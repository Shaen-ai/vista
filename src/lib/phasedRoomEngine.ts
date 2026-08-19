/**
 * Phased room-design engine — shared by Quick Room (`/api/interior-design/phased-generate`)
 * and Full Project per-room generation (`projectOrchestrator.generateRoomPhase`).
 *
 * Given a single phase (base | furniture | decor), a base input image (or null for a
 * text-to-image shell), and a catalog allowlist, this:
 *   1. resolves catalog slots filtered to the phase (Qdrant via resolveCatalogSlots)
 *   2. partitions pinned products by phase, dedupes singletons, caps to the phase limit
 *   3. sends individual product reference images to Gemini (no collages)
 *   4. validates the render with Claude vision, retrying with only the missing products
 *   5. returns the chosen image + confirmed/missing/cumulative product ids + purchase links
 *
 * Token metering and HTTP/SSE concerns stay in the callers.
 */
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type Part,
} from "@google/generative-ai";
import {
  buildConsumerDesignCatalogContext,
  buildGeminiMerchantFurnitureCatalogBlock,
  fetchMarketplaceProductsAsCatalog,
  type CatalogItemSummary,
} from "@/lib/consumerCatalog";
import { fetchProductPurchaseLinks, type ProductPurchaseLink } from "@/lib/productPurchaseLinks";
import { sortProductsForDisplay } from "@/lib/productDisplayOrder";
import { getMadeModeRoomSlots, getRoomSlotTemplate, mergeRoomSlots } from "@/lib/roomSlotTemplates";
import { isOrientationFlip, nearestEditAspectRatio } from "@/lib/editAspectRatio";
import {
  constraintsFromRoomAndStyle,
  filterSlotsForRoomType,
  rejectFamilyMismatchIds,
  resolveCatalogSlots,
  vectorConfirmedCatalogIds,
  type ResolvedCatalogSlot,
} from "@/lib/resolveCatalogSlots";
import { numericIdsFromMpKeys } from "@/lib/scrapedRoomGeneration";
import { buildGeminiProductVisualParts } from "@/lib/buildGeminiProductVisualParts";
import {
  type DesignPhase,
  classifyProductPhase,
  effectiveMadePhaseProductLimit,
  filterSlotsForMadePhase,
  partitionByPhase,
  PHASE_PRODUCT_LIMITS,
  productMatchesMadePhase,
  QUICK_ROOM_MADE_PRODUCTS_PER_STEP,
} from "@/lib/phaseRouter";
import { buildPreserveBlock } from "@/lib/quickRoom/quickEditPrompt";
import type { PreserveMode } from "@/lib/quickRoom/shapeCreativity";
import {
  buildImaginedSlotEntries,
  buildSlotNotices,
  notifySlotFailure,
  type ImaginedSlotEntry,
} from "@/lib/notifySlotFailure";
import {
  buildIndividualProductParts,
  buildGeminiPartsFromIndividual,
} from "@/lib/buildIndividualProductParts";
import { validatePhaseProducts } from "@/lib/validatePhaseProducts";
import {
  DESIGN_STYLES,
  type DesignStyleId,
  type RoomAnalysis,
  type DesignBrief,
} from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import { buildOpeningStructuralLock } from "@/lib/openingStructuralLock";
import { buildFalOpeningLockCompact } from "@/lib/falOpeningLockCompact";
import {
  buildDoorDesignPromptBlock,
  DOOR_CLEARANCE_DIRECTIVE,
} from "@/lib/doorRenderPrompt";
import { resolveRenderProvider, renderRoomImageViaOpenAi } from "@/lib/roomImageRenderer";
import { renderSecondaryAngle } from "@/lib/falRoomRenderer";
import { acceptRenderWithPlacementRetry, buildFurnitureLabels } from "@/lib/placementBoxes";
import {
  acceptSecondaryWithCrossViewRetry,
  appendSecondaryLayoutLock,
} from "@/lib/validateCrossViewConsistency";
import { SECONDARY_LAYOUT_LOCK } from "@/lib/secondaryLayoutLock";

