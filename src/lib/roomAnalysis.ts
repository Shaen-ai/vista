import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { DesignBrief, RoomAnalysis } from "@/lib/interiorDesignPrompts";
import { WINDOW_OPENING_INSTRUCTIONS } from "@/lib/interiorDesignPrompts";
import { extractFirstJsonObject } from "@/lib/extractFirstJsonObject";
import {
  geometryForGeminiPrompt,
  hasAuthoritativeAnalysisOpenings,
} from "@/lib/geminiBriefSanitizer";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import { withRetry } from "@/lib/aiRetry";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import { formatPolygonEdgesForPrompt, formatRoomDimensionsForPrompt } from "@/lib/roomShapePolygon";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import { resolveGeometryModel } from "@/lib/anthropicModels";
import { RENDER_QUALITY_DIRECTIVE } from "@/lib/renderQualityDirective";
import {
  buildDoorDesignPromptBlock,
} from "@/lib/doorRenderPrompt";
import { buildOpeningStructuralLock } from "@/lib/openingStructuralLock";

export {
  parseWindowWallLabel,
  buildWallPlacementLockLines,
  buildCurtainPolicyLines,
  buildDoorWallPlacementLockLines,
} from "@/lib/windowWallPlacement";
export {
  buildStructuralGeometryLock,
  detectAsymmetricLeftGeometry,
  analyzeColumnInjectionSources,
  buildNoColumnHallucinationDirective,
  hasPlanConfirmedColumn,
  hasConfirmedPierOrColumn,
  isPlanSpeculativeColumnFeature,
} from "@/lib/structuralGeometryLock";
export type { CameraWall } from "@/lib/windowWallPlacement";

export type {
  RoomShape,
  CardDirection,
  GeometryConfidence,
  FixedElementType,
  RoomWall,
  RoomDoor,
  RoomWindow,
  FixedElement,
  RoomPolygonEdge,
  RoomGeometry,
} from "@/lib/roomGeometryTypes";

export const GEOMETRY_EXTRACTOR_SYSTEM_PROMPT = `You are a room geometry extractor. Analyze the room photo and return ONLY valid JSON — no markdown, no explanation, no backticks. Extract structural facts only. Use this exact schema:
{
  "room_shape": "rectangle" | "L-shape" | "U-shape" | "irregular",
  "approximate_dimensions": {
    "longest_wall_m": number,
    "shortest_wall_m": number
  },
  "walls": [
    { "id": "W1", "position": "north" | "south" | "east" | "west", "approx_length_m": number }
  ],
  "doors": [
    { "wall_id": "W1", "approx_offset_from_left_m": number, "width_m": number }
  ],
  "windows": [
    { "wall_id": "W1", "approx_offset_from_left_m": number, "width_m": number, "height_m": number }
  ],
  "fixed_elements": [
    { "type": "column" | "beam" | "radiator" | "fireplace" | "staircase" | "floor_opening", "description": string }
  ],
  "ceiling_height_m": number | null,
  "confidence": "high" | "medium" | "low",
  "polygon_edges": "OPTIONAL — when room_shape is L-shape or U-shape: [{ \\"label\\": \\"A-B\\", \\"length_m\\": number }, ...] clockwise from corner A (L-shape: 6 edges A-B…F-A; U-shape: 8 edges A-B…H-A). Estimate each wall segment visible in the photo."
}

FLOOR_OPENINGS / STAIRWELLS: If you see a hole or cutout in the concrete slab, an opening to a lower level, stairs descending through the floor, or vertical rebar around a floor edge, you MUST add a fixed_elements entry with type "floor_opening" (preferred for the void) or "staircase" when stairs are the main cue — describe shape, rough position in the frame (e.g. foreground center), and that it is a void, not solid floor.

OPEN_PASSAGES: Wide archways or openings to another room without a door leaf still count as door-like passages — include them in "doors" when they are clear person-height openings.

WINDOW_COUNTING (critical): Each separate framed glazed opening = one entry in "windows". Six visible window units → six objects in "windows" (not one combined entry). Bay windows with multiple frames = one entry per frame if frames are distinct. Do not merge adjacent windows into a single array item. Include sidelights/transoms as separate windows when they have their own frame. When mullions divide glass into separate operable/fixed panels, count each panel bay as its own window if it reads as a distinct unit in the photo.
${WINDOW_OPENING_INSTRUCTIONS}
WALL ASSIGNMENT: Each windows[] entry must sit on the wall that actually carries the glass in the photo. Windows on the far/back wall (behind main furniture) must use that wall's id — not the left-edge wall id just because they appear on the left side of the image.

CAMERA-RELATIVE WALLS (for image editing): Geometry JSON uses compass wall ids (north/south/east/west). When interpreting openings for image generation, map to camera-relative labels: back/far wall = main wall facing the camera; left wall = wall along the left edge of the photo frame; right wall = wall along the right edge of the photo frame. Side-wall windows must NOT be reassigned to the back wall.

RECESS / ASYMMETRIC ROOMS: If a foreground pier/column/wall bump-out creates a recessed alcove with windows set back behind it, set room_shape to "L-shape" or "irregular" (not "rectangle"). Add fixed_elements: { type: "column", description: "foreground pier on far left creating recess behind it" }. If a lower soffit/drop ceiling exists above the recess windows, add fixed_elements: { type: "beam", description: "lower soffit ceiling above left recess with spotlights" }. Place windows on the recess wall, not the foreground pier face.

POLYGON_EDGES: When room_shape is "L-shape" or "U-shape", include polygon_edges with per-wall segment lengths in metres (clockwise from corner A). L-shape template edges: A-B, B-D, D-E, E-F, F-C, C-A. U-shape template edges: A-B, B-C, C-D, D-E, E-F, F-G, G-H, H-A. Use scale cues from furniture, doors, and tiling when estimating lengths.

If a value cannot be determined from the photo, use null. Never guess doors or windows that are not visible. Return JSON only.`;

