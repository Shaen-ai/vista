/**
 * Claude → apartment-staging render director (project custom mode).
 *
 * Claude runs ONCE at concept time for ALL rooms on the floor plan:
 *   floor plan images + room photos + viewpoint matrix → per-room designConcept,
 *   finishLock, and per-photo stagingPrompt (~80–220 chars each).
 *
 * FAL apartment-staging runs PER PHOTO with prep photo + that photo's stagingPrompt.
 */

import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "@/lib/aiRetry";
import {
  collectAnthropicTextBlocks,
  parseAssistantJsonObject,
} from "@/lib/creativeDirectorJson";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import { pipelineLog } from "@/lib/pipelineLog";
import { optimizeImageBufferForAi } from "@/lib/optimizeImageForAi";
import { getStylePresetOrDefault } from "@/lib/project/stylePresets";
import type { InteriorPreferencesPrompt, RoomStructuralMetrics } from "@/lib/buildStructuralGuardrailPrompt";
import { buildStructuralGuardrailPrompt } from "@/lib/buildStructuralGuardrailPrompt";
import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import { metricsFromSummarizeRoomParams } from "@/lib/buildStructuralGuardrailPrompt";
import { summarizeRoomParams } from "@/lib/pipelineLog";
import {
  roomSummaryText,
  renderHighlightedFloorPlan,
} from "./roomFloorPlanContext";
import { resolveViewpointFraming, framingVisibleOpenings, photoVerifiedVisibleOpenings } from "./viewpointFraming";
import type {
  DetectedRoom,
  FloorPlanAnalysis,
  ProjectState,
  RoomRenderPlan,
  UserPreferences,
} from "./types";
import { getRoomPhotos } from "./types";

const CLAUDE_RENDER_MODEL =
  process.env.ANTHROPIC_ROOM_GEOMETRY_MODEL?.trim() || "claude-opus-4-8";

/**
 * 7 rooms × 300–400-word concepts + per-photo renderInstructions overflow an
 * 8K output budget — the truncated JSON silently dropped rooms into the
 * deterministic fallback. 32K needs the streaming API (SDK timeout guard).
 */
const DIRECTOR_MAX_OUTPUT_TOKENS = 32000;

import {
  buildPhotoStagingPromptFromPlan,
  buildStagingPromptFromConcept,
  clampStagingPrompt,
  countWords,
  padDesignConceptToMinimum,
  parseAllRoomsStagingResponse,
  STAGING_PROMPT_MAX_CHARS,
  DESIGN_CONCEPT_TARGET_MIN_WORDS,
  DESIGN_CONCEPT_TARGET_MAX_WORDS,
  type PhotoMatrixEntry,
} from "./stagingConceptParse";
import { assembleStagingPrompt } from "./stagingPromptAssembly";
import { formatOpeningLockParts } from "./stagingOpeningLockFormat";

export {
  buildStagingPromptFromConcept,
  clampDesignConceptWords,
  clampStagingPrompt,
  countWords,
  DESIGN_CONCEPT_MIN_WORDS,
  DESIGN_CONCEPT_TARGET_MIN_WORDS,
  DESIGN_CONCEPT_TARGET_MAX_WORDS,
  STAGING_PROMPT_MIN_CHARS,
  STAGING_PROMPT_MAX_CHARS,
} from "./stagingConceptParse";

/** @deprecated Kontext-era char limits — kept for log compatibility. */
export const RENDER_PROMPT_MIN_CHARS = 500;
export const RENDER_PROMPT_MAX_CHARS = 1000;

function summarizePlansForLog(plans: Record<string, RoomRenderPlan>) {
  return Object.values(plans).map((p) => ({
    roomId: p.roomId,
    roomName: p.roomName,
    conceptWords: countWords(p.designConcept),
    stagingPromptChars: p.stagingPrompt?.length ?? 0,
    photoPromptCount: p.photoPrompts?.length ?? 0,
    inWordTarget:
      countWords(p.designConcept) >= DESIGN_CONCEPT_TARGET_MIN_WORDS &&
      countWords(p.designConcept) <= DESIGN_CONCEPT_TARGET_MAX_WORDS,
    preview: p.designConcept.slice(0, 100),
  }));
}

function buildPhotoMatrixForParse(state: ProjectState, analysis: FloorPlanAnalysis): Record<string, PhotoMatrixEntry[]> {
  const byRoom: Record<string, PhotoMatrixEntry[]> = {};
  for (const room of analysis.rooms) {
    byRoom[room.id] = getRoomPhotos(state, room.id).map((p) => {
      const framing = p.viewpoint ? resolveViewpointFraming(p.viewpoint, room) : null;
      return {
        photoId: p.id,
        label: p.label,
        cameraNote: framing?.note ?? null,
      };
    });
  }
  return byRoom;
}