async function recordGeminiGenerationSpend(
  model: string,
  label: string,
  result: {
    response?: {
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
  },
  imageCount: number,
): Promise<void> {
  const usageMeta = result.response?.usageMetadata;
  if (!usageMeta) return;
  const { recordGeminiUsage } = await import("@/lib/aiSpend");
  recordGeminiUsage({
    model,
    promptTokenCount: usageMeta.promptTokenCount,
    candidatesTokenCount: usageMeta.candidatesTokenCount,
    totalTokenCount: usageMeta.totalTokenCount,
    imageGeneration: imageCount > 0,
    label,
  });
}
import { pipelineLog, debugSessionLog, countMicroEdgeLabels } from "@/lib/pipelineLog";
import { logGeminiRequest, type LogGeminiRequestContext } from "@/lib/logGeminiRequest";
import { DESIGNER_SYSTEM_INSTRUCTION, HALLWAY_PHOTO_EDIT_SYSTEM_INSTRUCTION } from "@/lib/designerSystemInstruction";
import { RENDER_GENERATION_CONFIG, GEMINI_IMAGE_MODEL, GEMINI_IMAGE_MODEL_LABEL } from "@/lib/geminiImageConfig";
import {
  HALLWAY_PHOTO_EDIT_DIRECTIVE,
  HALLWAY_PHOTO_EDIT_LOCK,
  NO_TEXT_IN_IMAGE_DIRECTIVE,
  RENDER_QUALITY_DIRECTIVE,
} from "@/lib/renderQualityDirective";
import {
  buildHallwayPhotoGeminiParts,
  optimizeLabeledRoomPhotosForGemini,
} from "@/lib/hallwayPhotoEdit";
import {
  HALLWAY_PHOTO_OPTIMIZE_OPTIONS,
  optimizeImageBufferForAi,
} from "@/lib/optimizeImageForAi";
import {
  buildStructuralGuardrailPrompt,
  metricsFromSummarizeRoomParams,
  type InteriorPreferencesPrompt,
  type RoomStructuralMetrics,
} from "@/lib/buildStructuralGuardrailPrompt";
import { buildNoColumnHallucinationDirective } from "@/lib/structuralGeometryLock";
import { hasPhotoConfirmedColumn } from "@/lib/photoStructuralElements";
import {
  buildMultiPhotoContextParts,
  type LabeledRoomPhoto,
  type MultiPhotoContextMode,
} from "@/lib/buildMultiPhotoGeminiParts";
import { buildGalleryEditPrompt, EDIT_ANNOTATION_MARKER_PROMPT } from "@/lib/project/galleryRoomEdit";
import type { ViewpointFraming } from "@/lib/project/viewpointFraming";
import { buildFreezeMask } from "@/lib/buildFreezeMask";
import { REMOVAL_MASK_GEMINI_INTRO } from "@/lib/buildObjectRemovalDirective";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import sharp from "sharp";
import { dedupeSingletonCatalogIds, orderIdsForGemini } from "@/lib/placementPlan";
import { verifyProductAvailability } from "@/lib/verifyProductAvailability";

/** UI preference fields forwarded verbatim into the Gemini prompt. */
export type { InteriorPreferencesPrompt, RoomStructuralMetrics };

/** Fallback when `simpleDirectRender` is off (Quick Room / catalog path). */
const GEMINI_FALLBACK_RENDER_PROMPT =
  "Keep the room shape and proportions exactly unchanged.\n" +
  "Keep every window and door exactly as in the photo — do not add, remove, or move any opening.\n" +
  "Add a fully furnished interior design with appropriate furniture, finishes, and decor.";

async function buildOpeningMaskParts(
  photoBase64: string,
  windowBoxes: OpeningBox[],
  doorBoxes: OpeningBox[],
): Promise<GeminiPart[] | null> {
  if (!windowBoxes.length && !doorBoxes.length) return null;
  try {
    const input = Buffer.from(photoBase64, "base64");
    const meta = await sharp(input).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const maskBuf = await buildFreezeMask({ width, height, windowBoxes, doorBoxes });
    if (!maskBuf) return null;
    return [
      {
        text:
          "EDIT PERMISSION MASK — BLACK regions are LOCKED: preserve door/window pixels and surrounding wall edges exactly. " +
          "WHITE regions may receive new finishes, furniture, and decor. Never alter BLACK pixels.",
      },
      { inlineData: { mimeType: "image/png", data: maskBuf.toString("base64") } },
    ];
  } catch {
    return null;
  }
}

export const PHASED_MAX_RETRIES = 3;

export type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

export interface InspirationItem {
  base64: string;
  mimeType: string;
  label: string;
}

export interface PhasedRoomInput {
  phase: DesignPhase;
  /** Base input image: room photo or previous-phase render. null => text-to-image shell (base phase only). */
  baseImage: { base64: string; mimeType: string } | null;
  styleId: DesignStyleId;
  designStyleLabel: string;
  textPrompt: string;
  /** Already-normalized room type (e.g. "living room"). */
  roomType: string;
  roomAnalysis?: RoomAnalysis | null;
  roomGeometry?: RoomGeometry | null;
  brief?: DesignBrief | null;
  /** Marketplace ids to load as catalog context (the resolved allowlist). */
  marketplaceNumericIds: number[];
  /** Hard-pinned product ids (design-board picks) — partitioned by phase, always preferred. */
  pinnedProductIds: number[];
  /** Confirmed product mp-keys from earlier phases (for cumulative links). */
  previousPhaseProducts: string[];
  inspirationItems?: InspirationItem[];
  styleInspirationParts?: GeminiPart[];
  /** Project enrichment appended to the Gemini prompt (concept palette + cross-room consistency). */
  extraPromptBlock?: string;
  /**
   * Floor-plan reference images (original plan + target-room-highlighted schematic).
   * Spatial reference ONLY — never rendered; keeps walls/openings/room identity consistent.
   */
  floorPlanParts?: Array<{ base64: string; mimeType: string; label: string }>;
  /** All other photos of THIS SAME room (besides the base image) — equal references. */
  extraRoomPhotos?: Array<{ base64: string; mimeType: string }>;
  /** Top-down camera cone diagram + label for the primary photo viewpoint (base phase). */
  viewpointParts?: GeminiPart[];
  googleKey: string;
  anthropicKey?: string;
  /** When true (default), notify on failed base-phase slots. */
  notifyOnSlotFailure?: boolean;
  /**
   * Custom design mode: skip the catalog entirely and render a single,
   * fully-furnished imaginary design. No materials list, no product links.
   */
  freeRender?: boolean;
  /**
   * Single-pass design: produce one fully-designed-and-furnished render (materials +
   * lighting + furniture + decor together) instead of the base→furniture→decor phases.
   * Only meaningful with `freeRender` (Custom mode); ignored by the catalog path.
   */
  singlePassDesign?: boolean;
  /** For `[gemini-request]` logging (Full Project). */
  projectId?: string;
  roomId?: string;
  roomName?: string;
  /** Floor-plan structural data for `[gemini-request]` logging. */
  detectedRoom?: LogGeminiRequestContext["detectedRoom"];
  /**
   * Design-consistency reference: a finished render of THIS SAME room from another
   * viewpoint (the primary track's render). The model must match its design —
   * ceiling, flooring, finishes, and the same furniture pieces — but NOT its camera
   * or architecture. Keeps multi-viewpoint renders looking like one room.
   */
  designReferenceImage?: { base64: string; mimeType: string } | null;
  /** Additional approved renders of the SAME room from other angles — sequential viewpoint flow. */
  additionalDesignReferences?: { base64: string; mimeType: string }[];
  /** When set with `simpleDirectRender`, use UI preference labels in the Gemini prompt. */
  preferencesPrompt?: InteriorPreferencesPrompt;
  /** Send only room photo + floor plan; skip concept/viewpoint/product extras. */
  simpleDirectRender?: boolean;
  structuralMetrics?: RoomStructuralMetrics;
  openingGuideParts?: GeminiPart[];
  photoWindowBoxes?: OpeningBox[];
  photoDoorBoxes?: OpeningBox[];
  photoId?: string;
  cameraNote?: string;
  visibleOpeningsNote?: string;
  editFeedback?: string;
  /** All assigned room photos — sent together with structured labels. */
  allRoomPhotos?: LabeledRoomPhoto[];
  editTargetPhotoId?: string;
  /** Claude-composed render rules — Gemini receives room photos + this text only. */
  geminiRenderPrompt?: string;
  /** Claude door styling concept (optional — falls back to generic ready-door directive). */
  doorDesign?: string | null;
  /** Render with red strokes showing where the user wants a change. */
  editAnnotationImage?: { base64: string; mimeType: string } | null;
  /** User-marked regions to clear (furniture/debris) before redesign. */
  objectRemovalMask?: { base64: string; mimeType: string } | null;
  /** When transferring hero design onto a secondary camera — mirror rules for ~180° views. */
  viewpointTransferDirective?: string;
  /** Quick Room made: ≤4 selected products — merge furniture + decor in one furniture call. */
  compactProductFlow?: boolean;
  /** Ready-made ("made") design type — use the reduced flooring+furniture slot kit (<=4 products). */
  madeMode?: boolean;
  /** Max product reference images per Gemini request (Quick Room made default 4). */
  productsPerStep?: number;
  /** Quick Room made: prepend PRESERVE block + opening freeze masks from preserve mode. */
  veryStrongShapeLock?: boolean;
  shapePreserveMode?: PreserveMode;
}

export interface PhasedRoomResult {
  ok: boolean;
  status?: number;
  error?: string;
  images: { base64: string; mimeType: string }[];
  selectedCatalogIds: string[];
  confirmedCatalogIds: string[];
  missingCatalogIds: string[];
  allPhaseProductIds: string[];
  productLinks: ProductPurchaseLink[];
  imaginedSlots: ImaginedSlotEntry[];
  slotNotices: string[];
}

function resolvePhasedShapePreserveMode(opts: {
  shapePreserveMode?: PreserveMode;
  veryStrongShapeLock?: boolean;
}): PreserveMode | null {
  if (opts.shapePreserveMode) return opts.shapePreserveMode;
  if (opts.veryStrongShapeLock) return "veryStrong";
  return null;
}

async function generatePhasedGeminiImage(opts: {
  googleApiKey: string;
  /** Room input image; null => generate from scratch (base phase, no photo). */
  roomImage: { base64: string; mimeType: string } | null;
  productParts: GeminiPart[];
  styleInspirationParts?: GeminiPart[];
  phase: DesignPhase;
  designStyleLabel: string;
  textPrompt: string;
  roomType: string;
  roomAnalysis?: RoomAnalysis | null;
  roomGeometry?: RoomGeometry | null;
  brief?: DesignBrief | null;
  merchantAppendix?: string;
  extraPromptBlock?: string;
  hasCatalogProducts?: boolean;
  /** Ready-made ("made") design type — drives the rich-styling directive. */
  madeMode?: boolean;
  /** Floor-plan reference images — spatial reference only, never rendered. */
  floorPlanParts?: Array<{ base64: string; mimeType: string; label: string }>;
  /** Other photos of the same room — equal references to the same physical space. */
  extraRoomPhotos?: Array<{ base64: string; mimeType: string }>;
  /** Top-down camera cone diagram for the primary photo viewpoint. */
  viewpointParts?: GeminiPart[];
  /** Same room from another viewpoint — match its design, not its camera/architecture. */
  designReferenceImage?: { base64: string; mimeType: string } | null;
  additionalDesignReferences?: { base64: string; mimeType: string }[];
  /** Custom design: single-shot, fully-furnished imaginary render with no catalog tie. */
  freeRender?: boolean;
  /** Single-pass: design + furnish + decorate in ONE render (no empty-shell phase). */
  singlePassDesign?: boolean;
  projectId?: string;
  roomId?: string;
  roomName?: string;
  detectedRoom?: LogGeminiRequestContext["detectedRoom"];
  preferencesPrompt?: InteriorPreferencesPrompt;
  simpleDirectRender?: boolean;
  structuralMetrics?: RoomStructuralMetrics;
  openingGuideParts?: GeminiPart[];
  photoWindowBoxes?: OpeningBox[];
  photoDoorBoxes?: OpeningBox[];
  photoId?: string;
  cameraNote?: string;
  visibleOpeningsNote?: string;
  editFeedback?: string;
  allRoomPhotos?: LabeledRoomPhoto[];
  editTargetPhotoId?: string;
  geminiRenderPrompt?: string;
  doorDesign?: string | null;
  editAnnotationImage?: { base64: string; mimeType: string } | null;
  objectRemovalMask?: { base64: string; mimeType: string } | null;
  viewpointTransferDirective?: string;
  veryStrongShapeLock?: boolean;
  shapePreserveMode?: PreserveMode;
}): Promise<Array<{ base64: string; mimeType: string }>> {
  const simpleDirect = opts.simpleDirectRender && !!opts.preferencesPrompt;
  const photoGrounded = !!(
    opts.roomImage?.base64 || opts.allRoomPhotos?.some((p) => p.base64)
  );
  const isHallwayPhotoEdit = opts.roomType === "hallway" && photoGrounded;

  const genai = new GoogleGenerativeAI(opts.googleApiKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_IMAGE_MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: (isHallwayPhotoEdit
      ? { ...RENDER_GENERATION_CONFIG, temperature: 0.05 }
      : RENDER_GENERATION_CONFIG) as any,
    systemInstruction: isHallwayPhotoEdit
      ? HALLWAY_PHOTO_EDIT_SYSTEM_INSTRUCTION
      : DESIGNER_SYSTEM_INSTRUCTION,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
  });

  const parts: GeminiPart[] = [];
  const qualityDirective = isHallwayPhotoEdit ? HALLWAY_PHOTO_EDIT_DIRECTIVE : RENDER_QUALITY_DIRECTIVE;
  let renderPrompt = opts.geminiRenderPrompt?.trim()
    ? `${opts.geminiRenderPrompt.trim()}\n\n${qualityDirective}`
    : simpleDirect && opts.preferencesPrompt && opts.structuralMetrics
      ? buildStructuralGuardrailPrompt({
          metrics: opts.structuralMetrics,
          prefs: opts.preferencesPrompt,
          photoId: opts.photoId,
          cameraNote: opts.cameraNote,
          visibleOpeningsNote: opts.visibleOpeningsNote,
          editFeedback: opts.editFeedback,
          roomAnalysis: opts.roomAnalysis,
          roomGeometry: opts.roomGeometry,
          photoGrounded,
          hasObjectRemovalMask: !!opts.objectRemovalMask?.base64,
        })
      : GEMINI_FALLBACK_RENDER_PROMPT;

  const shapePreserveMode = resolvePhasedShapePreserveMode(opts);
  if (shapePreserveMode && !opts.geminiRenderPrompt?.trim()) {
    const preserve = buildPreserveBlock(shapePreserveMode);
    if (!renderPrompt.includes(preserve.slice(0, 40))) {
      renderPrompt = `${preserve}\n\n${renderPrompt}`;
    }
  }

  // Design concept path skips buildStructuralGuardrailPrompt — always append the
  // per-viewpoint opening lock so door/window counts and solid-wall rules reach Gemini.
  const openingLock = buildOpeningStructuralLock(opts.roomAnalysis, opts.roomGeometry);
  if (openingLock && !renderPrompt.includes(openingLock)) {
    renderPrompt += `\n\n${openingLock}`;
  }
  const doorDesign = opts.doorDesign ?? opts.brief?.doorDesign;
  if (!renderPrompt.includes("DOOR FINISH")) {
    renderPrompt += `\n\n${buildDoorDesignPromptBlock(doorDesign)}`;
  }
  if (!renderPrompt.includes(DOOR_CLEARANCE_DIRECTIVE.slice(0, 40))) {
    renderPrompt += `\n\n${DOOR_CLEARANCE_DIRECTIVE}`;
  }

  if (photoGrounded) {
    const wallPhotoLine = hasPhotoConfirmedColumn(opts.roomAnalysis)
      ? "WALL GEOMETRY: Preserve every photo-confirmed structural column/post/pier exactly as visible in the EDIT TARGET photo."
      : "WALL GEOMETRY: The EDIT TARGET room photo is authoritative for visible walls — do NOT add columns, posts, piers, or beams at plan corners or notches.";
    if (!renderPrompt.includes("EDIT TARGET room photo is authoritative") &&
        !renderPrompt.includes("photo-confirmed structural column")) {
      renderPrompt += `\n\n${wallPhotoLine}`;
    }
    const noColumn = buildNoColumnHallucinationDirective(opts.roomAnalysis);
    if (noColumn && !renderPrompt.includes("STRUCTURAL COLUMNS") && !renderPrompt.includes("PRESERVE COLUMNS")) {
      renderPrompt += `\n\n${noColumn}`;
    }
    // Reinforce the pixel-level aspect lock: keep the exact camera framing so the
    // model can't crop/zoom/reframe its way into re-inventing the room geometry.
    if (!renderPrompt.includes("FRAME LOCK")) {
      renderPrompt += `\n\nFRAME LOCK (non-negotiable): Reproduce the EXACT camera framing, zoom level, and room proportions of the EDIT TARGET photo. Do NOT crop, zoom, pan, tilt, re-frame, or change the canvas orientation. The output must line up wall-for-wall and corner-for-corner with the input photo — same vanishing point, same wall angles, same floor/ceiling lines.`;
    }
  }

  // RICH STYLING — Ready-made places only a few shoppable catalog products, which
  // can leave the room looking bare. Instruct a fully-styled, magazine-quality
  // interior WITHOUT adding any competing large furniture and WITHOUT altering the
  // provided catalog products or the room's architecture.
  if (opts.madeMode && opts.phase !== "base" && !renderPrompt.includes("RICH STYLING")) {
    renderPrompt += `\n\nRICH STYLING (make it look designed, not empty): Style the room to a polished, magazine-quality interior. Layer in cohesive, non-structural decor that fills the space with warmth and depth — an area rug that anchors the seating, greenery/potted plants, framed wall art, cushions and a throw, books and small objects on surfaces, and warm layered lighting (ambient + accent). Add subtle material and texture variety and natural depth of field. This styling is decorative dressing only: keep every provided catalog product exactly as shown (same model, color, finish, position), do NOT add or substitute large hero furniture beyond the catalog pieces, and keep all walls, windows, doors, and camera framing unchanged.`;
  }

  if (opts.designReferenceImage?.base64 && opts.viewpointTransferDirective?.trim()) {
    if (!renderPrompt.includes(opts.viewpointTransferDirective.trim())) {
      renderPrompt += `\n\n${opts.viewpointTransferDirective.trim()}`;
    }
  }

  if (opts.roomType === "hallway") {
    const poly = opts.detectedRoom?.polygon;
    const corners = poly?.length ?? 4;
    renderPrompt += `\n\nCORRIDOR DESIGN: This is a narrow circulation space.` +
      (corners > 4 ? ` It has a non-rectangular layout with ${corners} corners — preserve EVERY wall jog and angle change exactly as shown in the photos.` : "") +
      ` Keep the central walkway completely clear. Furniture must be slim and wall-hugging only.`;
  }

  if (isHallwayPhotoEdit && !renderPrompt.includes(HALLWAY_PHOTO_EDIT_LOCK)) {
    renderPrompt = `${HALLWAY_PHOTO_EDIT_LOCK}\n\n${renderPrompt}`;
  }

  // #region agent log
  debugSessionLog({
    location: "phasedRoomEngine.ts:generatePhasedGeminiImage",
    message: "final gemini prompt column guard check",
    hypothesisId: "B",
    data: {
      photoGrounded,
      mainPromptChars: renderPrompt.length,
      hasNoColumnDirective: renderPrompt.includes("STRUCTURAL COLUMNS"),
      hasWallPhotoAuthority: renderPrompt.includes("EDIT TARGET room photo is authoritative"),
      microEdgeLabelsInPrompt: countMicroEdgeLabels(opts.structuralMetrics?.edges ?? ""),
      edgesHasWallNotch: opts.structuralMetrics?.edges?.includes("wall notch") ?? false,
      hasGeometryLock: renderPrompt.includes("STRUCTURAL GEOMETRY LOCK"),
      structuralEdgesPreview: opts.structuralMetrics?.edges?.slice(0, 160) ?? null,
      hasDesignReference: !!opts.designReferenceImage?.base64,
      hasViewpointTransfer: !!opts.viewpointTransferDirective?.trim(),
      hasOppositeMirrorRule: renderPrompt.includes("OPPOSITE-CAMERA FURNITURE TRANSFER"),
    },
  });
  // #endregion

  // Room photo(s): when multiple assigned photos exist, send ALL with structured
  // labels so Gemini cross-references geometry across every camera angle.
  let multiPhotos = opts.allRoomPhotos?.filter((p) => p.base64) ?? [];
  const useMultiPhoto = multiPhotos.length > 0;
  const editTargetId =
    opts.editTargetPhotoId ??
    opts.photoId ??
    multiPhotos[0]?.id ??
    "";
  const hallwayTrailingParts: GeminiPart[] = [];

  if (isHallwayPhotoEdit && useMultiPhoto && editTargetId) {
    multiPhotos = await optimizeLabeledRoomPhotosForGemini(multiPhotos);
    const editTarget = multiPhotos.find((p) => p.id === editTargetId);
    if (editTarget) {
      // Single edit-target photo only — reference angles were causing Gemini to invent a generic corridor.
      hallwayTrailingParts.push(
        ...buildHallwayPhotoGeminiParts({
          photos: [editTarget],
          editTargetPhotoId: editTargetId,
          roomName: opts.roomName,
        }),
      );
    }
  } else if (useMultiPhoto && editTargetId) {
    if (opts.geminiRenderPrompt) {
      parts.push({
        text:
          `Real photos of ${opts.roomName ?? "this room"} — render ONLY the EDIT TARGET camera angle. ` +
          `Reference angles show other walls; do NOT copy their doors or windows into the EDIT TARGET output. ` +
          `Opening count and wall placement in the text prompt (OPENING COUNT LOCK) override anything visible in reference photos:`,
      });
      for (const p of multiPhotos) {
        const role = p.id === editTargetId ? "EDIT TARGET" : "reference angle";
        parts.push({ text: `[${p.label}] ${role}:` });
        parts.push({ inlineData: { mimeType: p.mimeType || "image/jpeg", data: p.base64 } });
      }
    } else {
      const multiPhotoMode: MultiPhotoContextMode =
        opts.designReferenceImage?.base64 ? "viewpoint-transfer" : "initial-design";
      parts.push(
        ...buildMultiPhotoContextParts({
          roomName: opts.roomName ?? "Room",
          roomType: opts.roomType,
          photos: multiPhotos,
          editTargetPhotoId: editTargetId,
          mode: multiPhotoMode,
        }),
      );
    }
  } else if (isHallwayPhotoEdit && opts.roomImage?.base64) {
    try {
      const optimized = await optimizeImageBufferForAi(
        Buffer.from(opts.roomImage.base64, "base64"),
        HALLWAY_PHOTO_OPTIMIZE_OPTIONS,
      );
      hallwayTrailingParts.push({
        text:
          "EDIT TARGET — corridor photo to modify in place. Preserve this exact camera angle, wall layout, " +
          "every corner and wall jog, and every door position. Apply design finishes and slim furniture ONLY:",
      });
      hallwayTrailingParts.push({
        inlineData: { mimeType: optimized.mimeType, data: optimized.base64 },
      });
    } catch {
      hallwayTrailingParts.push({
        text:
          "EDIT TARGET — corridor photo to modify in place. Preserve this exact camera angle, wall layout, " +
          "every corner and wall jog, and every door position. Apply design finishes and slim furniture ONLY:",
      });
      hallwayTrailingParts.push({
        inlineData: { mimeType: opts.roomImage.mimeType, data: opts.roomImage.base64 },
      });
    }
  } else if (opts.roomImage) {
    parts.push({
      text:
        "EDIT TARGET — room photo. The output MUST match this exact camera position, perspective, and wall framing:",
    });
    parts.push({
      inlineData: { mimeType: opts.roomImage.mimeType, data: opts.roomImage.base64 },
    });
  }

  // For rooms with complex geometry (>4 corners), a room-specific schematic
  // is sent so Gemini can see the actual shape (L-shape, U-shape, etc.).
  // Skip for hallways — real photos are sufficient and diagrams may confuse.
  if (opts.floorPlanParts?.length && opts.roomType !== "hallway") {
    for (const fp of opts.floorPlanParts) {
      parts.push({ text: fp.label });
      parts.push({ inlineData: { mimeType: fp.mimeType, data: fp.base64 } });
    }
  }

  // Opening guide (colored D/W boxes) + edit-permission mask — simple-direct path.
  // For hallways: opening guide on the EDIT TARGET photo only, placed right before the text prompt.
  if (simpleDirect) {
    if (opts.openingGuideParts?.length && isHallwayPhotoEdit) {
      hallwayTrailingParts.push(...opts.openingGuideParts);
    } else if (opts.openingGuideParts?.length) {
      for (const p of opts.openingGuideParts) parts.push(p);
    }
    if (opts.roomImage && !isHallwayPhotoEdit) {
      const maskParts = await buildOpeningMaskParts(
        opts.roomImage.base64,
        opts.photoWindowBoxes ?? [],
        opts.photoDoorBoxes ?? [],
      );
      if (maskParts) parts.push(...maskParts);
    }
    if (opts.designReferenceImage?.base64) {
      const transferHint = opts.viewpointTransferDirective?.trim()
        ? " Every piece of furniture stays on its SAME physical compass wall — the room layout is fixed, only the camera moved. Do NOT move furniture to different walls."
        : "";
      parts.push({
        text:
          "DESIGN CONSISTENCY REFERENCE — approved design of this SAME room from another camera angle. " +
          "Match furniture identity, finishes, materials, palette, and lighting ONLY." +
          transferHint +
          " Do NOT copy its camera position, perspective, or wall framing — the output MUST match the EDIT TARGET room photo above.",
      });
      parts.push({
        inlineData: {
          mimeType: opts.designReferenceImage.mimeType,
          data: opts.designReferenceImage.base64,
        },
      });
    }
    if (opts.editAnnotationImage?.base64) {
      parts.push({ text: EDIT_ANNOTATION_MARKER_PROMPT });
      parts.push({
        inlineData: {
          mimeType: opts.editAnnotationImage.mimeType,
          data: opts.editAnnotationImage.base64,
        },
      });
    }
    if (opts.objectRemovalMask?.base64) {
      parts.push({ text: REMOVAL_MASK_GEMINI_INTRO });
      parts.push({
        inlineData: {
          mimeType: opts.objectRemovalMask.mimeType,
          data: opts.objectRemovalMask.base64,
        },
      });
    }
  }

  if (!simpleDirect) {
    if (opts.styleInspirationParts?.length) {
      for (const p of opts.styleInspirationParts) parts.push(p);
    }

    const maskPreserveMode = resolvePhasedShapePreserveMode(opts);
    if (
      maskPreserveMode
      && maskPreserveMode !== "soft"
      && opts.roomImage
      && !isHallwayPhotoEdit
      && (opts.photoWindowBoxes?.length || opts.photoDoorBoxes?.length)
    ) {
      const maskParts = await buildOpeningMaskParts(
        opts.roomImage.base64,
        opts.photoWindowBoxes ?? [],
        opts.photoDoorBoxes ?? [],
      );
      if (maskParts) parts.push(...maskParts);
    }

    for (const p of opts.productParts) parts.push(p);

    if (opts.viewpointParts?.length && opts.roomType !== "hallway") {
      for (const p of opts.viewpointParts) parts.push(p);
    }

    // Other photos of the SAME room — equal references so the render matches this
    // exact physical space (different angles of one room, not different rooms).
    if (opts.extraRoomPhotos?.length) {
      parts.push({
        text: "ADDITIONAL PHOTOS OF THIS SAME ROOM (different angles of the one physical space being designed — match this exact room):",
      });
      for (const p of opts.extraRoomPhotos) {
        parts.push({ inlineData: { mimeType: p.mimeType, data: p.base64 } });
      }
    }

    // Design-consistency reference: the primary viewpoint's finished render of this
    // SAME room. Match its design, not its geometry — this is what stops the two
    // viewpoints from looking like two different rooms.
    if (opts.designReferenceImage) {
      const totalRefs = 1 + (opts.additionalDesignReferences?.length ?? 0);
      const refLabel = totalRefs > 1
        ? `DESIGN CONSISTENCY REFERENCES (${totalRefs} approved views of this SAME room from DIFFERENT camera angles)`
        : "DESIGN CONSISTENCY REFERENCE — this is the SAME room already designed, shown from a DIFFERENT camera angle";
      parts.push({
        text: `${refLabel}. Match the design EXACTLY: identical ceiling treatment, flooring, wall color/finish, lighting fixtures, and the SAME furniture pieces and materials. Do NOT copy camera angles, walls, or window/door positions from any reference — keep THIS room photo's camera and architecture. Only the design, finishes, and furniture identity must match.\n\nApproved view 1:`,
      });
      parts.push({
        inlineData: { mimeType: opts.designReferenceImage.mimeType, data: opts.designReferenceImage.base64 },
      });
      if (opts.additionalDesignReferences?.length) {
        for (let i = 0; i < opts.additionalDesignReferences.length; i++) {
          const ref = opts.additionalDesignReferences[i];
          parts.push({ text: `Approved view ${i + 2}:` });
          parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
        }
      }
    }
  }

  if (hallwayTrailingParts.length > 0) {
    parts.push(...hallwayTrailingParts);
  }

  parts.push({ text: renderPrompt });

  pipelineLog("ASSEMBLE_PROMPT", "gemini request composed", {
    phase: opts.phase,
    imageParts: parts.filter((p) => p.inlineData).length,
    roomImageLeads: !!opts.roomImage,
    floorPlanImages: isHallwayPhotoEdit ? 0 : (opts.floorPlanParts?.length ?? 0),
    productImages: simpleDirect ? 0 : opts.productParts.filter((p) => p.inlineData).length,
    extraRoomPhotos: simpleDirect ? 0 : opts.extraRoomPhotos?.length ?? 0,
    viewpointDiagram: !simpleDirect && (opts.viewpointParts?.length ?? 0) > 0,
    designReference: !!opts.designReferenceImage,
    simpleDirectRender: simpleDirect,
    isHallwayPhotoEdit,
    hallwayTrailingImageParts: hallwayTrailingParts.filter((p) => p.inlineData).length,
    model: GEMINI_IMAGE_MODEL_LABEL,
    mainPromptChars: renderPrompt.length,
    hasOpeningGuide: simpleDirect && (opts.openingGuideParts?.length ?? 0) > 0,
    hasOpeningMask:
      simpleDirect &&
      ((opts.photoWindowBoxes?.length ?? 0) > 0 || (opts.photoDoorBoxes?.length ?? 0) > 0),
    assignedPhotoCount: multiPhotos.length,
    useMultiPhoto,
    windowBoxes: opts.photoWindowBoxes?.length ?? 0,
    doorBoxes: opts.photoDoorBoxes?.length ?? 0,
  });

  logGeminiRequest({
    label: `phased-${opts.phase}`,
    model: GEMINI_IMAGE_MODEL_LABEL,
    systemInstruction: isHallwayPhotoEdit
      ? HALLWAY_PHOTO_EDIT_SYSTEM_INSTRUCTION
      : DESIGNER_SYSTEM_INSTRUCTION,
    parts,
    context: {
      phase: opts.phase,
      projectId: opts.projectId,
      roomId: opts.roomId,
      roomName: opts.roomName,
      detectedRoom: opts.detectedRoom,
      roomAnalysis: opts.roomAnalysis,
      roomGeometry: opts.roomGeometry,
      hasRoomImage: !!opts.roomImage,
      freeRender: opts.freeRender,
      designStyleLabel: opts.designStyleLabel,
    },
  });

  let images: Array<{ base64: string; mimeType: string }>;
  let blockReason: unknown;
  let finishReason: unknown;
  let inputPhotoWidth = 0;
  let inputPhotoHeight = 0;
  if (resolveRenderProvider() === "openai" && opts.roomImage) {
    images = await renderRoomImageViaOpenAi(parts, `phased-${opts.phase}`);
    blockReason = "openai-provider";
  } else {
    if (opts.roomImage) {
      pipelineLog("ASSEMBLE_PROMPT", "gemini photo-grounded render", {
        phase: opts.phase,
        imageParts: parts.filter((p) => p.inlineData).length,
        freeRender: opts.freeRender,
        singlePassDesign: opts.singlePassDesign,
        simpleDirectRender: simpleDirect,
        model: GEMINI_IMAGE_MODEL_LABEL,
        mainPromptChars: renderPrompt.length,
      });
    }
    const inlineParts = parts.filter((p) => p.inlineData);
    const totalInlineBytes = inlineParts.reduce(
      (sum, p) => sum + (p.inlineData?.data?.length ?? 0),
      0,
    );
    let inputPhotoBytes = 0;
    if (opts.roomImage?.base64) {
      inputPhotoBytes = opts.roomImage.base64.length;
      try {
        const meta = await sharp(Buffer.from(opts.roomImage.base64, "base64")).metadata();
        inputPhotoWidth = meta.width ?? 0;
        inputPhotoHeight = meta.height ?? 0;
      } catch {
        /* metadata optional */
      }
    }
    debugSessionLog({
      location: "phasedRoomEngine.ts:generatePhasedGeminiImage",
      message: "Gemini generateContent pre",
      hypothesisId: "A",
      data: {
        projectId: opts.projectId,
        roomId: opts.roomId,
        modelLabel: GEMINI_IMAGE_MODEL_LABEL,
        modelResolved: GEMINI_IMAGE_MODEL,
        simpleDirectRender: simpleDirect,
        imageParts: inlineParts.length,
        totalInlineBytesB64: totalInlineBytes,
        mainPromptChars: renderPrompt.length,
        designConceptChars: opts.geminiRenderPrompt?.length ?? 0,
        hasRenderQualityDirective: renderPrompt.includes("Photorealistic interior photography"),
        promptSource: opts.geminiRenderPrompt ? "claude-designConcept" : simpleDirect ? "deterministic" : "fallback",
        floorPlanImagesSent: opts.floorPlanParts?.length ?? 0,
        hasOpeningGuide: (opts.openingGuideParts?.length ?? 0) > 0,
        doorBoxes: opts.photoDoorBoxes?.length ?? 0,
        windowBoxes: opts.photoWindowBoxes?.length ?? 0,
        assignedPhotoCount: multiPhotos.length,
        useMultiPhoto,
        inputPhotoWidth,
        inputPhotoHeight,
        inputPhotoBytesB64: inputPhotoBytes,
        conceptPreview: opts.geminiRenderPrompt?.slice(0, 120),
        hasOpeningLock: !!openingLock,
        openingLockChars: openingLock?.length ?? 0,
        planDoorCount: opts.roomAnalysis?.plan_door_count ?? null,
      },
    });
    pipelineLog("GEMINI_GENERATE", "gemini request start", {
      projectId: opts.projectId,
      roomId: opts.roomId,
      phase: opts.phase,
      model: GEMINI_IMAGE_MODEL_LABEL,
      imageParts: inlineParts.length,
      roomPhotoCount: multiPhotos.length,
      designConceptChars: opts.geminiRenderPrompt?.length ?? 0,
      totalPromptChars: renderPrompt.length,
      floorPlanImagesSent: opts.floorPlanParts?.length ?? 0,
      promptSource: opts.geminiRenderPrompt ? "claude-designConcept" : simpleDirect ? "deterministic" : "fallback",
    });
    type GenPart = { inlineData?: { data?: unknown; mimeType?: unknown }; text?: string };
    // Pin the output canvas to the input photo's aspect ratio. Without this, Gemini
    // ("auto" framing) reframes landscape rooms into portrait and re-invents the
    // geometry (widened walls, moved/added openings) — the exact drift the FAL edit
    // pipeline avoids for Custom mode via nano-banana's aspect_ratio param.
    const lockedAspectRatio =
      inputPhotoWidth > 0 && inputPhotoHeight > 0
        ? nearestEditAspectRatio(inputPhotoWidth, inputPhotoHeight)
        : undefined;
    const perRequestGenerationConfig = {
      ...(isHallwayPhotoEdit
        ? { ...RENDER_GENERATION_CONFIG, temperature: 0.05 }
        : RENDER_GENERATION_CONFIG),
      ...(lockedAspectRatio ? { imageConfig: { aspectRatio: lockedAspectRatio } } : {}),
    };
    const runGeminiImageRequest = async () => {
      const res = await model.generateContent({
        contents: [{ role: "user", parts: parts as Part[] }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        generationConfig: perRequestGenerationConfig as any,
      });
      const imgs: Array<{ base64: string; mimeType: string }> = [];
      for (const candidate of res.response?.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          const pdata = part as GenPart;
          const raw = pdata.inlineData?.data;
          if (typeof raw === "string" && raw) {
            const mt = pdata.inlineData?.mimeType;
            imgs.push({ base64: raw, mimeType: typeof mt === "string" && mt ? mt : "image/png" });
          }
        }
      }
      return { res, imgs };
    };

    let genRun = await runGeminiImageRequest();

    // Belt-and-suspenders: if the model still flipped orientation despite the
    // explicit aspect lock, retry once before accepting a reframed render.
    if (lockedAspectRatio && genRun.imgs[0]?.base64 && inputPhotoWidth > 0 && inputPhotoHeight > 0) {
      try {
        const outMeta = await sharp(Buffer.from(genRun.imgs[0].base64, "base64")).metadata();
        if (isOrientationFlip(inputPhotoWidth, inputPhotoHeight, outMeta.width ?? 0, outMeta.height ?? 0)) {
          pipelineLog(
            "GEMINI_GENERATE",
            "orientation flip despite aspect lock — retrying once",
            {
              phase: opts.phase,
              inputPhotoWidth,
              inputPhotoHeight,
              outputWidth: outMeta.width ?? 0,
              outputHeight: outMeta.height ?? 0,
              aspectRatio: lockedAspectRatio,
            },
            "error",
          );
          const retry = await runGeminiImageRequest();
          if (retry.imgs.length > 0) genRun = retry;
        }
      } catch {
        /* metadata optional */
      }
    }

    const result = genRun.res;
    images = genRun.imgs;
    blockReason = result.response?.promptFeedback?.blockReason;
    finishReason = result.response?.candidates?.[0]?.finishReason;
    await recordGeminiGenerationSpend(GEMINI_IMAGE_MODEL_LABEL, `phased-${opts.phase}`, result, images.length);
  }

  // STEP 7 — render output for this phase (image produced, or why not).
  if (images.length === 0) {
    pipelineLog(
      "GEMINI_GENERATE",
      "no image returned",
      { phase: opts.phase, blockReason, finishReason },
      "error",
    );
  } else {
    const first = images[0];
    let outputWidth = 0;
    let outputHeight = 0;
    if (first?.base64) {
      try {
        const meta = await sharp(Buffer.from(first.base64, "base64")).metadata();
        outputWidth = meta.width ?? 0;
        outputHeight = meta.height ?? 0;
      } catch {
        /* metadata optional */
      }
    }
    pipelineLog("GEMINI_GENERATE", "image generated", {
      phase: opts.phase,
      projectId: opts.projectId,
      roomId: opts.roomId,
      images: images.length,
      outputWidth,
      outputHeight,
      outputBytesB64: first?.base64.length ?? 0,
      finishReason,
    });
    if (first?.base64) {
      debugSessionLog({
        location: "phasedRoomEngine.ts:generatePhasedGeminiImage",
        message: "Gemini output image metrics",
        hypothesisId: "E",
        data: {
          phase: opts.phase,
          projectId: opts.projectId,
          roomId: opts.roomId,
          outputWidth,
          outputHeight,
          outputBytesB64: first.base64.length,
          outputMime: first.mimeType,
          inputPhotoWidth,
          inputPhotoHeight,
          finishReason,
        },
      });
    }
  }

  return images;
}