const RETRY_JSON_MESSAGE =
  "Your previous response was not valid JSON. Return ONLY the JSON object, no other text.";

export function stripJsonCodeFences(text: string): string {
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```/m.exec(t);
  if (fence) {
    t = fence[1]!.trim();
  }
  return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function parseGeometryJson(rawText: string): RoomGeometry {
  const cleaned = stripJsonCodeFences(rawText);
  const slice = extractFirstJsonObject(cleaned) ?? cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch (e) {
    throw new Error(
      `Room geometry JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Room geometry response was not a JSON object.");
  }
  return parsed as RoomGeometry;
}

function normalizeImageMediaType(
  mimeType: string,
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const m = (mimeType || "image/jpeg").trim().toLowerCase();
  if (m === "image/jpg" || m === "image/jpeg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/gif") return "image/gif";
  if (m === "image/webp") return "image/webp";
  return "image/jpeg";
}

export type ExtractRoomGeometryOptions = {
  /** Overrides ANTHROPIC_ROOM_GEOMETRY_MODEL / default */
  model?: string;
};

/**
 * Step 1 — extract structural geometry only (Claude vision).
 */
export async function extractRoomGeometry(
  imageBase64: string,
  mimeType: string,
  options?: ExtractRoomGeometryOptions,
): Promise<RoomGeometry> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("Anthropic API key is not configured (ANTHROPIC_API_KEY).");
  }

  const model = resolveGeometryModel(options?.model);

  const client = new Anthropic({ apiKey });
  const mediaType = normalizeImageMediaType(mimeType);

  const runCall = (userText: string) => {
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: imageBase64 },
      },
      { type: "text", text: userText },
    ];
    logClaudeRequest({
      label: "room-geometry-extraction",
      model,
      maxTokens: 4096,
      system: GEOMETRY_EXTRACTOR_SYSTEM_PROMPT,
      messages: content,
    });
    return withRetry(
      () =>
        client.messages.create({
          model,
          max_tokens: 4096,
          system: GEOMETRY_EXTRACTOR_SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        }),
      "Room geometry extraction",
    );
  };

  let response = await runCall("Return JSON per system instructions.");

  const extractText = (r: Awaited<ReturnType<typeof runCall>>): string => {
    const textBlock = r.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Room geometry extraction returned no text.");
    }
    return textBlock.text;
  };

  let text = extractText(response);

  try {
    const geom = parseGeometryJson(text);
    logClaudeResponse({
      label: "room-geometry-extraction",
      response,
      parsed: geom,
      context: { retry: false, doors: geom?.doors, windows: geom?.windows },
    });
    return geom;
  } catch (firstErr) {
    response = await runCall(RETRY_JSON_MESSAGE);
    text = extractText(response);
    try {
      const geom = parseGeometryJson(text);
      logClaudeResponse({
        label: "room-geometry-extraction",
        response,
        parsed: geom,
        context: { retry: true, doors: geom?.doors, windows: geom?.windows },
      });
      return geom;
    } catch {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      throw new Error(`Room geometry extraction failed after retry: ${msg}`);
    }
  }
}

