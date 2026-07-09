/**
 * Phase 3 — Room-by-Room Generation.
 *
 * For each room: build Gemini prompts from the room brief + master
 * palette, generate 1-4 photorealistic renders, then derive a structured
 * material specification straight from the brief (with optional marketplace
 * product matching). No Claude call — the brief already carries every
 * design decision.
 */

import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { DESIGNER_SYSTEM_INSTRUCTION } from "@/lib/designerSystemInstruction";
import type {
  MasterDesignConcept,
  RoomDesignBrief,
  FloorPlanAnalysis,
  DetectedRoom,
  PhotoViewpoint,
  RenderResult,
  RoomMaterialSpec,
  MarketplaceMatch,
  RenderViewType,
  RoomPhotoWithViewpoint,
} from "./types";
import { getServerMarketplaceApiBaseUrl } from "@/lib/publicEnv";
import { getGoogleGenerativeAiApiKey } from "@/lib/serverAiKeys";
import { marketplaceSearchRowsFromJson } from "@/lib/scrapedAllowlist";
import {
  resolveRoomCatalogProducts,
  buildGeminiCatalogPayload,
  type ResolvedRoomCatalog,
} from "@/lib/scrapedRoomGeneration";
import { resolveViewpointFraming } from "./viewpointFraming";
import { renderViewpointDiagram, renderOpeningsDiagram } from "./viewpointDiagram";
import { openingEdgeLabel } from "./roomFloorPlanContext";
import type { RoomFloorPlanContext } from "./roomFloorPlanContext";
import { logGeminiRequest, type LogGeminiRequestContext } from "@/lib/logGeminiRequest";
import { optimizeImageBufferForAi } from "@/lib/optimizeImageForAi";
import { RENDER_QUALITY_DIRECTIVE } from "@/lib/renderQualityDirective";
import { RENDER_GENERATION_CONFIG, STRUCTURE_LOCK_DIRECTIVE, GEMINI_IMAGE_MODEL, GEMINI_IMAGE_MODEL_LABEL } from "@/lib/geminiImageConfig";

const MAX_EXTRA_ROOM_PHOTOS = 4;

type GeminiModel = ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;

function extractFirstGeminiImage(
  result: Awaited<ReturnType<GeminiModel["generateContent"]>>,
): { base64: string; mimeType: string } | null {
  type GenPart = { inlineData?: { data?: unknown; mimeType?: unknown }; text?: string };
  for (const candidate of result.response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const pdata = part as GenPart;
      const raw = pdata.inlineData?.data;
      if (typeof raw === "string" && raw) {
        const mt = pdata.inlineData?.mimeType;
        return { base64: raw, mimeType: typeof mt === "string" && mt ? mt : "image/png" };
      }
    }
  }
  return null;
}

function createGeminiRenderModel(googleKey: string): GeminiModel {
  const genai = new GoogleGenerativeAI(googleKey);
  return genai.getGenerativeModel({
    model: GEMINI_IMAGE_MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: RENDER_GENERATION_CONFIG as any,
    systemInstruction: DESIGNER_SYSTEM_INSTRUCTION,
  });
}

function generateContentLogged(
  model: GeminiModel,
  label: string,
  parts: Part[],
  context?: LogGeminiRequestContext,
) {
  logGeminiRequest({
    label,
    model: GEMINI_IMAGE_MODEL_LABEL,
    systemInstruction: DESIGNER_SYSTEM_INSTRUCTION,
    parts,
    context,
  });
  return model.generateContent(parts).then(async (result) => {
    const usageMeta = result.response?.usageMetadata;
    if (usageMeta) {
      const { recordGeminiUsage } = await import("@/lib/aiSpend");
      recordGeminiUsage({
        model: GEMINI_IMAGE_MODEL_LABEL,
        promptTokenCount: usageMeta.promptTokenCount,
        candidatesTokenCount: usageMeta.candidatesTokenCount,
        totalTokenCount: usageMeta.totalTokenCount,
        imageGeneration: true,
        label,
      });
    }
    return result;
  });
}

/** Downscale an image for an AI part; falls back to the raw bytes on failure. */
async function optimizedInlinePart(img: { base64: string; mimeType: string }): Promise<Part> {
  try {
    const optimized = await optimizeImageBufferForAi(Buffer.from(img.base64, "base64"), {
      maxEdge: 1280,
      quality: 78,
    });
    return { inlineData: { mimeType: optimized.mimeType, data: optimized.base64 } };
  } catch {
    return { inlineData: { mimeType: img.mimeType, data: img.base64 } };
  }
}

/**
 * Build the floor-plan reference parts (original + highlighted schematic) and the
 * extra same-room photo parts from the floor-plan context. The render's main
 * reference photo is passed in `excludeBase64` so it isn't duplicated.
 */
async function buildFloorPlanContextParts(
  ctx: RoomFloorPlanContext | undefined,
  excludeBase64?: string,
): Promise<{ floorPlanParts: Part[]; extraRoomPhotoParts: Part[] }> {
  const floorPlanParts: Part[] = [];
  const extraRoomPhotoParts: Part[] = [];
  if (!ctx) return { floorPlanParts, extraRoomPhotoParts };

  const planImages: Array<{ img: { base64: string; mimeType: string }; label: string }> = [];
  if (ctx.originalPlan) {
    planImages.push({
      img: ctx.originalPlan,
      label: "FLOOR PLAN (authoritative layout, with room labels/dimensions printed on it):",
    });
  }
  if (ctx.highlightedPlan) {
    planImages.push({
      img: ctx.highlightedPlan,
      label: "FLOOR PLAN SCHEMATIC (the target room is highlighted; same layout):",
    });
  }
  if (planImages.length > 0) {
    floorPlanParts.push({
      text: "FLOOR PLAN & TARGET ROOM (spatial reference ONLY — do NOT render the plan). Use these to keep walls, windows, doors, proportions, and which physical room this is correct:",
    });
    for (const { img, label } of planImages) {
      floorPlanParts.push({ text: label });
      floorPlanParts.push(await optimizedInlinePart(img));
    }
  }

  const extras = ctx.roomPhotos
    .filter((p) => p.base64 && p.base64 !== excludeBase64)
    .slice(0, MAX_EXTRA_ROOM_PHOTOS);
  if (extras.length > 0) {
    extraRoomPhotoParts.push({
      text:
        "STRUCTURAL REFERENCE PHOTOS OF THIS ROOM — these show the EXACT physical space. " +
        "The generated image MUST match: room shape, wall angles, window positions/sizes/count, " +
        "door positions/count, ceiling structure, and architectural features visible in these photos. " +
        "Only change surfaces (paint, flooring, finishes) and furniture:",
    });
    for (const p of extras) {
      extraRoomPhotoParts.push(await optimizedInlinePart({ base64: p.base64, mimeType: p.mimeType }));
    }
  }

  return { floorPlanParts, extraRoomPhotoParts };
}