export async function generatePhasedRoom(input: PhasedRoomInput): Promise<PhasedRoomResult> {
  const {
    phase,
    baseImage,
    styleId,
    designStyleLabel,
    textPrompt,
    roomType,
    roomAnalysis = null,
    roomGeometry = null,
    brief = null,
    marketplaceNumericIds,
    pinnedProductIds,
    previousPhaseProducts,
    inspirationItems = [],
    styleInspirationParts,
    extraPromptBlock,
    floorPlanParts,
    extraRoomPhotos,
    googleKey,
    anthropicKey,
    notifyOnSlotFailure = true,
    freeRender = false,
    singlePassDesign = false,
    viewpointParts,
    projectId,
    roomId,
    roomName,
    detectedRoom,
    designReferenceImage = null,
    additionalDesignReferences,
    preferencesPrompt,
    simpleDirectRender = false,
    structuralMetrics,
    openingGuideParts,
    photoWindowBoxes,
    photoDoorBoxes,
    photoId,
    cameraNote,
    visibleOpeningsNote,
    editFeedback,
    allRoomPhotos,
    editTargetPhotoId,
    geminiRenderPrompt,
    editAnnotationImage = null,
    objectRemovalMask = null,
    viewpointTransferDirective,
    doorDesign = null,
    compactProductFlow = false,
    madeMode = false,
    productsPerStep,
    veryStrongShapeLock = false,
    shapePreserveMode,
  } = input;

  const empty: Omit<PhasedRoomResult, "ok" | "status" | "error"> = {
    images: [],
    selectedCatalogIds: [],
    confirmedCatalogIds: [],
    missingCatalogIds: [],
    allPhaseProductIds: previousPhaseProducts,
    productLinks: [],
    imaginedSlots: [],
    slotNotices: [],
  };

  // Custom design: a single fully-furnished imaginary render. No catalog
  // resolution, no merchant appendix, no product links — but the room geometry
  // (dimensions, windows, doors, camera) is still grounded via textPrompt,
  // roomAnalysis/roomGeometry, baseImage, and the opening structural lock.
  const renderWithoutCatalog = async (): Promise<PhasedRoomResult> => {
    if (!baseImage && phase !== "base") {
      return { ok: false, status: 400, error: "Previous-phase image is required for this phase.", ...empty };
    }

    const referenceParts: GeminiPart[] = [];
    if (!simpleDirectRender) {
      if (inspirationItems.length > 0) {
        referenceParts.push({
          text: `REFERENCE IMAGES — ${inspirationItems.length} inspiration image(s) provided by the user. Use them as style and placement guidance for the design.`,
        });
        for (const item of inspirationItems) {
          referenceParts.push({ inlineData: { mimeType: item.mimeType, data: item.base64 } });
        }
      }

      // Custom mode invents the room freely, BUT products the user explicitly
      // pinned (design board) must still be placed. Auto-matched catalog products
      // are deliberately NOT fetched here — only the user's pins.
      if (pinnedProductIds.length > 0) {
        try {
          const pinRows = await fetchMarketplaceProductsAsCatalog(pinnedProductIds);
          const catalogById = new Map(pinRows.map((r) => [r.id, r]));
          const pinnedKeys = pinnedProductIds
            .map((id) => `mp-${id}`)
            .filter((k) => catalogById.has(k));
          if (pinnedKeys.length > 0) {
            const pinnedIndividual = await buildIndividualProductParts({
              selectedCatalogIds: pinnedKeys,
              catalogById,
              phase,
              userUploads: [],
            });
            referenceParts.push(...buildGeminiPartsFromIndividual(pinnedIndividual, phase));
          }
        } catch (err) {
          console.warn("freeRender: failed to attach pinned design-board products", err);
        }
      }
    }

    let images: Array<{ base64: string; mimeType: string }> = [];
    for (let attempt = 0; attempt < PHASED_MAX_RETRIES; attempt++) {
      images = await generatePhasedGeminiImage({
        googleApiKey: googleKey,
        roomImage: baseImage,
        productParts: referenceParts,
        styleInspirationParts: simpleDirectRender ? undefined : styleInspirationParts?.length ? styleInspirationParts : undefined,
        phase,
        designStyleLabel,
        textPrompt,
        roomType,
        roomAnalysis,
        roomGeometry,
        brief,
        merchantAppendix: undefined,
        extraPromptBlock,
        floorPlanParts,
        extraRoomPhotos: simpleDirectRender ? undefined : extraRoomPhotos,
        viewpointParts: simpleDirectRender ? undefined : viewpointParts,
        designReferenceImage,
        additionalDesignReferences,
        hasCatalogProducts: false,
        freeRender: true,
        singlePassDesign,
        projectId,
        roomId,
        roomName,
        detectedRoom,
        preferencesPrompt,
        simpleDirectRender,
        structuralMetrics,
        openingGuideParts,
        photoWindowBoxes,
        photoDoorBoxes,
        photoId,
        cameraNote,
        visibleOpeningsNote,
        editFeedback,
        allRoomPhotos,
        editTargetPhotoId,
        geminiRenderPrompt,
        editAnnotationImage,
        objectRemovalMask,
        viewpointTransferDirective,
        doorDesign: doorDesign ?? brief?.doorDesign,
      });
      if (images.length > 0) break;
    }

    if (images.length === 0) {
      return { ok: false, status: 500, error: "Image generation returned no results. Try rephrasing your request.", ...empty };
    }

    return { ok: true, ...empty, images, allPhaseProductIds: previousPhaseProducts };
  };

  const fallbackToFreeRender = async (reason: string): Promise<PhasedRoomResult> => {
    pipelineLog(
      "CATALOG_RESOLVE",
      "made-mode fallback to catalog-free render",
      { phase, roomType, reason },
      "warn",
    );
    const result = await renderWithoutCatalog();
    if (!result.ok || previousPhaseProducts.length === 0) return result;
    const linkNumericIds = numericIdsFromMpKeys(previousPhaseProducts);
    const productLinks =
      linkNumericIds.length > 0
        ? sortProductsForDisplay(await fetchProductPurchaseLinks(linkNumericIds))
        : [];
    return { ...result, productLinks };
  };

  if (freeRender) return renderWithoutCatalog();

  const madeOrCompact = madeMode || compactProductFlow;

  const catalogCtx = await buildConsumerDesignCatalogContext({
    marketplaceProductIds: marketplaceNumericIds,
    textPrompt,
    roomAnalysis,
    scrapedInventoryExclusive: true,
    maxRowsForPrompt: 36,
    pinnedProductCount: pinnedProductIds.length,
  });

  if (catalogCtx.summaryById.size === 0) {
    if (madeOrCompact) return fallbackToFreeRender("catalog_empty");
    return { ok: false, status: 422, error: "No products available in our catalog for this design phase.", ...empty };
  }

  // Ensure pinned products are present in the catalog context.
  const missingPinIds = pinnedProductIds.filter((id) => !catalogCtx.summaryById.has(`mp-${id}`));
  if (missingPinIds.length > 0) {
    const pinRows = await fetchMarketplaceProductsAsCatalog(missingPinIds);
    for (const row of pinRows) catalogCtx.summaryById.set(row.id, row);
  }

  // Resolve catalog slots filtered to this phase. Ready-made ("made") uses the
  // reduced flooring+furniture kit (<=4 shoppable products, no lighting/accessory
  // slots) so lampshades/picture frames can't displace the hero furniture.
  const slotTemplate = madeOrCompact
    ? getMadeModeRoomSlots(roomType, roomAnalysis?.window_count)
    : getRoomSlotTemplate(roomType, roomAnalysis?.window_count);
  const allSlots = filterSlotsForRoomType(
    mergeRoomSlots({ template: slotTemplate }),
    roomType,
  );
  const phaseSlots = filterSlotsForMadePhase(allSlots, phase, compactProductFlow);

  if (phaseSlots.length === 0 && pinnedProductIds.length === 0) {
    if (madeOrCompact) return fallbackToFreeRender("no_phase_slots");
    return {
      ok: false,
      status: 422,
      error: `No applicable product slots for the "${phase}" phase in a ${roomType}.`,
      ...empty,
    };
  }

  const designIntent = `${textPrompt} ${designStyleLabel} style ${roomType}`;
  const styleDef = DESIGN_STYLES.find((s) => s.id === styleId) ?? DESIGN_STYLES[0];
  const mergedConstraints = { ...constraintsFromRoomAndStyle(roomAnalysis, styleDef.keywords) };

  let resolvedNumericIds: number[] = [];
  let vectorResolvedSlots: ResolvedCatalogSlot[] = [];
  if (phaseSlots.length > 0) {
    const vectorResolved = await resolveCatalogSlots({
      designIntent,
      slots: phaseSlots,
      pinnedProductIds,
      roomAnalysis,
      constraints: mergedConstraints,
      roomType,
    });
    vectorResolvedSlots = vectorResolved.slots;

    resolvedNumericIds = vectorConfirmedCatalogIds({
      slots: vectorResolved.slots,
      pinnedProductIds,
      apiIds: vectorResolved.ids,
    });

    if (resolvedNumericIds.length > 0) {
      const extraRows = await fetchMarketplaceProductsAsCatalog(resolvedNumericIds);
      for (const row of extraRows) catalogCtx.summaryById.set(row.id, row);
      resolvedNumericIds = rejectFamilyMismatchIds({
        resolvedIds: resolvedNumericIds,
        slots: vectorResolved.slots,
        catalogById: catalogCtx.summaryById,
      });
    }
  }

  // Partition pinned catalog items by phase — only include ones for THIS phase.
  const pinnedMpKeys = pinnedProductIds.map((id) => `mp-${id}`).filter((k) => catalogCtx.summaryById.has(k));
  const pinnedPartitioned = partitionByPhase(pinnedMpKeys, catalogCtx.summaryById);
  const phasePinnedIds = pinnedPartitioned[phase];

  let selectedForGemini = [
    ...phasePinnedIds,
    ...resolvedNumericIds
      .map((n) => `mp-${n}`)
      .filter((k) => catalogCtx.summaryById.has(k) && !phasePinnedIds.includes(k)),
  ];

  selectedForGemini = orderIdsForGemini({
    pinnedMpKeys: phasePinnedIds,
    briefSelectedIds: selectedForGemini,
    catalogById: catalogCtx.summaryById,
  });

  selectedForGemini = dedupeSingletonCatalogIds(
    selectedForGemini,
    catalogCtx.summaryById,
    textPrompt,
    phaseSlots,
    new Set(phasePinnedIds),
  );

  selectedForGemini = selectedForGemini.filter((id) => {
    const item = catalogCtx.summaryById.get(id);
    if (!item) return false;
    return productMatchesMadePhase(item, phase, compactProductFlow);
  });

  const perStep = productsPerStep ?? QUICK_ROOM_MADE_PRODUCTS_PER_STEP;
  let limit = productsPerStep != null
    ? Math.min(PHASE_PRODUCT_LIMITS[phase], perStep)
    : PHASE_PRODUCT_LIMITS[phase];
  if (productsPerStep != null && compactProductFlow && phase === "furniture") {
    limit = effectiveMadePhaseProductLimit(
      phase,
      perStep,
      previousPhaseProducts,
      catalogCtx.summaryById,
    );
  }
  selectedForGemini = selectedForGemini.slice(0, limit);

  if (selectedForGemini.length === 0 && inspirationItems.length === 0 && phase !== "base") {
    if (madeOrCompact) return fallbackToFreeRender("no_matching_products");
    return { ok: false, status: 422, error: `Could not find matching products for the "${phase}" phase.`, ...empty };
  }

  // Verify availability.
  if (selectedForGemini.length > 0) {
    const itemsToVerify = selectedForGemini
      .map((k) => catalogCtx.summaryById.get(k))
      .filter((row): row is CatalogItemSummary => Boolean(row));
    if (itemsToVerify.length > 0) {
      const { deadIds } = await verifyProductAvailability(itemsToVerify);
      if (deadIds.length > 0) {
        const deadSet = new Set(deadIds.map((id) => `mp-${id}`));
        selectedForGemini = selectedForGemini.filter((k) => !deadSet.has(k));
      }
    }
  }

  const imaginedSlots = buildImaginedSlotEntries(phaseSlots, vectorResolvedSlots, selectedForGemini);
  const slotNotices = buildSlotNotices(imaginedSlots);

  if (phase === "base" && imaginedSlots.length > 0 && notifyOnSlotFailure) {
    void notifySlotFailure({
      phase,
      roomType,
      style: designStyleLabel,
      designIntent,
      failedSlots: imaginedSlots,
    });
  }

  const uploadParts = inspirationItems.map((item) => ({
    base64: item.base64,
    mimeType: item.mimeType,
    label: item.label,
  }));

  const individualParts = await buildIndividualProductParts({
    selectedCatalogIds: selectedForGemini,
    catalogById: catalogCtx.summaryById,
    phase,
    userUploads: uploadParts,
  });

  const merchantAppendix =
    selectedForGemini.length > 0
      ? buildGeminiMerchantFurnitureCatalogBlock(selectedForGemini, catalogCtx.summaryById, null, {
          armeniaLocalExclusive: true,
        })
      : "";

  if (!baseImage && phase !== "base") {
    return { ok: false, status: 400, error: "Previous-phase image is required for this phase.", ...empty };
  }

  // Generation + validation loop.
  let bestResult:
    | { images: Array<{ base64: string; mimeType: string }>; confirmed: string[]; missing: string[] }
    | null = null;
  let currentGeminiParts = buildGeminiPartsFromIndividual(individualParts, phase);

  for (let attempt = 0; attempt < PHASED_MAX_RETRIES; attempt++) {
    const images = await generatePhasedGeminiImage({
      googleApiKey: googleKey,
      roomImage: baseImage,
      productParts: currentGeminiParts,
      styleInspirationParts: styleInspirationParts?.length ? styleInspirationParts : undefined,
      phase,
      designStyleLabel,
      textPrompt,
      roomType,
      roomAnalysis,
      roomGeometry,
      brief,
      merchantAppendix: merchantAppendix || undefined,
      extraPromptBlock,
      floorPlanParts,
      extraRoomPhotos,
      viewpointParts,
      designReferenceImage,
      additionalDesignReferences,
      hasCatalogProducts: selectedForGemini.length > 0 || inspirationItems.length > 0,
      madeMode: madeOrCompact,
      projectId,
      roomId,
      roomName,
      detectedRoom,
      preferencesPrompt,
      simpleDirectRender,
      structuralMetrics,
      openingGuideParts,
      photoWindowBoxes,
      photoDoorBoxes,
      photoId,
      cameraNote,
      visibleOpeningsNote,
      editFeedback,
      allRoomPhotos,
      editTargetPhotoId,
      geminiRenderPrompt,
      editAnnotationImage,
      objectRemovalMask,
      viewpointTransferDirective,
      doorDesign: doorDesign ?? brief?.doorDesign,
      veryStrongShapeLock,
      shapePreserveMode,
    });

    if (images.length === 0) {
      if (attempt === PHASED_MAX_RETRIES - 1) {
        if (bestResult && bestResult.images.length > 0) break;
        return { ok: false, status: 500, error: "Image generation returned no results. Try rephrasing your request.", ...empty };
      }
      continue;
    }

    if (anthropicKey && selectedForGemini.length > 0) {
      const validation = await validatePhaseProducts({
        imageBase64: images[0]!.base64,
        imageMimeType: images[0]!.mimeType,
        expectedProductIds: selectedForGemini,
        catalogById: catalogCtx.summaryById,
      });

      const currentScore = validation.confirmed.length;
      const bestScore = bestResult?.confirmed.length ?? -1;
      if (currentScore > bestScore) {
        bestResult = { images, confirmed: validation.confirmed, missing: validation.missing };
      }

      if (validation.missing.length === 0) break;

      if (attempt < PHASED_MAX_RETRIES - 1) {
        const retryParts = await buildIndividualProductParts({
          selectedCatalogIds: validation.missing,
          catalogById: catalogCtx.summaryById,
          phase,
          userUploads: uploadParts,
        });
        currentGeminiParts = buildGeminiPartsFromIndividual(retryParts, phase);
      }
    } else {
      bestResult = { images, confirmed: selectedForGemini, missing: [] };
      break;
    }
  }

  if (!bestResult || bestResult.images.length === 0) {
    return { ok: false, status: 500, error: "Image generation failed after multiple attempts.", ...empty };
  }

  // Cumulative product ids + purchase links (this phase + flooring + previous phases).
  const flooringSlotIds = vectorResolvedSlots
    .filter((s) => s.family === "flooring" && s.product_ids?.length)
    .flatMap((s) => s.product_ids!.map((id) => `mp-${id}`))
    .filter((id) => catalogCtx.summaryById.has(id));
  const confirmedWithFlooring = [...new Set([...bestResult.confirmed, ...flooringSlotIds])];
  const allPhaseProductIds = [...new Set([...previousPhaseProducts, ...confirmedWithFlooring])];
  const linkNumericIds = numericIdsFromMpKeys(allPhaseProductIds);
  const productLinks =
    linkNumericIds.length > 0 ? sortProductsForDisplay(await fetchProductPurchaseLinks(linkNumericIds)) : [];

  return {
    ok: true,
    images: bestResult.images,
    selectedCatalogIds: selectedForGemini,
    confirmedCatalogIds: confirmedWithFlooring,
    missingCatalogIds: bestResult.missing,
    allPhaseProductIds,
    productLinks,
    imaginedSlots,
    slotNotices,
  };
}