export { buildOpeningStructuralLock } from "@/lib/openingStructuralLock";

export {
  FAL_OPENING_LOCK_RETRY_MAX,
  buildCompactOpeningLockForFal,
  buildCompactOpeningLockForRetry,
} from "@/lib/falOpeningLockCompact";

export function buildRedesignSystemPrompt(
  roomGeometry: RoomGeometry | null,
  designStyle: string,
  opts?: { geometryExtractionFailed?: boolean; roomAnalysis?: RoomAnalysis | null },
): string {
  if (opts?.geometryExtractionFailed && !roomGeometry) {
    return `You are an expert interior designer.

Note: geometry extraction failed, do your best to preserve the original room shape, ALL window/door/passage openings, stairwells, and any hole or cutout in the floor slab — never fill, cover, or “finish over” a floor void or stair opening.

Design style requested: ${designStyle}

You MAY change:
- Furniture layout and selection
- Colors, paint, wallpaper
- Flooring materials
- Lighting fixtures
- Decorative elements and accessories
- Ceiling treatment (not height if extracted)

When generating or describing the redesign, mentally verify: 'Does my output respect the locked room geometry?' If not, correct it before responding.`;
  }

  if (!roomGeometry) {
    return "";
  }

  const analysis = opts?.roomAnalysis;
  const geminiGeometry = geometryForGeminiPrompt(roomGeometry, analysis);
  const analysisOpenings = hasAuthoritativeAnalysisOpenings(analysis);
  const polygonEdgeNote =
    formatPolygonEdgesForPrompt(
      analysis?.room_shape ?? roomGeometry.room_shape,
      analysis?.polygon_edges ?? roomGeometry.polygon_edges,
    ) || "";

  const openingNote =
    analysis && analysis.window_count > (roomGeometry.windows?.length ?? 0)
      ? `\nRoom analysis confirms ${analysis.window_count} window(s) in this photo — preserve every one even if the geometry JSON lists fewer.\n`
      : "";

  const analysisOpeningsNote = analysisOpenings
    ? `\nNOTE: windows[]/doors[] omitted from geometry JSON below — opening positions come ONLY from room analysis (camera-relative wall labels).\n`
    : "";

  const cameraRelativeNote =
    analysis?.camera_angle?.trim() &&
    analysis.window_positions.length > 0
      ? `CAMERA-RELATIVE WALLS (authoritative for image editing): Geometry JSON below uses compass wall ids (north/south/east/west) for room shape and fixed elements only — NOT for window/door placement. For openings, use camera-relative labels from room analysis — back/far wall = wall facing the camera; left wall = left edge of photo frame; right wall = right edge of photo frame. Locked window positions: ${analysis.window_positions.join("; ")}. Camera: ${analysis.camera_angle}.\n\n`
      : analysis?.window_positions.length
        ? `CAMERA-RELATIVE WALLS: For image editing, back/far wall = wall facing camera; left/right = frame edges. Locked window positions: ${analysis.window_positions.join("; ")}.\n\n`
        : "";

  return `You are an expert interior designer.

STRUCTURAL CONSTRAINTS — these are locked and must NEVER be changed:
${cameraRelativeNote}${analysisOpeningsNote}${polygonEdgeNote ? `${polygonEdgeNote}\n` : ""}${JSON.stringify(geminiGeometry, null, 2)}
${openingNote}
The above geometry was extracted from the user's actual room. You must preserve EXACTLY:
- The room shape and all wall positions
- All door positions, sizes, and which wall they are on
- All window positions, sizes, and which wall they are on — every distinct glazed opening in the photo, not a reduced count
- All fixed elements (columns, radiators, fireplaces, staircases, and especially any floor_opening / stairwell cutout in the slab — the void must remain a void; do not add flooring, rugs, or furniture across the hole)

You MAY change:
- Furniture layout and selection
- Colors, paint, wallpaper
- Flooring materials
- Lighting fixtures
- Decorative elements and accessories
- Ceiling treatment (not height if extracted)

Design style requested: ${designStyle}

When generating or describing the redesign, always mentally verify:
'Does my output respect the locked room geometry?' If not, correct it before responding.`;
}