export interface RoomRenderGenerationOptions {
  scrapedInventoryExclusive?: boolean;
  scrapedAllowlistNumericIds?: number[];
  pinnedProductIds?: number[];
  inspirationUploads?: Array<{ base64: string; mimeType: string; label: string }>;
  /** Cross-room consistency prompt block from approved rooms */
  crossRoomContext?: string;
  /** Camera viewpoint the user marked for this room's reference photo. */
  referenceViewpoint?: PhotoViewpoint;
  /** Prebuilt "fixed utility connections" prompt block for this room (empty if none placed). */
  utilityConstraints?: string;
  /** Floor plan image + texts + which-room highlight + all room photos. */
  floorPlanContext?: RoomFloorPlanContext;
}

export interface RoomRenderGenerationResult {
  renders: RenderResult[];
  catalog: ResolvedRoomCatalog | null;
}

/** Shared spatial + design context for finish-time multi-viewpoint renders. */
export interface ViewpointRenderContext {
  floorPlanContext?: RoomFloorPlanContext;
  /** Room design intent / palette block to keep finishes consistent across views. */
  designConsistencyText?: string;
}

async function buildViewpointRenderContextParts(
  ctx: ViewpointRenderContext | undefined,
): Promise<{ floorPlanParts: Part[]; planText: string }> {
  const built = await buildFloorPlanContextParts(ctx?.floorPlanContext);
  return { floorPlanParts: built.floorPlanParts, planText: ctx?.floorPlanContext?.planText ?? "" };
}

function inferViewType(angleDescription: string, index: number): RenderViewType {
  const lower = angleDescription.toLowerCase();
  if (lower.includes("wide") || lower.includes("full room")) return "wide";
  if (lower.includes("close-up") || lower.includes("close up") || lower.includes("detail")) return "detail";
  if (lower.includes("entrance") || lower.includes("from the main")) return "entrance";
  if (index === 0) return "wide";
  if (index === 1) return "detail";
  return "standard";
}

function buildRoomShapeDescription(
  detectedRoom: DetectedRoom | undefined,
  overallShape?: string,
): string {
  if (overallShape?.trim()) return `Room shape: ${overallShape.trim()}`;
  if (detectedRoom?.polygon && detectedRoom.polygon.length > 4) {
    return `Room shape: non-rectangular (${detectedRoom.polygon.length}-sided polygon)`;
  }
  return "Room shape: rectangular";
}

function buildAllOpeningsSummary(detectedRoom: DetectedRoom | undefined): string | undefined {
  if (!detectedRoom) return undefined;
  const poly = detectedRoom.polygon;
  const windows = detectedRoom.windows.length
    ? `Windows: ${detectedRoom.windows
        .map((w) => `${w.position}${openingEdgeLabel(w.edgeIndex, w.t, poly)} (${w.width}m × ${w.height}m)`)
        .join("; ")}`
    : "Windows: none";
  const doors = detectedRoom.doors.length
    ? `; Doors: ${detectedRoom.doors
        .map(
          (d) =>
            `${d.position}${openingEdgeLabel(d.edgeIndex, d.t, poly)} (${d.width}m wide × ${d.height ?? 2.1}m tall)`,
        )
        .join("; ")}`
    : "";
  return windows + doors;
}

// ---------------------------------------------------------------------------
// Gemini render generation
// ---------------------------------------------------------------------------