/** Every photo assigned to a room must have a floor-plan viewpoint before concept/render. */
export function assertAssignedPhotosHaveViewpoints(state: ProjectState): void {
  if (!state.analysis?.rooms?.length) return;
  const missing: string[] = [];
  for (const room of state.analysis.rooms) {
    for (const photo of getRoomPhotos(state, room.id)) {
      if (!photo.viewpoint) {
        missing.push(`${photo.label || photo.id} (${room.name})`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Place a camera viewpoint on the floor plan for each room photo before continuing: ${missing.join(", ")}`,
    );
  }
}

function countPhotosInMatrix(matrix: unknown): number {
  if (!matrix || typeof matrix !== "object") return 0;
  let n = 0;
  for (const photos of Object.values(matrix as Record<string, unknown>)) {
    if (Array.isArray(photos)) n += photos.length;
  }
  return n;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function buildPhotoAssignmentMatrix(state: ProjectState, analysis: FloorPlanAnalysis): unknown {
  const byRoom: Record<string, unknown[]> = {};
  for (const room of analysis.rooms) {
    const photos = getRoomPhotos(state, room.id);
    byRoom[room.id] = photos.map((p) => {
      const framing = p.viewpoint ? resolveViewpointFraming(p.viewpoint, room) : null;
      return {
        photoId: p.id,
        label: p.label,
        viewpoint: p.viewpoint ?? null,
        cameraNote: framing?.note ?? null,
        facing: framing?.facing ?? null,
        visibleOpenings: framing?.openingsSummary ?? null,
      };
    });
  }
  return byRoom;
}

const SPACE_AWARE_RULES = `SPACE-AWARE HARD RULES — do not violate:
- Do NOT propose built-in wardrobes, walk-in closets, floor-to-ceiling cabinetry, kitchen islands, bathtubs, or other large fixed elements unless the floor plan clearly supports them for that room.
- Ground every furniture choice in: room type, dimensions (width × depth × height), estimated area, door/window positions, columns, and features[] from the floor-plan analysis.
- Small rooms (< 8 m²), narrow hallways, toilets, or wardrobe alcoves without a dedicated closet polygon: freestanding furniture only — no built-ins.
- Built-in wardrobe/closet wall only when room type is wardrobe/storage, OR features mention closet/wardrobe, OR the polygon is clearly a dedicated closet niche — and dimensions fit without blocking doors.
- Never invent storage that would block a door swing or window shown on the plan.
- Bathroom/toilet: no shower/bath unless room type and area plausibly support it; prefer compact fixtures in small WCs.
- Polygon corners and L-shaped wall jogs are wall outlines — NOT freestanding columns unless clearly visible in photos.`;

const SURFACE_FINISH_RULES = `SURFACE-FINISH RULES — finishLock and wall/ceiling descriptions must be SURFACE finishes only:
- ceilingDesign: paint color, flat ceiling color, or subtle texture only — NEVER tray steps, coves, soffits, bulkheads, coffers, beams, or built-in LED channels unless clearly visible in the original photo.
- wallColor: paint color or wall texture only — NEVER paneling, niches, recesses, wainscoting, or built-in light channels unless clearly visible in the photo.
- lightingConcept: surface-mounted or freestanding fixtures only (flush mount, pendant, floor/table lamps) — no recessed architectural lighting channels or cove lighting unless already in the photo.
- If style presets mention tray ceilings, LED coves, or beams, translate them into flat painted surfaces and standalone fixtures instead.`;

const HOUSEHOLD_ALLOCATION_RULES = `HOUSEHOLD ALLOCATION RULES — sleeping capacity is distributed across the WHOLE home:
- Any household description in the wishes or preferences (family size, "N people", "husband + wife + children") describes the ENTIRE home, NEVER a single room. Do not furnish one room for the whole household.
- Allocate sleeping across all bedrooms on the plan: the parents' bedroom gets exactly one double/queen bed; a children/kids room gets the children's beds (single beds or a bunk bed sized to the children count); guest bedrooms get one bed.
- NEVER place the entire household's sleeping capacity in one room. A bedroom with more than one sleeping arrangement (e.g. bunk bed + extra beds) is a FAILURE unless it is explicitly a children room shared by multiple children.
- Living rooms, kitchens, hallways, and bathrooms get NO beds unless the plan has no bedroom at all.
- State the chosen allocation explicitly in each bedroom's designConcept (e.g. "parents' bedroom: one queen bed" / "children room: two single beds for the three children" when counts allow).`;

const FULLY_FURNISHED_RULES = `FULLY-FURNISHED RULES — every room must read as a complete, professionally staged, lived-in space:
- No bare walls, empty corners, or single-piece rooms. A room with only one or two furniture pieces is a FAILURE.
- Include the FULL furniture complement for the room type. Examples: bedroom = bed + nightstands + bedside lamps + wardrobe or dresser + bench or accent chair + area rug; living room = sofa + coffee table + TV stand or media wall + armchair + side table + rug; kids room = bed + desk + chair + wardrobe + toy storage + rug; dining = table + chairs + sideboard.
- Then layer decor throughout: area rug, curtains/window treatments on every window, layered lighting (ceiling fixture plus floor or table lamps), wall art on major walls, plants, textiles (throws, cushions, bedding), books and props on surfaces, and shelving where the plan supports it.
- Choose any real-world furniture and decor appropriate to the style — do NOT restrict choices to any product catalog.
- Density must still respect the SPACE-AWARE HARD RULES: keep walkways clear, never block door swings or windows, and scale down the complement in small rooms (< 8 m²) rather than omitting decor layers.`;

function buildStagingClaudePrompt(
  analysis: FloorPlanAnalysis,
  preferences: UserPreferences,
  photoMatrix: unknown,
  inspirationUploads: Array<{ label: string }> = [],
  roomsToCover: DetectedRoom[] = analysis.rooms,
): string {
  const style = getStylePresetOrDefault(preferences.style);
  const planText = roomSummaryText(analysis);

  const wishes = preferences.wishes.trim();
  const roomWishes = preferences.roomWishes ?? {};
  const hasRoomWishes = roomsToCover.some((r) => roomWishes[r.id]?.trim());

  const styleReferenceBlock = inspirationUploads.length
    ? `PRIORITY 1 — STYLE REFERENCE PHOTOS (${inspirationUploads.length} image${inspirationUploads.length > 1 ? "s" : ""} labeled "STYLE REFERENCE PHOTO" above): the user's most concrete signal of the look they want. They are the visual ground truth for color palette, materials, furniture silhouettes, textures, decor density, and lighting mood.
- FIRST analyze the reference photos and fill "referenceStyleAnalysis" in your JSON: dominant colors (hex + name), materials, furniture character, decor motifs, lighting mood, decor density.
- Then REUSE those exact tokens: the apartment-wide colorPalette, materialPalette, overallStyle, and every room's designConcept, finishLock, and every photoPrompts[].renderInstruction MUST name the reference colors, materials, and motifs explicitly — the render model only sees the text, so the reference look must be spelled out in it.
- On ANY conflict with the named style preset, the reference photos win.
- Use reference photos for STYLE ONLY: never copy their room geometry, layout, or camera angles — geometry always comes from the floor plan and room photos.${inspirationUploads.some((u) => u.label?.trim()) ? "\n- Per-photo user notes indicate what the user liked in that specific photo — honor them." : ""}
`
    : "";

  const roomWishesNote = hasRoomWishes
    ? `PRIORITY 1 — PER-ROOM WISHES: some rooms in ROOMS TO COVER below carry "USER WISHES FOR THIS ROOM" — explicit user instructions for that specific room. For that room they rank with the apartment-wide wishes and override the style preset on conflict; reflect them in that room's designConcept and every one of its photoPrompts[].renderInstruction.
`
    : "";
  const wishesBlock =
    (wishes
      ? `PRIORITY 1 — ADDITIONAL WISHES (explicit user instructions — honor every one; they override the style preset on conflict): ${wishes}
`
      : "") + roomWishesNote;

  return `You are an interior design director preparing concepts for a virtual staging pipeline (fal-ai/nano-banana-pro/edit).

You receive the uploaded floor plan, a whole-home schematic, room geometry logs, design preferences, style reference photos, room photos, and a photo/viewpoint matrix.

The render model receives each room's real photo plus a FULL per-photo renderInstruction — never the floor plan image.

For EVERY room, output:
1. "designConcept": **300–400 words** — authoritative room design narrative (PDF + UI source of truth). Dense prose, no markdown headers, no SKUs. Cite room dimensions when choosing furniture scale. Enumerate the COMPLETE furniture list and all decor layers (rug, window treatments, lighting, wall art, plants, textiles, props). Describe furniture roles, materials, palette, mood, and symmetric professional lighting.
2. "finishLock": shared finishes for ALL photos in this room — floorMaterial, ceilingDesign, wallColor, lightingConcept, optional paletteSummary (e.g. "light oak, sage accents").
3. "photoPrompts": **one entry per photo** in the matrix for this roomId (match photoId exactly). Each entry MUST include:
   - "renderInstruction": **full-length** instruction (300–1000 chars) with two sections:
     PRESERVE: exact room geometry, walls, doors, windows, ceiling, camera angle — do not change openings.
     CHANGE: finishes, furniture placement, decor, lighting — from finishLock + furnitureLayoutLock + camera-specific visible subset. Must include the decor layers visible from this camera (rug, curtains, lamps, wall art, plants, textiles), not only major furniture.
   - "stagingPrompt": optional legacy short distill (~80–220 chars) for apartment-staging rollback.
4. "furnitureLayoutLock": **required when 2+ photos** — 2-3 canonical sentences listing exactly one placement for EVERY furniture piece in the room (major pieces AND secondary pieces: bed, nightstands, wardrobe, desk, chairs, rug, lamps...). All photos are the SAME physical room; furniture positions must not move between views.
5. "stagingPrompt": optional legacy hero distill (= photoPrompts[0].stagingPrompt).
6. Structured metadata (style, colors, materials, furnitureList, mood) for technical plans and PDF.

PER-PHOTO RENDER RULES:
- Every photoPrompts[].renderInstruction MUST start with PRESERVE: (geometry + openings + camera) then CHANGE: (design).
- Repeat furnitureLayoutLock verbatim in every photo renderInstruction before the camera-specific visible subset.
- All photos are the SAME physical room — furniture positions must not move between views.
- Never instruct changing walls, openings, or camera — the photo defines geometry.
- Do NOT use phrases like "door wall" — when a door is visible, cameraNote must say "door opening visible" (not a solid wall).
- When a door opening is visible, the CHANGE section must describe a finished closed door (leaf + frame + casing matching the palette) filling that opening — never an empty or gray recess.
- furnitureLayoutLock must specify freestanding pieces only — never built-in or recessed wardrobes.

${SPACE_AWARE_RULES}

${HOUSEHOLD_ALLOCATION_RULES}

${SURFACE_FINISH_RULES}

${FULLY_FURNISHED_RULES}

HOME GEOMETRY LOG:
${planText}

PHOTO / VIEWPOINT MATRIX (JSON — photos grouped by roomId):
${JSON.stringify(photoMatrix, null, 2)}

DESIGN INPUTS — PRIORITY ORDER (a higher priority overrides any lower one on conflict):
${styleReferenceBlock}${wishesBlock}PRIORITY 2 — NAMED STYLE PRESET: ${style.label} — ${style.keywords}. ${inspirationUploads.length || wishes || hasRoomWishes ? "Baseline only: apply it where the reference photos and wishes are silent; wherever they conflict, the reference photos and wishes win." : "Primary style direction for the whole apartment."}
PRIORITY 3 — PRACTICAL CONSTRAINTS (inform durability, furniture count, and price class — never the visual direction above):
- Family members: ${preferences.familyMembers}
- Budget: ${preferences.budgetTier}

ROOMS TO COVER (must include every id):
${roomsToCover
  .map((r) => {
    const wish = roomWishes[r.id]?.trim();
    return `- ${r.id}: ${r.name} (${r.type})${wish ? ` — USER WISHES FOR THIS ROOM (priority 1): "${wish}"` : ""}`;
  })
  .join("\n")}

Respond ONLY with valid JSON:
{${
    inspirationUploads.length
      ? `
  "referenceStyleAnalysis": {
    "dominantColors": [{"hex": "#hex", "name": "color name"}],
    "materials": ["material extracted from reference photos"],
    "furnitureCharacter": "string (silhouettes, shapes, era)",
    "decorMotifs": ["motif1", "motif2"],
    "lightingMood": "string",
    "decorDensity": "string (minimal | moderate | dense/maximal)"
  },`
      : ""
  }
  "overallConcept": "string (1-2 sentences about apartment-wide design direction)",
  "overallStyle": "string (e.g. Modern Scandinavian, Industrial Loft)",
  "colorPalette": {
    "primary": {"hex": "#hex", "name": "color name"},
    "secondary": {"hex": "#hex", "name": "color name"},
    "accent": {"hex": "#hex", "name": "color name"},
    "neutral": {"hex": "#hex", "name": "color name"}
  },
  "materialPalette": {
    "woodType": "string",
    "metalFinish": "string",
    "stoneType": "string",
    "textilePrimary": "string"
  },
  "rooms": [
    {
      "roomId": "string (exact id from list)",
      "roomName": "string",
      "designConcept": "string (300-400 words — full space-aware room narrative)",
      "finishLock": {
        "floorMaterial": "string",
        "ceilingDesign": "string",
        "wallColor": "string",
        "lightingConcept": "string",
        "paletteSummary": "string (optional)"
      },
      "furnitureLayoutLock": "string (required when 2+ photos — 2-3 sentences, one canonical placement for every furniture piece, identical across views)",
      "photoPrompts": [
        {
          "photoId": "string (exact id from matrix)",
          "label": "string (optional)",
          "renderInstruction": "string (300-1000 chars; PRESERVE + CHANGE sections)",
          "stagingPrompt": "string (optional ~80-220 chars legacy)",
          "cameraNote": "string (optional)"
        }
      ],
      "stagingPrompt": "string (optional ~80-220 chars; hero fallback)",
      "style": "string (room style name)",
      "primaryColor": "#hex",
      "accentColor": "#hex",
      "materials": ["material1", "material2"],
      "mood": "string (brief mood description)",
      "furnitureList": ["only items that fit room dimensions"],
      "floorMaterial": "string",
      "wallColor": "#hex",
      "ceilingDesign": "string",
      "lightingConcept": "string"
    }
  ]
}`;
}

function asStr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

export interface ReferenceStyleAnalysis {
  dominantColors: Array<{ hex: string; name: string }>;
  materials: string[];
  furnitureCharacter?: string;
  decorMotifs: string[];
  lightingMood?: string;
  decorDensity?: string;
}

export interface EnrichedConceptResponse {
  plans: Record<string, RoomRenderPlan>;
  /** Design DNA Claude extracted from the user's style reference photos (absent without references). */
  referenceStyleAnalysis?: ReferenceStyleAnalysis;
  overallConcept?: string;
  overallStyle?: string;
  colorPalette?: {
    primary: { hex: string; name: string };
    secondary: { hex: string; name: string };
    accent: { hex: string; name: string };
    neutral: { hex: string; name: string };
  };
  materialPalette?: {
    woodType: string;
    metalFinish: string;
    stoneType: string;
    textilePrimary: string;
  };
}

function parseColorEntry(v: unknown): { hex: string; name: string } | undefined {
  if (!isRecord(v)) return undefined;
  const hex = asStr(v.hex, "");
  const name = asStr(v.name, "");
  return hex ? { hex, name } : undefined;
}

function parseReferenceStyleAnalysis(v: unknown): ReferenceStyleAnalysis | undefined {
  if (!isRecord(v)) return undefined;
  const dominantColors = Array.isArray(v.dominantColors)
    ? v.dominantColors
        .map(parseColorEntry)
        .filter((c): c is { hex: string; name: string } => c !== undefined)
    : [];
  const materials = asStrArr(v.materials);
  const decorMotifs = asStrArr(v.decorMotifs);
  const furnitureCharacter = asStr(v.furnitureCharacter, "");
  const lightingMood = asStr(v.lightingMood, "");
  const decorDensity = asStr(v.decorDensity, "");
  if (
    dominantColors.length === 0 &&
    materials.length === 0 &&
    decorMotifs.length === 0 &&
    !furnitureCharacter &&
    !lightingMood
  ) {
    return undefined;
  }
  return {
    dominantColors,
    materials,
    decorMotifs,
    ...(furnitureCharacter ? { furnitureCharacter } : {}),
    ...(lightingMood ? { lightingMood } : {}),
    ...(decorDensity ? { decorDensity } : {}),
  };
}

export function parseAllRoomsResponse(
  raw: unknown,
  analysis: FloorPlanAnalysis,
  photoMatrix?: Record<string, PhotoMatrixEntry[]>,
): EnrichedConceptResponse {
  const parsed = parseAllRoomsStagingResponse(raw, analysis, photoMatrix);
  const o = isRecord(raw) ? raw : {};
  const cp = isRecord(o.colorPalette) ? o.colorPalette : {};
  const mp = isRecord(o.materialPalette) ? o.materialPalette : {};

  return {
    ...parsed,
    referenceStyleAnalysis: parseReferenceStyleAnalysis(o.referenceStyleAnalysis),
    colorPalette: {
      primary: parseColorEntry(cp.primary) ?? { hex: "#2C3E50", name: "Dark Slate" },
      secondary: parseColorEntry(cp.secondary) ?? { hex: "#ECE5D8", name: "Warm Cream" },
      accent: parseColorEntry(cp.accent) ?? { hex: "#C8956C", name: "Amber" },
      neutral: parseColorEntry(cp.neutral) ?? { hex: "#F5F1EB", name: "Soft White" },
    },
    materialPalette: {
      woodType: asStr(mp.woodType, "oak"),
      metalFinish: asStr(mp.metalFinish, "brushed brass"),
      stoneType: asStr(mp.stoneType, "marble"),
      textilePrimary: asStr(mp.textilePrimary, "linen"),
    },
  };
}

function deterministicRoomPlan(
  room: DetectedRoom,
  preferences: InteriorPreferencesPrompt,
  roomAnalysis?: RoomAnalysis | null,
): RoomRenderPlan {
  const style = getStylePresetOrDefault(preferences.style);
  const metrics = metricsFromSummarizeRoomParams(
    summarizeRoomParams(room) as Record<string, unknown>,
    room.type,
  );
  const full = buildStructuralGuardrailPrompt({
    metrics,
    prefs: preferences,
    roomAnalysis: roomAnalysis ?? null,
    roomGeometry: null,
  });
  const designConcept = padDesignConceptToMinimum(full, room, style.label);
  // Don't derive prompts from the concept here — it opens with the structural
  // guardrail markup ("### CRITICAL ..."), which reads as garbage when excerpted
  // into "Furnish this room with ..." / "Furniture layout: ..." render lines.
  const stagingPrompt = clampStagingPrompt(
    `Furnish this ${room.name.toLowerCase()} as a complete, professionally staged ${style.label} ${room.type} with realistic furniture scaled to the room, cohesive materials, and warm layered lighting.`,
  );
  return {
    roomId: room.id,
    roomName: room.name,
    designConcept,
    stagingPrompt,
    geminiPrompt: designConcept,
    furnitureLayoutLock:
      "Choose a furniture set appropriate for this room type and keep every piece in one fixed position across all camera angles of this room.",
  };
}

/** FAL-direct: style-preset render prompts per room — no Claude API. */
export function buildDeterministicRoomRenderPlans(
  state: ProjectState,
): Record<string, RoomRenderPlan> {
  const analysis = state.analysis;
  if (!analysis?.rooms?.length) return {};

  const preferencesPrompt: InteriorPreferencesPrompt = {
    style: state.preferences.style,
    familyMembers: state.preferences.familyMembers,
    budgetTier: state.preferences.budgetTier,
    wishes: state.preferences.wishes,
  };

  const plans: Record<string, RoomRenderPlan> = {};
  for (const room of analysis.rooms) {
    const roomPlan = deterministicRoomPlan(room, preferencesPrompt);
    const roomWish = state.preferences.roomWishes?.[room.id]?.trim();
    if (roomWish) {
      roomPlan.designConcept = `${roomPlan.designConcept} User wishes for this room: ${roomWish}.`;
      roomPlan.geminiPrompt = roomPlan.designConcept;
    }
    plans[room.id] = roomPlan;
  }

  pipelineLog("CLAUDE_ROOM_CONCEPTS", "deterministic render plans (Claude skipped)", {
    projectId: state.id,
    roomCount: analysis.rooms.length,
    rooms: summarizePlansForLog(plans),
  });

  return plans;
}

/**
 * One Claude director request covering `roomsToCover`. The full floor plan and
 * schematic always go along for whole-home context; room photos and the
 * ROOMS-TO-COVER list are scoped to the subset. Streams the response (32K
 * output budget) and reports stop_reason so the caller can detect truncation.
 */
async function requestRoomPlansOnce(opts: {
  client: Anthropic;
  state: ProjectState;
  analysis: FloorPlanAnalysis;
  roomsToCover: DetectedRoom[];
  preferences: UserPreferences;
  photoMatrixForParse: Record<string, PhotoMatrixEntry[]>;
  attempt: "full" | "retry-missing";
}): Promise<{ enriched: EnrichedConceptResponse; stopReason: string | null }> {
  const { client, state, analysis, roomsToCover, preferences, photoMatrixForParse, attempt } =
    opts;

  const coveredIds = new Set(roomsToCover.map((r) => r.id));
  const fullMatrix = buildPhotoAssignmentMatrix(state, analysis) as Record<string, unknown>;
  const photoMatrix = Object.fromEntries(
    Object.entries(fullMatrix).filter(([roomId]) => coveredIds.has(roomId)),
  );

  const content: Anthropic.ContentBlockParam[] = [];

  if (state.floorPlanBase64) {
    content.push({ type: "text", text: "UPLOADED FLOOR PLAN (authoritative layout):" });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: (state.floorPlanMimeType || "image/jpeg") as
          | "image/jpeg"
          | "image/png"
          | "image/webp"
          | "image/gif",
        data: state.floorPlanBase64,
      },
    });
  }

  const schematic = await renderHighlightedFloorPlan(analysis.rooms, analysis.imageFrame);
  if (schematic) {
    content.push({ type: "text", text: "WHOLE-HOME FLOOR PLAN SCHEMATIC (all rooms labeled):" });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: schematic.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data: schematic.base64,
      },
    });
  }

  const inspirationUploads = (state.inspirationUploads ?? []).filter((u) => u.base64?.trim());
  inspirationUploads.forEach((upload, i) => {
    content.push({
      type: "text",
      text: `STYLE REFERENCE PHOTO ${i + 1}/${inspirationUploads.length}${upload.label?.trim() ? ` — user note: ${upload.label.trim()}` : ""}:`,
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: (upload.mimeType || "image/jpeg") as
          | "image/jpeg"
          | "image/png"
          | "image/webp"
          | "image/gif",
        data: upload.base64,
      },
    });
  });

  for (const room of roomsToCover) {
    for (const photo of getRoomPhotos(state, room.id)) {
      if (!photo.base64?.trim()) continue;
      try {
        const optimized = await optimizeImageBufferForAi(Buffer.from(photo.base64, "base64"), {
          maxEdge: 768,
          quality: 78,
        });
        content.push({
          type: "text",
          text: `ROOM PHOTO roomId=${room.id} photoId=${photo.id} label=${photo.label}:`,
        });
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: optimized.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
            data: optimized.base64,
          },
        });
      } catch {
        pipelineLog(
          "CLAUDE_ROOM_CONCEPTS",
          "room photo skip — optimize failed",
          { roomId: room.id, photoId: photo.id },
          "warn",
        );
      }
    }
  }

  const claudeTextPrompt = buildStagingClaudePrompt(
    analysis,
    preferences,
    photoMatrix,
    inspirationUploads,
    roomsToCover,
  );
  content.push({ type: "text", text: claudeTextPrompt });

  pipelineLog("CLAUDE_ROOM_CONCEPTS", "claude request prepared", {
    attempt,
    roomIds: roomsToCover.map((r) => r.id),
    imageParts: content.filter((p) => p.type === "image").length,
    hasOriginalPlan: !!state.floorPlanBase64,
    hasSchematic: !!schematic,
    styleReferenceCount: inspirationUploads.length,
    textPromptChars: claudeTextPrompt.length,
  });

  logClaudeRequest({
    label: "claude-render-director-all-rooms",
    model: CLAUDE_RENDER_MODEL,
    maxTokens: DIRECTOR_MAX_OUTPUT_TOKENS,
    messages: content,
    context: { roomCount: roomsToCover.length, attempt },
  });

  const response = await withRetry(
    () =>
      client.messages
        .stream({
          model: CLAUDE_RENDER_MODEL,
          max_tokens: DIRECTOR_MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content }],
        })
        .finalMessage(),
    "Claude all-rooms staging director",
  );

  const text = collectAnthropicTextBlocks(response.content).trim();
  logClaudeResponse({ label: "claude-render-director-all-rooms", response, rawText: text });

  const parsed = parseAssistantJsonObject(text);
  return {
    enriched: parseAllRoomsResponse(parsed, analysis, photoMatrixForParse),
    stopReason: response.stop_reason ?? null,
  };
}