export type RedesignRoomContext = {
  brief: DesignBrief;
  roomAnalysis?: RoomAnalysis | null;
  merchantAppendix?: string;
  scrapedInventoryExclusive?: boolean;
  /** When true, prepend extraction-fallback note (no JSON constraints). */
  geometryExtractionFailed?: boolean;
  /** When true, the reference image is a previously generated render (not the original photo). */
  keepRoomShape?: boolean;
};

function buildStructuralLockTail(roomAnalysis?: RoomAnalysis | null): string {
  if (!roomAnalysis) return "";
  const structs =
    roomAnalysis.structural_elements.length > 0
      ? roomAnalysis.structural_elements.join("; ")
      : "none separately listed beyond photograph";
  const floorVoid =
    roomAnalysis.has_floor_opening
      ? ` Floor slab void / cutout: ${roomAnalysis.floor_opening_description?.trim() || "present as in photo — do NOT infill or cover with flooring or rugs."}`
      : "";
  const winConf = roomAnalysis.confidence?.window_count ?? "medium";
  const doorConf = roomAnalysis.confidence?.door_count ?? "medium";
  const winVerb = winConf === "high" ? "EXACTLY" : "at least";
  const doorVerb = doorConf === "high" ? "EXACTLY" : "at least";
  return `
FINAL STRUCTURAL LOCK (repeat — overrides any contradictory creative wording above): Keep ${winVerb} ${roomAnalysis.window_count} window(s)${
    roomAnalysis.window_positions.length
      ? ` at: ${roomAnalysis.window_positions.join("; ")}`
      : ""
  }. Keep ${doorVerb} ${roomAnalysis.door_count} door/passage opening(s)${
    roomAnalysis.door_positions.length ? ` at: ${roomAnalysis.door_positions.join("; ")}` : ""
  }. Room shape: ${roomAnalysis.room_shape}; ${formatRoomDimensionsForPrompt(roomAnalysis.room_shape, roomAnalysis.estimated_dimensions, roomAnalysis.polygon_edges)} Ceiling type: ${roomAnalysis.ceiling_type}. Structural columns/posts/piers: ${structs}.${roomAnalysis.has_staircase ? ` Staircase: ${roomAnalysis.staircase_description || "unchanged vs photo"} — unchanged.` : ""}${floorVoid}`;
}

/**
 * Primary Gemini **text** instruction for photo-based room redesign.
 * Room analysis opening counts are always enforced; geometry JSON supplements but does not reduce window/door counts.
 */