function buildRoomRenderPrompt(
  brief: RoomDesignBrief,
  concept: MasterDesignConcept,
  detectedRoom: DetectedRoom | undefined,
  angleDescription: string,
  merchantCatalogAppendix?: string,
  collageNote?: string,
  crossRoomContext?: string,
  viewpointNote?: string,
  utilityNote?: string,
  openingsOverride?: string,
  floorPlanText?: string,
  overallShape?: string,
): string {
  const dims = detectedRoom?.dimensions;
  const dimStr = dims
    ? `${dims.width}m wide × ${dims.depth}m deep, ${dims.height}m ceiling`
    : "standard proportions";
  const shapeStr = buildRoomShapeDescription(detectedRoom, overallShape);
  // When a marked viewpoint is known, list only the openings actually in frame
  // (with left/center/right placement) instead of dumping every window.
  const poly = detectedRoom?.polygon;
  const windowStr =
    openingsOverride ??
    (detectedRoom?.windows.length
      ? `Windows: ${detectedRoom.windows
          .map((w) => `${w.position}${openingEdgeLabel(w.edgeIndex, w.t, poly)} (${w.width}m × ${w.height}m)`)
          .join("; ")}`
      : "No windows visible from this angle");
  const doorStr = detectedRoom?.doors.length
    ? `Doors: ${detectedRoom.doors
        .map(
          (d) =>
            `${d.position}${openingEdgeLabel(d.edgeIndex, d.t, poly)} (${d.width}m wide × ${d.height ?? 2.1}m tall, connects to ${d.connectsTo})`,
        )
        .join("; ")}`
    : "";

  return `Generate a photorealistic interior design render of a ${brief.roomName} (${brief.roomType}).

ROOM SPECIFICATIONS:
- Dimensions: ${dimStr}
- ${shapeStr}
- ${windowStr}${doorStr ? `\n- ${doorStr}` : ""}
${detectedRoom?.features.length ? `- Features: ${detectedRoom.features.join(", ")}` : ""}

CAMERA: ${angleDescription}${viewpointNote ? ` — ${viewpointNote}` : ""}

DESIGN CONCEPT:
- Style: ${concept.overallStyle}
- Wall color: ${brief.wallColor.ncs} (${brief.wallColor.hex}) — paint ALL walls this exact color
- Floor: ${brief.floorMaterial}
- Ceiling: ${brief.ceilingDesign}
- Lighting: ${brief.lightingConcept}

FURNITURE & DECOR:
${brief.furnitureList.map((f) => `- ${f}`).join("\n")}
${utilityNote ?? ""}
KEY DESIGN ELEMENTS:
${brief.keyDesignElements.map((e) => `- ${e}`).join("\n")}

MATERIAL PALETTE (use consistently):
- Wood: ${concept.materialPalette.woodType}
- Metal: ${concept.materialPalette.metalFinish}
- Stone: ${concept.materialPalette.stoneType}
- Textile: ${concept.materialPalette.textilePrimary}

COLOR PALETTE:
- Primary: ${concept.colorPalette.primary.name} (${concept.colorPalette.primary.hex})
- Secondary: ${concept.colorPalette.secondary.name} (${concept.colorPalette.secondary.hex})
- Accent: ${concept.colorPalette.accent.name} (${concept.colorPalette.accent.hex})
- Neutral: ${concept.colorPalette.neutral.name} (${concept.colorPalette.neutral.hex})

${brief.specialNotes ? `SPECIAL NOTES: ${brief.specialNotes}` : ""}

${floorPlanText ? `FLOOR PLAN CONTEXT (see the floor plan images above; the target room is highlighted):\n${floorPlanText}\n\n` : ""}${crossRoomContext ? `${crossRoomContext}\n\n` : ""}${merchantCatalogAppendix?.trim() ? `${merchantCatalogAppendix.trim().slice(0, 3800)}\n` : ""}${collageNote ?? ""}
${STRUCTURE_LOCK_DIRECTIVE}

${RENDER_QUALITY_DIRECTIVE}

Also: every surface fully finished (no bare walls, no unfinished floors), magazine-quality styling with accessories, books, plants, and textiles, accurate room proportions matching the specified dimensions.`;
}

function buildPhotoGroundedPrompt(
  brief: RoomDesignBrief,
  concept: MasterDesignConcept,
  detectedRoom: DetectedRoom | undefined,
  merchantCatalogAppendix?: string,
  collageNote?: string,
  crossRoomContext?: string,
  viewpointNote?: string,
  utilityNote?: string,
  openingsNote?: string,
  floorPlanText?: string,
): string {
  const dims = detectedRoom?.dimensions;
  const dimStr = dims
    ? `${dims.width}m wide × ${dims.depth}m deep, ${dims.height}m ceiling`
    : "standard proportions";
  const windowCount = detectedRoom?.windows.length ?? 0;
  const doorCount = detectedRoom?.doors.length ?? 0;
  const windowPositions = detectedRoom?.windows.length
    ? detectedRoom.windows.map((w) => w.position).join("; ")
    : "";
  const doorPositions = detectedRoom?.doors.length
    ? detectedRoom.doors.map((d) => d.position).join("; ")
    : "";

  return `Edit this photo of a room. This is an IMAGE EDITING task — you are modifying the provided photo, NOT generating a new image from scratch.

TASK: Apply interior design to THIS EXACT ROOM in the photo. The output must show the SAME physical space with new finishes, furniture, and decor.
${viewpointNote ? `\nVANTAGE POINT (consistent with the input photo): ${viewpointNote}. Keep this exact vantage.\n` : ""}${openingsNote ? `SPATIAL ORIENTATION (from the floor plan — for correctly placing walls/openings/finishes, do NOT change the camera): ${openingsNote}\n` : ""}
ABSOLUTE RULES — DO NOT CHANGE ANY OF THESE:
- Camera angle, perspective, and viewpoint — IDENTICAL to the input photo
- Room shape, walls, corners, columns, structural openings — IDENTICAL
- Windows: exactly ${windowCount} window(s)${windowPositions ? ` at: ${windowPositions}` : ""} — positions, sizes, shapes, and count IDENTICAL
- Doors: exactly ${doorCount} door(s)${doorPositions ? ` at: ${doorPositions}` : ""} — positions, sizes, and count IDENTICAL
- View visible outside windows — keep EXACTLY as-is
- Room proportions (${dimStr}) — IDENTICAL
- Any staircase, floor opening, or multi-level feature — keep EXACTLY as-is

WHAT TO CHANGE (decoration & finishes only):
- Style: ${concept.overallStyle}
- Wall color: ${brief.wallColor.ncs} (${brief.wallColor.hex}) — paint ALL walls
- Floor: ${brief.floorMaterial}
- Ceiling: ${brief.ceilingDesign}
- Lighting: ${brief.lightingConcept}
- Furniture: ${brief.furnitureList.join("; ")}
- Design elements: ${brief.keyDesignElements.join("; ")}
${utilityNote ?? ""}
MATERIAL PALETTE:
- Wood: ${concept.materialPalette.woodType}
- Metal: ${concept.materialPalette.metalFinish}
- Stone: ${concept.materialPalette.stoneType}
- Textile: ${concept.materialPalette.textilePrimary}

COLOR PALETTE:
- Primary: ${concept.colorPalette.primary.name} (${concept.colorPalette.primary.hex})
- Secondary: ${concept.colorPalette.secondary.name} (${concept.colorPalette.secondary.hex})
- Accent: ${concept.colorPalette.accent.name} (${concept.colorPalette.accent.hex})

${brief.specialNotes ? `SPECIAL NOTES: ${brief.specialNotes}` : ""}

${floorPlanText ? `FLOOR PLAN CONTEXT (see the floor plan images above; the target room is highlighted — this photo IS that room):\n${floorPlanText}\n\n` : ""}${crossRoomContext ? `${crossRoomContext}\n\n` : ""}${merchantCatalogAppendix?.trim() ? `\nMERCHANT SKU CONSTRAINTS:\n${merchantCatalogAppendix.trim().slice(0, 3800)}\n` : ""}${collageNote ?? ""}
The output must be a FULLY FINISHED, magazine-quality interior. Every visible surface must be complete.

${STRUCTURE_LOCK_DIRECTIVE}

${RENDER_QUALITY_DIRECTIVE}`;
}

