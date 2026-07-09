/**
 * Viewpoint-grounded photo analysis.
 *
 * Uses OpenAI vision to analyze a room photo together with its pre-computed
 * geometric framing (from `resolveViewpointFraming`), producing a photo-verified
 * structural description. The output is merged with authoritative geometry
 * dimensions and sent to Gemini as a spatial constraint during all render phases.
 */

import { withRetry } from "@/lib/aiRetry";
import { parseAssistantJsonObject } from "@/lib/creativeDirectorJson";
import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { pipelineLog } from "@/lib/pipelineLog";
import type { ViewpointFraming } from "./viewpointFraming";
import type { DetectedRoom, ViewpointPhotoAnalysis } from "./types";
import { parseStructuralMembers } from "@/lib/photoStructuralElements";

function buildViewpointAnalysisPrompt(framing: ViewpointFraming): string {
  return `You are an expert architectural analyst. You are given a room photo and a geometric description of the camera position within the room (derived from the floor plan). Your job is to VERIFY what the geometry predicts against what you actually SEE in the photo, and describe the physical condition of each visible surface.

GEOMETRIC CAMERA DESCRIPTION (from floor plan analysis):
${framing.note}
${framing.openingsSummary}

INSTRUCTIONS:
1. For each visible wall (left, center/ahead, right), confirm or correct the predicted openings (windows, doors). State whether each predicted opening is actually visible in the photo.
2. Describe the CURRENT surface finish of each visible wall (e.g. "bare concrete", "white plaster", "painted beige", "ceramic tile", "wallpaper").
3. Note any architectural features visible on each wall (recessed niches, built-in shelving, load-bearing columns, exposed beams, electrical panels, radiators).
4. Describe the ceiling type and any visible features.
5. Describe the current floor finish.
6. Add any structural notes that would matter for an interior design render (e.g. "uneven walls", "very low ceiling in corner", "large pipe running along east wall").
7. List every freestanding load-bearing column, post, or pier visible in the photo under "structuralMembers" — NOT wall jogs, L-shaped corners, or plan notches. Do not infer from the floor plan; photo evidence only. If none visible, use an empty array.

Respond ONLY with valid JSON matching this schema:
{
  "walls": [
    {
      "position": "left" | "center" | "right" | "partial-left" | "partial-right",
      "compass": "string (e.g. north, east, south, west — echo from the geometric description)",
      "openings": [
        {
          "type": "window" | "door",
          "placementAlongWall": "string (e.g. centered, offset 30% from left, near right corner)",
          "confirmed": true | false,
          "bbox": { "x": number, "y": number, "w": number, "h": number }
        }
      ],
      "features": ["string array of architectural features visible on this wall"],
      "currentFinish": "string describing the current wall surface"
    }
  ],
  "ceiling": {
    "type": "string (flat, coffered, sloped, suspended, exposed beams, etc.)",
    "features": ["string array — e.g. recessed lights, crown molding, skylight"]
  },
  "floor": {
    "currentFinish": "string (concrete screed, laminate, hardwood, tile, carpet, etc.)"
  },
  "structuralNotes": "string — anything else structurally relevant for rendering",
  "structuralMembers": [
    {
      "type": "column" | "post" | "pier" | "beam",
      "position": "string (camera-relative: left | center | right | foreground | mid-room)",
      "confidence": "high" | "medium" | "low",
      "bbox": { "x": number, "y": number, "w": number, "h": number },
      "description": "string (optional, max 60 chars, debug only)"
    }
  ]
}

For each CONFIRMED opening, include "bbox": a tight bounding box of the visible opening as fractions of the image (0–1), top-left origin — x,y = top-left corner, w,h = width/height (glass area for windows, the leaf or clear passage for doors). Omit "bbox" only when the opening is too occluded to box.

For each structuralMember with confidence "high", you MUST include "bbox" — a tight box around the visible member (same 0–1 coordinate system). Use confidence "high" only when the member is clearly visible and boxable.

Only include walls that are actually visible in the photo. If a wall is only partially visible, use "partial-left" or "partial-right".`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

/** Parse a normalized opening bbox; clamps to the image and drops degenerate boxes. */
function parseBbox(v: unknown): { x: number; y: number; w: number; h: number } | undefined {
  if (!isRecord(v)) return undefined;
  const num = (k: unknown) => (typeof k === "number" && Number.isFinite(k) ? k : NaN);
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const x = clamp01(num(v.x));
  const y = clamp01(num(v.y));
  let w = clamp01(num(v.w ?? v.width));
  let h = clamp01(num(v.h ?? v.height));
  if (![x, y, w, h].every(Number.isFinite)) return undefined;
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  if (w <= 0.005 || h <= 0.005) return undefined;
  return { x, y, w, h };
}

function normalizeAnalysisResult(raw: unknown): ViewpointPhotoAnalysis {
  const o = isRecord(raw) ? raw : {};

  const wallsRaw = Array.isArray(o.walls) ? o.walls : [];
  const walls = wallsRaw.filter(isRecord).map((w) => {
    const openingsRaw = Array.isArray(w.openings) ? w.openings : [];
    return {
      position: asString(w.position, "center") as ViewpointPhotoAnalysis["walls"][number]["position"],
      compass: asString(w.compass, "unknown"),
      openings: openingsRaw.filter(isRecord).map((op) => {
        const bbox = parseBbox(op.bbox);
        return {
          type: asString(op.type, "window") as "window" | "door",
          placementAlongWall: asString(op.placementAlongWall, "centered"),
          confirmed: op.confirmed !== false,
          ...(bbox ? { bbox } : {}),
        };
      }),
      features: (Array.isArray(w.features) ? w.features : []).filter(
        (f): f is string => typeof f === "string",
      ),
      currentFinish: asString(w.currentFinish, "unknown"),
    };
  });

  const ceilingRaw = isRecord(o.ceiling) ? o.ceiling : {};
  const floorRaw = isRecord(o.floor) ? o.floor : {};

  return {
    walls,
    ceiling: {
      type: asString(ceilingRaw.type, "flat"),
      features: (Array.isArray(ceilingRaw.features) ? ceilingRaw.features : []).filter(
        (f): f is string => typeof f === "string",
      ),
    },
    floor: {
      currentFinish: asString(floorRaw.currentFinish, "unknown"),
    },
    structuralNotes: asString(o.structuralNotes, ""),
    structuralMembers: parseStructuralMembers(o.structuralMembers),
  };
}

export async function analyzePhotoWithViewpoint(
  photoBase64: string,
  photoMimeType: string,
  framing: ViewpointFraming,
  coneDiagram?: { base64: string; mimeType: string },
): Promise<ViewpointPhotoAnalysis> {
  const openAiKey = getOpenAiApiKey();
  if (!openAiKey) throw new Error("OPENAI_API_KEY is not configured");

  pipelineLog("ANALYZE_IMAGES_VIEWPOINTS", "openai viewpoint photo analysis start", {
    model: process.env.FLOOR_PLAN_ANALYSIS_MODEL || "gpt-5.5",
    facing: framing.facing,
    photoKB: Math.round((photoBase64.length * 3) / 4 / 1024),
    hasConeDiagram: !!coneDiagram,
  });

  const prompt = buildViewpointAnalysisPrompt(framing);

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

  const content: ContentPart[] = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: `data:${photoMimeType};base64,${photoBase64}` } },
  ];

  if (coneDiagram) {
    content.push({
      type: "text",
      text: "The following diagram shows the room from above with the camera position (dot) and field of view (shaded wedge). Use it to understand which walls correspond to left/center/right in the photo.",
    });
    content.push({
      type: "image_url",
      image_url: { url: `data:${coneDiagram.mimeType};base64,${coneDiagram.base64}` },
    });
  }

  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const response = await withRetry(async () => {
    const res = await openAiFetch(
      apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model: process.env.FLOOR_PLAN_ANALYSIS_MODEL || "gpt-5.5",
          messages: [{ role: "user", content }],
          response_format: { type: "json_object" },
          max_completion_tokens: 4000,
        }),
      },
      { vision: true },
    );
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const err: Error & { status?: number } = new Error(
        `OpenAI viewpoint photo analysis failed (${res.status}): ${errBody.slice(0, 500)}`,
      );
      err.status = res.status;
      throw err;
    }
    return res.json();
  }, "Viewpoint photo analysis");

  const assistantText = response?.choices?.[0]?.message?.content;
  if (!assistantText || typeof assistantText !== "string") {
    throw new Error("Viewpoint photo analysis returned no text response");
  }

  const parsed = parseAssistantJsonObject(assistantText);
  const result = normalizeAnalysisResult(parsed);
  const confirmedOpenings = result.walls.flatMap((w) =>
    w.openings.filter((o) => o.confirmed).map((o) => o.type),
  );
  pipelineLog("ANALYZE_IMAGES_VIEWPOINTS", "openai viewpoint photo analysis complete", {
    wallCount: result.walls.length,
    confirmedOpeningCount: confirmedOpenings.length,
    confirmedWindows: confirmedOpenings.filter((t) => t === "window").length,
    confirmedDoors: confirmedOpenings.filter((t) => t === "door").length,
    ceilingType: result.ceiling.type,
    floorFinish: result.floor.currentFinish,
    structuralMemberCount: result.structuralMembers.length,
    highConfidenceStructuralCount: result.structuralMembers.filter((m) => m.confidence === "high").length,
  });
  return result;
}