// ---------------------------------------------------------------------------
// Gallery edit — all approved renders + one user prompt, per camera angle
// ---------------------------------------------------------------------------

export interface GalleryEditInput {
  googleKey: string;
  approvedRenders: Array<{ base64: string; mimeType: string; label?: string }>;
  extraPhoto: { base64: string; mimeType: string };
  allRoomPhotos?: LabeledRoomPhoto[];
  editTargetPhotoId?: string;
  roomName?: string;
  designStyleLabel: string;
  roomType: string;
  userEdit: string;
  framing?: ViewpointFraming | null;
  roomAnalysis?: RoomAnalysis | null;
  roomGeometry?: RoomGeometry | null;
  editAnnotationImage?: { base64: string; mimeType: string } | null;
}

export interface GalleryEditResult {
  ok: boolean;
  status?: number;
  error?: string;
  image?: { base64: string; mimeType: string };
}

async function generateGalleryEditGeminiImage(opts: GalleryEditInput): Promise<Array<{ base64: string; mimeType: string }>> {
  const genai = new GoogleGenerativeAI(opts.googleKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_IMAGE_MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: RENDER_GENERATION_CONFIG as any,
    systemInstruction: DESIGNER_SYSTEM_INSTRUCTION,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
  });

  const parts: GeminiPart[] = [];
  const refs = opts.approvedRenders.filter((r) => r.base64);
  const editTargetId = opts.editTargetPhotoId ?? "";

  // Raw photo first — locks output camera before design references.
  parts.push({
    text:
      "EDIT TARGET — raw photo for the output camera. Keep this exact perspective, framing, and architecture; " +
      "apply the approved design references plus the user change only.",
  });
  parts.push({ inlineData: { mimeType: opts.extraPhoto.mimeType, data: opts.extraPhoto.base64 } });

  // Additional raw room photos for spatial cross-reference (geometry only).
  const otherPhotos = (opts.allRoomPhotos ?? []).filter(
    (p) => p.base64 && p.id !== editTargetId,
  );
  if (otherPhotos.length > 0) {
    parts.push({
      text:
        `REFERENCE PHOTOS of the SAME room from other cameras — use for spatial understanding only. ` +
        `Do NOT copy their camera angle into the output:`,
    });
    for (const p of otherPhotos) {
      parts.push({ text: `[${p.label}] reference angle:` });
      parts.push({ inlineData: { mimeType: p.mimeType || "image/jpeg", data: p.base64 } });
    }
  }

  if (refs.length > 0) {
    parts.push({
      text:
        `APPROVED DESIGN REFERENCES — ${refs.length} finished render(s) of the SAME ${opts.roomName ?? "room"} the user already accepted. ` +
        "Match furniture, finishes, materials, and palette ONLY — do NOT copy their camera angles.",
    });
    refs.forEach((r, i) => {
      parts.push({ text: `[Approved view ${i + 1}]${r.label ? ` ${r.label}` : ""}:` });
      parts.push({ inlineData: { mimeType: r.mimeType || "image/jpeg", data: r.base64 } });
    });
  }

  if (opts.editAnnotationImage?.base64) {
    parts.push({ text: EDIT_ANNOTATION_MARKER_PROMPT });
    parts.push({
      inlineData: {
        mimeType: opts.editAnnotationImage.mimeType,
        data: opts.editAnnotationImage.base64,
      },
    });
  }

  let mainPrompt = buildGalleryEditPrompt(opts.userEdit, opts.framing, !!opts.editAnnotationImage?.base64);
  mainPrompt +=
    "\n\nOutput ONE photorealistic image from the EDIT TARGET raw photo camera only — not from any approved reference camera.";
  const openingLock = buildOpeningStructuralLock(opts.roomAnalysis, opts.roomGeometry);
  if (openingLock) mainPrompt += `\n\n${openingLock}`;

  parts.push({ text: mainPrompt });

  debugSessionLog({
    location: "phasedRoomEngine.ts:generateGalleryEditGeminiImage",
    message: "gallery edit render inputs",
    hypothesisId: "H",
    data: {
      approvedRefCount: refs.length,
      editTargetPhotoId: editTargetId,
      userEditChars: opts.userEdit.length,
      hasFramingNote: !!opts.framing?.note,
      singlePhotoMode: true,
      hasEditAnnotation: !!opts.editAnnotationImage?.base64,
    },
  });

  pipelineLog("ASSEMBLE_PROMPT", "gallery edit gemini request", {
    approvedRefCount: refs.length,
    editTargetPhotoId: editTargetId,
    userEditPreview: opts.userEdit.slice(0, 120),
  });

  logGeminiRequest({
    label: "gallery-edit",
    model: GEMINI_IMAGE_MODEL_LABEL,
    systemInstruction: DESIGNER_SYSTEM_INSTRUCTION,
    parts,
    context: {
      roomAnalysis: opts.roomAnalysis,
      designStyleLabel: opts.designStyleLabel,
      roomType: opts.roomType,
    },
  });

  if (resolveRenderProvider() === "openai") {
    const images = await renderRoomImageViaOpenAi(parts, "gallery-edit");
    return images.length > 0 ? [images[0]!] : [];
  }

  const result = await model.generateContent(parts as Part[]);
  type GenPart = { inlineData?: { data?: unknown; mimeType?: unknown }; text?: string };
  const images: Array<{ base64: string; mimeType: string }> = [];
  for (const candidate of result.response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const pdata = part as GenPart;
      const raw = pdata.inlineData?.data;
      if (typeof raw === "string" && raw) {
        const mt = pdata.inlineData?.mimeType;
        images.push({ base64: raw, mimeType: typeof mt === "string" && mt ? mt : "image/png" });
      }
    }
  }
  await recordGeminiGenerationSpend(GEMINI_IMAGE_MODEL_LABEL, "gallery-edit", result, images.length);
  return images.length > 0 ? [images[0]!] : [];
}