function rowToMarketplaceMatch(row: Record<string, unknown>): MarketplaceMatch {
  const name =
    typeof row.name_en === "string" && row.name_en.trim()
      ? row.name_en.trim()
      : typeof row.name === "string"
        ? row.name
        : "Product";
  return {
    marketplaceId: Number(row.id) || 0,
    name,
    price: Number(row.price) || 0,
    currency: typeof row.currency === "string" ? row.currency : "AMD",
    url: typeof row.external_url === "string" ? row.external_url : "",
    imageUrl: typeof row.main_image_url === "string" ? row.main_image_url : null,
    sourceMarketplace: typeof row.source_marketplace === "string" ? row.source_marketplace : undefined,
  };
}

/**
 * Re-render the final composed room from additional camera angles WITHOUT changing
 * any products/finishes. Used after the 3-phase chain locks the design so the PDF
 * still gets multiple views. The first returned render is the composed image itself.
 */
export async function generateRoomAngleVariations(
  finalImage: { base64: string; mimeType: string },
  brief: RoomDesignBrief,
  analysis: FloorPlanAnalysis,
): Promise<RenderResult[]> {
  const googleKey = getGoogleGenerativeAiApiKey();
  const composed: RenderResult = {
    angleIndex: 0,
    angleDescription: "Final design",
    viewType: "wide",
    base64: finalImage.base64,
    mimeType: finalImage.mimeType,
  };
  const results: RenderResult[] = [composed];

  const angles = (brief.renderAngles ?? []).filter((a) => typeof a === "string" && a.trim());
  if (!googleKey || angles.length === 0) return results;

  const detectedRoom = analysis.rooms.find((r) => r.id === brief.roomId);
  const dims = detectedRoom?.dimensions;
  const dimStr = dims ? `${dims.width}m × ${dims.depth}m, ${dims.height}m ceiling` : "the same proportions";

  const extraAngles = angles.slice(1);
  const model = createGeminiRenderModel(googleKey);

  for (let i = 0; i < extraAngles.length; i++) {
    const angle = extraAngles[i];
    // The first extra view is the reverse (~180°) of the composed shot; any
    // further view is a distinct three-quarter/corner angle.
    const viewpointDirective =
      i === 0
        ? "Place the camera on the OPPOSITE side of the room from the reference image, looking back toward where the reference camera stood. This MUST be the reverse viewpoint (~180° around) — a clearly different shot, NOT the same view nudged slightly."
        : "Place the camera at a clearly different position from both the reference image and the other generated views — an elevated or corner three-quarter angle that shows a different part of the room.";
    const prompt = `This is a finished interior design of a ${brief.roomName}. Re-render the EXACT SAME room — identical furniture, finishes, flooring, lighting, decor, colors, and materials — from a different camera angle.

NEW CAMERA ANGLE: ${angle}

CAMERA POSITION: ${viewpointDirective}

ABSOLUTE RULES:
- Do NOT add, remove, replace, resize, or restyle ANY furniture, product, or finish.
- Keep room shape, windows, doors, and proportions (${dimStr}) identical.
- Only the camera viewpoint changes — and it MUST be a genuinely different viewpoint than the reference image.
Render it as a photorealistic, high-end interior photograph: warm architectural lighting with soft, natural shadows, realistic reflections on glass and polished surfaces, and true-to-life fabric and wood textures — Architectural Digest publication quality.`;

    try {
      const parts: Part[] = [
        {
          text: "REFERENCE IMAGE — finished design to re-render from a new camera angle. Preserve all furniture, finishes, and openings exactly:",
        },
        { inlineData: { mimeType: finalImage.mimeType, data: finalImage.base64 } },
        { text: prompt },
      ];
      const result = await generateContentLogged(model, `project-angle-variation-${i}`, parts, {
        roomId: brief.roomId,
        roomName: brief.roomName,
        detectedRoom,
        renderAngle: angle,
        angleIndex: i + 1,
      });
      const img = extractFirstGeminiImage(result);
      if (img) {
        results.push({
          angleIndex: i + 1,
          angleDescription: angle,
          viewType: inferViewType(angle, i + 1),
          base64: img.base64,
          mimeType: img.mimeType,
        });
      }
    } catch (err) {
      console.error(`Failed to render angle variation for ${brief.roomName}:`, err);
    }
  }

  return results;
}

/**
 * Re-render the locked final design once per user-marked camera viewpoint.
 * The design (furniture, finishes, materials) is held identical to `finalImage`;
 * only the camera changes to match each viewpoint's actual photo + geometry.
 * `viewpointPhotos` must be ordered primary-first and all carry a `viewpoint`.
 * Result[0] is the composed final image itself (it already uses the primary
 * viewpoint), followed by one render for every additional viewpoint.
 */