export async function composeAllRoomsClaudeRenderPlans(
  state: ProjectState,
): Promise<Record<string, RoomRenderPlan>> {
  const enriched = await composeAllRoomsClaudeRenderPlansEnriched(state);
  return enriched.plans;
}

export async function composeAllRoomsClaudeRenderPlansEnriched(
  state: ProjectState,
): Promise<EnrichedConceptResponse> {
  const analysis = state.analysis;
  if (!analysis?.rooms?.length) {
    pipelineLog("CLAUDE_ROOM_CONCEPTS", "skipped — no rooms in analysis", {}, "warn");
    return { plans: {} };
  }

  const preferences = state.preferences;
  const photoMatrix = buildPhotoAssignmentMatrix(state, analysis);
  const photoMatrixForParse = buildPhotoMatrixForParse(state, analysis);
  const preferencesPrompt: InteriorPreferencesPrompt = {
    style: preferences.style,
    familyMembers: preferences.familyMembers,
    budgetTier: preferences.budgetTier,
    wishes: preferences.wishes,
  };

  pipelineLog("CLAUDE_ROOM_CONCEPTS", "start", {
    projectId: state.id,
    roomCount: analysis.rooms.length,
    assignedPhotoCount: countPhotosInMatrix(photoMatrix),
    style: preferences.style,
    budgetTier: preferences.budgetTier,
    hasFloorPlan: !!state.floorPlanBase64,
    model: CLAUDE_RENDER_MODEL,
  });

  const anthropicKey = getAnthropicApiKey();
  if (!anthropicKey) {
    pipelineLog("CLAUDE_ROOM_CONCEPTS", "fallback — no anthropic API key", {}, "warn");
    const fallback: Record<string, RoomRenderPlan> = {};
    for (const room of analysis.rooms) {
      fallback[room.id] = deterministicRoomPlan(room, preferencesPrompt);
    }
    pipelineLog("CLAUDE_ROOM_CONCEPTS", "complete", {
      source: "deterministic-fallback",
      rooms: summarizePlansForLog(fallback),
    });
    return { plans: fallback };
  }

  const client = new Anthropic({ apiKey: anthropicKey });

  try {
    const first = await requestRoomPlansOnce({
      client,
      state,
      analysis,
      roomsToCover: analysis.rooms,
      preferences,
      photoMatrixForParse,
      attempt: "full",
    });
    const enriched = first.enriched;

    // Truncated JSON (stop_reason max_tokens) or dropped rooms: retry ONCE with
    // a request scoped to only the missing rooms before deterministic-filling.
    let missing = analysis.rooms.filter((room) => !enriched.plans[room.id]);
    if (missing.length > 0) {
      pipelineLog(
        "CLAUDE_ROOM_CONCEPTS",
        "claude response missing rooms — retrying missing subset",
        {
          stopReason: first.stopReason,
          truncated: first.stopReason === "max_tokens",
          missingRoomIds: missing.map((r) => r.id),
        },
        "error",
      );
      try {
        const retry = await requestRoomPlansOnce({
          client,
          state,
          analysis,
          roomsToCover: missing,
          preferences,
          photoMatrixForParse,
          attempt: "retry-missing",
        });
        for (const [roomId, plan] of Object.entries(retry.enriched.plans)) {
          if (!enriched.plans[roomId]) enriched.plans[roomId] = plan;
        }
      } catch (err) {
        pipelineLog(
          "CLAUDE_ROOM_CONCEPTS",
          "missing-room retry failed",
          { error: String(err).slice(0, 300) },
          "error",
        );
      }
      missing = analysis.rooms.filter((room) => !enriched.plans[room.id]);
    }

    for (const room of missing) {
      enriched.plans[room.id] = deterministicRoomPlan(room, preferencesPrompt);
      pipelineLog(
        "CLAUDE_ROOM_CONCEPTS",
        "room missing from claude JSON — filled deterministic",
        { roomId: room.id, roomName: room.name },
        "error",
      );
    }

    for (const summary of summarizePlansForLog(enriched.plans)) {
      pipelineLog("CLAUDE_ROOM_CONCEPTS", "room design concept", summary);
    }

    pipelineLog("CLAUDE_ROOM_CONCEPTS", "complete", {
      source: "claude",
      roomCount: analysis.rooms.length,
      plannedRooms: Object.keys(enriched.plans).length,
      deterministicFilledRoomIds: missing.map((r) => r.id),
      overallStyle: enriched.overallStyle,
      referenceStyleAnalysis: enriched.referenceStyleAnalysis ?? null,
      rooms: summarizePlansForLog(enriched.plans),
    });

    return enriched;
  } catch (err) {
    pipelineLog(
      "CLAUDE_ROOM_CONCEPTS",
      "failed — deterministic fallback",
      { error: String(err) },
      "error",
    );
    const fallback: Record<string, RoomRenderPlan> = {};
    for (const room of analysis.rooms) {
      fallback[room.id] = deterministicRoomPlan(room, preferencesPrompt);
    }
    pipelineLog("CLAUDE_ROOM_CONCEPTS", "complete", {
      source: "deterministic-fallback",
      rooms: summarizePlansForLog(fallback),
    });
    return { plans: fallback };
  }
}