export async function generateGalleryEditRender(input: GalleryEditInput): Promise<GalleryEditResult> {
  try {
    const images = await generateGalleryEditGeminiImage(input);
    if (images.length === 0) {
      return { ok: false, status: 500, error: "Gallery edit returned no image." };
    }
    return { ok: true, image: images[0] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Final multi-viewpoint render
// ---------------------------------------------------------------------------
//
// After all phases are approved, the design lives on the PRIMARY photo. To show
// the same room from the OTHER photos the user uploaded (different real camera
// angles), we render the complete confirmed product set onto each extra photo in
// one shot, using the approved primary render as the canonical reference so the
// products/materials stay identical — only the viewpoint changes.

export interface FinalViewInput {
  /** The extra room photo to render the design onto (a different camera angle of the same room). */
  extraPhoto: { base64: string; mimeType: string };
  /** The approved primary (decor) render — canonical reference for products + materials. */
  primaryDesignImage: { base64: string; mimeType: string };
  /** All assigned room photos — cross-referenced together in one Gemini request. */
  allRoomPhotos?: LabeledRoomPhoto[];
  editTargetPhotoId?: string;
  roomName?: string;
  /** Complete confirmed product set (mp-* keys) accumulated across all phases. */
  confirmedProductIds: string[];
  styleId: DesignStyleId;
  designStyleLabel: string;
  /** Already-normalized room type (e.g. "living room"). */
  roomType: string;
  textPrompt: string;
  roomAnalysis?: RoomAnalysis | null;
  roomGeometry?: RoomGeometry | null;
  googleKey: string;
  /** Locked FAL seed from master render (Quick Room fal path). */
  falRenderSeed?: number;
  /** Claude door styling concept for finished door leaves. */
  doorDesign?: string | null;
}

export interface FinalViewResult {
  ok: boolean;
  status?: number;
  error?: string;
  image?: { base64: string; mimeType: string };
}

async function generateFinalViewGeminiImage(opts: {
  googleApiKey: string;
  primaryDesignImage: { base64: string; mimeType: string };
  extraPhoto: { base64: string; mimeType: string };
  allRoomPhotos?: LabeledRoomPhoto[];
  editTargetPhotoId?: string;
  roomName?: string;
  productParts: GeminiPart[];
  productIntroText: string;
  productCloseText: string;
  designStyleLabel: string;
  roomType: string;
  textPrompt: string;
  roomAnalysis?: RoomAnalysis | null;
  roomGeometry?: RoomGeometry | null;
  viewpointTransferDirective?: string;
  doorDesign?: string | null;
}): Promise<Array<{ base64: string; mimeType: string }>> {
  const genai = new GoogleGenerativeAI(opts.googleApiKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_IMAGE_MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: RENDER_GENERATION_CONFIG as any,
    systemInstruction: DESIGNER_SYSTEM_INSTRUCTION,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
  });

  const parts: GeminiPart[] = [];

  // Single edit-target raw photo only — sending all room photos here caused Gemini to
  // copy the hero camera instead of the secondary viewpoint.
  parts.push({
    text:
      "EDIT TARGET — raw photo for the output camera. Keep this exact perspective, framing, and architecture; " +
      "apply the approved design from the PRIMARY DESIGN REFERENCE below.",
  });
  parts.push({
    inlineData: { mimeType: opts.extraPhoto.mimeType, data: opts.extraPhoto.base64 },
  });

  // Primary design image — canonical look to reproduce on the edit-target camera.
  parts.push({
    text:
      "PRIMARY DESIGN REFERENCE — the image below is the finished, approved design of this room. " +
      "It defines the EXACT furniture, flooring, wall finishes, lighting, curtains, materials, and color palette you must reproduce.",
  });
  parts.push({
    inlineData: { mimeType: opts.primaryDesignImage.mimeType, data: opts.primaryDesignImage.base64 },
  });

  // Product reference collages (the exact catalog items already in the design).
  if (opts.productParts.length > 0) {
    if (opts.productIntroText) parts.push({ text: opts.productIntroText });
    for (const p of opts.productParts) parts.push(p);
    if (opts.productCloseText) parts.push({ text: opts.productCloseText });
  }

  debugSessionLog({
    location: "phasedRoomEngine.ts:generateFinalViewGeminiImage",
    message: "final viewpoint render inputs",
    hypothesisId: "G",
    data: {
      hasPrimaryDesign: !!opts.primaryDesignImage.base64,
      hasExtraPhoto: !!opts.extraPhoto.base64,
      extraPhotoBytes: opts.extraPhoto.base64.length,
      editTargetPhotoId: opts.editTargetPhotoId ?? null,
      singlePhotoMode: true,
      productParts: opts.productParts.filter((p) => p.inlineData).length,
    },
  });

  const absoluteRules = `
ABSOLUTE RULES:${SECONDARY_LAYOUT_LOCK}
- The furniture, flooring, wall finishes, lighting fixtures, curtains, rugs, decor, materials, and color palette MUST match the PRIMARY DESIGN REFERENCE — same products, same textures, same colors.
- Keep the real room architecture (walls, windows, doors, ceiling height, openings) exactly as shown in the EDIT TARGET photo. Only preserve freestanding columns/posts if they are visible in that photo — do NOT add new ones.
- Cross-reference every assigned room photo for geometry; only the EDIT TARGET camera angle appears in the output.`;

  let mainPrompt: string;
  mainPrompt =
    `Re-render the SAME designed ${opts.designStyleLabel} ${opts.roomType} shown in the PRIMARY DESIGN REFERENCE onto the EDIT TARGET raw photo camera.` +
    absoluteRules +
    "\n\nOutput ONE photorealistic image from the EDIT TARGET photo camera only — NOT the primary reference camera.";

  if (opts.viewpointTransferDirective?.trim()) {
    mainPrompt += `\n\n${opts.viewpointTransferDirective.trim()}`;
  }

  const openingLock = buildOpeningStructuralLock(opts.roomAnalysis, opts.roomGeometry);
  if (openingLock) mainPrompt += `\n\n${openingLock}`;
  mainPrompt += `\n\n${buildDoorDesignPromptBlock(opts.doorDesign)}`;
  mainPrompt += `\n\n${DOOR_CLEARANCE_DIRECTIVE}`;
  mainPrompt += `\n\n${NO_TEXT_IN_IMAGE_DIRECTIVE}`;

  parts.push({ text: mainPrompt });

  logGeminiRequest({
    label: "phased-final-view",
    model: GEMINI_IMAGE_MODEL_LABEL,
    systemInstruction: DESIGNER_SYSTEM_INSTRUCTION,
    parts,
    context: {
      roomAnalysis: opts.roomAnalysis,
      roomGeometry: opts.roomGeometry,
      designStyleLabel: opts.designStyleLabel,
      roomType: opts.roomType,
    },
  });

  if (resolveRenderProvider() === "openai") {
    return renderRoomImageViaOpenAi(parts, "phased-final-view");
  }

  const result = await model.generateContent(parts as Part[]);
  type GenPart = { inlineData?: { data?: unknown; mimeType?: unknown }; text?: string };
  const images: Array<{ base64: string; mimeType: string }> = [];
  for (const candidate of result.response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const pdata = part as GenPart;
      const raw = pdata.inlineData?.data;
      if (typeof raw === "string" && raw) {
        const mt = pdata.inlineData?.mimeType;
        images.push({ base64: raw, mimeType: typeof mt === "string" && mt ? mt : "image/png" });
      }
    }
  }
  if (images.length === 0) {
    console.error("[generateFinalViewGeminiImage] No images returned (gemini)");
  } else {
    await recordGeminiGenerationSpend(GEMINI_IMAGE_MODEL_LABEL, "phased-final-view", result, images.length);
  }

  // Return exactly ONE image — never forward the whole candidate array.
  return images.length > 0 ? [images[0]!] : [];
}

export async function generateFinalViewpointRender(input: FinalViewInput): Promise<FinalViewResult> {
  const {
    extraPhoto,
    primaryDesignImage,
    allRoomPhotos,
    editTargetPhotoId,
    roomName,
    confirmedProductIds,
    designStyleLabel,
    roomType,
    textPrompt,
    roomAnalysis = null,
    roomGeometry = null,
    googleKey,
    falRenderSeed,
    doorDesign = null,
  } = input;

  if (resolveRenderProvider() === "fal") {
    const basePrompt =
      textPrompt.trim()
      || `A beautiful photorealistic interior design photograph of the same ${designStyleLabel} ${roomType}, maintaining the exact same style, finishes, materials, colors, lighting fixtures, and furniture. Same room, different camera angle.`;
    const openingLock = buildFalOpeningLockCompact(roomAnalysis, roomGeometry);
    const prompt = appendSecondaryLayoutLock(
      [
        basePrompt,
        openingLock.trim() || null,
        buildDoorDesignPromptBlock(doorDesign),
        DOOR_CLEARANCE_DIRECTIVE,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );

    const renderSecondary = async (renderPrompt: string, label: string) => {
      const result = await renderSecondaryAngle({
        secondaryPhotoBase64: extraPhoto.base64,
        secondaryPhotoMime: extraPhoto.mimeType,
        heroBase64: primaryDesignImage.base64,
        heroMime: primaryDesignImage.mimeType,
        prompt: renderPrompt,
        seed: falRenderSeed,
        label,
      });
      return result.images[0] ?? null;
    };

    const rendered = await renderSecondary(prompt, "quick-room-finalview");
    if (!rendered) {
      return { ok: false, status: 500, error: "Viewpoint render returned no results." };
    }

    const numericIds = numericIdsFromMpKeys(confirmedProductIds);
    const catalogNames: string[] = [];
    if (numericIds.length > 0) {
      const rows = await fetchMarketplaceProductsAsCatalog(numericIds);
      for (const row of rows) catalogNames.push(row.name);
    }
    const furnitureLabels = buildFurnitureLabels({ catalogNames });

    const placementAccepted = await acceptRenderWithPlacementRetry({
      image: rendered,
      doorBoxes: roomAnalysis?.door_boxes,
      windowBoxes: roomAnalysis?.window_boxes,
      furnitureLabels,
      label: "quick-room-finalview",
      retryRender: async (correctiveFeedback) =>
        renderSecondary(`${prompt}\n\n${correctiveFeedback}`, "quick-room-finalview-placement-retry"),
    });

    const crossViewAccepted = await acceptSecondaryWithCrossViewRetry({
      image: placementAccepted.image,
      heroBase64: primaryDesignImage.base64,
      heroMime: primaryDesignImage.mimeType,
      furnitureLabels,
      label: "quick-room-finalview",
      retryRender: async (correctiveFeedback) =>
        renderSecondary(`${prompt}\n\n${correctiveFeedback}`, "quick-room-finalview-crossview-retry"),
    });

    return { ok: true, image: crossViewAccepted.image };
  }

  // The product set is already final — load it directly, no slot resolution.
  const numericIds = numericIdsFromMpKeys(confirmedProductIds);
  const summaryById = new Map<string, CatalogItemSummary>();
  if (numericIds.length > 0) {
    const rows = await fetchMarketplaceProductsAsCatalog(numericIds);
    for (const row of rows) summaryById.set(row.id, row);
  }

  // Build full-set product collages (reuse the non-phased full-render path). No
  // room image here — the engine adds the extra photo + primary reference itself.
  const visualParts = await buildGeminiProductVisualParts({
    roomImageBytes: null,
    extraRoomImageBytes: [],
    userUploads: [],
    selectedCatalogIds: confirmedProductIds,
    pinnedMpKeys: confirmedProductIds,
    catalogById: summaryById,
  });

  const images = await generateFinalViewGeminiImage({
    googleApiKey: googleKey,
    primaryDesignImage,
    extraPhoto,
    allRoomPhotos,
    editTargetPhotoId,
    roomName,
    productParts: visualParts.productImageParts,
    productIntroText: visualParts.productIntroText,
    productCloseText: visualParts.productCloseText,
    designStyleLabel,
    roomType,
    textPrompt,
    roomAnalysis,
    roomGeometry,
    doorDesign,
  });

  if (images.length === 0) {
    return { ok: false, status: 500, error: "Viewpoint render returned no results." };
  }

  return { ok: true, image: images[0] };
}