export async function generateRoomViewpointRenders(
  finalImage: { base64: string; mimeType: string },
  brief: RoomDesignBrief,
  analysis: FloorPlanAnalysis,
  viewpointPhotos: RoomPhotoWithViewpoint[],
  context?: ViewpointRenderContext,
): Promise<RenderResult[]> {
  const composed: RenderResult = {
    angleIndex: 0,
    angleDescription: "Final design",
    viewType: "wide",
    base64: finalImage.base64,
    mimeType: finalImage.mimeType,
  };
  const results: RenderResult[] = [composed];

  const googleKey = getGoogleGenerativeAiApiKey();
  // The primary viewpoint is already represented by the composed base render.
  const extraViewpoints = viewpointPhotos.slice(1).filter((p) => p.viewpoint);
  if (!googleKey || extraViewpoints.length === 0) return results;

  const detectedRoom = analysis.rooms.find((r) => r.id === brief.roomId);
  const dims = detectedRoom?.dimensions;
  const dimStr = dims ? `${dims.width}m × ${dims.depth}m, ${dims.height}m ceiling` : "the same proportions";
  // Only planText is needed now (fal takes a single prompt string, not floor-plan image
  // parts). designConsistencyText + planText feed the prompt's consistency block.
  const { planText } = await buildViewpointRenderContextParts(context);
  const consistencyBlock = [context?.designConsistencyText?.trim(), planText.trim()]
    .filter(Boolean)
    .join("\n\n");

  const model = createGeminiRenderModel(googleKey);

  for (let i = 0; i < extraViewpoints.length; i++) {
    const vpPhoto = extraViewpoints[i];
    const framing = resolveViewpointFraming(vpPhoto.viewpoint!, detectedRoom);

    const prompt = `This is a finished interior design of a ${brief.roomName}. Re-render the EXACT SAME room — identical furniture, finishes, flooring, lighting, decor, colors, and materials as the DESIGN image — from a specific camera viewpoint.

NEW CAMERA VIEWPOINT: ${framing.note}
${framing.openingsSummary}
${consistencyBlock ? `\nDESIGN CONSISTENCY (keep identical across all views):\n${consistencyBlock.slice(0, 2000)}` : ""}

You are given:
- DESIGN image: the finished design to replicate exactly (all furniture/finishes/colors) — supplied as the consistency anchor.
- CAMERA REFERENCE photo: the user's real photo from this viewpoint — match its EXACT camera position, angle, and framing. IGNORE the old furniture and finishes in it; it is ONLY a camera guide.

ABSOLUTE RULES:
- Do NOT add, remove, replace, resize, or restyle ANY furniture, product, or finish from the DESIGN image.
- Keep room shape, windows, doors, and proportions (${dimStr}) identical.
- Flooring, ceiling, curtains, wall color, and lighting must match the DESIGN image exactly.
- Only the camera viewpoint changes — match the CAMERA REFERENCE photo's vantage.
Render it as a photorealistic, high-end interior photograph: warm architectural lighting with soft, natural shadows, realistic reflections on glass and polished surfaces, and true-to-life fabric and wood textures — Architectural Digest publication quality.`;

    try {
      const parts: Part[] = [
        {
          text:
            "PRIMARY DESIGN REFERENCE — finished design to replicate exactly (furniture, finishes, colors):",
        },
        { inlineData: { mimeType: finalImage.mimeType, data: finalImage.base64 } },
        {
          text:
            "CAMERA REFERENCE — same room from a different real photo. Match this camera position and architecture only:",
        },
        { inlineData: { mimeType: vpPhoto.mimeType, data: vpPhoto.base64 } },
        { text: prompt },
      ];
      const result = await generateContentLogged(model, `project-viewpoint-render-${i}`, parts, {
        roomId: brief.roomId,
        roomName: brief.roomName,
        detectedRoom,
        angleIndex: i + 1,
      });
      const img = extractFirstGeminiImage(result);
      if (img) {
        results.push({
          angleIndex: i + 1,
          angleDescription: `Viewpoint: facing ${framing.facing}`,
          viewType: inferViewType(framing.facing, i + 1),
          base64: img.base64,
          mimeType: img.mimeType,
        });
      }
    } catch (err) {
      console.error(`Failed to render viewpoint for ${brief.roomName}:`, err);
    }
  }

  return results;
}

/**
 * Re-render the locked final design once per additional room photo when the user
 * assigned photos to the room but did not mark floor-plan viewpoints. Uses each
 * extra photo purely as a camera reference (no cone diagram).
 */
export async function generateRoomPhotoReferenceRenders(
  finalImage: { base64: string; mimeType: string },
  brief: RoomDesignBrief,
  analysis: FloorPlanAnalysis,
  roomPhotos: RoomPhotoWithViewpoint[],
  context?: ViewpointRenderContext,
): Promise<RenderResult[]> {
  const composed: RenderResult = {
    angleIndex: 0,
    angleDescription: "Final design",
    viewType: "wide",
    base64: finalImage.base64,
    mimeType: finalImage.mimeType,
  };
  const results: RenderResult[] = [composed];

  const googleKey = getGoogleGenerativeAiApiKey();
  const extraPhotos = roomPhotos.slice(1);
  if (!googleKey || extraPhotos.length === 0) return results;

  const detectedRoom = analysis.rooms.find((r) => r.id === brief.roomId);
  const dims = detectedRoom?.dimensions;
  const dimStr = dims ? `${dims.width}m × ${dims.depth}m, ${dims.height}m ceiling` : "the same proportions";
  // Only planText is needed now (fal takes a single prompt string, not image parts).
  const { planText } = await buildViewpointRenderContextParts(context);
  const consistencyBlock = [context?.designConsistencyText?.trim(), planText.trim()]
    .filter(Boolean)
    .join("\n\n");

  const model = createGeminiRenderModel(googleKey);

  for (let i = 0; i < extraPhotos.length; i++) {
    const refPhoto = extraPhotos[i]!;
    const label = refPhoto.label?.trim() || `Photo ${i + 2}`;

    const prompt = `This is a finished interior design of a ${brief.roomName}. Re-render the EXACT SAME room — identical furniture, finishes, flooring, lighting, decor, colors, and materials as the DESIGN image — from the camera angle shown in the CAMERA REFERENCE photo.

CAMERA REFERENCE: "${label}" — match this photo's EXACT camera position, angle, and framing. IGNORE the old furniture and finishes in the reference; it is ONLY a camera guide.
${consistencyBlock ? `\nDESIGN CONSISTENCY (keep identical across all views):\n${consistencyBlock.slice(0, 2000)}` : ""}

You are given:
- DESIGN image: the finished design to replicate exactly (all furniture/finishes/colors) — supplied as the consistency anchor.
- CAMERA REFERENCE photo: match its vantage precisely.

ABSOLUTE RULES:
- Do NOT add, remove, replace, resize, or restyle ANY furniture, product, or finish from the DESIGN image.
- Keep room shape, windows, doors, and proportions (${dimStr}) identical.
- Flooring, ceiling, curtains, wall color, and lighting must match the DESIGN image exactly.
- Only the camera viewpoint changes — match the CAMERA REFERENCE photo's vantage.
Render it as a photorealistic, high-end interior photograph: warm architectural lighting with soft, natural shadows, realistic reflections on glass and polished surfaces, and true-to-life fabric and wood textures — Architectural Digest publication quality.`;

    try {
      const parts: Part[] = [
        {
          text:
            "PRIMARY DESIGN REFERENCE — finished design to replicate exactly (furniture, finishes, colors):",
        },
        { inlineData: { mimeType: finalImage.mimeType, data: finalImage.base64 } },
        {
          text:
            "CAMERA REFERENCE — same room from a different real photo. Match this camera position and architecture only:",
        },
        { inlineData: { mimeType: refPhoto.mimeType, data: refPhoto.base64 } },
        { text: prompt },
      ];
      const result = await generateContentLogged(model, `project-photo-reference-render-${i}`, parts, {
        roomId: brief.roomId,
        roomName: brief.roomName,
        detectedRoom,
        angleIndex: i + 1,
      });
      const img = extractFirstGeminiImage(result);
      if (img) {
        results.push({
          angleIndex: i + 1,
          angleDescription: `View: ${label}`,
          viewType: inferViewType(label, i + 1),
          base64: img.base64,
          mimeType: img.mimeType,
        });
      }
    } catch (err) {
      console.error(`Failed to render photo reference for ${brief.roomName}:`, err);
    }
  }

  return results;
}