function cameraNoteForPhoto(state: ProjectState, roomId: string, photoId: string): string | null {
  const detected = state.analysis?.rooms.find((r) => r.id === roomId);
  const photo = getRoomPhotos(state, roomId).find((p) => p.id === photoId);
  if (!photo?.viewpoint || !detected) return null;
  return resolveViewpointFraming(photo.viewpoint, detected)?.note ?? null;
}

export const STAGING_GEOMETRY_PREFIX =
  "Keep all walls, doors, windows, ceiling from input photo unchanged.";

/** Compact structural opening lock for apartment-staging prompts. */
export function buildStagingOpeningLockSnippet(
  state: ProjectState,
  roomId: string,
  photoId: string,
): string {
  const detected = state.analysis?.rooms.find((r) => r.id === roomId);
  const photo = getRoomPhotos(state, roomId).find((p) => p.id === photoId);
  if (!photo?.viewpoint || !detected) return STAGING_GEOMETRY_PREFIX;

  const framing = resolveViewpointFraming(photo.viewpoint, detected);
  if (!framing) return STAGING_GEOMETRY_PREFIX;

  let visible = framingVisibleOpenings(framing);
  const uploaded = state.uploadedPhotos.find((p) => p.id === photoId);
  if (uploaded?.viewpointAnalysis) {
    visible = photoVerifiedVisibleOpenings(uploaded.viewpointAnalysis);
  }

  const doorPart = formatOpeningLockParts(visible.doorCount, visible.doorPositions, "door");
  const windowPart = formatOpeningLockParts(visible.windowCount, visible.windowPositions, "window");
  const preserveParts = [doorPart, windowPart].filter(Boolean);
  if (preserveParts.length === 0) return STAGING_GEOMETRY_PREFIX;

  return `${STAGING_GEOMETRY_PREFIX} Preserve exactly: ${preserveParts.join(", ")} — do not cover, remove, or repaint openings.`;
}