/**
 * Merge geometry-sourced dimensions with photo-observed details into a
 * natural-language prompt block for Gemini.
 */
export function formatViewpointAnalysisForPrompt(
  framing: ViewpointFraming,
  analysis: ViewpointPhotoAnalysis,
  room: DetectedRoom | undefined,
): string {
  const lines: string[] = [
    "CAMERA VANTAGE (camera orientation + current surface condition — match the photo's exact viewpoint):",
    framing.standingDesc + ".",
    "Openings (windows/doors): see the OPENINGS lock below — the floor plan is authoritative for the count, wall, and position of every opening; this photo is the visual base only.",
  ];

  const dims = room?.dimensions;
  const wallDimensions = new Map<string, number>();
  if (dims) {
    // Approximate: compass directions map to width/depth
    wallDimensions.set("north", dims.width);
    wallDimensions.set("south", dims.width);
    wallDimensions.set("east", dims.depth);
    wallDimensions.set("west", dims.depth);
  }

  for (const wall of analysis.walls) {
    // Openings are intentionally omitted here — placement is owned solely by the
    // floor-plan opening lock. This block describes camera orientation + surface finish.
    const dimM = wallDimensions.get(wall.compass);
    const dimStr = dimM ? `${dimM}m long` : "";
    const featStr = wall.features.length > 0
      ? `, features: ${wall.features.join(", ")}`
      : "";

    const posLabel = wall.position.toUpperCase();
    const compassLabel = wall.compass.toUpperCase();
    lines.push(
      `${posLabel} WALL (${compassLabel}): ${dimStr}${dimStr ? ", " : ""}${wall.currentFinish}${featStr}.`,
    );
  }

  const heightStr = dims?.height ? `${dims.height}m` : "standard";
  const ceilFeats = analysis.ceiling.features.length > 0
    ? `, ${analysis.ceiling.features.join(", ")}`
    : "";
  lines.push(`Ceiling: ${heightStr}, ${analysis.ceiling.type}${ceilFeats}.`);
  lines.push(`Floor: ${analysis.floor.currentFinish}.`);

  if (analysis.structuralNotes) {
    lines.push(`Structural: ${analysis.structuralNotes}.`);
  }

  return lines.join("\n");
}