export async function generateRoomRenders(
  brief: RoomDesignBrief,
  concept: MasterDesignConcept,
  analysis: FloorPlanAnalysis,
  referencePhoto?: { base64: string; mimeType: string },
  options?: RoomRenderGenerationOptions,
  onAngleProgress?: (angleIndex: number, total: number) => void,
): Promise<RoomRenderGenerationResult> {
  const googleKey = getGoogleGenerativeAiApiKey();
  if (!googleKey) {
    throw new Error("GOOGLE_AI_API_KEY or GEMINI_API_KEY is not configured");
  }

  const detectedRoom = analysis.rooms.find((r) => r.id === brief.roomId);
  const genai = new GoogleGenerativeAI(googleKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_IMAGE_MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: RENDER_GENERATION_CONFIG as any,
    systemInstruction: DESIGNER_SYSTEM_INSTRUCTION,
  });

  const results: RenderResult[] = [];

  const exclusive =
    !!options?.scrapedInventoryExclusive &&
    Array.isArray(options.scrapedAllowlistNumericIds) &&
    options.scrapedAllowlistNumericIds.length > 0;

  let catalog: ResolvedRoomCatalog | null = null;
  let combinedMerchantAppendix = "";
  let productImageGeminiParts: Part[] = [];
  let productIntroText = "";
  let productCloseText = "";
  const collageNote =
    "\nREFERENCE PRODUCT COLLAGES inserted below — see IMAGE_MANIFEST for cell → product mapping. Match silhouettes, proportions, upholstery, wood tones, and finishes exactly.\n";

  if (exclusive && options?.scrapedAllowlistNumericIds?.length) {
    catalog = await resolveRoomCatalogProducts({
      brief,
      concept,
      allowlistIds: options.scrapedAllowlistNumericIds,
      pinnedProductIds: options.pinnedProductIds,
    });

    if (catalog.selectedForGemini.length === 0) {
      throw new Error(
        "Could not match catalog products for this room. Try adjusting preferences or add inspiration products.",
      );
    }

    const referencePhotoBytes = referencePhoto
      ? (() => {
          const buf = Buffer.from(referencePhoto.base64, "base64");
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        })()
      : null;

    const geminiPayload = await buildGeminiCatalogPayload({
      selectedForGemini: catalog.selectedForGemini,
      catalogById: catalog.catalogById,
      pinnedMpKeys: catalog.pinnedMpKeys,
      plannedCatalogIds: catalog.plannedCatalogIds,
      referencePhotoBytes,
      userUploads: options.inspirationUploads ?? [],
      scrapedInventoryExclusive: true,
    });

    combinedMerchantAppendix = geminiPayload.combinedMerchantAppendix;
    productImageGeminiParts = geminiPayload.productImageParts as Part[];
    productIntroText = geminiPayload.productIntroText;
    productCloseText = geminiPayload.productCloseText;
    catalog = {
      ...catalog,
      collageIncludedIds: geminiPayload.includedCatalogIds,
      textOnlyCatalogIds: geminiPayload.textOnlyCatalogIds,
    };
    console.info("project.gemini.visual_payload", {
      catalogCount: catalog.selectedForGemini.length,
      collageCount: productImageGeminiParts.length,
      includedCatalogCount: geminiPayload.includedCatalogIds.length,
      traceTag: "[gemini-product-images]",
    });
  }

  const merchantForPrompt = combinedMerchantAppendix || undefined;
  const visualNote = productImageGeminiParts.length > 0 ? collageNote : "";
  const crossRoomContext = options?.crossRoomContext;
  const floorPlanText = options?.floorPlanContext?.planText;

  // Floor plan (original + highlighted) + every other photo of this same room,
  // shared with the Claude director so both produce the same physical room.
  const { floorPlanParts, extraRoomPhotoParts } = await buildFloorPlanContextParts(
    options?.floorPlanContext,
    referencePhoto?.base64,
  );

  // Geometry-grounded camera framing from the user-marked viewpoint: a precise
  // vantage note, an in-frame openings summary, and a top-down cone diagram fed
  // to Gemini as a visual anchor.
  const framing = options?.referenceViewpoint
    ? resolveViewpointFraming(options.referenceViewpoint, detectedRoom)
    : undefined;
  const viewpointNote = framing?.note;
  const coneImage =
    options?.referenceViewpoint && detectedRoom
      ? await renderViewpointDiagram(detectedRoom, options.referenceViewpoint)
      : null;
  const conePartsFor = (label: string): Part[] =>
    coneImage
      ? [{ text: label }, { inlineData: { mimeType: coneImage.mimeType, data: coneImage.base64 } }]
      : [];

  // Camera-agnostic top-down openings map (polygon + windows/doors at exact
  // positions + corner letters) — built once per room and sent on EVERY render
  // angle so Gemini places openings on the right wall regardless of vantage.
  const openingsImage = detectedRoom ? await renderOpeningsDiagram(detectedRoom) : null;
  const openingsPartsFor = (label: string): Part[] =>
    openingsImage
      ? [{ text: label }, { inlineData: { mimeType: openingsImage.mimeType, data: openingsImage.base64 } }]
      : [];

  const allOpeningsSummary = buildAllOpeningsSummary(detectedRoom);
  const overallShape = analysis.overallShape;

  if (referencePhoto) {
    const prompt = buildPhotoGroundedPrompt(
      brief,
      concept,
      detectedRoom,
      undefined,
      "",
      crossRoomContext,
      viewpointNote,
      options?.utilityConstraints,
      framing?.openingsSummary,
      floorPlanText,
    );
    try {
      const parts: Part[] = [
        {
          text:
            "PRIMARY IMAGE — THE ROOM TO EDIT. Preserve its walls, corners, room shape, proportions, ceiling structure, camera angle, and the count + positions of every window and door EXACTLY:",
        },
        { inlineData: { mimeType: referencePhoto.mimeType, data: referencePhoto.base64 } },
        ...floorPlanParts,
      ];
      if (productImageGeminiParts.length > 0 && productIntroText) {
        parts.push({ text: productIntroText });
      }
      parts.push(...productImageGeminiParts);
      if (productImageGeminiParts.length > 0 && productCloseText) {
        parts.push({ text: productCloseText });
      }
      parts.push(...extraRoomPhotoParts);
      if (options?.referenceViewpoint && coneImage) {
        parts.push(
          ...conePartsFor(
            "VANTAGE DIAGRAM (top-down floor plan): the dot is the camera and the shaded wedge is its field of view. Match this exact vantage — the walls and openings inside the wedge are what must be visible, in these positions.",
          ),
        );
      }
      parts.push(
        ...openingsPartsFor(
          "OPENINGS DIAGRAM (top-down floor plan, no camera): the room outline with windows (cyan) and doors (orange, with swing arc); corner letters A, B, C… label the walls. Place every window and door on the exact wall and exact position shown here, at the stated widths/heights — do not move, resize, add, or remove any opening.",
        ),
      );
      parts.push({ text: prompt });
      const result = await generateContentLogged(model, "project-photo-grounded", parts, {
        roomId: brief.roomId,
        roomName: brief.roomName,
        detectedRoom,
        angleIndex: 0,
      });
      const img = extractFirstGeminiImage(result);
      if (img) {
        results.push({
          angleIndex: 0,
          angleDescription: "Photo-grounded redesign",
          viewType: "standard",
          base64: img.base64,
          mimeType: img.mimeType,
        });
      }
    } catch (err) {
      console.error(`Failed to generate photo-grounded render for ${brief.roomName}:`, err);
    }
    return { renders: results, catalog };
  }

  for (let i = 0; i < brief.renderAngles.length; i++) {
    onAngleProgress?.(i, brief.renderAngles.length);
    const angle = brief.renderAngles[i];
    // The user marked a single vantage — apply it (and the cone diagram + in-frame
    // openings) to the primary angle only; other angles use generic framing.
    const primary = i === 0;
    const prompt = buildRoomRenderPrompt(
      brief,
      concept,
      detectedRoom,
      angle,
      merchantForPrompt,
      visualNote,
      crossRoomContext,
      primary ? viewpointNote : undefined,
      options?.utilityConstraints,
      primary ? (framing?.openingsSummary ?? allOpeningsSummary) : allOpeningsSummary,
      floorPlanText,
      overallShape,
    );

    try {
      const parts: Part[] = [];
      parts.push(...floorPlanParts);
      if (productImageGeminiParts.length > 0 && productIntroText) {
        parts.push({ text: productIntroText });
      }
      parts.push(...productImageGeminiParts);
      if (productImageGeminiParts.length > 0 && productCloseText) {
        parts.push({ text: productCloseText });
      }
      parts.push(...extraRoomPhotoParts);
      if (primary) {
        parts.push(
          ...conePartsFor(
            "VANTAGE DIAGRAM (top-down floor plan): the dot is the camera and the shaded wedge is its field of view. Match this exact vantage — the walls and openings inside the wedge are what must be visible, in these positions.",
          ),
        );
      }
      parts.push(
        ...openingsPartsFor(
          "OPENINGS DIAGRAM (top-down floor plan, no camera): the room outline with windows (cyan) and doors (orange, with swing arc); corner letters A, B, C… label the walls. Place every window and door on the exact wall and exact position shown here, at the stated widths/heights — do not move, resize, add, or remove any opening.",
        ),
      );
      parts.push({ text: prompt });
      const result = await generateContentLogged(model, `project-text-to-image-angle-${i}`, parts, {
        roomId: brief.roomId,
        roomName: brief.roomName,
        detectedRoom,
        renderAngle: angle,
        angleIndex: i,
      });

      type GenPart = { inlineData?: { data?: unknown; mimeType?: unknown }; text?: string };
      for (const candidate of result.response?.candidates ?? []) {
        let pushed = false;
        for (const part of candidate.content?.parts ?? []) {
          const pdata = part as GenPart;
          const raw = pdata.inlineData?.data;
          if (typeof raw === "string" && raw) {
            const mt = pdata.inlineData?.mimeType;
            results.push({
              angleIndex: i,
              angleDescription: angle,
              viewType: inferViewType(angle, i),
              base64: raw,
              mimeType: typeof mt === "string" && mt ? mt : "image/png",
            });
            pushed = true;
            break;
          }
        }
        if (pushed) break;
      }
    } catch (err) {
      console.error(`Failed to generate render for ${brief.roomName} angle ${i}:`, err);
    }
  }

  return { renders: results, catalog };
}

