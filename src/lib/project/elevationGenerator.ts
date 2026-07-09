/**
 * Wall elevation generation — Claude JSON + deterministic SVG renderer.
 */

import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "@/lib/aiRetry";
import {
  collectAnthropicTextBlocks,
  parseAssistantJsonObject,
} from "@/lib/creativeDirectorJson";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import type {
  FloorPlanAnalysis,
  MasterDesignConcept,
  RoomResult,
  WallElevation,
  WallElevationSet,
  DimensionAnnotation,
  ElevationElement,
  MaterialBand,
} from "./types";
import { prepareApprovedWallElevations } from "./approvedRoomPlanBuilder";

const MAX_ELEVATIONS = 10;

function buildElevationPrompt(
  analysis: FloorPlanAnalysis,
  concept: MasterDesignConcept,
  approvedRooms: RoomResult[],
): string {
  const roomDetails = approvedRooms
    .map((r) => {
      const mat = r.materials;
      return `  - ${r.brief.roomName} (${r.brief.roomType}, id=${r.brief.roomId}):
    wallColor: ${r.brief.wallColor.ncs}
    floor: ${mat?.floorMaterial.type ?? r.brief.floorMaterial}
    furniture: ${r.brief.furnitureList.slice(0, 6).join(", ")}
    key elements: ${r.brief.keyDesignElements.join(", ")}`;
    })
    .join("\n");

  return `You are an interior design drafter creating wall elevation drawings for a residential project.

FLOOR PLAN:
${JSON.stringify(analysis.rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, dimensions: r.dimensions })), null, 2)}

DESIGN CONCEPT: ${concept.overallStyle}
ROOMS:
${roomDetails}

Generate elevation data for the most important walls (max ${MAX_ELEVATIONS} total). Prioritize:
- TV / living room feature wall
- Kitchen run (cabinetry, backsplash, appliances)
- Bathroom vanity / shower wall
- Wardrobe / built-in wall
- Bedroom headboard wall

All dimensions in millimeters. Origin bottom-left of each wall elevation.

Respond ONLY with valid JSON:
{
  "elevations": [
    {
      "elevationId": "string",
      "roomId": "string",
      "roomName": "string",
      "wallLabel": "string (e.g. TV Wall, Kitchen North Wall)",
      "wallWidthMm": number,
      "wallHeightMm": number,
      "elements": [
        { "type": "string (cabinet|shelf|tv|mirror|sink|tile_band|art|socket)", "label": "string", "x": number, "y": number, "width": number, "height": number, "material": "string" }
      ],
      "materialBands": [
        { "yStart": number, "yEnd": number, "material": "string", "color": "#hex optional" }
      ],
      "dimensions": [
        { "start": [x, y], "end": [x, y], "value": "string", "offset": number }
      ]
    }
  ]
}

Use realistic proportions. Wall height typically ${analysis.ceilingHeight || 2700}mm.`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseDims(arr: unknown): DimensionAnnotation[] {
  return (Array.isArray(arr) ? arr : []).filter(isRecord).map((d) => ({
    start: Array.isArray(d.start)
      ? ([Number(d.start[0]) || 0, Number(d.start[1]) || 0] as [number, number])
      : [0, 0],
    end: Array.isArray(d.end)
      ? ([Number(d.end[0]) || 0, Number(d.end[1]) || 0] as [number, number])
      : [0, 0],
    value: typeof d.value === "string" ? d.value : "0",
    offset: typeof d.offset === "number" ? d.offset : 150,
  }));
}

function parseElevations(raw: unknown): WallElevation[] {
  const o = isRecord(raw) ? raw : {};
  const arr = Array.isArray(o.elevations) ? o.elevations : [];
  return arr
    .filter(isRecord)
    .slice(0, MAX_ELEVATIONS)
    .map((e, i) => ({
      elevationId: typeof e.elevationId === "string" ? e.elevationId : `elev-${i}`,
      roomId: typeof e.roomId === "string" ? e.roomId : "",
      roomName: typeof e.roomName === "string" ? e.roomName : "",
      wallLabel: typeof e.wallLabel === "string" ? e.wallLabel : `Wall ${i + 1}`,
      wallWidthMm: Number(e.wallWidthMm) || 4000,
      wallHeightMm: Number(e.wallHeightMm) || 2700,
      elements: (Array.isArray(e.elements) ? e.elements : []).filter(isRecord).map((el) => ({
        type: typeof el.type === "string" ? el.type : "element",
        label: typeof el.label === "string" ? el.label : "",
        x: Number(el.x) || 0,
        y: Number(el.y) || 0,
        width: Number(el.width) || 500,
        height: Number(el.height) || 500,
        material: typeof el.material === "string" ? el.material : undefined,
      })),
      materialBands: (Array.isArray(e.materialBands) ? e.materialBands : [])
        .filter(isRecord)
        .map((b) => ({
          yStart: Number(b.yStart) || 0,
          yEnd: Number(b.yEnd) || 0,
          material: typeof b.material === "string" ? b.material : "",
          color: typeof b.color === "string" ? b.color : undefined,
        })),
      dimensions: parseDims(e.dimensions),
    }));
}

export async function generateWallElevations(
  analysis: FloorPlanAnalysis,
  concept: MasterDesignConcept,
  approvedRooms: RoomResult[],
): Promise<WallElevationSet> {
  const anthropicKey = getAnthropicApiKey();
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey: anthropicKey });
  const prompt = buildElevationPrompt(analysis, concept, approvedRooms);

  logClaudeRequest({
    label: "wall-elevations",
    model: "claude-opus-4-8",
    maxTokens: 16384,
    messages: [{ type: "text", text: prompt }],
    context: { approvedRooms: approvedRooms?.length },
  });

  const response = await withRetry(
    () =>
      client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 16384,
        messages: [{ role: "user", content: prompt }],
      }),
    "Wall elevations",
  );

  if (response.stop_reason === "max_tokens") {
    console.warn(
      "[Wall elevations] Response hit max_tokens; truncated JSON repair will be attempted.",
    );
  }

  const rawText = collectAnthropicTextBlocks(response.content);
  if (!rawText) {
    throw new Error("Wall elevations returned no text response");
  }

  let parsed: unknown;
  try {
    parsed = parseAssistantJsonObject(rawText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid JSON";
    throw new Error(`Wall elevations JSON parse failed: ${msg}`);
  }

  const elevations = parseElevations(parsed);
  logClaudeResponse({
    label: "wall-elevations",
    response,
    rawText,
    parsed: elevations,
  });
  return prepareApprovedWallElevations({ elevations }, approvedRooms, analysis);
}