export function redesignRoom(
  _imageBase64: string,
  _mimeType: string,
  roomGeometry: RoomGeometry | null,
  designStyle: string,
  context: RedesignRoomContext,
): string {
  void _imageBase64;
  void _mimeType;

  const { brief, roomAnalysis, merchantAppendix, scrapedInventoryExclusive, geometryExtractionFailed, keepRoomShape } =
    context;
  const appendix = merchantAppendix?.trim() ?? "";
  const useFailedNote = Boolean(geometryExtractionFailed && !roomGeometry);
  const openingLock = buildOpeningStructuralLock(roomAnalysis, roomGeometry);

  const exclusiveLock = appendix
    ? `

CATALOG_INVENTORY_LOCK: Every visible product (furniture, appliance, decorative lighting fixture, tile/parquet sold as a product SKU, etc.) MUST match the MERCHANT CATALOG block below. If the design narrative asks for an object not in that block, OMIT it from the image — do not substitute a generic lookalike. Plain wall paint, generic recessed ceiling wash, rugs/curtains/art without brand, and small tabletop props are allowed ONLY when they do not introduce a non-listed major SKU. A sparsely furnished room with ONLY catalog products is BETTER than a room with invented furniture.`
    : "";

  const structuralAnchor = !roomAnalysis
      ? ""
      : `
STRUCTURAL GROUND TRUTH (from room analysis — these are the EXACT facts to preserve):
- Room shape: ${roomAnalysis.room_shape}
- Dimensions: ${formatRoomDimensionsForPrompt(roomAnalysis.room_shape, roomAnalysis.estimated_dimensions, roomAnalysis.polygon_edges)}
- ${roomAnalysis.confidence?.window_count === "high" ? "Exactly" : "At least"} ${roomAnalysis.window_count} window(s)${roomAnalysis.window_positions.length ? ` at: ${roomAnalysis.window_positions.join("; ")}` : ""}
- ${roomAnalysis.confidence?.door_count === "high" ? "Exactly" : "At least"} ${roomAnalysis.door_count} door(s)${roomAnalysis.door_positions.length ? ` at: ${roomAnalysis.door_positions.join("; ")}` : ""}
- Camera viewpoint: ${roomAnalysis.camera_angle}
- Ceiling: ${roomAnalysis.ceiling_type}${roomAnalysis.architectural_features.length ? `\n- Architectural features (must preserve): ${roomAnalysis.architectural_features.join("; ")}` : ""}${roomAnalysis.structural_elements.length ? `\n- Structural elements: ${roomAnalysis.structural_elements.join(", ")}` : ""}${roomAnalysis.has_staircase ? `\n- Staircase: ${roomAnalysis.staircase_description || "present"} — keep exactly as-is (including any floor opening)` : ""}${roomAnalysis.has_floor_opening ? `\n- Floor cutout / stairwell void: ${roomAnalysis.floor_opening_description?.trim() || "visible in photo"} — NEVER fill in, cover with rug, or pretend it is solid floor` : ""}
The output MUST match every structural fact above. Window, door, and passage count stays identical to the photo. Every open connection between rooms stays open. Room geometry and floor voids remain unchanged.
`;

  const designerLock =
    roomGeometry
      ? buildRedesignSystemPrompt(roomGeometry, designStyle, { roomAnalysis: roomAnalysis ?? undefined })
      : useFailedNote
        ? buildRedesignSystemPrompt(null, designStyle, {
            geometryExtractionFailed: true,
            roomAnalysis: roomAnalysis ?? undefined,
          })
        : buildRedesignSystemPrompt(null, designStyle, { roomAnalysis: roomAnalysis ?? undefined });

  const userRedoLine = keepRoomShape
    ? `Edit this interior design render in ${designStyle} style. Preserve the exact room shape and composition — only change the requested design elements.`
    : `Redesign this room in ${designStyle} style. Keep the exact room structure — only change the interior design elements.`;

  const structuralTail = roomAnalysis ? buildStructuralLockTail(roomAnalysis) : "";

  const openingBlock = openingLock ? `\n${openingLock}\n` : "";
  const doorDesignBlock = `\n${buildDoorDesignPromptBlock(brief.doorDesign)}\n`;

  const body = keepRoomShape
    ? `Edit this interior design render. This is an ITERATIVE EDIT — you are modifying a previously generated design image, NOT starting from scratch.

TASK: Apply the requested changes to THIS EXACT IMAGE. The output must preserve the same room shape, camera angle, spatial composition, and perspective.

ABSOLUTE RULES — PRESERVE ALL OF THESE FROM THE INPUT IMAGE:
- Camera angle, perspective, and viewpoint — IDENTICAL
- Room shape, walls, corners, columns, structural openings — IDENTICAL
- Window and door positions, sizes, shapes, and count — IDENTICAL
- Room proportions and overall dimensions — IDENTICAL
- Ceiling structure and height — IDENTICAL
- Floor plan layout and room boundaries — IDENTICAL
- Overall spatial composition and depth — IDENTICAL
- Wall slats/panels/paint must NOT cover any reference-photo window — each locked position stays visible glazed glass
${openingBlock}${doorDesignBlock}${structuralAnchor}
WHAT TO CHANGE (only the requested modifications):
- Wall finishes: ${brief.subject.slice(0, 400)}
- Style, colors & mood: ${brief.style.slice(0, 400)}
- Furniture layout & decor: ${brief.arrangement.slice(0, 400)}
- Apply changes to flooring, lighting fixtures, textiles, art, and plants as specified${exclusiveLock}${appendix ? `\n${appendix.slice(0, 2500)}` : ""}

CRITICAL: The output must look like the SAME ROOM from the SAME ANGLE with only the requested design changes applied. Do NOT alter the room geometry, perspective, or spatial layout in any way. Photorealistic interior photography, 8K, architectural digest quality.`
    : `Edit this photo of a room. This is an IMAGE EDITING task — you are modifying the provided photo, NOT generating a new image from scratch.

TASK: Apply interior design to THIS EXACT ROOM in the photo. The output must show the SAME physical space with new finishes, furniture, and decor.

ABSOLUTE RULES — DO NOT CHANGE ANY OF THESE:
- Camera angle, perspective, and viewpoint — IDENTICAL to the input photo
- Room shape, walls, corners, columns, structural openings — IDENTICAL
- Window and door positions, sizes, shapes, and count — IDENTICAL; any wide passage or archway to another room must STAY OPEN — never replace with a solid wall
- View visible outside windows — keep EXACTLY as-is (do not replace with different scenery)
- Room proportions and overall dimensions — IDENTICAL
- Ceiling structure (beams, vaults, ribbing, height) — keep the SAME geometry (you may change surface finish only)
- Any staircase, floor slab hole, stairwell cutout, rebar at slab edge, or multi-level feature — keep EXACTLY as-is; NEVER infill the hole or draw continuous flooring across the void
- The number of walls and their angles — IDENTICAL
- Floor plan layout and room boundaries — IDENTICAL
${openingBlock}${doorDesignBlock}${structuralAnchor}
IMPORTANT: The design descriptions below may inadvertently mention architectural elements (window counts, room shapes, ceiling types, etc.). IGNORE any such structural descriptions in the design text — use ONLY the input photo as the structural reference. Apply ONLY the decorative and finish changes.

WHAT TO CHANGE (decoration & finishes only):
- Wall finishes: ${brief.subject.slice(0, 400)}
- Style, colors & mood: ${brief.style.slice(0, 400)}
- Furniture layout & decor: ${brief.arrangement.slice(0, 400)}
- Add appropriate flooring finish, lighting fixtures, textiles, art, and plants${exclusiveLock}${appendix ? `\n${appendix.slice(0, 2500)}` : ""}

COMPLETENESS — the output must be a FULLY FINISHED, magazine-quality interior (NOT a work-in-progress):
- WALL FINISHES vs WINDOWS: Decorative treatments (slats, panels, accent bands) must frame every existing window from the reference photo — never brick over or panel over glazed openings; curtains may change, glass bays must stay
- CURTAINS: Hang curtains ONLY where glazed openings exist in the reference photo and at locked positions above; never on solid walls
- EVERY visible wall must have a complete finish (paint, wallpaper, panels, texture) — no bare drywall, no unfinished patches
- Flooring, tile, carpet, and area rugs apply ONLY to solid walkable slab — they must NOT span across stairwell cutouts, floor holes, or open stairs; rugs must stop at the void edge exactly as real life would
- Where a floor void or stairs remain visible, you may refine edges (trim, nosing) but the opening shape and depth stay TRUE to the photo
- The ENTIRE visible ceiling must be designed (painted, with appropriate fixtures, molding, or beams) — no raw/unfinished ceiling areas EXCEPT do not invent a false lower ceiling that hides real slab geometry when the photo shows exposed concrete
- ALL surface transitions (wall-to-floor, wall-to-ceiling, corners) must be clean and complete on actual surfaces only
- Every solid surface in the frame must look professionally finished; structural openings and voids must remain spatially correct
${structuralTail}

The output must be recognizably the SAME room from the SAME camera position, with a COMPLETE interior design applied to every surface. Photorealistic interior photography, 8K, architectural digest quality.`;

  const parts = [designerLock, userRedoLine, body, RENDER_QUALITY_DIRECTIVE].filter((s) => s.trim().length > 0);
  return parts.join("\n\n");
}