// ---------------------------------------------------------------------------
// Material specification — derived from the saved design brief (no Claude call)
// ---------------------------------------------------------------------------

export interface ExtractRoomMaterialsOptions {
  scrapedInventoryExclusive?: boolean;
  scrapedAllowlistNumericIds?: number[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function firstSearchHitInAllowlist(query: string, allowed: Set<number>): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(
      `${getServerMarketplaceApiBaseUrl()}/products/search?q=${encodeURIComponent(query)}&in_stock=0&per_page=20`,
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
    if (!res.ok) return undefined;
    const json: unknown = await res.json();
    const rows = marketplaceSearchRowsFromJson(json);
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const id = Number(row.id);
      if (allowed.has(id)) return row;
    }
  } catch { /* ignore */ }
  return undefined;
}

/** Generic (non-allowlist) marketplace search — first hit. */
async function firstMarketplaceSearchHit(query: string): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(
      `${getServerMarketplaceApiBaseUrl()}/products/search?q=${encodeURIComponent(query)}&per_page=1`,
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: Record<string, unknown>[] };
    const first = Array.isArray(json.data) ? json.data[0] : undefined;
    return first && isRecord(first) ? first : undefined;
  } catch {
    return undefined;
  }
}

// Ordered most-specific → least so the first keyword hit is the best product noun.
const FURNITURE_CATEGORY_KEYWORDS = [
  "sectional", "sofa", "divan", "armchair", "accent chair", "lounge chair", "chair",
  "coffee table", "dining table", "console table", "side table", "nightstand", "desk", "table",
  "wardrobe", "closet", "dresser", "chest of drawers", "cabinet", "sideboard", "bookcase",
  "shelving", "shelf", "bed frame", "headboard", "bed", "ottoman", "pouf", "bench", "stool",
  "tv stand", "media unit", "rug", "carpet", "mirror", "chandelier", "pendant", "floor lamp",
  "table lamp", "lamp", "curtain", "blinds",
];