/** Resolve the short staging prompt for one photo (+ optional edit feedback). */
export function resolvePhotoStagingPrompt(
  state: ProjectState,
  roomId: string,
  photoId: string,
  editFeedback?: string,
): string | undefined {
  const plan = state.roomRenderPlans?.[roomId];
  if (!plan) {
    return resolveRoomStagingPrompt(state, roomId, editFeedback);
  }

  const perPhoto = plan.photoPrompts?.find((p) => p.photoId === photoId)?.stagingPrompt?.trim();
  const base =
    perPhoto ||
    buildPhotoStagingPromptFromPlan(plan, photoId, cameraNoteForPhoto(state, roomId, photoId)) ||
    plan.stagingPrompt?.trim() ||
    resolveRoomStagingPrompt(state, roomId);

  if (!base) {
    pipelineLog(
      "ASSEMBLE_PROMPT",
      "no staging prompt for photo",
      { projectId: state.id, roomId, photoId, hasPlans: !!state.roomRenderPlans },
      "warn",
    );
    return undefined;
  }

  const edit = editFeedback?.trim();
  const openingLock = buildStagingOpeningLockSnippet(state, roomId, photoId);
  const resolved = assembleStagingPrompt({
    openingLock,
    body: base,
    editFeedback: edit,
  });
  pipelineLog("ASSEMBLE_PROMPT", "photo staging prompt resolved", {
    projectId: state.id,
    roomId,
    photoId,
    roomName: plan.roomName,
    promptChars: resolved.length,
    hasEditFeedback: !!edit,
    source: perPhoto ? "photoPrompts" : "assembled",
    preview: resolved.slice(0, 120),
  });
  return resolved;
}