function wallWidthForRoom(roomId: string, analysis: FloorPlanAnalysis): number {
  const room = analysis.rooms.find((r) => r.id === roomId);
  if (room?.polygon && room.polygon.length >= 2) {
    const xs = room.polygon.map((p) => p[0]);
    return Math.max(...xs) - Math.min(...xs);
  }
  const w = room?.dimensions?.width ?? 4;
  return w > 50 ? w : w * 1000;
}

/** Build schematic elevations from approved room data when AI output is empty or unusable. */
export function buildFallbackElevations(
  approvedRooms: RoomResult[],
  analysis: FloorPlanAnalysis,
): WallElevation[] {
  const wallH = analysis.ceilingHeight || 2700;
  return approvedRooms.slice(0, MAX_ELEVATIONS).map((room, i) => {
    const wallW = wallWidthForRoom(room.brief.roomId, analysis);
    const mat = room.materials;
    const floorMat = mat?.floorMaterial.type ?? room.brief.floorMaterial;
    const wallHex = room.brief.wallColor.hex;
    const elements: ElevationElement[] = [];
    let cursorX = 400;
    for (const label of room.brief.furnitureList.slice(0, 4)) {
      const l = label.toLowerCase();
      const isTv = l.includes("tv") || l.includes("media");
      const isCabinet = l.includes("cabinet") || l.includes("wardrobe") || l.includes("shelf");
      const w = isTv ? 1200 : isCabinet ? 800 : 600;
      const h = isTv ? 700 : isCabinet ? 2200 : 450;
      const y = isCabinet ? 0 : isTv ? 900 : 400;
      elements.push({
        type: isTv ? "tv" : isCabinet ? "cabinet" : "furniture",
        label: label.slice(0, 24),
        x: cursorX,
        y,
        width: Math.min(w, wallW - cursorX - 200),
        height: h,
        material: label,
      });
      cursorX += w + 200;
      if (cursorX > wallW - 400) break;
    }
    return {
      elevationId: `elev-fallback-${room.roomId}`,
      roomId: room.brief.roomId,
      roomName: room.brief.roomName,
      wallLabel: room.brief.keyDesignElements[0] ?? "Feature wall",
      wallWidthMm: wallW,
      wallHeightMm: wallH,
      elements,
      materialBands: [
        { yStart: 0, yEnd: 120, material: floorMat, color: "#e8e0d4" },
        { yStart: 120, yEnd: wallH, material: room.brief.wallColor.ncs, color: wallHex },
      ],
      dimensions: [
        {
          start: [0, 0],
          end: [wallW, 0],
          value: `${(wallW / 1000).toFixed(2)} m`,
          offset: 120,
        },
        {
          start: [0, 0],
          end: [0, wallH],
          value: `${(wallH / 1000).toFixed(2)} m`,
          offset: 120,
        },
      ],
    };
  });
}