/** Reduce a descriptive brief furniture line to a short, searchable product noun. */
function furnitureCategoryFromName(name: string): string {
  const hay = name.toLowerCase();
  for (const kw of FURNITURE_CATEGORY_KEYWORDS) {
    if (hay.includes(kw)) return kw;
  }
  return name.trim().split(/[\s,]+/).slice(0, 2).join(" ") || name.trim();
}

/**
 * Build a structured {@link RoomMaterialSpec} straight from the saved design
 * brief — the non-Claude replacement for the former per-room "material spec"
 * call. The brief already carries every design decision, so this only attaches
 * best-effort scraped-marketplace product matches (for the PDF / procurement
 * rows). In Armenia·Local exclusive mode matches are constrained to the room's
 * allow-list; otherwise the general marketplace search is used.
 */
export async function buildMaterialSpecFromBrief(
  brief: RoomDesignBrief,
  options?: ExtractRoomMaterialsOptions,
): Promise<RoomMaterialSpec> {
  const allow = [...new Set((options?.scrapedAllowlistNumericIds ?? []).filter((n) => n > 0))];
  const exclusive = !!options?.scrapedInventoryExclusive && allow.length > 0;
  const allowSet = new Set(allow);
  const searchHit = exclusive
    ? (q: string) => firstSearchHitInAllowlist(q, allowSet)
    : (q: string) => firstMarketplaceSearchHit(q);

  const isWetRoom =
    brief.roomType === "bathroom" ||
    brief.roomType === "toilet" ||
    brief.roomType === "kitchen" ||
    brief.roomType === "laundry";

  const spec: RoomMaterialSpec = {
    wallColor: { ncs: brief.wallColor.ncs, hex: brief.wallColor.hex },
    floorMaterial: { type: brief.floorMaterial || "engineered hardwood" },
    tileMaterial: isWetRoom ? { type: "porcelain tile" } : undefined,
    keyFurniture: brief.furnitureList.slice(0, 7).map((name) => ({
      name,
      category: furnitureCategoryFromName(name),
    })),
  };

  const applyHit = (
    target: {
      productName?: string;
      productUrl?: string;
      price?: number;
      imageUrl?: string;
      scrapedListing?: MarketplaceMatch;
    },
    hit: Record<string, unknown>,
  ) => {
    target.productName =
      typeof hit.name_en === "string" && hit.name_en.trim()
        ? hit.name_en
        : typeof hit.name === "string"
          ? hit.name
          : target.productName;
    target.productUrl = typeof hit.external_url === "string" ? hit.external_url : target.productUrl;
    target.price = typeof hit.price === "number" ? hit.price : target.price;
    if ("imageUrl" in target) {
      target.imageUrl = typeof hit.main_image_url === "string" ? hit.main_image_url : target.imageUrl;
    }
    target.scrapedListing = rowToMarketplaceMatch(hit);
  };

  if (spec.tileMaterial) {
    const q = spec.tileMaterial.type.includes("tile")
      ? spec.tileMaterial.type
      : `${spec.tileMaterial.type} tile`;
    const hit = await searchHit(q.slice(0, 90));
    if (hit) applyHit(spec.tileMaterial, hit);
  }

  {
    const hit = await searchHit(`${spec.floorMaterial.type} floor`.slice(0, 90));
    if (hit) applyHit(spec.floorMaterial, hit);
  }

  const usedFurnitureIds = new Set<number>();
  for (const item of spec.keyFurniture) {
    for (const query of [item.category, item.name].filter((q) => q.trim().length > 0)) {
      const hit = await searchHit(query);
      if (!hit) continue;
      const match = rowToMarketplaceMatch(hit);
      if (!match.marketplaceId || usedFurnitureIds.has(match.marketplaceId)) continue;
      item.suggestedProduct = match;
      usedFurnitureIds.add(match.marketplaceId);
      break;
    }
  }

  return spec;
}

/**
 * Map the products a render actually resolved (`selectedForGemini`) to
 * {@link MarketplaceMatch}es — the authoritative "products used in this room",
 * replacing the former Claude in-render verification pass.
 */
export function scrapedProductsFromCatalog(catalog: ResolvedRoomCatalog): MarketplaceMatch[] {
  const out: MarketplaceMatch[] = [];
  const seen = new Set<number>();
  for (const id of catalog.selectedForGemini) {
    const item = catalog.catalogById.get(id);
    if (!item) continue;
    const mpId = Number(item.id) || 0;
    if (!mpId || seen.has(mpId)) continue;
    seen.add(mpId);
    out.push({
      marketplaceId: mpId,
      name: item.name,
      price: item.price || 0,
      currency: item.currency || "AMD",
      url: item.externalUrl || "",
      imageUrl: item.primaryImageUrl ?? null,
    });
  }
  return out;
}