/** True when the room has at least one resolvable staging prompt. */
export function roomHasStagingPrompts(state: ProjectState, roomId: string): boolean {
  const plan = state.roomRenderPlans?.[roomId];
  if (!plan) return false;
  if (plan.photoPrompts?.some((p) => p.stagingPrompt?.trim() || p.renderInstruction?.trim())) return true;
  if (plan.stagingPrompt?.trim() || plan.designConcept?.trim()) return true;
  return false;
}

/** Resolve the short staging prompt for apartment-staging (+ optional edit feedback). */
export function resolveRoomStagingPrompt(
  state: ProjectState,
  roomId: string,
  editFeedback?: string,
): string | undefined {
  const plan = state.roomRenderPlans?.[roomId];
  const detected = state.analysis?.rooms.find((r) => r.id === roomId);
  const base = (
    plan?.stagingPrompt?.trim() ||
    (plan?.designConcept ? buildStagingPromptFromConcept(plan.designConcept, detected, plan.style) : "") ||
    plan?.geminiPrompt?.trim()
  );
  if (!base) {
    pipelineLog(
      "ASSEMBLE_PROMPT",
      "no staging prompt for room",
      { projectId: state.id, roomId, hasPlans: !!state.roomRenderPlans },
      "warn",
    );
    return undefined;
  }
  const edit = editFeedback?.trim();
  const resolved = edit ? clampStagingPrompt(`${base} ${edit}`) : base;
  pipelineLog("ASSEMBLE_PROMPT", "room staging prompt resolved", {
    projectId: state.id,
    roomId,
    roomName: plan?.roomName,
    promptChars: resolved.length,
    hasEditFeedback: !!edit,
    preview: resolved.slice(0, 120),
  });
  return resolved;
}

/** Resolve the stored design concept for one room (+ optional edit feedback). Kontext path. */
export function resolveRoomDesignPrompt(
  state: ProjectState,
  roomId: string,
  editFeedback?: string,
): string | undefined {
  const plan = state.roomRenderPlans?.[roomId];
  const base = (plan?.designConcept || plan?.geminiPrompt)?.trim();
  if (!base) {
    pipelineLog(
      "ASSEMBLE_PROMPT",
      "no claude design concept for room",
      { projectId: state.id, roomId, hasPlans: !!state.roomRenderPlans },
      "warn",
    );
    return undefined;
  }
  const edit = editFeedback?.trim();
  const resolved = edit ? `${base} Adjustments: ${edit}`.trim() : base;
  pipelineLog("ASSEMBLE_PROMPT", "room design concept resolved", {
    projectId: state.id,
    roomId,
    roomName: plan?.roomName,
    conceptWords: countWords(resolved),
    hasEditFeedback: !!edit,
    preview: resolved.slice(0, 120),
  });
  return resolved;
}