export function prepareWallElevationsForRender(
  set: WallElevationSet,
  approvedRooms: RoomResult[],
  analysis: FloorPlanAnalysis | null,
): WallElevationSet {
  const valid =
    set.elevations.length > 0 &&
    set.elevations.some((e) => e.elements.length > 0 || e.materialBands.length > 0);
  if (valid || !analysis || approvedRooms.length === 0) return set;
  return { elevations: buildFallbackElevations(approvedRooms, analysis) };
}

function renderElevationDims(dims: DimensionAnnotation[], wallH: number): string {
  return dims
    .map((d) => {
      const [sx, sy] = d.start;
      const [ex, ey] = d.end;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      const offset = d.offset ?? 150;
      // Elevation space: origin bottom-left, Y grows up — flip to SVG Y-down.
      const fsy = wallH - sy;
      const fey = wallH - ey;
      const fmy = wallH - my;
      return `
      <line x1="${sx}" y1="${fsy}" x2="${ex}" y2="${fey}" stroke="#334155" stroke-width="1.5"/>
      <text x="${mx + offset}" y="${fmy}" font-size="55" fill="#334155">${d.value}</text>`;
    })
    .join("\n");
}

function renderElevationElementsFlipped(elements: ElevationElement[], wallH: number): string {
  return elements
    .map((el) => {
      const fill =
        el.type === "cabinet" || el.type === "wardrobe"
          ? "#e8e4df"
          : el.type === "tile_band"
            ? "#d4d4d4"
            : el.type === "tv"
              ? "#1e293b"
              : "#f5f5f5";
      const svgY = wallH - el.y - el.height;
      return `
      <rect x="${el.x}" y="${svgY}" width="${el.width}" height="${el.height}" fill="${fill}" stroke="#334155" stroke-width="2"/>
      <text x="${el.x + el.width / 2}" y="${svgY + el.height / 2}" text-anchor="middle" dominant-baseline="central" font-size="58" fill="#475569">${el.label || el.type}</text>`;
    })
    .join("\n");
}

function renderMaterialBandsFlipped(bands: MaterialBand[], wallWidth: number, wallH: number): string {
  return bands
    .map((b) => {
      const svgY = wallH - b.yEnd;
      const h = b.yEnd - b.yStart;
      const fill = b.color || "#eee";
      return `
      <rect x="0" y="${svgY}" width="${wallWidth}" height="${h}" fill="${fill}" fill-opacity="0.3" stroke="none"/>
      <text x="${wallWidth - 80}" y="${svgY + h / 2}" text-anchor="end" font-size="48" fill="#64748b">${b.material}</text>`;
    })
    .join("\n");
}

export function renderElevationToSvg(elevation: WallElevation): string {
  const w = elevation.wallWidthMm;
  const h = elevation.wallHeightMm;
  const pad = 400;
  const viewBox = `${-pad} ${-pad - 200} ${w + 2 * pad} ${h + 2 * pad + 400}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" style="background:#fff" font-family="Arial, Helvetica, sans-serif">
  <text x="${w / 2}" y="-100" text-anchor="middle" font-size="120" font-weight="bold" fill="#1e293b">${elevation.roomName} — ${elevation.wallLabel}</text>
  <rect x="0" y="0" width="${w}" height="${h}" fill="#fff" stroke="#334155" stroke-width="4"/>
  ${renderMaterialBandsFlipped(elevation.materialBands, w, h)}
  ${renderElevationElementsFlipped(elevation.elements, h)}
  ${renderElevationDims(elevation.dimensions, h)}
  <text x="${w / 2}" y="${h + 120}" text-anchor="middle" font-size="70" fill="#888">${w} × ${h} mm</text>
</svg>`;
}

export function renderAllElevations(set: WallElevationSet): { id: string; svg: string }[] {
  return set.elevations.map((e) => ({
    id: e.elevationId,
    svg: renderElevationToSvg(e),
  }));
}
