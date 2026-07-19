/**
 * Project Orchestrator — state machine for the interactive design flow.
 *
 * Flow:
 *   1. initializeSpatialAnalysis() — analyze floor plan only (no master concept)
 *   2. confirmFloorPlan() — user confirms dimensions, utilities, photo assignments
 *   3. createProjectConcept() — master concept (catalog allowlists built per room on demand)
 *   4. generateSingleRoom() — generate one room on demand (SSE)
 *   4. handleRoomAction() — approve / regenerate / edit
 *   5. finalizeProject() — technical drawings + PDF
 *
 * State persisted in Redis (see redisStore.ts).
 */

import type {
  MasterDesignConcept,
  ProgressEvent,
  ProjectInput,
  ProjectState,
  ProjectUploadedPhoto,
  RoomDesignBrief,
  RoomEditRequest,
  RoomResult,
  RenderResult,
  DesignPhase,
  DetectedRoom,
  RoomPhotoWithViewpoint,
  FloorPlanAnalysis,
  PhotoViewpoint,
  UtilityEntryPoint,
  UserPreferences,
} from "./types";
import {
  getRoomPhoto,
  getRoomPhotos,
  isPlanOnlyProject,
  marketplaceMatchesFromMaterialSpec,
  marketplaceMatchFromProductLink,
  emptyRoomPhases,
} from "./types";
import { analyzeFloorPlan } from "./floorPlanAnalyzer";
import { getStylePresetOrDefault } from "./stylePresets";
import {
  buildRoomFloorPlanContext,
  renderHighlightedFloorPlan,
} from "./roomFloorPlanContext";
import { assignUtilitiesToRooms, computeSharedWalls } from "./floorPlanGeometry";
import { buildRoomUtilityConstraints } from "./utilityConstraints";
import {
  generateRoomRenders,
  generateRoomAngleVariations,
  generateRoomViewpointRenders,
  generateRoomPhotoReferenceRenders,
  type ViewpointRenderContext,
  buildMaterialSpecFromBrief,
  scrapedProductsFromCatalog,
  type ExtractRoomMaterialsOptions,
  type RoomRenderGenerationOptions,
} from "./roomDesignGenerator";
import { generatePhasedRoom, generateGalleryEditRender, type PhasedRoomResult } from "@/lib/phasedRoomEngine";
import { metricsFromSummarizeRoomParams } from "@/lib/buildStructuralGuardrailPrompt";
import type { LabeledRoomPhoto } from "@/lib/buildMultiPhotoGeminiParts";
import {
  DESIGN_STYLES,
  normalizeRoomTypeValue,
  type DesignStyleId,
  type OpeningBox,
} from "@/lib/interiorDesignPrompts";
import { resolveStyleReferenceUrls } from "@/lib/falStyleReferences";
import { getAnthropicApiKey, getGoogleGenerativeAiApiKey } from "@/lib/serverAiKeys";
import { interpretRoomEdit } from "./roomEditPrompt";
import { generateTechnicalDrawings } from "./technicalDrawings";
import { generateWallElevations } from "./elevationGenerator";
import { assemblePDF, type PdfSectionSelection } from "./pdfAssembler";
import { persistProjectPdf } from "./projectPdfPersistence";
import {
  buildProjectRoomScrapedAllowlistIds,
  LOCAL_SCRAPED_CATALOG_EMPTY_CODE,
  projectRoomQueriesFromBrief,
} from "@/lib/scrapedAllowlist";
import { isVistaLocale, type VistaLocale } from "@/i18n/locales";
import { getProjectFromRedis, setProjectInRedis } from "./redisStore";
import { recoverOrphanedRoomsInState } from "./orphanGenerationRecovery";
import { buildApprovedDesignSummary, buildCrossRoomConsistencyBlock } from "./designConsistency";
import {
  computeSuggestedRoomOrder,
  getFinalizeRequiredRoomIds,
  getPendingFinalizeRoomIds,
} from "./roomOrder";
import {
  resolveViewpointFraming,
  framingVisibleOpenings,
  photoVerifiedVisibleOpenings,
  compassToCameraWallMap,
  buildViewpointTransferDirective,
  areViewpointsRoughlyOpposite,
  type VisibleOpeningExpectation,
} from "./viewpointFraming";
import { renderViewpointDiagram } from "./viewpointDiagram";
import { analyzePhotoWithViewpoint, formatViewpointAnalysisForPrompt } from "./viewpointPhotoAnalyzer";
import {
  buildSecondaryViewpointPrompt,
} from "./secondaryViewpointPrompt";
import {
  getViewpointGenerationTargets,
  isMultiViewpointRoom,
  buildViewpointPhaseContext,
  resolvePhaseBaseImage,
} from "./viewpointPhaseContext";
import { detectedRoomToRoomAnalysis, planDoorInventoryForLock } from "./detectedRoomToRoomAnalysis";
import { pipelineLog, pipelineTimed, summarizeRoomParams, userFlowLog } from "@/lib/pipelineLog";
import { isFreeRenderMode, resolveDesignMode } from "@/lib/designModeConfig";
import { runWithLogContext } from "@/lib/logSink";
import { resolveFinishRoomRenderStrategy } from "./finishRoomRenderStrategy";
import { optimizeImageBufferForAi } from "@/lib/optimizeImageForAi";
import { buildProjectFalPrompt, buildProjectKontextPrompt } from "./buildProjectFalPrompt";
import { renderFurnishedFloorPlanImage } from "./furnishedFloorPlanRenderer";
import {
  assertAssignedPhotosHaveViewpoints,
  composeAllRoomsClaudeRenderPlansEnriched,
  resolvePhotoStagingPrompt,
  resolveRoomStagingPrompt,
  buildStagingOpeningLockSnippet,
} from "./claudeRenderDirector";
import {
  buildSecondaryStagingPrompt,
  buildFinishLockFromPlan,
  clampStagingPrompt,
  requireFurnitureLayoutLock,
} from "./stagingConceptParse";
import {
  assembleLayeredStagingPrompt,
  buildFurnitureStagingPrompt,
  buildShellStagingPrompt,
} from "./stagingPromptAssembly";
import { isLayeredStagingEnabled, shellWorkspaceFilename } from "./stagingLayeredConfig";
import { renderStagingLayer } from "./stagingLayerRender";
import { resolveStagingLayerRenderer } from "./stagingLayerRouter";
import {
  prepFingerprint,
  shellFingerprint,
  readStagingCacheMeta,
  writePhotoStagingCacheMeta,
} from "./stagingCacheFingerprint";
import { planStagingBatchMode, type StagingWorkMode } from "./stagingBatchPlan";
import { resolveProjectRenderModel } from "./projectRenderModel";
import { applyPhotoPrepInpaint } from "./photoPrepInpaint";
import { applyPhotoPrepErase } from "./photoPrepErase";
import { renderEditStaging } from "@/lib/falEditRenderer";
import { detectHeroCopy, isHeroCopyGuardEnabled } from "@/lib/falStyleRefCopyGuard";
import {
  buildSecondaryRenderInstruction,
  resolvePhotoRenderInstruction,
  buildMasterRenderInstruction,
  framingFallbackOpeningCounts,
  buildGeometryAnchorSentence,
} from "./editPromptAssembly";
import { validateProjectRender, type RenderValidationResult } from "./renderValidation";
import {
  STRUCTURAL_RETRY_ESCALATION_TYPES,
  hasStructuralFailure,
  pickBestEditAttempt,
  resolveEditRetryLimit,
  type EditAttemptRecord,
} from "./editRetryPolicy";
import { analyzePhotoOpenings } from "./photoOpeningAnalysis";
import {
  describeHeroFurniturePlacement,
  isHeroPlacementMapEnabled,
} from "./heroPlacementMap";
import { logPipelineStage, logRoomPipelineSummary } from "./pipelineStageLog";
import {
  writeWorkspaceFile,
  readWorkspaceFile,
  writeWorkspaceMeta,
  writeWorkspaceSeed,
  workspaceFileExists,
  deleteWorkspaceFile,
} from "./projectRoomWorkspace";
import { estimateRoomGenerationUsd, maxStagingAttemptsPerRoom } from "./projectStagingCost";
import {
  isGalleryEditEligible,
  appendEditAnnotationHint,
  buildGalleryEditPrompt,
  EDIT_ANNOTATION_MARKER_PROMPT,
} from "./galleryRoomEdit";
import type { EditAnnotation } from "./types";
import type { ViewpointFraming } from "./viewpointFraming";
import { resolveProjectRenderProvider } from "@/lib/roomImageRenderer";
import { renderMasterAngle, renderSecondaryAngle, renderRoomRedesign, renderApartmentStaging } from "@/lib/falRoomRenderer";
import { uploadPublicImage } from "@/lib/falStorage";
import { buildFurnitureLabels } from "@/lib/placementBoxes";
import { acceptSecondaryWithCrossViewRetry } from "@/lib/validateCrossViewConsistency";
import { buildRoomIntentText } from "./roomIntentText";
import { isFalDebugEnabled, logFalDebug, saveFalDebugArtifacts } from "@/lib/falDebug";
import { buildFreezeMask } from "@/lib/buildFreezeMask";
import { annotateOpenings } from "@/lib/annotateOpenings";
import sharp from "sharp";

export type ProgressCallback = (event: ProgressEvent) => void;

/** In-memory guard — one active generateRoomPhase per project+room. */
const roomGenerationInFlight = new Set<string>();
const roomGenerationAbortControllers = new Map<string, AbortController>();

export const GENERATION_CANCELLED_MESSAGE = "Generation cancelled";

export class GenerationCancelledError extends Error {
  constructor(message = GENERATION_CANCELLED_MESSAGE) {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

function roomGenerationLockKey(projectId: string, roomId: string): string {
  return `${projectId}:${roomId}`;
}

/** True while this process holds the in-memory generation lock for the room. */
export function isRoomGenerationRunning(projectId: string, roomId: string): boolean {
  return roomGenerationInFlight.has(roomGenerationLockKey(projectId, roomId));
}

export async function recoverOrphanedRoomGenerations(
  state: ProjectState,
): Promise<{ state: ProjectState; recovered: boolean }> {
  const { rooms, recovered } = recoverOrphanedRoomsInState(state.rooms, (roomId) =>
    isRoomGenerationRunning(state.id, roomId),
  );
  if (!recovered) return { state, recovered: false };
  const next = { ...state, rooms };
  await setProject(next);
  pipelineLog("STATE_PERSIST", "recovered orphaned room generation(s)", {
    projectId: state.id,
    roomIds: rooms.filter((r) => r.generationError?.includes("interrupted")).map((r) => r.roomId),
  });
  return { state: next, recovered: true };
}

function throwIfGenerationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new GenerationCancelledError();
  }
}

function isGenerationCancelledError(err: unknown): boolean {
  return err instanceof GenerationCancelledError;
}

function resetRoomGenerationState(room: RoomResult): void {
  const hasWork =
    (room.renders?.length ?? 0) > 0 || (room.phases?.base?.versions.length ?? 0) > 0;
  room.status = hasWork ? "review" : "pending";
  room.generationStep = "idle";
  room.generationError = undefined;
  if (room.phases) {
    for (const phase of ["base", "furniture", "decor"] as const) {
      if (room.phases[phase]?.status === "generating") {
        room.phases[phase].status = hasWork ? "review" : "pending";
      }
    }
  }
}

/** Stop an in-flight job and clear persisted generating state (idempotent). */
export async function cancelRoomGeneration(
  projectId: string,
  roomId: string,
): Promise<ProjectState | undefined> {
  const generationLockKey = roomGenerationLockKey(projectId, roomId);
  roomGenerationAbortControllers.get(generationLockKey)?.abort();
  roomGenerationAbortControllers.delete(generationLockKey);
  roomGenerationInFlight.delete(generationLockKey);

  const state = await getProject(projectId);
  if (!state) return undefined;
  const room = state.rooms.find((r) => r.roomId === roomId);
  if (!room) return state;

  if (room.status === "generating" || room.status === "editing" || room.generationStep) {
    resetRoomGenerationState(room);
    await setProject(state);
    pipelineLog("STATE_PERSIST", "room generation cancelled", { projectId, roomId });
  }
  return state;
}

async function applyCrossViewConsistencyRetry<T extends { base64: string; mimeType: string }>(opts: {
  image: T;
  heroBase64: string;
  heroMime: string;
  brief: RoomDesignBrief;
  plan?: { furnitureList?: string[] } | null;
  label: string;
  retryRender: (correctiveFeedback: string) => Promise<T | null>;
}): Promise<T> {
  const furnitureLabels = buildFurnitureLabels({
    furnitureList: opts.brief.furnitureList,
    catalogNames: opts.plan?.furnitureList,
  });
  if (furnitureLabels.length === 0) return opts.image;

  const { image } = await acceptSecondaryWithCrossViewRetry({
    image: opts.image,
    heroBase64: opts.heroBase64,
    heroMime: opts.heroMime,
    furnitureLabels,
    label: opts.label,
    retryRender: opts.retryRender,
  });
  return image;
}

/** Minimal concept stub — skips Claude; room briefs come from floor-plan analysis only. */
function buildMinimalConceptFromPreferences(
  analysis: FloorPlanAnalysis,
  preferences: UserPreferences,
): MasterDesignConcept {
  const style = getStylePresetOrDefault(preferences.style);
  return {
    projectName: "Design Project",
    overallStyle: style.label,
    colorPalette: style.defaultPalette,
    materialPalette: style.defaultMaterials,
    rooms: analysis.rooms.map((dr) => ({
      roomId: dr.id,
      roomName: dr.name,
      roomType: dr.type,
      wallColor: { hex: style.defaultPalette.primary.hex, ncs: style.defaultPalette.primary.ncs },
      floorMaterial: `${style.defaultMaterials.woodType} flooring`,
      ceilingDesign: style.ceilingStyle,
      lightingConcept: style.lightingStyle,
      furnitureList: [],
      keyDesignElements: [],
      renderAngles: ["Wide-angle view from the main entrance showing full room layout"],
      specialNotes: "",
    })),
  };
}

/**
 * Build a real MasterDesignConcept from the enriched Claude render director response.
 * Falls back to style-preset defaults for any fields Claude didn't populate.
 */
function buildConceptFromEnrichedResponse(
  enriched: import("./claudeRenderDirector").EnrichedConceptResponse,
  analysis: FloorPlanAnalysis,
  preferences: UserPreferences,
): MasterDesignConcept {
  const style = getStylePresetOrDefault(preferences.style);
  const cp = enriched.colorPalette;
  const mp = enriched.materialPalette;

  return {
    projectName: "Design Project",
    overallStyle: enriched.overallStyle || style.label,
    colorPalette: cp ? {
      primary: { hex: cp.primary.hex || style.defaultPalette.primary.hex, ncs: style.defaultPalette.primary.ncs, name: cp.primary.name || style.defaultPalette.primary.name },
      secondary: { hex: cp.secondary.hex || style.defaultPalette.secondary.hex, ncs: style.defaultPalette.secondary.ncs, name: cp.secondary.name || style.defaultPalette.secondary.name },
      accent: { hex: cp.accent.hex || style.defaultPalette.accent.hex, ncs: style.defaultPalette.accent.ncs, name: cp.accent.name || style.defaultPalette.accent.name },
      neutral: { hex: cp.neutral.hex || style.defaultPalette.neutral.hex, ncs: style.defaultPalette.neutral.ncs, name: cp.neutral.name || style.defaultPalette.neutral.name },
    } : style.defaultPalette,
    materialPalette: mp ? {
      woodType: mp.woodType || style.defaultMaterials.woodType,
      metalFinish: mp.metalFinish || style.defaultMaterials.metalFinish,
      stoneType: mp.stoneType || style.defaultMaterials.stoneType,
      textilePrimary: mp.textilePrimary || style.defaultMaterials.textilePrimary,
    } : style.defaultMaterials,
    rooms: analysis.rooms.map((dr) => {
      const plan = enriched.plans[dr.id];
      return {
        roomId: dr.id,
        roomName: dr.name,
        roomType: dr.type,
        wallColor: plan?.wallColor
          ? { hex: plan.wallColor, ncs: style.defaultPalette.primary.ncs }
          : { hex: style.defaultPalette.primary.hex, ncs: style.defaultPalette.primary.ncs },
        floorMaterial: plan?.floorMaterial || `${(mp?.woodType || style.defaultMaterials.woodType)} flooring`,
        ceilingDesign: plan?.ceilingDesign || style.ceilingStyle,
        lightingConcept: plan?.lightingConcept || style.lightingStyle,
        furnitureList: plan?.furnitureList?.length ? plan.furnitureList : [],
        keyDesignElements: plan?.materials?.length ? plan.materials : [],
        renderAngles: ["Wide-angle view from the main entrance showing full room layout"],
        specialNotes: plan?.mood || "",
      };
    }),
  };
}

function buildLabeledRoomPhotos(
  targets: ReturnType<typeof getViewpointGenerationTargets>,
  detectedRoom: DetectedRoom | undefined,
): LabeledRoomPhoto[] {
  return targets
    .filter((t) => t.base64)
    .map((t, i) => ({
      id: t.id,
      label: t.label || `Photo ${i + 1}`,
      base64: t.base64,
      mimeType: t.mimeType || "image/jpeg",
      cameraNote: t.viewpoint
        ? resolveViewpointFraming(t.viewpoint, detectedRoom)?.note
        : undefined,
    }));
}

export function getProjectFinalizeStatus(state: ProjectState): {
  canFinalize: boolean;
  requiredRoomIds: string[];
  pendingRoomIds: string[];
  approvedRoomCount: number;
} {
  if (!state.concept) {
    return { canFinalize: false, requiredRoomIds: [], pendingRoomIds: [], approvedRoomCount: 0 };
  }
  const requiredRoomIds = getFinalizeRequiredRoomIds(
    state.analysis,
    state.concept,
    state.suggestedRoomOrder,
    state.rooms,
  );
  const pendingRoomIds = getPendingFinalizeRoomIds(requiredRoomIds, state.rooms);
  const approvedRoomCount = state.rooms.filter(
    (r) => r.status === "approved" && r.renders.length > 0,
  ).length;
  // Every designable room must be approved before the project can be finalized.
  return {
    canFinalize: requiredRoomIds.length > 0 && pendingRoomIds.length === 0,
    requiredRoomIds,
    pendingRoomIds,
    approvedRoomCount,
  };
}

/** True once every designable room is approved (the project can be finalized). */
function canFinalizeProject(state: ProjectState): boolean {
  return getProjectFinalizeStatus(state).canFinalize;
}

function mergeAllowlistWithPinned(allowIds: number[], pinnedIds: number[]): number[] {
  return [...new Set([...allowIds.filter((n) => n > 0), ...pinnedIds.filter((n) => n > 0)])];
}

/** Primary room photo for Gemini photo-grounded mode; falls back to first assigned upload. */
function resolveRoomReferencePhoto(
  state: ProjectState,
  roomId: string,
): { base64: string; mimeType: string } | undefined {
  const direct = getRoomPhoto(state, roomId);
  if (direct) return direct;
  const photos = getRoomPhotos(state, roomId);
  const first = photos[0];
  return first ? { base64: first.base64, mimeType: first.mimeType } : undefined;
}

function briefNeedsTileQueries(roomType: string): boolean {
  return (
    roomType === "bathroom" ||
    roomType === "toilet" ||
    roomType === "kitchen" ||
    roomType === "laundry"
  );
}

/** Resolve (or rebuild) scraped allowlist for one room. Re-runs search when cache is missing or empty. */
async function ensureRoomScrapedAllowlist(
  state: ProjectState,
  roomId: string,
  brief: RoomDesignBrief,
  forceRebuild = false,
): Promise<number[]> {
  const cached = forceRebuild ? undefined : state.scrapedRoomAllowlists?.[roomId];
  if (cached && cached.length > 0) {
    return cached;
  }

  const queries = projectRoomQueriesFromBrief(
    brief.furnitureList,
    brief.floorMaterial,
    brief.lightingConcept,
    brief.roomType,
    briefNeedsTileQueries(brief.roomType),
  );
  const allowMap = await buildProjectRoomScrapedAllowlistIds({
    seeds: [{ roomId, queries }],
  });
  const ids = allowMap.get(roomId) ?? [];
  if (!state.scrapedRoomAllowlists) state.scrapedRoomAllowlists = {};
  state.scrapedRoomAllowlists[roomId] = ids;
  await setProject(state);
  return ids;
}

async function buildRenderOptions(
  state: ProjectState,
  allowIds: number[],
  roomId: string,
): Promise<RoomRenderGenerationOptions> {
  const merged = mergeAllowlistWithPinned(allowIds, state.pinnedProductIds);
  if (merged.length === 0) {
    throw new Error(LOCAL_SCRAPED_CATALOG_EMPTY_CODE);
  }
  const crossRoomContext =
    state.concept && Object.keys(state.approvedDesignSummaries).length > 0
      ? buildCrossRoomConsistencyBlock(state.concept, state.approvedDesignSummaries)
      : state.concept
        ? buildCrossRoomConsistencyBlock(state.concept, {})
        : undefined;

  const referenceViewpoint = state.uploadedPhotos.find(
    (p) => p.roomId === roomId && p.viewpoint,
  )?.viewpoint;

  const rooms = state.analysis?.rooms ?? [];
  const roomUtilities = assignUtilitiesToRooms(rooms, state.utilityEntryPoints ?? []).get(roomId) ?? [];
  const utilityConstraints = buildRoomUtilityConstraints(
    rooms.find((r) => r.id === roomId),
    roomUtilities,
  );

  const floorPlanContext = await buildRoomFloorPlanContext(state, roomId);

  return {
    scrapedInventoryExclusive: true,
    scrapedAllowlistNumericIds: merged,
    pinnedProductIds: state.pinnedProductIds,
    inspirationUploads: state.inspirationUploads,
    crossRoomContext,
    referenceViewpoint,
    utilityConstraints,
    floorPlanContext,
  };
}

const MAX_EXTRA_ROOM_PHOTOS = 4;

/** Downscale an image for an AI part; falls back to the raw bytes on failure. */
async function optimizedImagePart(img: {
  base64: string;
  mimeType: string;
}): Promise<{ base64: string; mimeType: string }> {
  try {
    const optimized = await optimizeImageBufferForAi(Buffer.from(img.base64, "base64"), {
      maxEdge: 1280,
      quality: 78,
    });
    return { base64: optimized.base64, mimeType: optimized.mimeType };
  } catch (optimizeErr) {
    pipelineLog(
      "UPLOAD",
      "image optimize fallback — using original",
      { error: String(optimizeErr).slice(0, 200) },
      "warn",
    );
    return img;
  }
}

/**
 * Build the floor-plan reference parts (original + highlighted schematic) and the
 * other-same-room photo parts for the phased Gemini engine. `excludeBase64` is the
 * base/camera image so it isn't duplicated as an extra reference.
 *
 * `excludeOtherBase64s` — in multi-viewpoint mode, the base64 blobs of other
 * viewpoint photos that must NOT be included as `extraRoomPhotos` (prevents
 * cross-angle contamination).
 */
async function buildPhasedFloorPlanInputs(
  state: ProjectState,
  roomId: string,
  excludeBase64?: string,
  excludeOtherBase64s?: string[],
): Promise<{
  floorPlanParts: Array<{ base64: string; mimeType: string; label: string }>;
  extraRoomPhotos: Array<{ base64: string; mimeType: string }>;
  planText: string;
}> {
  const ctx = await buildRoomFloorPlanContext(state, roomId);
  const floorPlanParts: Array<{ base64: string; mimeType: string; label: string }> = [];
  if (ctx.originalPlan) {
    const opt = await optimizedImagePart(ctx.originalPlan);
    floorPlanParts.push({
      ...opt,
      label: "FLOOR PLAN (authoritative layout, with room labels/dimensions printed on it):",
    });
  }
  if (ctx.highlightedPlan) {
    const opt = await optimizedImagePart(ctx.highlightedPlan);
    floorPlanParts.push({
      ...opt,
      label: "FLOOR PLAN SCHEMATIC (the target room is highlighted; same layout):",
    });
  }

  const excludeSet = new Set<string>();
  if (excludeBase64) excludeSet.add(excludeBase64);
  if (excludeOtherBase64s) {
    for (const b of excludeOtherBase64s) excludeSet.add(b);
  }

  const extras = ctx.roomPhotos
    .filter((p) => p.base64 && !excludeSet.has(p.base64))
    .slice(0, MAX_EXTRA_ROOM_PHOTOS);
  const extraRoomPhotos = await Promise.all(
    extras.map((p) => optimizedImagePart({ base64: p.base64, mimeType: p.mimeType })),
  );

  return { floorPlanParts, extraRoomPhotos, planText: ctx.planText };
}

function toExtractOptions(renderOpts: RoomRenderGenerationOptions): ExtractRoomMaterialsOptions {
  return {
    scrapedInventoryExclusive: renderOpts.scrapedInventoryExclusive,
    scrapedAllowlistNumericIds: renderOpts.scrapedAllowlistNumericIds,
  };
}

async function finalizeRoomGeneration(
  room: RoomResult,
  brief: RoomDesignBrief,
  renderResult: Awaited<ReturnType<typeof generateRoomRenders>>,
  extractOpts: ExtractRoomMaterialsOptions,
): Promise<void> {
  room.renders = renderResult.renders;

  const materials = await buildMaterialSpecFromBrief(brief, extractOpts);
  room.materials = materials;

  const catalog = renderResult.catalog;

  if (catalog) {
    room.selectedCatalogIds = catalog.selectedForGemini;
    room.plannedCatalogIds = catalog.plannedCatalogIds;
    // The products the render actually resolved are the authoritative "used"
    // list (replaces the former Claude in-render verification pass).
    const fromCatalog = scrapedProductsFromCatalog(catalog);
    room.usedScrapedProducts =
      fromCatalog.length > 0 ? fromCatalog : marketplaceMatchesFromMaterialSpec(materials);
  } else {
    room.usedScrapedProducts = marketplaceMatchesFromMaterialSpec(materials);
  }
}

export async function getProject(id: string): Promise<ProjectState | undefined> {
  const state = await getProjectFromRedis(id);
  if (!state) return undefined;
  // Migrate legacy Redis key: roomGeminiPlans → roomRenderPlans
  const legacy = (state as unknown as Record<string, unknown>).roomGeminiPlans;
  if (!state.roomRenderPlans && legacy) {
    state.roomRenderPlans = legacy as ProjectState["roomRenderPlans"];
  }
  return state;
}

export async function setProject(state: ProjectState): Promise<void> {
  await setProjectInRedis(state);
}

function generateId(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface AnalysisInput extends ProjectInput {
  uploadedPhotos?: ProjectUploadedPhoto[];
  /** Optional user-drawn plan that seeds the analysis (Claude keeps the rooms, fixes geometry). */
  manualAnalysis?: FloorPlanAnalysis;
  /** Optional rasterized image of the drawn plan (rooms + doors + windows), sent to Claude. */
  drawnPlanBase64?: string;
  drawnPlanMimeType?: string;
}

function spatialCompletePayload(state: ProjectState) {
  return {
    projectId: state.id,
    analysis: state.analysis,
    uploadedPhotos: state.uploadedPhotos.map((p) => ({
      id: p.id,
      label: p.label,
      roomId: p.roomId,
      confidence: p.confidence,
    })),
  };
}

/**
 * Phase 1a: Analyze floor plan only (no master concept, no room photos).
 * Photos stay client-side until confirmFloorPlan uploads them with assignments.
 */
export async function initializeSpatialAnalysis(
  input: AnalysisInput,
  onProgress?: ProgressCallback,
): Promise<ProjectState> {
  const id = generateId();
  const now = new Date().toISOString();

  const state: ProjectState = {
    id,
    status: "analyzing",
    preferences: input.preferences,
    floorPlanBase64: input.floorPlanBase64,
    floorPlanMimeType: input.floorPlanMimeType,
    analysis: null,
    concept: null,
    roomRenderPlans: null,
    rooms: [],
    currentRoomIndex: 0,
    technicalDrawings: null,
    wallElevations: null,
    pdfBase64: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    roomPhotos: {},
    uploadedPhotos: input.uploadedPhotos ?? [],
    scrapedRoomAllowlists: null,
    pinnedProductIds: (input.pinnedProductIds ?? []).filter((n) => n > 0),
    inspirationUploads: input.inspirationUploads ?? [],
    suggestedRoomOrder: [],
    approvedDesignSummaries: {},
    floorPlanConfirmed: false,
    utilityEntryPoints: [],
  };

  // STEP 1 — server received the uploaded plan + photos.
  pipelineLog("UPLOAD", "server received upload", {
    projectId: id,
    floorPlanMime: input.floorPlanMimeType,
    floorPlanKB: Math.round((input.floorPlanBase64.length * 3) / 4 / 1024),
    photoCount: input.uploadedPhotos?.length ?? 0,
    hasDrawnPlan: !!input.drawnPlanBase64,
    hasManualAnalysis: !!input.manualAnalysis,
    totalArea: input.preferences.totalArea,
  });

  await setProject(state);

  try {
    onProgress?.({ phase: "floor_plan", message: "Analyzing floor plan...", progress: 0.1 });

    // STEP 2 — analyze the floor plan (OpenAI vision or manual/drawn geometry).
    pipelineLog("ANALYZE_FLOOR_PLAN", "start", {
      projectId: id,
      source: input.manualAnalysis ? "manual" : input.drawnPlanBase64 ? "drawn" : "ai-vision",
    });
    const seeded =
      (input.manualAnalysis?.rooms?.filter((r) => (r.polygon?.length ?? 0) >= 3).length ?? 0) > 0;
    // Show motion before the long, silent vision call so the client isn't stuck at 10%.
    if (!seeded) {
      onProgress?.({ phase: "floor_plan", message: "Reading room shapes…", progress: 0.4 });
    }
    const analysis = await analyzeFloorPlan(
      input.floorPlanBase64,
      input.floorPlanMimeType,
      input.preferences.totalArea,
      input.manualAnalysis,
      seeded ? undefined : input.drawnPlanBase64,
      seeded ? undefined : input.drawnPlanMimeType,
    );
    state.analysis = analysis;
    state.status = "reviewing";
    await setProject(state);

    // STEP 3 — what the floor-plan analysis produced (eyeball wrong room
    // params here BEFORE any generation: room count, sizes, window/door counts).
    pipelineLog("FLOOR_PLAN_RESULTS", "rooms detected", {
      projectId: id,
      roomCount: analysis.rooms.length,
      overallShape: analysis.overallShape,
      ceilingHeight: analysis.ceilingHeight,
    });
    for (const r of analysis.rooms) {
      pipelineLog("FLOOR_PLAN_RESULTS", "room", summarizeRoomParams(r));
    }

    // Apply any user pre-assignments from the upload page (no AI matching).
    // Unassigned photos are left for the user to match on the review screen.
    for (const photo of state.uploadedPhotos) {
      if (photo.roomId && !state.roomPhotos[photo.roomId]) {
        state.roomPhotos[photo.roomId] = { base64: photo.base64, mimeType: photo.mimeType };
      }
    }

    onProgress?.({
      phase: "complete",
      message: "Floor plan analysis complete",
      progress: 1.0,
      data: spatialCompletePayload(state),
    });

    return state;
  } catch (err) {
    console.error("[initializeSpatialAnalysis] failed", err);
    state.status = "failed";
    state.error = err instanceof Error ? err.message : "Project initialization failed";
    await setProject(state);
    throw err;
  }
}

export interface CreateConceptInput {
  preferences: UserPreferences;
  inspirationUploads?: Array<{ base64: string; mimeType: string; label: string }>;
  pinnedProductIds?: number[];
}

/** Wipe prior room renders/plans so "Start Designing" always begins a fresh concept run. */
function resetProjectDesignForNewConcept(state: ProjectState): void {
  const hadPriorWork =
    state.rooms.some((r) => r.renders.length > 0 || (r.phases?.base.versions.length ?? 0) > 0) ||
    !!state.roomRenderPlans ||
    !!state.pdfBase64;

  state.rooms = [];
  state.roomRenderPlans = null;
  state.concept = null;
  state.approvedDesignSummaries = {};
  state.technicalDrawings = null;
  state.wallElevations = null;
  state.pdfBase64 = null;
  state.scrapedRoomAllowlists = null;
  state.currentRoomIndex = 0;
  state.error = null;
  state.status = "reviewing";

  if (hadPriorWork) {
    pipelineLog("CLAUDE_ROOM_CONCEPTS", "reset prior design — starting fresh concept", {
      projectId: state.id,
    });
  }
}

/**
 * Phase 1b: Master design concept (after floor plan confirmed + design brief).
 * Catalog allowlists are resolved lazily in generateSingleRoom().
 */
export async function createProjectConcept(
  projectId: string,
  input: CreateConceptInput,
  onProgress?: ProgressCallback,
): Promise<ProjectState> {
  return runWithLogContext(projectId, () => createProjectConceptImpl(projectId, input, onProgress));
}

async function createProjectConceptImpl(
  projectId: string,
  input: CreateConceptInput,
  onProgress?: ProgressCallback,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.analysis) throw new Error("Floor plan not analyzed");
  if (!state.floorPlanConfirmed) throw new Error("Floor plan not confirmed");

  resetProjectDesignForNewConcept(state);

  state.preferences = input.preferences;
  if (input.inspirationUploads !== undefined) {
    state.inspirationUploads = input.inspirationUploads;
  }
  if (input.pinnedProductIds !== undefined) {
    state.pinnedProductIds = input.pinnedProductIds.filter((n) => n > 0);
  }

  try {
    onProgress?.({ phase: "master_concept", message: "Saving plan...", progress: 0.1 });

    pipelineLog("CLAUDE_ROOM_CONCEPTS", "concept step invoked", {
      projectId,
      roomCount: state.analysis.rooms.length,
      style: input.preferences.style,
      budgetTier: input.preferences.budgetTier,
    });

    onProgress?.({
      phase: "master_concept",
      message: "Reading floor plan for all rooms…",
      progress: 0.25,
    });

    assertAssignedPhotosHaveViewpoints(state);

    const enriched = await composeAllRoomsClaudeRenderPlansEnriched(state);
    state.roomRenderPlans = enriched.plans;

    onProgress?.({ phase: "master_concept", message: "We are designing your concept...", progress: 0.5 });

    const concept = buildConceptFromEnrichedResponse(enriched, state.analysis, state.preferences);
    state.concept = concept;
    state.suggestedRoomOrder = computeSuggestedRoomOrder(state.analysis, concept);

    /* --- FAL-direct stub (disabled — Claude concept restored) ---
    state.roomRenderPlans = null;
    const concept = buildMinimalConceptFromPreferences(state.analysis, state.preferences);
    ...
    */

    onProgress?.({ phase: "master_concept", message: "Ready to render", progress: 0.9 });
    state.status = "reviewing";
    await setProject(state);

    onProgress?.({
      phase: "complete",
      message: "Design concept complete",
      progress: 1.0,
      data: {
        projectId: state.id,
        concept: sanitizeConceptSummary(state.concept),
        suggestedRoomOrder: state.suggestedRoomOrder,
      },
    });

    return state;
  } catch (err) {
    pipelineLog(
      "CLAUDE_ROOM_CONCEPTS",
      "createProjectConcept failed",
      { projectId: state.id, error: String(err).slice(0, 300) },
      "error",
    );
    state.status = "failed";
    state.error = err instanceof Error ? err.message : "Design concept creation failed";
    await setProject(state);
    throw err;
  }
}

/**
 * Floor-plan-only path: render one furnished overview image (no room photos).
 */
export async function generateFurnishedFloorPlan(
  projectId: string,
  onProgress?: ProgressCallback,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.floorPlanConfirmed) throw new Error("Floor plan not confirmed");
  if (!state.analysis) throw new Error("Floor plan not analyzed");
  if (!state.concept) throw new Error("Design concept not created");
  if (!isPlanOnlyProject(state)) {
    throw new Error("Furnished floor plan is only available when no room photos are uploaded.");
  }

  state.furnishedPlanStatus = "generating";
  state.furnishedPlanError = null;
  state.error = null;
  await setProject(state);

  onProgress?.({
    phase: "generating",
    message: "Preparing furnished floor plan…",
    progress: 0.1,
  });

  try {
    onProgress?.({
      phase: "generating",
      message: "Rendering decorated floor plan…",
      progress: 0.45,
    });

    const image = await renderFurnishedFloorPlanImage(state);

    state.furnishedPlanRender = image;
    state.furnishedPlanStatus = "review";
    state.furnishedPlanError = null;
    state.status = "reviewing";
    await setProject(state);

    onProgress?.({
      phase: "complete",
      message: "Decorated floor plan ready",
      progress: 1.0,
      data: {
        furnishedPlanRender: image,
        furnishedPlanStatus: state.furnishedPlanStatus,
      },
    });

    return state;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Furnished floor plan generation failed";
    state.furnishedPlanStatus = "error";
    state.furnishedPlanError = errMsg;
    state.error = errMsg;
    await setProject(state);
    onProgress?.({
      phase: "error",
      message: errMsg,
      data: { furnishedPlanStatus: "error" },
    });
    throw err;
  }
}

/**
 * Legacy one-shot: spatial analysis + auto-confirm + master concept.
 * @deprecated Prefer initializeSpatialAnalysis + confirmFloorPlan + createProjectConcept.
 */
export async function initializeProjectAnalysis(
  input: AnalysisInput,
  onProgress?: ProgressCallback,
): Promise<ProjectState> {
  const state = await initializeSpatialAnalysis(input, onProgress);
  // The projectId only exists after spatial analysis — key the rest (concept
  // creation) of this operation to it so those logs land in the project file.
  return runWithLogContext(state.id, async () => {
    state.floorPlanConfirmed = true;
    await setProject(state);
    return createProjectConcept(
      state.id,
      {
        preferences: input.preferences,
        inspirationUploads: input.inspirationUploads,
        pinnedProductIds: input.pinnedProductIds,
      },
      onProgress,
    );
  });
}

export function sanitizeConceptSummary(concept: MasterDesignConcept | null) {
  if (!concept) return null;
  return {
    projectName: concept.projectName,
    overallStyle: concept.overallStyle,
    colorPalette: concept.colorPalette,
    materialPalette: concept.materialPalette,
    roomCount: concept.rooms.length,
    roomNames: concept.rooms.map((r) => ({
      id: r.roomId,
      name: r.roomName,
      type: r.roomType,
    })),
  };
}

export interface ConfirmPlanInput {
  /**
   * Full client-edited floor-plan geometry (rooms with polygons + wall segments).
   * When provided, it replaces the analyzed geometry — this is how the manual
   * floor-plan editor persists reshaped / added / deleted rooms.
   */
  analysis?: FloorPlanAnalysis;
  rooms?: Array<{
    roomId: string;
    dimensions?: { width: number; depth: number; height: number };
    type?: DetectedRoom["type"];
    name?: string;
    photoIds?: string[];
  }>;
  /** Per-photo camera viewpoints set by the user on the plan. */
  viewpoints?: Array<{ photoId: string; viewpoint: PhotoViewpoint | null }>;
  /**
   * Full client-held room photos (id + base64). Photos added in the floor-plan
   * editor after the initial analysis live only in the browser — the analysis
   * upload never saw them — so confirm-plan must persist their blobs here.
   * Without this, the `rooms[].photoIds` / `viewpoints[].photoId` references
   * below resolve to nothing and generation falls back to a floor-plan-only
   * render despite the user assigning photos.
   */
  photos?: Array<{
    id: string;
    base64: string;
    mimeType: string;
    label?: string;
    structuralLineMap?: { base64: string; mimeType: string; strokeOnly?: boolean } | null;
    objectRemovalMask?: { base64: string; mimeType: string } | null;
    openingAnalysis?: {
      window_boxes: OpeningBox[];
      door_boxes: OpeningBox[];
    } | null;
  }>;
  utilityEntryPoints?: UtilityEntryPoint[];
}

/**
 * Phase 2: User confirms floor plan after editing dimensions/photos.
 */
export async function confirmFloorPlan(
  projectId: string,
  input: ConfirmPlanInput,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.analysis) throw new Error("Floor plan not analyzed");

  // Materialize photos the client holds but the server never received (added in
  // the floor-plan editor after analysis). This MUST run before the room/
  // viewpoint loops below, which only *reference* photos by id — they cannot
  // create them. Upsert so re-confirming keeps existing assignments intact.
  if (input.photos) {
    for (const incoming of input.photos) {
      if (!incoming.id || !incoming.base64) continue;
      const existing = state.uploadedPhotos.find((p) => p.id === incoming.id);
      if (existing) {
        existing.base64 = incoming.base64;
        existing.mimeType = incoming.mimeType;
        if (incoming.label !== undefined) existing.label = incoming.label;
        if (incoming.structuralLineMap !== undefined) {
          existing.structuralLineMap = incoming.structuralLineMap ?? undefined;
        }
        if (incoming.objectRemovalMask !== undefined) {
          existing.objectRemovalMask = incoming.objectRemovalMask ?? undefined;
        }
        if (incoming.openingAnalysis !== undefined) {
          existing.openingAnalysis = incoming.openingAnalysis ?? undefined;
        }
      } else {
        state.uploadedPhotos.push({
          id: incoming.id,
          base64: incoming.base64,
          mimeType: incoming.mimeType,
          label: incoming.label ?? "",
          structuralLineMap: incoming.structuralLineMap ?? undefined,
          objectRemovalMask: incoming.objectRemovalMask ?? undefined,
          openingAnalysis: incoming.openingAnalysis ?? undefined,
        });
      }
    }
  }

  // The manual editor authors the room set + geometry; treat it as source of truth.
  if (input.analysis) {
    // Approve sweep: confirming the plan vouches for every opening, so mark them
    // all `confirmed` → detectedRoomToRoomAnalysis emits a hard `EXACTLY N` lock
    // for Claude + Gemini (the photo-viewpoint override still wins where present).
    const confirmedRooms = input.analysis.rooms.map((r) => ({
      ...r,
      windows: r.windows.map((w) => ({ ...w, confirmed: true })),
      doors: r.doors.map((d) => ({ ...d, confirmed: true })),
    }));
    state.analysis = {
      ...state.analysis,
      rooms: confirmedRooms,
      wallSegments: input.analysis.wallSegments,
      sharedWalls: computeSharedWalls(confirmedRooms),
      totalArea: input.analysis.totalArea || state.analysis.totalArea,
      overallShape: input.analysis.overallShape || state.analysis.overallShape,
    };

    // Drop photo assignments + cached reference photos for rooms that no longer exist.
    // ORDERING: this orphan-cleanup MUST run before the `input.rooms` block below,
    // which re-asserts photo→room assignments from `photoIds`. Reordering would let
    // this sweep wipe a just-restored assignment and resurface the "no assigned
    // photo" path during generation.
    const validRoomIds = new Set(state.analysis.rooms.map((r) => r.id));
    for (const photo of state.uploadedPhotos) {
      if (photo.roomId && !validRoomIds.has(photo.roomId)) {
        photo.roomId = undefined;
        photo.viewpoint = undefined;
      }
    }
    for (const roomId of Object.keys(state.roomPhotos)) {
      if (!validRoomIds.has(roomId)) delete state.roomPhotos[roomId];
    }
  }

  if (input.rooms) {
    for (const edit of input.rooms) {
      const room = state.analysis.rooms.find((r) => r.id === edit.roomId);
      if (!room) continue;
      if (edit.dimensions) room.dimensions = edit.dimensions;
      if (edit.type) room.type = edit.type;
      if (edit.name) room.name = edit.name;

      if (edit.photoIds) {
        for (const pid of edit.photoIds) {
          const photo = state.uploadedPhotos.find((p) => p.id === pid);
          if (photo) {
            photo.roomId = edit.roomId;
            state.roomPhotos[edit.roomId] = {
              base64: photo.base64,
              mimeType: photo.mimeType,
            };
            // STEP 4 — user assigned this photo to this room (overrides auto-match).
            pipelineLog("ASSIGN_PHOTOS_VIEWPOINTS", "photo assigned to room", {
              projectId: state.id,
              roomId: edit.roomId,
              roomName: edit.name ?? room.name,
              photoId: pid,
            });
          }
        }
      }

      if (state.concept) {
        const brief = state.concept.rooms.find((b) => b.roomId === edit.roomId);
        if (brief && edit.name) brief.roomName = edit.name;
        if (brief && edit.type) brief.roomType = edit.type;
      }
    }
  }

  if (input.viewpoints) {
    for (const { photoId, viewpoint } of input.viewpoints) {
      const photo = state.uploadedPhotos.find((p) => p.id === photoId);
      if (!photo) {
        // The viewpoint references a photo the server doesn't have. Log loudly —
        // a silent skip here is exactly what previously masked lost photo blobs.
        pipelineLog("ASSIGN_PHOTOS_VIEWPOINTS", "viewpoint target photo not found", {
          projectId: state.id,
          photoId,
        }, "warn");
        continue;
      }
      photo.viewpoint = viewpoint ?? undefined;
      // STEP 4 — user marked (or cleared) the camera viewpoint for this photo.
      pipelineLog("ASSIGN_PHOTOS_VIEWPOINTS", viewpoint ? "viewpoint set" : "viewpoint cleared", {
        projectId: state.id,
        photoId,
        roomId: photo.roomId ?? null,
        viewpoint: viewpoint ?? null,
      });
    }
  }

  // STEP 4 — confirmed snapshot: which rooms ended up with a photo + viewpoint.
  pipelineLog("ASSIGN_PHOTOS_VIEWPOINTS", "floor plan confirmed", {
    projectId: state.id,
    rooms: state.analysis.rooms.length,
    photosAssigned: state.uploadedPhotos.filter((p) => p.roomId).length,
    viewpointsSet: state.uploadedPhotos.filter((p) => p.viewpoint).length,
  });

  state.utilityEntryPoints = input.utilityEntryPoints ?? [];
  state.floorPlanConfirmed = true;
  await setProject(state);

  prefetchPhotoOpeningAnalyses(state, projectId);

  return state;
}

/**
 * Phase 3: Generate designs for a single room on demand.
 */
export async function generateSingleRoom(
  projectId: string,
  roomId: string,
  onProgress?: ProgressCallback,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.concept || !state.analysis) throw new Error("Project not initialized");
  if (!state.floorPlanConfirmed) throw new Error("Floor plan not confirmed");

  const brief = state.concept.rooms.find((b) => b.roomId === roomId);
  if (!brief) throw new Error(`Room ${roomId} not found in concept`);

  let room = state.rooms.find((r) => r.roomId === roomId);
  if (!room) {
    room = {
      roomId,
      status: "generating",
      brief,
      renders: [],
      materials: null,
      editHistory: [],
      version: 1,
      usedScrapedProducts: [],
    };
    state.rooms.push(room);
  } else {
    room.status = "generating";
    room.brief = brief;
  }

  await setProject(state);

  onProgress?.({ phase: "preparing", message: "Resolving catalog...", progress: 0.1, room: brief.roomName });

  try {
    const allowIds = await ensureRoomScrapedAllowlist(state, roomId, brief);
    const renderOpts = await buildRenderOptions(state, allowIds, roomId);

    const renderResult = await generateRoomRenders(
      brief,
      state.concept,
      state.analysis,
      resolveRoomReferencePhoto(state, roomId),
      renderOpts,
      (angleIndex, total) => {
        onProgress?.({
          phase: "generating",
          message: `Generating angle ${angleIndex + 1} of ${total}...`,
          progress: 0.2 + ((angleIndex + 1) / total) * 0.55,
          angleIndex,
          room: brief.roomName,
        });
      },
    );

    onProgress?.({
      phase: "materials",
      message: "Extracting materials...",
      progress: 0.85,
      room: brief.roomName,
    });

    await finalizeRoomGeneration(room, brief, renderResult, toExtractOptions(renderOpts));

    room.status = "review";
    state.status = "reviewing";
    await setProject(state);

    onProgress?.({
      phase: "complete",
      message: "Room ready for review",
      progress: 1.0,
      room: brief.roomName,
      data: { room: sanitizeRoomResult(room) },
    });

    return state;
  } catch (err) {
    pipelineLog(
      "GEMINI_GENERATE",
      "generateSingleRoom failed",
      { projectId: state.id, roomId, error: String(err).slice(0, 300) },
      "error",
    );
    room.status = "review";
    state.error = err instanceof Error ? err.message : "Room generation failed";
    await setProject(state);
    throw err;
  }
}

export function sanitizeRoomResult(room: RoomResult) {
  return {
    roomId: room.roomId,
    status: room.status,
    brief: room.brief,
    renders: room.renders.map((rr) => ({
      angleIndex: rr.angleIndex,
      angleDescription: rr.angleDescription,
      base64: rr.base64,
      mimeType: rr.mimeType,
    })),
    materials: room.materials,
    editHistory: room.editHistory,
    version: room.version,
    usedScrapedProducts: room.usedScrapedProducts,
    selectedCatalogIds: room.selectedCatalogIds,
    plannedCatalogIds: room.plannedCatalogIds,
    phases: room.phases,
    currentPhase: room.currentPhase,
    viewpointPhases: room.viewpointPhases,
    primaryPhotoId: room.primaryPhotoId,
    viewpointErrors: room.viewpointErrors,
    photoRenderMap: room.photoRenderMap,
    viewpointTargetCount: room.viewpointTargetCount,
    gallerySyncComplete: room.gallerySyncComplete,
    lockedBaseUrl: room.lockedBaseUrl,
    stage1Validation: room.stage1Validation,
    lastRenderWarning: room.lastRenderWarning,
  };
}

/**
 * @deprecated Prefer initializeProjectAnalysis via /api/project/create-stream
 */
export async function initializeProject(input: ProjectInput): Promise<ProjectState> {
  const uploadedPhotos: ProjectUploadedPhoto[] =
    ("uploadedPhotos" in input && Array.isArray((input as AnalysisInput).uploadedPhotos)
      ? (input as AnalysisInput).uploadedPhotos
      : undefined) ??
    (input.roomPhotos ?? []).map((rp, i) => ({
      id: `photo-${i}`,
      base64: rp.base64,
      mimeType: rp.mimeType,
      label: `photo-${i}`,
      roomId: rp.roomId || undefined,
    }));

  return initializeProjectAnalysis({ ...input, uploadedPhotos });
}

// ---------------------------------------------------------------------------
// Phase 3 (phased): per-room base → furniture → decor generation
// ---------------------------------------------------------------------------

function resolveProjectStyleId(state: ProjectState): DesignStyleId {
  const raw = (state.preferences.style ?? "").trim().toLowerCase();
  const found = DESIGN_STYLES.find((s) => s.id === raw);
  return (found?.id ?? "modern") as DesignStyleId;
}

function projectStyleLabel(state: ProjectState): string {
  return state.concept?.overallStyle?.trim() || state.preferences.style || "modern";
}

/** Secondary viewpoint: one raw photo + hero design reference via the same photo-grounded Gemini path as the hero. */
async function renderSecondaryCustomViewpoint(opts: {
  state: ProjectState;
  projectId: string;
  roomId: string;
  brief: RoomDesignBrief;
  detectedRoom: DetectedRoom | undefined;
  photo: RoomPhotoWithViewpoint;
  heroRender: { base64: string; mimeType: string };
  additionalDesignReferences?: { base64: string; mimeType: string }[];
  heroViewpoint?: PhotoViewpoint;
  secondaryIndex: number;
  allRoomPhotos?: LabeledRoomPhoto[];
  galleryEdit?: {
    userEdit: string;
    framing?: ViewpointFraming | null;
    editAnnotationImage?: { base64: string; mimeType: string } | null;
  };
}): Promise<{ ok: boolean; image?: { base64: string; mimeType: string }; error?: string }> {
  const googleKey = getGoogleGenerativeAiApiKey();
  if (!googleKey) return { ok: false, error: "GOOGLE_AI_API_KEY or GEMINI_API_KEY is not configured" };

  const vpCtx = await buildViewpointPhaseContext(
    opts.state,
    opts.roomId,
    opts.photo,
    opts.detectedRoom,
    !!opts.photo.base64,
  );

  const visibleOpeningsNote = [
    vpCtx.visibleOpenings?.doorCount
      ? `${vpCtx.visibleOpenings.doorCount} door(s): ${vpCtx.visibleOpenings.doorPositions?.join("; ") ?? "see plan"}`
      : null,
    vpCtx.visibleOpenings?.windowCount
      ? `${vpCtx.visibleOpenings.windowCount} window(s): ${vpCtx.visibleOpenings.windowPositions?.join("; ") ?? "see plan"}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const conceptPrompt = buildProjectFalPrompt(opts.brief.roomName, opts.state.preferences);
  // The Claude concept may bake in the hero camera ("Camera looks down the 4.6m wall…").
  // For secondary viewpoints we MUST override with the actual camera for this photo.
  const cameraOverride = vpCtx.framing?.note
    ? `\n\nCAMERA OVERRIDE (this viewpoint, NOT the hero): ${vpCtx.framing.note} — render from THIS camera angle, matching the EDIT TARGET photo's perspective exactly. Ignore any camera description above that conflicts with this.`
    : "";
  const designPrompt = opts.galleryEdit
    ? [
        conceptPrompt,
        cameraOverride,
        buildGalleryEditPrompt(
          opts.galleryEdit.userEdit,
          opts.galleryEdit.framing,
          !!opts.galleryEdit.editAnnotationImage?.base64,
        ),
      ]
        .filter(Boolean)
        .join("\n\n")
    : (conceptPrompt ? conceptPrompt + cameraOverride : undefined);
  const structuralMetrics = opts.detectedRoom
    ? metricsFromSummarizeRoomParams(summarizeRoomParams(opts.detectedRoom), opts.brief.roomType)
    : {
        roomName: opts.brief.roomName,
        roomType: opts.brief.roomType,
        size: "unknown",
        windows: 0,
        doors: 0,
      };

  const heroFraming = opts.heroViewpoint
    ? resolveViewpointFraming(opts.heroViewpoint, opts.detectedRoom)
    : null;
  const viewpointTransferDirective = buildViewpointTransferDirective({
    referenceAngleDeg: opts.heroViewpoint?.angleDeg,
    editTargetAngleDeg: opts.photo.viewpoint?.angleDeg,
    referenceFacing: heroFraming?.facing,
    editTargetFacing: vpCtx.framing?.facing,
    heroFraming,
    editTargetFraming: vpCtx.framing,
  });

  const result = await generatePhasedRoom({
    phase: "base",
    baseImage: { base64: opts.photo.base64, mimeType: opts.photo.mimeType || "image/jpeg" },
    styleId: resolveProjectStyleId(opts.state),
    designStyleLabel: projectStyleLabel(opts.state),
    textPrompt: "",
    roomType: normalizeRoomTypeValue(opts.brief.roomType),
    roomAnalysis: vpCtx.lockAnalysis,
    roomGeometry: null,
    brief: null,
    freeRender: true,
    singlePassDesign: true,
    projectId: opts.projectId,
    roomId: opts.roomId,
    roomName: opts.brief.roomName,
    detectedRoom: opts.detectedRoom,
    marketplaceNumericIds: [],
    pinnedProductIds: opts.state.pinnedProductIds,
    previousPhaseProducts: [],
    inspirationItems: [],
    extraPromptBlock: undefined,
    floorPlanParts: await (async () => {
      if (opts.detectedRoom && (opts.detectedRoom.polygon?.length ?? 0) > 4) {
        const sch = await renderHighlightedFloorPlan(
          opts.state.analysis!.rooms,
          opts.state.analysis!.imageFrame,
          opts.detectedRoom.id,
        );
        return sch
          ? [{ base64: sch.base64, mimeType: sch.mimeType, label: `ROOM SHAPE SCHEMATIC — this room (${opts.detectedRoom.name}) is highlighted. Preserve this exact shape in the render:` }]
          : [];
      }
      return [];
    })(),
    extraRoomPhotos: undefined,
    viewpointParts: undefined,
    designReferenceImage: opts.heroRender,
    additionalDesignReferences: opts.additionalDesignReferences,
    preferencesPrompt: {
      style: opts.state.preferences.style,
      familyMembers: opts.state.preferences.familyMembers,
      budgetTier: opts.state.preferences.budgetTier,
      wishes: opts.state.preferences.wishes,
    },
    simpleDirectRender: true,
    structuralMetrics,
    openingGuideParts: vpCtx.openingGuideParts,
    photoWindowBoxes: vpCtx.photoWindowBoxes,
    photoDoorBoxes: vpCtx.photoDoorBoxes,
    photoId: opts.photo.id,
    cameraNote: vpCtx.framing?.note ?? vpCtx.cameraAngleForLock,
    visibleOpeningsNote: visibleOpeningsNote || undefined,
    allRoomPhotos: opts.allRoomPhotos,
    editTargetPhotoId: opts.photo.id,
    geminiRenderPrompt: designPrompt,
    editAnnotationImage: opts.galleryEdit?.editAnnotationImage ?? null,
    objectRemovalMask: opts.photo.objectRemovalMask ?? null,
    viewpointTransferDirective,
    googleKey,
    anthropicKey: getAnthropicApiKey() ?? undefined,
  });

  if (!result.ok || result.images.length === 0) {
    return { ok: false, error: result.error ?? "Secondary viewpoint render returned no image" };
  }
  return { ok: true, image: result.images[0] };
}

function buildRoomAnalysisJsonBlock(room: DetectedRoom | undefined): string {
  if (!room) return "";
  // Openings (windows/doors) are intentionally omitted — they are stated once,
  // authoritatively, in the OPENINGS lock. This block is the dimensions/features anchor.
  const data = {
    id: room.id,
    name: room.name,
    type: room.type,
    estimatedArea: room.estimatedArea,
    dimensions: room.dimensions,
    features: room.features,
  };
  return `ROOM STRUCTURAL DATA (authoritative — from floor plan analysis, use as ground truth for dimensions and fixed features. Window/door count and placement are defined in the OPENINGS lock below):\n${JSON.stringify(data, null, 2)}`;
}

function buildConceptPromptBlock(state: ProjectState, brief: RoomDesignBrief): string {
  const concept = state.concept!;
  const cp = concept.colorPalette;
  const mp = concept.materialPalette;
  const palette = `MASTER DESIGN CONCEPT (keep consistent across the whole home):
- Overall style: ${concept.overallStyle}
- Wall color: ${brief.wallColor.ncs} (${brief.wallColor.hex}) — paint ALL walls this exact color
- Color palette: ${cp.primary.name} ${cp.primary.hex}, ${cp.secondary.name} ${cp.secondary.hex}, accent ${cp.accent.name} ${cp.accent.hex}, neutral ${cp.neutral.name} ${cp.neutral.hex}
- Materials: wood ${mp.woodType}; metal ${mp.metalFinish}; stone ${mp.stoneType}; textile ${mp.textilePrimary}`;
  const crossRoom = buildCrossRoomConsistencyBlock(concept, state.approvedDesignSummaries);
  return [palette, crossRoom].filter(Boolean).join("\n\n");
}

function getOrCreateRoom(state: ProjectState, roomId: string, brief: RoomDesignBrief): RoomResult {
  let room = state.rooms.find((r) => r.roomId === roomId);
  if (!room) {
    room = {
      roomId,
      status: "generating",
      brief,
      renders: [],
      materials: null,
      editHistory: [],
      version: 1,
      usedScrapedProducts: [],
      phases: emptyRoomPhases(),
    };
    state.rooms.push(room);
  }
  if (!room.phases) room.phases = emptyRoomPhases();
  room.brief = brief;
  return room;
}

function selectedPhaseRender(
  phase: { versions: RenderResult[]; selectedIndex: number } | undefined,
): RenderResult | undefined {
  if (!phase || phase.versions.length === 0) return undefined;
  return phase.versions[Math.min(phase.selectedIndex, phase.versions.length - 1)];
}

function cumulativePreviousProducts(room: RoomResult, phase: DesignPhase): string[] {
  if (!room.phases) return [];
  const ids: string[] = [];
  if (phase !== "base") ids.push(...room.phases.base.confirmedCatalogIds);
  if (phase === "decor") ids.push(...room.phases.furniture.confirmedCatalogIds);
  return [...new Set(ids)];
}

/**
 * Generate (or regenerate / edit) a single design phase for one room.
 *
 * When the room has multiple photos with marked viewpoints, each viewpoint
 * gets its own independent track (base → furniture → decor). The primary
 * track drives the UI (`room.phases`); secondary tracks live in
 * `room.viewpointPhases`. Catalog validation runs on the primary only.
 */
export function generateRoomPhase(
  projectId: string,
  roomId: string,
  phase: DesignPhase,
  editFeedback?: string,
  onProgress?: ProgressCallback,
  opts?: {
    designMode?: "made" | "custom";
    editAnnotation?: EditAnnotation;
    photoId?: string;
    roomAction?: "generate" | "regenerate" | "edit";
    abortSignal?: AbortSignal;
  },
): Promise<ProjectState> {
  return runWithLogContext(projectId, () =>
    generateRoomPhaseImpl(projectId, roomId, phase, editFeedback, onProgress, opts),
  );
}

async function applyGalleryEditToRoom(
  projectId: string,
  roomId: string,
  editFeedback: string,
  onProgress?: ProgressCallback,
  _editAnnotation?: EditAnnotation,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.concept || !state.analysis) throw new Error("Project not initialized");

  const brief = state.concept.rooms.find((b) => b.roomId === roomId);
  if (!brief) throw new Error(`Room ${roomId} not found in concept`);

  const room = state.rooms.find((r) => r.roomId === roomId);
  if (!room?.phases) throw new Error("Room has not been generated");

  const targets = getViewpointGenerationTargets(state, roomId);
  const withPhoto = targets.filter((t) => t.base64);
  if (withPhoto.length === 0) throw new Error("Assign at least one room photo before editing.");

  pipelineLog("FAL_PIPELINE", "gallery edit — re-render all photos", {
    projectId,
    roomId,
    photoCount: withPhoto.length,
    userEditPreview: editFeedback.slice(0, 120),
  });

  room.status = "generating";
  await setProject(state);

  onProgress?.({
    phase: "generating",
    message: "Applying your edits…",
    progress: 0.1,
    room: brief.roomName,
  });

  const result = await generateRoomViaFalPipeline({
    state,
    projectId,
    roomId,
    room,
    brief,
    targets: withPhoto,
    editFeedback: editFeedback.trim(),
    onProgress,
  });

  if (!result.ok || room.renders.length === 0) {
    room.status = "review";
    await setProject(state);
    throw new Error(result.error ?? "Gallery edit failed");
  }

  const phaseState = room.phases.base;
  const versionIdx = Math.min(phaseState.selectedIndex, Math.max(0, phaseState.versions.length - 1));
  const hero = room.renders[0]!;
  if (phaseState.versions[versionIdx]) {
    phaseState.versions[versionIdx] = {
      ...phaseState.versions[versionIdx]!,
      base64: hero.base64,
      mimeType: hero.mimeType,
    };
  }

  const editEntry = { feedback: editFeedback, timestamp: new Date().toISOString() };
  room.editHistory.push(editEntry);
  phaseState.editHistory.push(editEntry);
  phaseState.status = "review";
  room.status = "review";
  room.gallerySyncComplete = withPhoto.length > 1;
  state.status = "reviewing";
  await setProject(state);

  onProgress?.({
    phase: "complete",
    message: "All views updated — review before approving",
    progress: 1.0,
    room: brief.roomName,
    data: { room: sanitizeRoomResult(room) },
  });
  return state;
}

// ---------------------------------------------------------------------------
// FAL-only render pipeline — Kontext multi (room + structural markup + style ref).
// ---------------------------------------------------------------------------

async function resolveMasterStyleReference(
  state: ProjectState,
  room: RoomResult,
  brief: RoomDesignBrief,
  photo: RoomPhotoWithViewpoint,
): Promise<{ base64: string; mimeType: string } | undefined> {
  const upload = state.inspirationUploads?.[0];
  if (upload?.base64) {
    return { base64: upload.base64, mimeType: upload.mimeType || "image/jpeg" };
  }
  if (room.styleReferenceCache?.base64) {
    return {
      base64: room.styleReferenceCache.base64,
      mimeType: room.styleReferenceCache.mimeType || "image/jpeg",
    };
  }

  const googleKey = getGoogleGenerativeAiApiKey();
  if (!googleKey) return undefined;

  try {
    const conceptPrompt = [
      state.concept?.overallStyle,
      brief.specialNotes,
      brief.keyDesignElements?.join(", "),
    ]
      .filter(Boolean)
      .join(". ");
    const resolved = await resolveStyleReferenceUrls({
      inspirationUploads: state.inspirationUploads ?? [],
      geminiStyleInputBase64: photo.base64,
      geminiStyleInputMime: photo.mimeType,
      conceptPrompt,
      preferences: state.preferences,
      photoId: photo.id,
      cached: room.styleReferenceCache,
      projectId: state.id,
      roomId: room.roomId,
      googleKey,
    });
    if (resolved.stylePlateBase64) {
      room.styleReferenceCache = {
        base64: resolved.stylePlateBase64,
        mimeType: resolved.stylePlateMimeType ?? "image/jpeg",
        cacheKey: resolved.cacheEntry?.cacheKey ?? "generated",
        source: "gemini",
      };
      return {
        base64: resolved.stylePlateBase64,
        mimeType: resolved.stylePlateMimeType ?? "image/jpeg",
      };
    }
  } catch (err) {
    pipelineLog("FAL_PIPELINE", "style reference resolve failed", {
      roomId: room.roomId,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    }, "warn");
  }
  return undefined;
}

async function generateRoomViaStagingPipeline(opts: {
  state: ProjectState;
  projectId: string;
  roomId: string;
  room: RoomResult;
  brief: RoomDesignBrief;
  targets: RoomPhotoWithViewpoint[];
  editFeedback?: string;
  redoPhotoId?: string;
  roomAction?: "generate" | "regenerate" | "edit";
  onProgress?: ProgressCallback;
}): Promise<{ ok: boolean; images: { base64: string; mimeType: string }[]; error?: string }> {
  const { state, projectId, roomId, room, brief, targets, editFeedback, redoPhotoId, roomAction, onProgress } = opts;

  const withPhoto = targets.filter((t) => t.base64);
  if (withPhoto.length === 0) {
    return { ok: false, images: [], error: "Assign at least one room photo before generating." };
  }

  const stagingPrompt = resolveRoomStagingPrompt(state, roomId, editFeedback?.trim());
  const plan = state.roomRenderPlans?.[roomId];
  if (!stagingPrompt && !plan?.photoPrompts?.length) {
    return { ok: false, images: [], error: "No staging prompt for this room — create design concept first." };
  }

  const masterPhotoId = withPhoto[0]?.id;
  const multiView = withPhoto.length > 1;

  let layoutLock = "";
  try {
    const lockResult = requireFurnitureLayoutLock(plan, withPhoto.length);
    layoutLock = lockResult.lock;
    if (lockResult.derived) {
      pipelineLog("FAL_PIPELINE", "furnitureLayoutLock derived from concept fallback", {
        projectId,
        roomId,
        lockPreview: layoutLock.slice(0, 80),
      }, "warn");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, images: [], error: errMsg };
  }

  const masterPhotoIdResolved = masterPhotoId!;
  const renderedPhotoIds = Object.keys(room.photoRenderMap ?? {});
  const existingHeroIdx = masterPhotoId ? room.photoRenderMap?.[masterPhotoId] : undefined;
  const existingHero =
    existingHeroIdx !== undefined ? room.renders[existingHeroIdx] : room.renders[0];

  const allowMasterRedoCascade =
    roomAction === "regenerate" &&
    !!redoPhotoId &&
    redoPhotoId === masterPhotoIdResolved;

  const { batchMode, workQueue: plannedQueue } = planStagingBatchMode({
    photoIds: withPhoto.map((p) => p.id),
    rendersCount: room.renders.length,
    renderedPhotoIds,
    redoPhotoId,
    existingHeroHasBase64: !!existingHero?.base64,
    allowMasterRedoCascade,
  });

  type StagingWorkItem = { photo: RoomPhotoWithViewpoint; mode: StagingWorkMode; globalIndex: number };

  const workQueue: StagingWorkItem[] = plannedQueue
    .map((item) => {
      const photo = withPhoto.find((p) => p.id === item.photoId);
      if (!photo) return null;
      return { photo, mode: item.mode, globalIndex: item.globalIndex };
    })
    .filter((item): item is StagingWorkItem => item != null);

  if (workQueue.length === 0) {
    return { ok: false, images: [], error: "Photo not found for render." };
  }

  if (workQueue.every((w) => w.mode === "secondary") && !existingHero?.base64) {
    return {
      ok: false,
      images: [],
      error: "Master render missing — regenerate the room before adding secondary views.",
    };
  }

  pipelineLog("FAL_PIPELINE", "staging batch planned", {
    projectId,
    roomId,
    batchMode,
    workCount: workQueue.length,
    multiView,
    photoCount: withPhoto.length,
  });

  const needsPrep = workQueue.some((w) => !!w.photo.objectRemovalMask?.base64?.trim());
  const layeredStaging = isLayeredStagingEnabled();
  pipelineLog("COST_ESTIMATE", "room staging estimate", {
    projectId,
    roomId,
    photoCount: workQueue.length,
    needsPrep,
    layeredStaging,
    estimatedUsd: estimateRoomGenerationUsd({
      photoCount: workQueue.length,
      needsPrep,
      layeredStaging,
    }),
  });

  const willRenderMaster = workQueue.some((w) => w.mode === "master");
  if (
    willRenderMaster &&
    (editFeedback?.trim() ||
      redoPhotoId === masterPhotoIdResolved ||
      (batchMode === "master-only" && room.renders.length > 0))
  ) {
    room.falRenderSeed = undefined;
    room.masterRenderPrompt = undefined;
  }

  const preserveExistingRenders =
    batchMode === "append-secondary" ||
    batchMode === "secondary-redo" ||
    batchMode === "master-redo-cascade" ||
    (batchMode === "master-only" && room.renders.length > 0);
  const newRenders: RenderResult[] = preserveExistingRenders ? [...room.renders] : [];
  if (!room.photoRenderMap) room.photoRenderMap = {};
  if (!room.viewpointErrors) room.viewpointErrors = {};

  let masterSeed = room.falRenderSeed;
  let heroBase64 = existingHero?.base64;
  let heroMime = existingHero?.mimeType ?? "image/jpeg";

  const detectedRoom = state.analysis?.rooms.find((r) => r.id === roomId);
  const persistStagingProgress = async (partialRenders: RenderResult[]) => {
    if (partialRenders.length > 0) {
      room.renders = [...partialRenders];
    }
    room.viewpointTargetCount = withPhoto.length;
    await setProject(state);
  };

  const upsertRender = (photoId: string, renderEntry: RenderResult) => {
    const existingIdx = room.photoRenderMap![photoId];
    if (existingIdx !== undefined && newRenders[existingIdx]) {
      newRenders[existingIdx] = renderEntry;
    } else {
      newRenders.push(renderEntry);
      room.photoRenderMap![photoId] = newRenders.length - 1;
    }
  };

  try {
  for (let i = 0; i < workQueue.length; i++) {
    const { photo, mode, globalIndex } = workQueue[i]!;
    const isMaster = mode === "master";
    const angleDesc =
      photo.viewpoint && detectedRoom
        ? resolveViewpointFraming(photo.viewpoint, detectedRoom)?.note ?? photo.label
        : photo.label;

    onProgress?.({
      phase: "generating",
      message: `Staging view ${globalIndex + 1} of ${withPhoto.length}${photo.label ? ` — ${photo.label}` : ""}...`,
      progress: 0.2 + (0.7 * i) / workQueue.length,
      room: brief.roomName,
    });

    try {
      room.generationStep = "workspace";
      await writeWorkspaceMeta(projectId, roomId, { status: "running", step: "workspace", renderModel: "apartment-staging" });
      await persistStagingProgress(newRenders);

      const photoBuf = Buffer.from(photo.base64, "base64");
      await writeWorkspaceFile(projectId, roomId, "original.jpg", photoBuf);
      if (photo.objectRemovalMask?.base64) {
        await writeWorkspaceFile(
          projectId,
          roomId,
          "mask.png",
          Buffer.from(photo.objectRemovalMask.base64, "base64"),
        );
      }

      room.generationStep = "prep";
      await writeWorkspaceMeta(projectId, roomId, { step: "prep" });
      await persistStagingProgress(newRenders);

      const currentPrepFp = prepFingerprint(photo);
      const prep = await applyPhotoPrepInpaint({
        projectId,
        roomId,
        photoId: photo.id,
        photoBase64: photo.base64,
        photoMime: photo.mimeType || "image/jpeg",
        maskBase64: photo.objectRemovalMask?.base64,
        openingAnalysis: photo.openingAnalysis ?? null,
        skipIfCached: true,
        prepFingerprint: currentPrepFp,
      });

      if (!prep.skipped) {
        await writePhotoStagingCacheMeta(projectId, roomId, photo.id, {
          prepFingerprint: currentPrepFp,
        });
      }

      photo.prepBase64 = prep.prepBase64;
      const uploaded = state.uploadedPhotos.find((p) => p.id === photo.id);
      if (uploaded) {
        uploaded.prepBase64 = prep.prepBase64;
        uploaded.prepMimeType = prep.prepMime;
      }
      room.lastSuccessfulStep = "prep";
      room.generationStep = "upload";
      await writeWorkspaceMeta(projectId, roomId, { step: "upload", prepComplete: true, prepSkipped: prep.skipped });
      await persistStagingProgress(newRenders);

      const prepBuf = Buffer.from(prep.prepBase64, "base64");
      const prepMeta = await sharp(prepBuf).metadata();

      pipelineLog("FAL_PIPELINE", "staging input ready", {
        projectId,
        roomId,
        photoId: photo.id,
        prepSkipped: prep.skipped,
        hasMask: !!photo.objectRemovalMask?.base64?.trim(),
        prepBytes: prepBuf.length,
        renderMode: mode,
        batchMode,
      });

      room.generationStep = "staging";
      await writeWorkspaceMeta(projectId, roomId, { step: "staging" });
      await persistStagingProgress(newRenders);

      let img: { base64: string; mimeType: string } | undefined;
      const layered = layeredStaging && !!plan;

      if (isMaster) {
        const openingLock = buildStagingOpeningLockSnippet(state, roomId, photo.id);
        const cameraNote =
          photo.viewpoint && detectedRoom
            ? resolveViewpointFraming(photo.viewpoint, detectedRoom)?.note ?? photo.label
            : photo.label;

        if (layered) {
          let shellBase64 = prep.prepBase64;
          let shellMime = prep.prepMime || "image/jpeg";
          const shellFile = shellWorkspaceFilename(photo.id);
          const finishLock = buildFinishLockFromPlan(plan);
          const currentShellFp = shellFingerprint(photo, finishLock);
          const cacheMeta = await readStagingCacheMeta(projectId, roomId);
          const storedShellFp = cacheMeta.photos[photo.id]?.shellFingerprint;
          const shellFpMismatch = storedShellFp !== currentShellFp;
          const masterRegenerate =
            batchMode === "master-only" && (room.renders.length > 0 || preserveExistingRenders);
          const skipShellCache =
            !!editFeedback?.trim() ||
            !!redoPhotoId ||
            !prep.skipped ||
            shellFpMismatch ||
            masterRegenerate;
          let shellFromCache = false;

          room.generationStep = "shell";
          await writeWorkspaceMeta(projectId, roomId, { step: "shell" });
          await persistStagingProgress(newRenders);

          if (skipShellCache) {
            await deleteWorkspaceFile(projectId, roomId, shellFile);
          }

          if (!skipShellCache && (await workspaceFileExists(projectId, roomId, shellFile))) {
            const cachedShell = await readWorkspaceFile(projectId, roomId, shellFile);
            if (cachedShell) {
              shellBase64 = cachedShell.toString("base64");
              shellMime = "image/jpeg";
              shellFromCache = true;
              if (uploaded) {
                uploaded.shellBase64 = shellBase64;
                uploaded.shellMimeType = shellMime;
              }
              pipelineLog("FAL_PIPELINE", "shell cache hit", { projectId, roomId, photoId: photo.id });
            }
          }

          const shellRenderer = resolveStagingLayerRenderer(photo, "shell");

          if (!shellFromCache) {
            const shellPrompt = assembleLayeredStagingPrompt({
              layer: "shell",
              renderer: shellRenderer,
              openingLock,
              body: buildShellStagingPrompt(plan),
            });
            const shellRendered = await renderStagingLayer({
              layer: "shell",
              photo,
              imageBase64: prep.prepBase64,
              imageMime: prep.prepMime || "image/jpeg",
              prompt: shellPrompt,
              seed: masterSeed,
              sessionId: projectId,
              roomLabel: brief.roomName,
              photoId: photo.id,
            });
            shellBase64 = shellRendered.base64;
            shellMime = shellRendered.mimeType;
            if (shellRendered.seed != null) masterSeed = shellRendered.seed;
            if (uploaded) {
              uploaded.shellBase64 = shellBase64;
              uploaded.shellMimeType = shellMime;
            }
            await writeWorkspaceFile(
              projectId,
              roomId,
              shellFile,
              Buffer.from(shellBase64, "base64"),
            );
            await writePhotoStagingCacheMeta(projectId, roomId, photo.id, {
              shellFingerprint: currentShellFp,
            });
          }

          room.generationStep = "furnish";
          await writeWorkspaceMeta(projectId, roomId, { step: "furnish" });
          await persistStagingProgress(newRenders);

          const furnishRenderer = resolveStagingLayerRenderer(photo, "furnish");
          const furnishPrompt = assembleLayeredStagingPrompt({
            layer: "furnish",
            renderer: furnishRenderer,
            openingLock,
            body: buildFurnitureStagingPrompt(plan, photo.id, cameraNote),
            editFeedback: editFeedback?.trim(),
          });
          const furnishRendered = await renderStagingLayer({
            layer: "furnish",
            photo,
            imageBase64: shellBase64,
            imageMime: shellMime,
            prompt: furnishPrompt,
            seed: masterSeed,
            sessionId: projectId,
            roomLabel: brief.roomName,
            photoId: photo.id,
          });

          if (furnishRendered.seed != null) {
            masterSeed = furnishRendered.seed;
            room.falRenderSeed = masterSeed;
            room.masterRenderPrompt = furnishPrompt;
            await writeWorkspaceSeed(
              projectId,
              roomId,
              masterSeed,
              stagingPrompt ?? furnishPrompt,
              furnishPrompt,
              { finishLock: plan.finishLock, photoPrompts: plan.photoPrompts },
            );
          }

          img = furnishRendered;
          if (img) {
            heroBase64 = img.base64;
            heroMime = img.mimeType;
          }
        } else {
          const prepUrl = await uploadPublicImage(prepBuf, prep.prepMime || "image/jpeg", {
            sessionId: projectId,
            type: "original",
            label: `staging-prep-${roomId}-${photo.id}`,
          });

          const photoPrompt =
            resolvePhotoStagingPrompt(state, roomId, photo.id, editFeedback) ?? stagingPrompt ?? "";
          const rendered = await renderApartmentStaging({
            imageUrl: prepUrl,
            prompt: photoPrompt,
            seed: masterSeed,
            sessionId: projectId,
            label: `project-${brief.roomName}-master`,
            photoId: photo.id,
            width: prepMeta.width ?? 0,
            height: prepMeta.height ?? 0,
          });

          if (rendered.seed != null) {
            masterSeed = rendered.seed;
            room.falRenderSeed = masterSeed;
            room.masterRenderPrompt = photoPrompt;
            await writeWorkspaceSeed(projectId, roomId, masterSeed, stagingPrompt ?? photoPrompt, photoPrompt, {
              finishLock: plan?.finishLock,
              photoPrompts: plan?.photoPrompts,
            });
          }

          img = rendered.images[0];
          if (img) {
            heroBase64 = img.base64;
            heroMime = img.mimeType;
          }
        }
      } else {
        if (!heroBase64) {
          throw new Error("Master render missing — cannot chain secondary viewpoint.");
        }

        pipelineLog("FAL_PIPELINE", "secondary viewpoint via renderSecondaryAngle", {
          projectId,
          roomId,
          photoId: photo.id,
          batchMode,
          falRenderSeed: masterSeed,
        });

        const openingLock = buildStagingOpeningLockSnippet(state, roomId, photo.id);
        const secondaryPrompt = plan
          ? buildSecondaryStagingPrompt(plan, layoutLock, openingLock, editFeedback?.trim())
          : clampStagingPrompt(`${layoutLock}. ${openingLock}`);
        const secondaryLabel = `project-${brief.roomName}-view-${globalIndex + 1}`;

        const renderSecondary = async (prompt: string, label: string) => {
          const rendered = await renderSecondaryAngle({
            heroBase64,
            heroMime,
            secondaryPhotoBase64: prep.prepBase64,
            secondaryPhotoMime: prep.prepMime || "image/jpeg",
            prompt,
            seed: masterSeed,
            structuralLineMapBase64: photo.structuralLineMap?.base64,
            structuralLineMapMime: photo.structuralLineMap?.mimeType,
            structuralLineStrokeOnly: photo.structuralLineMap?.strokeOnly,
            sessionId: projectId,
            label,
          });
          return rendered.images[0] ?? null;
        };

        const secondaryImage = await renderSecondary(secondaryPrompt, secondaryLabel);
        img = secondaryImage
          ? await applyCrossViewConsistencyRetry({
              image: secondaryImage,
              heroBase64,
              heroMime,
              brief,
              plan,
              label: secondaryLabel,
              retryRender: (correctiveFeedback) =>
                renderSecondary(`${secondaryPrompt}\n\n${correctiveFeedback}`, `${secondaryLabel}-crossview-retry`),
            })
          : undefined;
      }

      if (!img) {
        room.viewpointErrors[photo.id] = "Staging returned no image";
        continue;
      }

      const renderFile = isMaster ? "render-master.jpg" : `render-${photo.id}.jpg`;
      await writeWorkspaceFile(projectId, roomId, renderFile, Buffer.from(img.base64, "base64"));

      room.generationStep = "complete";
      room.lastSuccessfulStep = "staging";
      room.generationError = undefined;
      await writeWorkspaceMeta(projectId, roomId, {
        status: "complete",
        step: "staging",
        stagingComplete: true,
        prepComplete: true,
      });

      const renderEntry: RenderResult = {
        base64: img.base64,
        mimeType: img.mimeType,
        angleIndex: globalIndex,
        angleDescription: angleDesc,
        viewType: "standard",
      };

      upsertRender(photo.id, renderEntry);
      await persistStagingProgress(newRenders);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      room.viewpointErrors[photo.id] = errMsg;
      room.generationError = errMsg;
      room.generationFailedAt = new Date().toISOString();
      room.generationStep = room.lastSuccessfulStep === "prep" ? "staging" : "prep";
      await writeWorkspaceMeta(projectId, roomId, {
        status: `${room.generationStep}_failed`,
        step: room.generationStep,
        error: errMsg,
        prepComplete: await workspaceFileExists(projectId, roomId, `prep-${photo.id}.jpg`),
      });
      await persistStagingProgress(newRenders);
      if (i === 0 && newRenders.length === 0) {
        return {
          ok: false,
          images: [],
          error: errMsg,
        };
      }
    }
  }

  if (newRenders.length === 0) {
    return { ok: false, images: [], error: room.generationError || "All staging renders failed" };
  }

  room.renders = newRenders;
  room.viewpointTargetCount = withPhoto.length;
  room.gallerySyncComplete = withPhoto.length <= 1 || newRenders.length >= withPhoto.length;
  room.generationStep = "complete";
  await setProject(state);

  onProgress?.({ phase: "generating", message: "Finalizing...", progress: 0.95, room: brief.roomName });

  const heroIdx = masterPhotoId ? room.photoRenderMap[masterPhotoId] : 0;
  const heroRender = newRenders[heroIdx ?? 0] ?? newRenders[0]!;

  return {
    ok: true,
    images: [{ base64: heroRender.base64, mimeType: heroRender.mimeType }],
  };
  } finally {
    if (newRenders.length > 0 && room.renders.length < newRenders.length) {
      room.renders = [...newRenders];
      room.viewpointTargetCount = withPhoto.length;
      try {
        await setProject(state);
      } catch (persistErr) {
        pipelineLog(
          "STATE_PERSIST",
          "best-effort persist on unexpected exit failed",
          { projectId, roomId, error: String(persistErr).slice(0, 200) },
          "warn",
        );
      }
    }
  }
}

// Retry-ladder policy helpers live in editRetryPolicy.ts (shared with the
// Quick Room edit pipeline).

function resolveOpeningBoxCountsFromPhoto(
  photo: RoomPhotoWithViewpoint,
  framing: ViewpointFraming | null,
): { windows: number; doors: number } | undefined {
  if (photo.openingAnalysis) {
    return {
      windows: photo.openingAnalysis.window_boxes?.length ?? 0,
      doors: photo.openingAnalysis.door_boxes?.length ?? 0,
    };
  }
  return framingFallbackOpeningCounts(framing);
}

async function ensurePhotoOpeningAnalysis(opts: {
  state: ProjectState;
  photo: RoomPhotoWithViewpoint;
  framing: ViewpointFraming | null;
  projectId: string;
  roomId: string;
}): Promise<void> {
  const { state, photo, framing, projectId, roomId } = opts;
  if (photo.openingAnalysis) return;

  const result = await analyzePhotoOpenings({
    photoBase64: photo.base64,
    photoMime: photo.mimeType,
    photoId: photo.id,
    projectId,
    roomId,
  });
  if (!result) return;

  photo.openingAnalysis = result;
  const uploaded = state.uploadedPhotos.find((p) => p.id === photo.id);
  if (uploaded) {
    uploaded.openingAnalysis = result;
  }
  await setProject(state);

  const framingCounts = framingFallbackOpeningCounts(framing);
  if (framingCounts) {
    const photoWindows = result.window_boxes.length;
    const photoDoors = result.door_boxes.length;
    if (photoWindows !== framingCounts.windows || photoDoors !== framingCounts.doors) {
      pipelineLog(
        "ROOM_OPENINGS",
        "photo opening counts disagree with floor-plan framing",
        {
          photoId: photo.id,
          projectId,
          roomId,
          photoWindows,
          photoDoors,
          framingWindows: framingCounts.windows,
          framingDoors: framingCounts.doors,
        },
        "warn",
      );
    }
  }
}

/** Fire-and-forget opening analysis for all uploaded photos (warms cache before generation). */
function prefetchPhotoOpeningAnalyses(state: ProjectState, projectId: string): void {
  const photos = state.uploadedPhotos.filter((p) => p.base64?.trim() && !p.openingAnalysis);
  if (photos.length === 0) return;

  void (async () => {
    await Promise.allSettled(
      photos.map(async (photo) => {
        const result = await analyzePhotoOpenings({
          photoBase64: photo.base64,
          photoMime: photo.mimeType,
          photoId: photo.id,
          projectId,
          roomId: photo.roomId,
        });
        if (!result) return;
        const fresh = await getProject(projectId);
        if (!fresh) return;
        const uploaded = fresh.uploadedPhotos.find((p) => p.id === photo.id);
        if (!uploaded || uploaded.openingAnalysis) return;
        uploaded.openingAnalysis = result;
        await setProject(fresh);
        pipelineLog("ROOM_OPENINGS", "prefetched photo opening analysis", {
          projectId,
          photoId: photo.id,
          windows: result.window_boxes.length,
          doors: result.door_boxes.length,
        });
      }),
    );
  })();
}

async function generateRoomViaEditPipeline(opts: {
  state: ProjectState;
  projectId: string;
  roomId: string;
  room: RoomResult;
  brief: RoomDesignBrief;
  targets: RoomPhotoWithViewpoint[];
  editFeedback?: string;
  editAnnotation?: EditAnnotation;
  redoPhotoId?: string;
  roomAction?: "generate" | "regenerate" | "edit";
  onProgress?: ProgressCallback;
  abortSignal?: AbortSignal;
}): Promise<{ ok: boolean; images: { base64: string; mimeType: string }[]; error?: string }> {
  const {
    state,
    projectId,
    roomId,
    room,
    brief,
    targets,
    editFeedback,
    editAnnotation,
    redoPhotoId,
    roomAction,
    onProgress,
  } = opts;
  const pipelineStart = Date.now();
  let validationsFailed = 0;
  let retries = 0;

  const withPhoto = targets.filter((t) => t.base64);
  if (withPhoto.length === 0) {
    return { ok: false, images: [], error: "Assign at least one room photo before generating." };
  }

  const plan = state.roomRenderPlans?.[roomId];
  if (!plan?.designConcept?.trim() && !plan?.photoPrompts?.some((p) => p.renderInstruction?.trim())) {
    return { ok: false, images: [], error: "No render instructions for this room — create design concept first." };
  }
  if (!plan) {
    return { ok: false, images: [], error: "No render plan for this room." };
  }

  const masterPhotoId = withPhoto[0]?.id;

  let layoutLock = "";
  try {
    const lockResult = requireFurnitureLayoutLock(plan, withPhoto.length);
    layoutLock = lockResult.lock;
    if (lockResult.derived) {
      pipelineLog("FAL_PIPELINE", "furnitureLayoutLock derived from concept fallback", {
        projectId,
        roomId,
        lockPreview: layoutLock.slice(0, 80),
      }, "warn");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, images: [], error: errMsg };
  }

  const masterPhotoIdResolved = masterPhotoId!;
  const renderedPhotoIds = Object.keys(room.photoRenderMap ?? {});
  const existingHeroIdx = masterPhotoId ? room.photoRenderMap?.[masterPhotoId] : undefined;
  const existingHero =
    existingHeroIdx !== undefined ? room.renders[existingHeroIdx] : room.renders[0];

  const allowMasterRedoCascade =
    roomAction === "regenerate" &&
    !!redoPhotoId &&
    redoPhotoId === masterPhotoIdResolved;

  const { batchMode, workQueue: plannedQueue } = planStagingBatchMode({
    photoIds: withPhoto.map((p) => p.id),
    rendersCount: room.renders.length,
    renderedPhotoIds,
    redoPhotoId,
    existingHeroHasBase64: !!existingHero?.base64,
    allowMasterRedoCascade,
  });

  type EditWorkItem = { photo: RoomPhotoWithViewpoint; mode: StagingWorkMode; globalIndex: number };

  const workQueue: EditWorkItem[] = plannedQueue
    .map((item) => {
      const photo = withPhoto.find((p) => p.id === item.photoId);
      if (!photo) return null;
      return { photo, mode: item.mode, globalIndex: item.globalIndex };
    })
    .filter((item): item is EditWorkItem => item != null);

  if (workQueue.length === 0) {
    return { ok: false, images: [], error: "Photo not found for render." };
  }

  if (workQueue.every((w) => w.mode === "secondary") && !existingHero?.base64) {
    return {
      ok: false,
      images: [],
      error: "Master render missing — regenerate the room before adding secondary views.",
    };
  }

  pipelineLog("FAL_PIPELINE", "edit pipeline batch planned", {
    projectId,
    roomId,
    batchMode,
    workCount: workQueue.length,
    photoCount: withPhoto.length,
    styleReferenceAttached: (state.inspirationUploads ?? []).some((u) => u.base64?.trim()),
  });

  const preserveExistingRenders =
    batchMode === "append-secondary" ||
    batchMode === "secondary-redo" ||
    batchMode === "master-redo-cascade" ||
    (batchMode === "master-only" && room.renders.length > 0);
  const newRenders: RenderResult[] = preserveExistingRenders ? [...room.renders] : [];
  if (!room.photoRenderMap) room.photoRenderMap = {};
  if (!room.viewpointErrors) room.viewpointErrors = {};

  let heroBase64 = existingHero?.base64;
  let heroMime = existingHero?.mimeType ?? "image/png";

  const detectedRoom = state.analysis?.rooms.find((r) => r.id === roomId);
  // User's style reference photo rides along on the master render as a second
  // input image (geometry still comes only from the room photo — see
  // MASTER_STYLE_REF_IMAGE_ROLES in the prompt).
  const styleRefUpload = (state.inspirationUploads ?? []).find((u) => u.base64?.trim());
  const masterStyleRef = styleRefUpload
    ? await optimizedImagePart({
        base64: styleRefUpload.base64,
        mimeType: styleRefUpload.mimeType || "image/jpeg",
      })
    : undefined;

  const persistEditProgress = async (partialRenders: RenderResult[]) => {
    if (partialRenders.length > 0) {
      room.renders = [...partialRenders];
    }
    room.viewpointTargetCount = withPhoto.length;
    await setProject(state);
  };

  const upsertRender = (photoId: string, renderEntry: RenderResult) => {
    const existingIdx = room.photoRenderMap![photoId];
    if (existingIdx !== undefined && newRenders[existingIdx]) {
      newRenders[existingIdx] = renderEntry;
    } else {
      newRenders.push(renderEntry);
      room.photoRenderMap![photoId] = newRenders.length - 1;
    }
  };

  let renderUpsertChain: Promise<void> = Promise.resolve();
  const upsertRenderAsync = async (photoId: string, renderEntry: RenderResult) => {
    renderUpsertChain = renderUpsertChain.then(() => {
      upsertRender(photoId, renderEntry);
    });
    await renderUpsertChain;
  };

  type EditGenerationStep = NonNullable<typeof room.generationStep>;

  const emitEditProgress = async (
    step: EditGenerationStep,
    message: string,
    withinPhotoFrac: number,
    viewIndex: number,
    persist = false,
  ) => {
    const viewTotal = withPhoto.length;
    const overall = (viewIndex + Math.min(1, Math.max(0, withinPhotoFrac))) / viewTotal;
    const progress = Math.min(0.98, Math.max(0.03, overall * 0.92 + 0.05));
    room.generationStep = step;
    if (persist) await persistEditProgress(newRenders);
    onProgress?.({
      phase: "generating",
      message,
      progress,
      room: brief.roomName,
      angleIndex: viewIndex,
      data: { generationStep: step, viewIndex: viewIndex + 1, viewTotal },
    });
  };

  const runEditWithValidation = async (
    input: {
      photo: RoomPhotoWithViewpoint;
      isMaster: boolean;
      prepBase64: string;
      prepMime: string;
      prompt: string;
      globalIndex: number;
      attempt: number;
      openingBoxCounts?: { windows: number; doors: number };
      /** False on the hero-copy escalation attempt: send only the photo, no hero image. */
      attachHero?: boolean;
      /** Rebuilds the secondary prompt for a hero-free call (no "SECOND image" references). */
      rebuildPromptWithoutHero?: () => string;
      onBeforeValidate?: () => Promise<void>;
      /** Retry only failed validation sub-checks from the prior attempt. */
      validationOnlyChecks?: import("./renderValidation").ValidationCheck[];
    },
    attemptRecords: EditAttemptRecord[] = [],
  ): Promise<{
    base64: string;
    mimeType: string;
    validationPassed: boolean;
    heroAnalysis?: import("./heroPlacementMap").HeroMasterAnalysis;
  } | null> => {
    const {
      photo,
      isMaster,
      prepBase64,
      prepMime,
      prompt,
      globalIndex,
      attempt,
      openingBoxCounts,
    } = input;
    const attachHero = input.attachHero !== false;
    const imageBase64List = isMaster
      ? masterStyleRef
        ? [prepBase64, masterStyleRef.base64]
        : [prepBase64]
      : heroBase64 && attachHero
        ? [prepBase64, heroBase64]
        : [prepBase64];
    const imageMimeList = isMaster
      ? masterStyleRef
        ? [prepMime, masterStyleRef.mimeType]
        : [prepMime]
      : heroBase64 && attachHero
        ? [prepMime, heroMime]
        : [prepMime];

    const acceptBestFailedAttempt = (
      reason: string,
      correctiveFeedback?: string,
    ): { base64: string; mimeType: string; validationPassed: boolean } => {
      const best = pickBestEditAttempt(attemptRecords);
      pipelineLog(
        "VALIDATE",
        "render accepted with validation warnings (best attempt)",
        {
          photoId: photo.id,
          reason: reason.slice(0, 200),
          chosenAttempt: best.attempt,
          attemptCount: attemptRecords.length,
          failureTypes: best.validation.failureTypes,
        },
        "warn",
      );
      room.lastRenderWarning = isMaster
        ? "The main view was accepted with a consistency warning — use Redo this view if it looks wrong."
        : `View ${globalIndex + 1} was accepted with a consistency warning — use Redo this view if it looks wrong.`;
      const storedFeedback = (correctiveFeedback ?? best.validation.correctiveFeedback ?? best.validation.reason)?.trim();
      if (storedFeedback) {
        room.lastValidationFeedback = {
          ...room.lastValidationFeedback,
          [photo.id]: storedFeedback,
        };
      }
      return { ...best.rendered, validationPassed: false };
    };

    const stageStart = Date.now();
    let rendered: { base64: string; mimeType: string };
    try {
      rendered = await renderEditStaging({
        imageBase64List,
        imageMimeList,
        prompt,
        projectId,
        roomId,
        photoId: photo.id,
        stage: isMaster ? "master" : "secondary",
        sessionId: projectId,
        label: `project-${brief.roomName}-${isMaster ? "master" : `view-${globalIndex + 1}`}`,
      });
    } catch (err) {
      logPipelineStage({
        projectId,
        roomId,
        photoId: photo.id,
        stage: isMaster ? "master" : "secondary",
        ok: false,
        ms: Date.now() - stageStart,
        endpoint: "fal-ai/nano-banana-pro/edit",
        retry: attempt,
        errorCode: "render_failed",
        extra: { error: String(err).slice(0, 200) },
      });
      throw err;
    }

    const framing =
      photo.viewpoint && detectedRoom
        ? resolveViewpointFraming(photo.viewpoint, detectedRoom)
        : null;

    await input.onBeforeValidate?.();

    // Deterministic hero-copy gate: nano-banana sometimes returns the master
    // design reference (image 2) re-rendered instead of editing this photo
    // (image 1) — the GPT judge below misses that. Catch it cheaply first.
    // Skipped when the hero image wasn't attached — nothing to copy.
    if (!isMaster && heroBase64 && attachHero && isHeroCopyGuardEnabled()) {
      const copyCheck = await detectHeroCopy({
        outputBase64: rendered.base64,
        heroBase64,
        editTargetBase64: prepBase64,
      });
      if (copyCheck.detected) {
        validationsFailed++;
        const heroCopyValidation: RenderValidationResult = {
          pass: false,
          reason: "secondary render copied the hero design reference",
          failureTypes: ["hero_copy"],
          correctiveFeedback:
            "CORRECTION: Your previous output reproduced the SECOND image (the master design) with its camera and composition. That is wrong. The output MUST keep the FIRST image's camera angle, walls, and openings exactly — the FIRST image is the photo to edit; the SECOND image is only a furniture/finish/palette reference.",
          failedChecks: ["judge"],
        };
        attemptRecords.push({
          attempt,
          rendered,
          validation: heroCopyValidation,
          validationPassed: false,
        });
        logPipelineStage({
          projectId,
          roomId,
          photoId: photo.id,
          stage: "validate",
          ok: false,
          ms: Date.now() - stageStart,
          errorCode: "hero_copy",
          retry: attempt,
          extra: {
            heroCorrelation: Number(copyCheck.heroCorrelation.toFixed(3)),
            editTargetCorrelation: Number(copyCheck.editTargetCorrelation.toFixed(3)),
          },
        });
        pipelineLog(
          "VALIDATE",
          "secondary render copied the hero design reference",
          {
            photoId: photo.id,
            attempt,
            heroCorrelation: Number(copyCheck.heroCorrelation.toFixed(3)),
            editTargetCorrelation: Number(copyCheck.editTargetCorrelation.toFixed(3)),
          },
          "warn",
        );
        const heroCopyCorrection = heroCopyValidation.correctiveFeedback!;
        const retryLimit = resolveEditRetryLimit(heroCopyValidation.failureTypes);
        if (attempt < retryLimit) {
          retries++;
          const isFinalStructuralAttempt = attempt + 1 === retryLimit;
          if (isFinalStructuralAttempt && input.rebuildPromptWithoutHero) {
            pipelineLog("FAL_PIPELINE", "hero copy persisted — retrying without hero image", {
              projectId,
              roomId,
              photoId: photo.id,
              attempt: attempt + 1,
            });
            const geometryAnchor = buildGeometryAnchorSentence(openingBoxCounts);
            const heroFreePrompt = input.rebuildPromptWithoutHero();
            const anchorPrompt = [geometryAnchor, heroFreePrompt].filter(Boolean).join(" ");
            return runEditWithValidation(
              {
                ...input,
                prompt: anchorPrompt,
                attachHero: false,
                attempt: attempt + 1,
                validationOnlyChecks: heroCopyValidation.failedChecks,
              },
              attemptRecords,
            );
          }
          return runEditWithValidation(
            {
              ...input,
              prompt: `${prompt} ${heroCopyCorrection}`,
              attempt: attempt + 1,
              validationOnlyChecks: heroCopyValidation.failedChecks,
            },
            attemptRecords,
          );
        }
        return acceptBestFailedAttempt("hero_copy after max attempts", heroCopyCorrection);
      }
    }

    const validation = await validateProjectRender({
      mode: isMaster ? "master" : "secondary",
      originalBase64: photo.base64,
      originalMime: photo.mimeType || "image/jpeg",
      renderedBase64: rendered.base64,
      renderedMime: rendered.mimeType,
      windowBoxes: photo.openingAnalysis?.window_boxes,
      doorBoxes: photo.openingAnalysis?.door_boxes,
      detectedRoom,
      framing,
      hadRemovalMask: !!photo.objectRemovalMask?.base64?.trim(),
      heroBase64: isMaster ? undefined : heroBase64,
      heroMime: isMaster ? undefined : heroMime,
      projectId,
      roomId,
      photoId: photo.id,
      label: `${isMaster ? "master" : "secondary"}-attempt-${attempt}`,
      furnitureLabels: brief.furnitureList?.length ? brief.furnitureList : plan?.furnitureList,
      onlyChecks: input.validationOnlyChecks,
      extractHeroAnalysis: isMaster && isHeroPlacementMapEnabled(),
      heroFraming:
        isMaster && photo.viewpoint && detectedRoom
          ? resolveViewpointFraming(photo.viewpoint, detectedRoom)
          : null,
      expectedFurnitureList: plan?.furnitureList,
    });

    attemptRecords.push({
      attempt,
      rendered,
      validation,
      validationPassed: validation.pass,
    });

    if (!validation.pass) {
      validationsFailed++;
      const retryLimit = resolveEditRetryLimit(validation.failureTypes);
      if (attempt < retryLimit) {
        retries++;
        const shouldDropHero =
          !isMaster &&
          attachHero &&
          input.rebuildPromptWithoutHero &&
          validation.failureTypes.some((t) => STRUCTURAL_RETRY_ESCALATION_TYPES.has(t));

        if (shouldDropHero) {
          pipelineLog("FAL_PIPELINE", "structural drift — retrying without hero image", {
            projectId,
            roomId,
            photoId: photo.id,
            attempt: attempt + 1,
            failureTypes: validation.failureTypes,
          });
          const geometryAnchor = buildGeometryAnchorSentence(openingBoxCounts);
          const heroFreePrompt = input.rebuildPromptWithoutHero!();
          const anchorPrompt = [geometryAnchor, heroFreePrompt].filter(Boolean).join(" ");
          return runEditWithValidation(
            {
              ...input,
              prompt: anchorPrompt,
              attachHero: false,
              attempt: attempt + 1,
              validationOnlyChecks: validation.failedChecks,
            },
            attemptRecords,
          );
        }

        const corrective = validation.correctiveFeedback ?? validation.reason;
        const geometryAnchor = hasStructuralFailure(validation.failureTypes)
          ? buildGeometryAnchorSentence(openingBoxCounts)
          : "";
        const retryPrompt = [prompt, geometryAnchor, corrective ? `CORRECTION: ${corrective}` : ""]
          .filter(Boolean)
          .join(" ");
        return runEditWithValidation(
          {
            ...input,
            prompt: retryPrompt,
            attempt: attempt + 1,
            validationOnlyChecks: validation.failedChecks,
          },
          attemptRecords,
        );
      }
      return acceptBestFailedAttempt(
        validation.reason,
        validation.correctiveFeedback ?? validation.reason,
      );
    }

    if (room.lastValidationFeedback?.[photo.id]) {
      delete room.lastValidationFeedback[photo.id];
    }
    return { ...rendered, validationPassed: true, heroAnalysis: validation.heroAnalysis };
  };

  const buildHeroMasterAnalysis = async (base64: string, mime: string) => {
    const heroPhoto = withPhoto[0];
    const heroFraming =
      heroPhoto?.viewpoint && detectedRoom
        ? resolveViewpointFraming(heroPhoto.viewpoint, detectedRoom)
        : null;
    return describeHeroFurniturePlacement({
      heroBase64: base64,
      heroMime: mime,
      furnitureList: plan.furnitureList,
      heroFraming,
      projectId,
      roomId,
    });
  };

  // Gallery refine: modify an existing generated render in-place (not from the room photo).
  if (roomAction === "edit" && editFeedback?.trim()) {
    let targetPhotoId = redoPhotoId;
    if (!targetPhotoId && editAnnotation?.renderIndex != null) {
      targetPhotoId = Object.entries(room.photoRenderMap ?? {}).find(
        ([, idx]) => idx === editAnnotation.renderIndex,
      )?.[0];
    }
    if (!targetPhotoId && withPhoto.length === 1) {
      targetPhotoId = withPhoto[0]!.id;
    }
    if (!targetPhotoId) {
      targetPhotoId = masterPhotoId;
    }

    const targetPhoto = targetPhotoId ? withPhoto.find((p) => p.id === targetPhotoId) : undefined;
    const renderIdx = targetPhotoId ? room.photoRenderMap?.[targetPhotoId] : undefined;
    const currentRender = renderIdx !== undefined ? room.renders[renderIdx] : undefined;

    if (targetPhoto && targetPhotoId && currentRender?.base64) {
      const isMasterRefine = targetPhotoId === masterPhotoIdResolved;
      const globalIndex = Math.max(0, withPhoto.findIndex((p) => p.id === targetPhotoId));
      const photoFraming =
        targetPhoto.viewpoint && detectedRoom
          ? resolveViewpointFraming(targetPhoto.viewpoint, detectedRoom)
          : null;
      const angleDesc = photoFraming?.note ?? targetPhoto.label;
      const hasAnnotation = !!editAnnotation?.base64?.trim();

      pipelineLog("FAL_PIPELINE", "gallery refine edit — in-place render modification", {
        projectId,
        roomId,
        photoId: targetPhotoId,
        isMaster: isMasterRefine,
        hasAnnotation,
        userEditPreview: editFeedback.trim().slice(0, 120),
      });

      await emitEditProgress(
        "staging",
        hasAnnotation ? "Applying edit to marked areas…" : "Applying your edit…",
        0.3,
        globalIndex,
        true,
      );

      let refinePrompt = buildGalleryEditPrompt(editFeedback.trim(), photoFraming, hasAnnotation);
      if (hasAnnotation) {
        refinePrompt = `${EDIT_ANNOTATION_MARKER_PROMPT}\n\n${refinePrompt}`;
      }

      const refineImageBase64List = [currentRender.base64];
      const refineImageMimeList = [currentRender.mimeType || "image/png"];
      if (hasAnnotation && editAnnotation) {
        refineImageBase64List.push(editAnnotation.base64);
        refineImageMimeList.push(editAnnotation.mimeType || "image/png");
      }

      const runRefineAttempt = async (
        attempt: number,
        prompt: string,
        attemptRecords: EditAttemptRecord[] = [],
      ): Promise<{ base64: string; mimeType: string; validationPassed: boolean } | null> => {
        const stageStart = Date.now();
        let rendered: { base64: string; mimeType: string };
        try {
          rendered = await renderEditStaging({
            imageBase64List: refineImageBase64List,
            imageMimeList: refineImageMimeList,
            prompt,
            projectId,
            roomId,
            photoId: targetPhotoId,
            stage: isMasterRefine ? "master" : "secondary",
            sessionId: projectId,
            label: `project-${brief.roomName}-refine-${isMasterRefine ? "master" : `view-${globalIndex + 1}`}`,
          });
        } catch (err) {
          logPipelineStage({
            projectId,
            roomId,
            photoId: targetPhotoId,
            stage: isMasterRefine ? "master" : "secondary",
            ok: false,
            ms: Date.now() - stageStart,
            endpoint: "fal-ai/nano-banana-pro/edit",
            retry: attempt,
            errorCode: "refine_render_failed",
            extra: { error: String(err).slice(0, 200) },
          });
          throw err;
        }

        await emitEditProgress(
          "validate",
          "Checking refined render…",
          0.82,
          globalIndex,
          true,
        );

        const validation = await validateProjectRender({
          mode: isMasterRefine ? "master" : "secondary",
          originalBase64: targetPhoto.base64,
          originalMime: targetPhoto.mimeType || "image/jpeg",
          renderedBase64: rendered.base64,
          renderedMime: rendered.mimeType,
          windowBoxes: targetPhoto.openingAnalysis?.window_boxes,
          doorBoxes: targetPhoto.openingAnalysis?.door_boxes,
          detectedRoom,
          framing: photoFraming,
          hadRemovalMask: !!targetPhoto.objectRemovalMask?.base64?.trim(),
          heroBase64: isMasterRefine ? undefined : heroBase64,
          heroMime: isMasterRefine ? undefined : heroMime,
          projectId,
          roomId,
          photoId: targetPhotoId,
          label: `refine-${isMasterRefine ? "master" : "secondary"}-attempt-${attempt}`,
          furnitureLabels: brief.furnitureList?.length ? brief.furnitureList : plan?.furnitureList,
        });

        attemptRecords.push({
          attempt,
          rendered,
          validation,
          validationPassed: validation.pass,
        });

        if (!validation.pass) {
          validationsFailed++;
          const retryLimit = resolveEditRetryLimit(validation.failureTypes);
          if (attempt < retryLimit) {
            retries++;
            const corrective = validation.correctiveFeedback ?? validation.reason;
            const retryPrompt = [prompt, corrective ? `CORRECTION: ${corrective}` : ""]
              .filter(Boolean)
              .join(" ");
            return runRefineAttempt(attempt + 1, retryPrompt, attemptRecords);
          }
          const best = pickBestEditAttempt(attemptRecords);
          room.lastRenderWarning = isMasterRefine
            ? "The edit was accepted with a consistency warning — try again if it looks wrong."
            : `View ${globalIndex + 1} edit was accepted with a warning — try again if it looks wrong.`;
          return { ...best.rendered, validationPassed: false };
        }

        if (room.lastValidationFeedback?.[targetPhotoId]) {
          delete room.lastValidationFeedback[targetPhotoId];
        }
        return { ...rendered, validationPassed: true };
      };

      try {
        const img = await runRefineAttempt(0, refinePrompt);
        if (!img) {
          return { ok: false, images: [], error: "Refine edit returned no image" };
        }

        if (isMasterRefine) {
          heroBase64 = img.base64;
          heroMime = img.mimeType;
          const analysis = await buildHeroMasterAnalysis(img.base64, img.mimeType);
          room.heroPlacementMap = analysis.placementMap ?? undefined;
          room.heroDecorLock = analysis.decorLock ?? undefined;
        }

        const renderEntry: RenderResult = {
          base64: img.base64,
          mimeType: img.mimeType,
          angleIndex: globalIndex,
          angleDescription: angleDesc,
          viewType: "standard",
          ...(img.validationPassed === false ? { notConfirmed: true } : {}),
        };

        upsertRender(targetPhotoId, renderEntry);
        room.renders = [...newRenders];
        room.viewpointTargetCount = withPhoto.length;
        room.generationStep = "complete";
        room.generationError = undefined;
        room.lastSuccessfulStep = "staging";
        room.status = "review";

        const renderFile = isMasterRefine ? "render-master.jpg" : `render-${targetPhotoId}.jpg`;
        await writeWorkspaceFile(projectId, roomId, renderFile, Buffer.from(img.base64, "base64"));
        await setProject(state);

        logRoomPipelineSummary({
          projectId,
          roomId,
          roomName: brief.roomName,
          viewsRendered: newRenders.length,
          viewsTarget: withPhoto.length,
          validationsFailed,
          retries,
          totalMs: Date.now() - pipelineStart,
        });

        await emitEditProgress(
          "complete",
          "Edit applied — review the updated design",
          0.95,
          globalIndex,
          true,
        );

        const heroIdx = masterPhotoId ? room.photoRenderMap![masterPhotoId] : 0;
        const heroRender = newRenders[heroIdx ?? 0] ?? newRenders[0]!;
        return {
          ok: true,
          images: [{ base64: heroRender.base64, mimeType: heroRender.mimeType }],
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        pipelineLog(
          "FAL_PIPELINE",
          "gallery refine edit failed",
          { projectId, roomId, photoId: targetPhotoId, error: errMsg.slice(0, 200) },
          "warn",
        );
        return { ok: false, images: [], error: errMsg };
      }
    }
  }

  try {
    room.lastRenderWarning = undefined;

    // Backfill the placement map and decor lock for secondary-only batches (append/redo) on
    // projects whose master render predates the map.
    if (
      !workQueue.some((w) => w.mode === "master") &&
      workQueue.some((w) => w.mode === "secondary") &&
      (!room.heroPlacementMap || !room.heroDecorLock) &&
      heroBase64
    ) {
      const analysis = await buildHeroMasterAnalysis(heroBase64, heroMime);
      if (!room.heroPlacementMap) {
        room.heroPlacementMap = analysis.placementMap ?? undefined;
      }
      if (!room.heroDecorLock) {
        room.heroDecorLock = analysis.decorLock ?? undefined;
      }
    }
    const SECONDARY_RENDER_PARALLEL = 2;

    const processWorkQueueIndex = async (i: number): Promise<void> => {
      throwIfGenerationAborted(opts.abortSignal);
      const { photo, mode, globalIndex } = workQueue[i]!;
      const isMaster = mode === "master";
      const angleDesc =
        photo.viewpoint && detectedRoom
          ? resolveViewpointFraming(photo.viewpoint, detectedRoom)?.note ?? photo.label
          : photo.label;

      const viewNum = globalIndex + 1;
      const viewTotal = withPhoto.length;
      const viewLabel = photo.label ? ` — ${photo.label}` : "";

      try {
        await emitEditProgress(
          "workspace",
          `Preparing view ${viewNum} of ${viewTotal}${viewLabel}…`,
          0,
          globalIndex,
          true,
        );
        await writeWorkspaceMeta(projectId, roomId, { status: "running", step: "workspace", renderModel: "edit-pipeline" });

        const photoFraming =
          photo.viewpoint && detectedRoom
            ? resolveViewpointFraming(photo.viewpoint, detectedRoom)
            : null;

        await ensurePhotoOpeningAnalysis({
          state,
          photo,
          framing: photoFraming,
          projectId,
          roomId,
        });

        const photoBuf = Buffer.from(photo.base64, "base64");
        await writeWorkspaceFile(projectId, roomId, "original.jpg", photoBuf);
        if (photo.objectRemovalMask?.base64) {
          await writeWorkspaceFile(
            projectId,
            roomId,
            "mask.png",
            Buffer.from(photo.objectRemovalMask.base64, "base64"),
          );
        }

        await emitEditProgress(
          "prep",
          `Removing marked objects — view ${viewNum} of ${viewTotal}${viewLabel}…`,
          0.05,
          globalIndex,
          true,
        );
        await writeWorkspaceMeta(projectId, roomId, { step: "prep" });

        const eraseStart = Date.now();
        const currentPrepFp = prepFingerprint(photo);
        const prep = await applyPhotoPrepErase({
          projectId,
          roomId,
          photoId: photo.id,
          photoBase64: photo.base64,
          photoMime: photo.mimeType || "image/jpeg",
          maskBase64: photo.objectRemovalMask?.base64,
          openingAnalysis: photo.openingAnalysis ?? null,
          skipIfCached: true,
          prepFingerprint: currentPrepFp,
        });

        logPipelineStage({
          projectId,
          roomId,
          photoId: photo.id,
          stage: "erase",
          ok: true,
          ms: Date.now() - eraseStart,
          endpoint: "fal-ai/flux-pro/v1/erase",
          extra: { skipped: prep.skipped },
        });

        if (!prep.skipped) {
          await writePhotoStagingCacheMeta(projectId, roomId, photo.id, {
            prepFingerprint: currentPrepFp,
          });
        }

        photo.prepBase64 = prep.prepBase64;
        const uploaded = state.uploadedPhotos.find((p) => p.id === photo.id);
        if (uploaded) {
          uploaded.prepBase64 = prep.prepBase64;
          uploaded.prepMimeType = prep.prepMime;
        }
        room.lastSuccessfulStep = "prep";
        await emitEditProgress(
          "prep",
          `Prep complete — view ${viewNum} of ${viewTotal}${viewLabel}`,
          0.2,
          globalIndex,
        );
        await emitEditProgress(
          "staging",
          `Rendering view ${viewNum} of ${viewTotal}${viewLabel} — usually ~40s`,
          0.25,
          globalIndex,
          true,
        );
        await writeWorkspaceMeta(projectId, roomId, { step: "staging", prepComplete: true, prepSkipped: prep.skipped });

        const cameraNote = photoFraming?.note ?? photo.label;

        const openingBoxCounts = resolveOpeningBoxCountsFromPhoto(photo, photoFraming);

        const masterInstruction =
          resolvePhotoRenderInstruction(state, roomId, photo.id, editFeedback?.trim(), !!masterStyleRef) ??
          buildMasterRenderInstruction(plan, photo.id, cameraNote, editFeedback?.trim(), openingBoxCounts, !!masterStyleRef);

        const heroPhoto = withPhoto[0];
        const secondaryViewpointCtx = {
          photoId: photo.id,
          heroViewpoint: heroPhoto?.viewpoint,
          secondaryViewpoint: photo.viewpoint,
          detectedRoom,
          heroPlacementMap: room.heroPlacementMap,
          heroDecorLock: room.heroDecorLock,
        };
        const secondaryInstruction = buildSecondaryRenderInstruction(
          plan,
          cameraNote,
          editFeedback?.trim(),
          openingBoxCounts,
          secondaryViewpointCtx,
        );

        if (!isMaster && heroPhoto?.viewpoint && photo.viewpoint) {
          const oppositeCamera = areViewpointsRoughlyOpposite(
            heroPhoto.viewpoint.angleDeg,
            photo.viewpoint.angleDeg,
          );
          pipelineLog("FAL_PIPELINE", "secondary prompt viewpoint transfer", {
            projectId,
            roomId,
            photoId: photo.id,
            heroAngleDeg: heroPhoto.viewpoint.angleDeg,
            secondaryAngleDeg: photo.viewpoint.angleDeg,
            oppositeCamera,
            hasOppositeCameraBlock: secondaryInstruction.includes("OPPOSITE-CAMERA"),
            hasViewpointPlacementBlock: secondaryInstruction.includes("VIEWPOINT FURNITURE PLACEMENT"),
            hasPlacementMap: secondaryInstruction.includes("FURNITURE PLACEMENT MAP"),
          });
        }

        let prompt = isMaster ? masterInstruction : secondaryInstruction;
        const redoCorrection =
          roomAction === "regenerate" &&
          redoPhotoId === photo.id &&
          !editFeedback?.trim()
            ? room.lastValidationFeedback?.[photo.id]?.trim()
            : undefined;
        if (redoCorrection) {
          prompt = `${prompt} CORRECTION: ${redoCorrection}`;
          pipelineLog("FAL_PIPELINE", "redo applying stored validation correction", {
            projectId,
            roomId,
            photoId: photo.id,
            preview: redoCorrection.slice(0, 160),
          });
        }

        const img = await runEditWithValidation({
          photo,
          isMaster,
          prepBase64: prep.prepBase64,
          prepMime: prep.prepMime || "image/jpeg",
          prompt,
          globalIndex,
          attempt: 0,
          openingBoxCounts,
          rebuildPromptWithoutHero: isMaster
            ? undefined
            : () =>
                buildSecondaryRenderInstruction(
                  plan,
                  cameraNote,
                  editFeedback?.trim(),
                  openingBoxCounts,
                  { ...secondaryViewpointCtx, heroImageAttached: false },
                ),
          onBeforeValidate: () =>
            emitEditProgress(
              "validate",
              `Checking view ${viewNum} of ${viewTotal}${viewLabel}…`,
              0.82,
              globalIndex,
              true,
            ),
        });

        if (!img) {
          if (!room.viewpointErrors) room.viewpointErrors = {};
          room.viewpointErrors[photo.id] = "Edit pipeline returned no image";
          return;
        }

        if (isMaster) {
          heroBase64 = img.base64;
          heroMime = img.mimeType;
          if (img.heroAnalysis?.placementMap || img.heroAnalysis?.decorLock) {
            room.heroPlacementMap = img.heroAnalysis.placementMap ?? undefined;
            room.heroDecorLock = img.heroAnalysis.decorLock ?? undefined;
          } else {
            const analysis = await buildHeroMasterAnalysis(img.base64, img.mimeType);
            room.heroPlacementMap = analysis.placementMap ?? undefined;
            room.heroDecorLock = analysis.decorLock ?? undefined;
          }
        }

        const renderFile = isMaster ? "render-master.jpg" : `render-${photo.id}.jpg`;
        await writeWorkspaceFile(projectId, roomId, renderFile, Buffer.from(img.base64, "base64"));

        room.lastSuccessfulStep = "staging";
        room.generationError = undefined;
        await writeWorkspaceMeta(projectId, roomId, {
          status: i === workQueue.length - 1 ? "complete" : "running",
          step: "staging",
          stagingComplete: true,
          prepComplete: true,
        });

        const renderEntry: RenderResult = {
          base64: img.base64,
          mimeType: img.mimeType,
          angleIndex: globalIndex,
          angleDescription: angleDesc,
          viewType: "standard",
          ...(img.validationPassed === false ? { notConfirmed: true } : {}),
        };

        await upsertRenderAsync(photo.id, renderEntry);
        const photoDoneStep: EditGenerationStep =
          i === workQueue.length - 1 ? "complete" : "staging";
        await emitEditProgress(
          photoDoneStep,
          i === workQueue.length - 1
            ? `View ${viewNum} of ${viewTotal} complete`
            : `View ${viewNum} of ${viewTotal} done — continuing…`,
          0.95,
          globalIndex,
          true,
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!room.viewpointErrors) room.viewpointErrors = {};
        room.viewpointErrors[photo.id] = errMsg;
        room.generationError = errMsg;
        room.generationFailedAt = new Date().toISOString();
        room.generationStep = room.lastSuccessfulStep === "prep" ? "staging" : "prep";
        await writeWorkspaceMeta(projectId, roomId, {
          status: `${room.generationStep}_failed`,
          step: room.generationStep,
          error: errMsg,
          prepComplete: await workspaceFileExists(projectId, roomId, `prep-${photo.id}.jpg`),
        });
        await persistEditProgress(newRenders);
        if (i === 0 && newRenders.length === 0) {
          throw new Error(errMsg);
        }
      }
    };

    const masterIndices = workQueue
      .map((item, idx) => (item.mode === "master" ? idx : -1))
      .filter((idx) => idx >= 0);
    const secondaryIndices = workQueue
      .map((item, idx) => (item.mode === "secondary" ? idx : -1))
      .filter((idx) => idx >= 0);

    try {
      for (const idx of masterIndices) {
        await processWorkQueueIndex(idx);
      }
      for (let b = 0; b < secondaryIndices.length; b += SECONDARY_RENDER_PARALLEL) {
        const batch = secondaryIndices.slice(b, b + SECONDARY_RENDER_PARALLEL);
        await Promise.all(batch.map((idx) => processWorkQueueIndex(idx)));
      }
    } catch (batchErr) {
      const errMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
      if (newRenders.length === 0) {
        return { ok: false, images: [], error: errMsg };
      }
    }

    if (newRenders.length === 0) {
      return { ok: false, images: [], error: room.generationError || "All edit renders failed" };
    }

    room.renders = newRenders;
    room.viewpointTargetCount = withPhoto.length;
    room.gallerySyncComplete = withPhoto.length <= 1 || newRenders.length >= withPhoto.length;
    room.generationStep = "complete";
    await setProject(state);

    logRoomPipelineSummary({
      projectId,
      roomId,
      roomName: brief.roomName,
      viewsRendered: newRenders.length,
      viewsTarget: withPhoto.length,
      validationsFailed,
      retries,
      totalMs: Date.now() - pipelineStart,
    });

    onProgress?.({ phase: "generating", message: "Finalizing...", progress: 0.95, room: brief.roomName });

    const heroIdx = masterPhotoId ? room.photoRenderMap[masterPhotoId] : 0;
    const heroRender = newRenders[heroIdx ?? 0] ?? newRenders[0]!;

    return {
      ok: true,
      images: [{ base64: heroRender.base64, mimeType: heroRender.mimeType }],
    };
  } finally {
    if (newRenders.length > 0 && room.renders.length < newRenders.length) {
      room.renders = [...newRenders];
      room.viewpointTargetCount = withPhoto.length;
      try {
        await setProject(state);
      } catch (persistErr) {
        pipelineLog(
          "STATE_PERSIST",
          "best-effort persist on unexpected exit failed",
          { projectId, roomId, error: String(persistErr).slice(0, 200) },
          "warn",
        );
      }
    }
  }
}

async function generateRoomViaFalPipeline(opts: {
  state: ProjectState;
  projectId: string;
  roomId: string;
  room: RoomResult;
  brief: RoomDesignBrief;
  targets: RoomPhotoWithViewpoint[];
  editFeedback?: string;
  editAnnotation?: EditAnnotation;
  redoPhotoId?: string;
  roomAction?: "generate" | "regenerate" | "edit";
  onProgress?: ProgressCallback;
  abortSignal?: AbortSignal;
}): Promise<{ ok: boolean; images: { base64: string; mimeType: string }[]; error?: string }> {
  const renderModel = resolveProjectRenderModel();
  if (renderModel === "apartment-staging") {
    return generateRoomViaStagingPipeline(opts);
  }
  if (renderModel === "edit-pipeline") {
    return generateRoomViaEditPipeline(opts);
  }

  const { state, projectId, roomId, room, brief, targets, editFeedback, redoPhotoId, roomAction, onProgress } = opts;

  const withPhoto = targets.filter((t) => t.base64);
  if (withPhoto.length === 0) {
    return { ok: false, images: [], error: "Assign at least one room photo before generating." };
  }

  const masterPhotoId = withPhoto[0]?.id;
  const multiView = withPhoto.length > 1;

  const detectedRoom = state.analysis?.rooms.find((r) => r.id === roomId);
  const buildPrompt = (
    lineMap?: { base64?: string },
    removalMask?: { base64?: string },
    feedback?: string,
  ) =>
    buildProjectKontextPrompt({
      state,
      roomId,
      brief,
      detectedRoom,
      editFeedback: feedback,
      hasStructuralLines: !!lineMap?.base64,
      hasObjectRemovalMask: !!removalMask?.base64,
    });
  const prompt = buildPrompt(undefined, undefined, editFeedback?.trim());
  const toRender = redoPhotoId ? withPhoto.filter((t) => t.id === redoPhotoId) : withPhoto;
  if (toRender.length === 0) {
    return { ok: false, images: [], error: "Photo not found for render." };
  }

  pipelineLog("FAL_PIPELINE", "render all assigned photos", {
    projectId,
    roomId,
    roomName: brief.roomName,
    photoCount: toRender.length,
    promptChars: prompt.length,
  });

  const isMasterRerender =
    !redoPhotoId ||
    redoPhotoId === masterPhotoId ||
    (multiView && !redoPhotoId && room.renders.length === 0);
  if (editFeedback?.trim() && isMasterRerender) {
    room.falRenderSeed = undefined;
    room.masterRenderPrompt = undefined;
  } else if (roomAction === "regenerate" && redoPhotoId === masterPhotoId) {
    room.falRenderSeed = undefined;
    room.masterRenderPrompt = undefined;
  }

  const newRenders: RenderResult[] = redoPhotoId ? [...room.renders] : [];
  if (!room.photoRenderMap) room.photoRenderMap = {};
  if (!room.viewpointErrors) room.viewpointErrors = {};

  let masterSeed = room.falRenderSeed;
  const masterPrompt = room.masterRenderPrompt ?? prompt;
  let heroStyleRef: { base64: string; mimeType: string } | undefined =
    room.renders[0]?.base64 ? { base64: room.renders[0].base64, mimeType: room.renders[0].mimeType } : undefined;
  const masterPhoto = withPhoto[0];
  const masterStyleRef = masterPhoto
    ? await resolveMasterStyleReference(state, room, brief, masterPhoto)
    : undefined;

  for (let i = 0; i < toRender.length; i++) {
    const photo = toRender[i]!;
    const isFirstInBatch = i === 0;
    const isMaster = !redoPhotoId ? isFirstInBatch : photo.id === withPhoto[0]?.id;
    const globalIndex = withPhoto.findIndex((t) => t.id === photo.id);
    const angleDesc =
      photo.viewpoint && detectedRoom
        ? resolveViewpointFraming(photo.viewpoint, detectedRoom)?.note ?? photo.label
        : photo.label;

    onProgress?.({
      phase: "generating",
      message: `Rendering view ${globalIndex + 1} of ${withPhoto.length}...`,
      progress: 0.2 + (0.7 * i) / toRender.length,
      room: brief.roomName,
    });

    let rendered: Awaited<ReturnType<typeof renderRoomRedesign>>;
    const lineMap = photo.structuralLineMap;
    const removalMask = photo.objectRemovalMask;
    const photoPrompt = isMaster && !masterSeed
      ? buildPrompt(lineMap, removalMask, editFeedback?.trim())
      : masterPrompt;
    const styleRef = isMaster ? masterStyleRef : heroStyleRef;
    if (isMaster && !masterSeed) {
      rendered = await renderRoomRedesign({
        photoBase64: photo.base64,
        photoMime: photo.mimeType || "image/jpeg",
        prompt: photoPrompt,
        structuralLineMapBase64: lineMap?.base64,
        structuralLineMapMime: lineMap?.mimeType,
        structuralLineStrokeOnly: lineMap?.strokeOnly,
        originalPhotoBase64: photo.base64,
        styleReferenceBase64: styleRef?.base64,
        styleReferenceMime: styleRef?.mimeType,
        sessionId: projectId,
        label: `project-${brief.roomName}-master`,
        angleRole: "master",
      });
      masterSeed = rendered.seed;
      room.falRenderSeed = masterSeed;
      room.masterRenderPrompt = photoPrompt;
      const masterImg = rendered.images[0];
      if (masterImg) {
        heroStyleRef = { base64: masterImg.base64, mimeType: masterImg.mimeType };
      }
    } else {
      const secondaryDesignPrompt = buildSecondaryViewpointPrompt({
        state,
        roomId,
        photo,
        detectedRoom,
        designPrompt: masterPrompt,
      });
      rendered = await renderRoomRedesign({
        photoBase64: photo.base64,
        photoMime: photo.mimeType || "image/jpeg",
        prompt: secondaryDesignPrompt,
        structuralLineMapBase64: lineMap?.base64,
        structuralLineMapMime: lineMap?.mimeType,
        structuralLineStrokeOnly: lineMap?.strokeOnly,
        originalPhotoBase64: photo.base64,
        styleReferenceBase64: heroStyleRef?.base64,
        styleReferenceMime: heroStyleRef?.mimeType,
        seed: masterSeed,
        sessionId: projectId,
        label: `project-${brief.roomName}-view-${globalIndex + 1}`,
        angleRole: isMaster ? "master" : "secondary",
      });
    }

    const img = rendered.images[0];
    if (!img) {
      room.viewpointErrors[photo.id] = "Render returned no image";
      continue;
    }

    const renderEntry: RenderResult = {
      base64: img.base64,
      mimeType: img.mimeType,
      angleIndex: globalIndex,
      angleDescription: angleDesc,
      viewType: "standard",
    };

    if (redoPhotoId) {
      const existingIdx = room.photoRenderMap[photo.id];
      if (existingIdx !== undefined && newRenders[existingIdx]) {
        newRenders[existingIdx] = renderEntry;
      } else {
        newRenders.push(renderEntry);
        room.photoRenderMap[photo.id] = newRenders.length - 1;
      }
    } else {
      newRenders.push(renderEntry);
      room.photoRenderMap[photo.id] = newRenders.length - 1;
    }
  }

  if (newRenders.length === 0) {
    return { ok: false, images: [], error: "All renders failed" };
  }

  room.renders = newRenders;
  room.viewpointTargetCount = withPhoto.length;
  room.gallerySyncComplete = withPhoto.length <= 1 || newRenders.length >= withPhoto.length;
  await setProject(state);

  onProgress?.({ phase: "generating", message: "Finalizing...", progress: 0.95, room: brief.roomName });

  return {
    ok: true,
    images: [{ base64: newRenders[0]!.base64, mimeType: newRenders[0]!.mimeType }],
  };
}

async function generateRoomPhaseImpl(
  projectId: string,
  roomId: string,
  phase: DesignPhase,
  editFeedback?: string,
  onProgress?: ProgressCallback,
  opts?: {
    designMode?: "made" | "custom";
    editAnnotation?: EditAnnotation;
    photoId?: string;
    roomAction?: "generate" | "regenerate" | "edit";
    abortSignal?: AbortSignal;
  },
): Promise<ProjectState> {
  const generationLockKey = roomGenerationLockKey(projectId, roomId);
  if (roomGenerationInFlight.has(generationLockKey)) {
    pipelineLog(
      "STATE_PERSIST",
      "generation rejected — already in flight",
      { projectId, roomId },
      "warn",
    );
    throw new Error("Room generation already in progress — wait or refresh");
  }
  roomGenerationInFlight.add(generationLockKey);

  const linkedAbort = new AbortController();
  if (opts?.abortSignal) {
    if (opts.abortSignal.aborted) {
      roomGenerationInFlight.delete(generationLockKey);
      throw new GenerationCancelledError();
    }
    opts.abortSignal.addEventListener("abort", () => linkedAbort.abort(), { once: true });
  }
  roomGenerationAbortControllers.set(generationLockKey, linkedAbort);

  try {
    return await generateRoomPhaseImplBody(
      projectId,
      roomId,
      phase,
      editFeedback,
      onProgress,
      { ...opts, abortSignal: linkedAbort.signal },
    );
  } finally {
    roomGenerationAbortControllers.delete(generationLockKey);
    roomGenerationInFlight.delete(generationLockKey);
  }
}

async function generateRoomPhaseImplBody(
  projectId: string,
  roomId: string,
  phase: DesignPhase,
  editFeedback?: string,
  onProgress?: ProgressCallback,
  opts?: {
    designMode?: "made" | "custom";
    editAnnotation?: EditAnnotation;
    photoId?: string;
    roomAction?: "generate" | "regenerate" | "edit";
    abortSignal?: AbortSignal;
  },
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.concept || !state.analysis) throw new Error("Project not initialized");
  if (!state.floorPlanConfirmed) throw new Error("Floor plan not confirmed");

  if (opts?.designMode) {
    const resolved = resolveDesignMode(opts.designMode);
    if (resolved !== state.preferences.designMode) {
      state.preferences = { ...state.preferences, designMode: resolved };
      await setProject(state);
    }
  }

  const brief = state.concept.rooms.find((b) => b.roomId === roomId);
  if (!brief) throw new Error(`Room ${roomId} not found in concept`);

  const room = getOrCreateRoom(state, roomId, brief);

  const attempt = (room.generationAttempt ?? 0) + 1;
  if (attempt > maxStagingAttemptsPerRoom() && room.renders.length === 0) {
    throw new Error(
      `Maximum generation attempts (${maxStagingAttemptsPerRoom()}) reached for this room.`,
    );
  }
  room.generationAttempt = attempt;
  room.generationError = undefined;
  room.generationStep = "workspace";

  // A fresh attempt clears any stale error persisted by a previous failed run,
  // so an old failure can't resurface in the UI after the user navigates around.
  state.error = null;

  // Resolve all viewpoint targets before gallery-edit routing (needs target count).
  let targets = getViewpointGenerationTargets(state, roomId);

  const designModeEarly = resolveDesignMode(state.preferences.designMode);
  const freeRenderEarly = isFreeRenderMode(designModeEarly);

  if (freeRenderEarly && phase === "base" && !opts?.photoId) {
    room.renders = [];
    room.photoRenderMap = undefined;
    room.viewpointErrors = undefined;
    room.viewpointTargetCount = undefined;
  }

  const withPhoto = targets.filter((t) => t.base64);
  if (withPhoto.length === 0) {
    throw new Error("Assign at least one room photo before generating.");
  }

  const multiViewpoint = withPhoto.length > 1;
  const primaryPhotoId = withPhoto[0]?.id ?? null;

  if (multiViewpoint) {
    if (!room.viewpointPhases) room.viewpointPhases = {};
    room.primaryPhotoId = primaryPhotoId ?? undefined;
    for (const t of withPhoto) {
      if (!room.viewpointPhases[t.id]) room.viewpointPhases[t.id] = emptyRoomPhases();
    }
  }

  const designMode = resolveDesignMode(state.preferences.designMode);
  const freeRenderMode = isFreeRenderMode(designMode);
  if (freeRenderMode && phase !== "base") {
    return state;
  }

  const phaseState = room.phases![phase];
  phaseState.status = "generating";
  room.currentPhase = phase;
  room.status = "generating";
  await setProject(state);

  onProgress?.({ phase: "generating", message: "Rendering design…", progress: 0.1, room: brief.roomName });

  try {
    pipelineLog("FAL_PIPELINE", "room generation start", {
      projectId,
      roomId,
      roomName: brief.roomName,
      photoCount: withPhoto.length,
    });

    const result = await generateRoomViaFalPipeline({
      state,
      projectId,
      roomId,
      room,
      brief,
      targets: withPhoto,
      editFeedback: editFeedback?.trim(),
      editAnnotation: opts?.editAnnotation,
      redoPhotoId: opts?.photoId,
      roomAction: opts?.roomAction,
      onProgress,
      abortSignal: opts?.abortSignal,
    });

    if (!result.ok || result.images.length === 0) {
      const errMsg = result.error || "Render failed";
      const hasPriorWork = phaseState.versions.length > 0 || room.renders.length > 0;
      phaseState.status = hasPriorWork ? "review" : "pending";
      room.status = hasPriorWork ? "review" : "pending";
      room.generationError = errMsg;
      room.generationFailedAt = new Date().toISOString();
      room.generationStep = "idle";
      await setProject(state);
      onProgress?.({
        phase: "error",
        message: errMsg,
        data: {
          roomId,
          step: room.generationStep,
          recoverable: true,
          prepCached: await workspaceFileExists(projectId, roomId, "prep.jpg"),
        },
      });
      throw new Error(errMsg);
    }

    const img = result.images[0]!;
    const heroRender = room.renders[0];
    phaseState.versions.push({
      angleIndex: phaseState.versions.length,
      angleDescription: `${phase} v${phaseState.versions.length + 1}`,
      viewType: "standard",
      base64: img.base64,
      mimeType: img.mimeType,
      ...(heroRender?.notConfirmed ? { notConfirmed: true } : {}),
    });
    phaseState.selectedIndex = phaseState.versions.length - 1;
    phaseState.status = "review";

    userFlowLog(5, "room render generated on server", {
      projectId,
      roomId,
      roomName: brief.roomName,
      phase,
      versionCount: phaseState.versions.length,
      renderCount: room.renders.length,
    }, "E");

    if (editFeedback?.trim()) {
      phaseState.editHistory.push({ feedback: editFeedback.trim(), timestamp: new Date().toISOString() });
    }

    room.status = "review";
    room.generationError = undefined;
    room.generationStep = "complete";
    state.status = "reviewing";
    await setProject(state);

    onProgress?.({
      phase: "complete",
      message:
        withPhoto.length > 1 && room.renders.length < withPhoto.length
          ? `View ${room.renders.length} ready — ${withPhoto.length - room.renders.length} view(s) remaining`
          : room.renders.length > 1
            ? `${room.renders.length} views ready for review`
            : `${phase} ready for review`,
      progress: 1.0,
      room: brief.roomName,
      data: { room: sanitizeRoomResult(room) },
    });

    return state;
  } catch (err) {
    if (isGenerationCancelledError(err)) {
      resetRoomGenerationState(room);
      if (room.phases?.[phase]?.status === "generating") {
        const hasPriorWork = phaseState.versions.length > 0 || room.renders.length > 0;
        room.phases[phase].status = hasPriorWork ? "review" : "pending";
      }
      await setProject(state);
      onProgress?.({
        phase: "error",
        message: GENERATION_CANCELLED_MESSAGE,
        data: { roomId, code: "cancelled" },
      });
      throw err;
    }
    const errMsg = err instanceof Error ? err.message : "Phase generation failed";
    const hasPriorWork = phaseState.versions.length > 0 || room.renders.length > 0;
    phaseState.status = hasPriorWork ? "review" : "pending";
    room.status = hasPriorWork ? "review" : "pending";
    room.generationError = errMsg;
    room.generationFailedAt = new Date().toISOString();
    room.generationStep = "idle";
    await setProject(state);
    onProgress?.({
      phase: "error",
      message: errMsg,
      data: {
        roomId,
        step: room.generationStep,
        recoverable: true,
        prepCached: await workspaceFileExists(projectId, roomId, "prep.jpg"),
      },
    });
    throw err;
  }
}

/**
 * Remove a single render from the room gallery (persisted in Redis).
 * Remaps photoRenderMap indices and excludes the photo from future regeneration.
 */
export function removeRoomRender(
  projectId: string,
  roomId: string,
  renderIndex: number,
): Promise<ProjectState> {
  return runWithLogContext(projectId, () =>
    removeRoomRenderImpl(projectId, roomId, renderIndex),
  );
}

async function removeRoomRenderImpl(
  projectId: string,
  roomId: string,
  renderIndex: number,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);

  const room = state.rooms.find((r) => r.roomId === roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);
  if (room.renders.length <= 1) {
    throw new Error("Cannot remove the last render");
  }
  if (!Number.isInteger(renderIndex) || renderIndex < 0 || renderIndex >= room.renders.length) {
    throw new Error("Invalid render index");
  }

  const photoIdToRemove = Object.entries(room.photoRenderMap ?? {}).find(
    ([, idx]) => idx === renderIndex,
  )?.[0];

  room.renders.splice(renderIndex, 1);

  if (room.photoRenderMap) {
    if (photoIdToRemove) {
      delete room.photoRenderMap[photoIdToRemove];
    }
    for (const [pid, idx] of Object.entries(room.photoRenderMap)) {
      if (idx > renderIndex) {
        room.photoRenderMap[pid] = idx - 1;
      }
    }
  }

  if (photoIdToRemove) {
    if (!room.excludedViewpointPhotoIds) room.excludedViewpointPhotoIds = [];
    if (!room.excludedViewpointPhotoIds.includes(photoIdToRemove)) {
      room.excludedViewpointPhotoIds.push(photoIdToRemove);
    }
    delete room.viewpointErrors?.[photoIdToRemove];
    delete room.viewpointPhases?.[photoIdToRemove];
    delete room.lastValidationFeedback?.[photoIdToRemove];
  }

  if (room.viewpointTargetCount != null && room.viewpointTargetCount > 1) {
    room.viewpointTargetCount -= 1;
  }

  pipelineLog("REMOVE_RENDER", "removed room render from gallery", {
    projectId,
    roomId,
    renderIndex,
    photoIdToRemove,
    remainingRenders: room.renders.length,
    viewpointTargetCount: room.viewpointTargetCount,
  });

  await setProject(state);
  return state;
}

/**
 * Render the next un-rendered viewpoint for a room (FAL-only — locked seed from hero).
 */
export function generateNextViewpoint(
  projectId: string,
  roomId: string,
  onProgress?: ProgressCallback,
  editFeedback?: string,
  editAnnotation?: EditAnnotation,
  opts?: { redo?: boolean },
): Promise<ProjectState> {
  return runWithLogContext(projectId, () =>
    generateNextViewpointImpl(projectId, roomId, onProgress, editFeedback, editAnnotation, opts),
  );
}

async function generateNextViewpointImpl(
  projectId: string,
  roomId: string,
  onProgress?: ProgressCallback,
  editFeedback?: string,
  editAnnotation?: EditAnnotation,
  opts?: { redo?: boolean },
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.concept || !state.analysis) throw new Error("Project not initialized");

  const room = state.rooms.find((r) => r.roomId === roomId);
  if (!room?.phases) throw new Error("Room has not been generated");

  const brief = room.brief;
  const targets = getViewpointGenerationTargets(state, roomId);
  const detectedRoom = state.analysis.rooms.find((r) => r.id === roomId);
  const allRoomPhotos = buildLabeledRoomPhotos(targets, detectedRoom);

  // Redo: pop the last secondary render so it gets re-rendered.
  if (opts?.redo && room.renders.length > 1) {
    const popped = room.renders.pop()!;
    const poppedPhotoId = Object.entries(room.photoRenderMap ?? {}).find(
      ([, idx]) => idx === room.renders.length,
    )?.[0];
    if (poppedPhotoId) delete room.photoRenderMap![poppedPhotoId];
    pipelineLog("FINISH_ROOM", "popped last viewpoint for redo", {
      projectId, roomId, poppedAngle: popped.angleDescription, poppedPhotoId,
    });
    await setProject(state);
  }

  // Find the next target that doesn't have a render yet.
  const excludedPhotoIds = new Set(room.excludedViewpointPhotoIds ?? []);
  const renderedPhotoIds = new Set(Object.keys(room.photoRenderMap ?? {}));
  const nextIndex = targets.findIndex(
    (t) => !renderedPhotoIds.has(t.id) && !excludedPhotoIds.has(t.id),
  );

  if (nextIndex < 0) {
    pipelineLog("FINISH_ROOM", "all viewpoints already rendered", { projectId, roomId });
    return state;
  }

  const photo = targets[nextIndex];
  if (!room.photoRenderMap) room.photoRenderMap = {};
  if (!room.viewpointErrors) room.viewpointErrors = {};

  room.status = "generating";
  await setProject(state);

  onProgress?.({
    phase: "generating",
    message: `Rendering view ${nextIndex + 1} of ${targets.length}...`,
    progress: 0.2,
    room: brief.roomName,
  });

  const approvedRenders = room.renders
    .filter((r) => r.base64)
    .map((r) => ({ base64: r.base64, mimeType: r.mimeType }));

  const renderModel = resolveProjectRenderModel();
  const heroRender = approvedRenders[0];
  if (!heroRender && renderModel !== "apartment-staging") {
    throw new Error("Hero render must exist before generating secondary viewpoints");
  }

  pipelineLog("FINISH_ROOM", "sequential viewpoint render", {
    projectId,
    roomId,
    photoId: photo.id,
    photoLabel: photo.label,
    viewpointIndex: nextIndex,
    totalTargets: targets.length,
    approvedReferenceCount: approvedRenders.length,
    hasEditFeedback: !!editFeedback?.trim(),
  });

  const framing = photo.viewpoint ? resolveViewpointFraming(photo.viewpoint, detectedRoom) : null;

  try {
    if (renderModel === "apartment-staging" || renderModel === "edit-pipeline") {
      await generateRoomViaFalPipeline({
        state,
        projectId,
        roomId,
        room,
        brief,
        targets,
        redoPhotoId: photo.id,
        editFeedback,
        editAnnotation,
        // "regenerate" lets the pipeline inject the stored validation
        // correction (e.g. hero-copy feedback) on "Redo this view".
        roomAction: editFeedback?.trim() ? "edit" : "regenerate",
        onProgress,
      });

      const renderIdx = room.photoRenderMap?.[photo.id];
      const render = renderIdx !== undefined ? room.renders[renderIdx] : undefined;
      if (render) {
        if (!room.viewpointPhases) room.viewpointPhases = {};
        if (!room.viewpointPhases[photo.id]) room.viewpointPhases[photo.id] = emptyRoomPhases();
        const vpTrack = room.viewpointPhases[photo.id].base;
        const angleDesc = framing?.note ?? photo.label;
        vpTrack.versions.push({
          angleIndex: vpTrack.versions.length,
          angleDescription: angleDesc,
          viewType: "standard",
          base64: render.base64,
          mimeType: render.mimeType,
          ...(render.notConfirmed ? { notConfirmed: true } : {}),
        });
        vpTrack.selectedIndex = vpTrack.versions.length - 1;
        vpTrack.status = "review";

        pipelineLog("FINISH_ROOM", "sequential staging viewpoint done", {
          projectId,
          roomId,
          photoId: photo.id,
          viewpointIndex: nextIndex,
          renderedCount: room.renders.length,
          totalTargets: targets.length,
          renderModel,
        });
      } else {
        room.viewpointErrors[photo.id] =
          room.viewpointErrors[photo.id] ?? "Render pipeline returned no image";
      }
    } else {
    const useFalViewpoint = heroRender && photo.base64;
    let vpResult: { ok: boolean; image?: { base64: string; mimeType: string }; error?: string };

    if (useFalViewpoint) {
      pipelineLog("FAL_PIPELINE", "secondary viewpoint via renderSecondaryAngle", {
        projectId, roomId, photoId: photo.id, viewpointIndex: nextIndex,
        falRenderSeed: room.falRenderSeed,
      });

      const designPrompt = buildSecondaryViewpointPrompt({
        state,
        roomId,
        photo,
        detectedRoom,
        designPrompt:
          room.masterRenderPrompt
          ?? buildProjectKontextPrompt({
            state,
            roomId,
            brief,
            detectedRoom,
            editFeedback: editFeedback?.trim(),
            hasStructuralLines: !!photo.structuralLineMap?.base64,
            hasObjectRemovalMask: !!photo.objectRemovalMask?.base64,
          }),
      });
      const viewpointLabel = `project-${brief.roomName}-viewpoint-${nextIndex}`;
      const plan = state.roomRenderPlans?.[roomId];

      const renderSecondary = async (prompt: string, label: string) => {
        const rendered = await renderSecondaryAngle({
          heroBase64: heroRender.base64,
          heroMime: heroRender.mimeType,
          secondaryPhotoBase64: photo.base64,
          secondaryPhotoMime: photo.mimeType || "image/jpeg",
          prompt,
          seed: room.falRenderSeed,
          structuralLineMapBase64: photo.structuralLineMap?.base64,
          structuralLineMapMime: photo.structuralLineMap?.mimeType,
          structuralLineStrokeOnly: photo.structuralLineMap?.strokeOnly,
          sessionId: projectId,
          label,
        });
        return rendered.images[0] ?? null;
      };

      const secondaryImage = await renderSecondary(designPrompt, viewpointLabel);
      const crossViewImage = secondaryImage
        ? await applyCrossViewConsistencyRetry({
            image: secondaryImage,
            heroBase64: heroRender.base64,
            heroMime: heroRender.mimeType,
            brief,
            plan,
            label: viewpointLabel,
            retryRender: (correctiveFeedback) =>
              renderSecondary(`${designPrompt}\n\n${correctiveFeedback}`, `${viewpointLabel}-crossview-retry`),
          })
        : null;

      vpResult = crossViewImage
        ? { ok: true, image: crossViewImage }
        : { ok: false, error: "Fal viewpoint render returned no image" };
    } else {
      throw new Error("Secondary viewpoints require image rendering.");
    }

    if (vpResult.ok && vpResult.image) {
      room.photoRenderMap[photo.id] = room.renders.length;
      const angleDesc = framing?.note ?? photo.label;
      room.renders.push({
        base64: vpResult.image.base64,
        mimeType: vpResult.image.mimeType,
        angleIndex: nextIndex,
        angleDescription: angleDesc,
        viewType: "standard",
      });

      // Populate viewpointPhases for per-view tracking.
      if (!room.viewpointPhases) room.viewpointPhases = {};
      if (!room.viewpointPhases[photo.id]) room.viewpointPhases[photo.id] = emptyRoomPhases();
      const vpTrack = room.viewpointPhases[photo.id].base;
      vpTrack.versions.push({
        angleIndex: vpTrack.versions.length,
        angleDescription: angleDesc,
        viewType: "standard",
        base64: vpResult.image.base64,
        mimeType: vpResult.image.mimeType,
      });
      vpTrack.selectedIndex = vpTrack.versions.length - 1;
      vpTrack.status = "review";

      pipelineLog("FINISH_ROOM", "sequential viewpoint done", {
        projectId,
        roomId,
        photoId: photo.id,
        viewpointIndex: nextIndex,
        renderedCount: room.renders.length,
        totalTargets: targets.length,
      });
    } else {
      room.viewpointErrors[photo.id] = vpResult.error ?? "Render returned no image";
      pipelineLog("FINISH_ROOM", "sequential viewpoint failed", {
        projectId, roomId, photoId: photo.id, error: vpResult.error,
      }, "warn");
    }
    }
  } catch (err) {
    room.viewpointErrors[photo.id] = err instanceof Error ? err.message : String(err);
    pipelineLog("FINISH_ROOM", "sequential viewpoint error", {
      projectId, roomId, photoId: photo.id, error: String(err),
    }, "warn");
  }

  room.status = "review";
  await setProject(state);

  const allDone = room.renders.length >= targets.length;
  onProgress?.({
    phase: "complete",
    message: allDone
      ? "All viewpoints rendered"
      : `View ${nextIndex + 1} ready — ${targets.length - room.renders.length} remaining`,
    progress: 1.0,
    room: brief.roomName,
    data: {
      room: sanitizeRoomResult(room),
      viewpointProgress: {
        rendered: room.renders.length,
        total: targets.length,
        allDone,
      },
    },
  });

  return state;
}

export async function approveRoomPhase(
  projectId: string,
  roomId: string,
  phase: DesignPhase,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  const room = state.rooms.find((r) => r.roomId === roomId);
  if (!room?.phases) throw new Error("Room not generated yet");
  room.phases[phase].status = "approved";
  // Approve the same phase on all viewpoint tracks so they advance together.
  if (room.viewpointPhases) {
    for (const track of Object.values(room.viewpointPhases)) {
      track[phase].status = "approved";
    }
  }
  pipelineLog("FINISH_ROOM", "phase approved", { projectId, roomId, phase });
  userFlowLog(6, "phase approved on server", { projectId, roomId, phase }, "F");
  await setProject(state);
  return state;
}

/**
 * Approve a single viewpoint in a multi-photo room (per-view flow).
 * Does NOT approve the whole room — only marks that photo's track as approved.
 */
export async function approveViewpoint(
  projectId: string,
  roomId: string,
  photoId: string,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  const room = state.rooms.find((r) => r.roomId === roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);
  if (!room.viewpointPhases?.[photoId]) {
    throw new Error(`No viewpoint track for photo ${photoId}`);
  }
  room.viewpointPhases[photoId].base.status = "approved";
  pipelineLog("FINISH_ROOM", "viewpoint approved", { projectId, roomId, photoId });
  await setProject(state);
  return state;
}

/**
 * Gallery sync pass: regenerate all viewpoints with the full set of pass-1
 * approved renders as cross-references. Only allowed after every viewpoint
 * track has base.status === "approved".
 */
export async function syncGallery(
  projectId: string,
  roomId: string,
  editFeedback?: string,
  onProgress?: ProgressCallback,
): Promise<ProjectState> {
  return runWithLogContext(projectId, () =>
    syncGalleryImpl(projectId, roomId, editFeedback, onProgress),
  );
}

async function syncGalleryImpl(
  projectId: string,
  roomId: string,
  editFeedback?: string,
  onProgress?: ProgressCallback,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.concept || !state.analysis) throw new Error("Project not initialized");

  const room = state.rooms.find((r) => r.roomId === roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);

  const brief = state.concept.rooms.find((b) => b.roomId === roomId);
  if (!brief) throw new Error(`Room ${roomId} not found in concept`);

  const targets = getViewpointGenerationTargets(state, roomId);
  const withPhoto = targets.filter((t) => t.base64);
  if (withPhoto.length < 2) throw new Error("Gallery sync requires 2+ assigned photos");

  const userEdit = editFeedback?.trim() ||
    "Align all views for consistent style and materials.";

  pipelineLog("FAL_PIPELINE", "gallery sync — re-render all photos", {
    projectId,
    roomId,
    targetCount: withPhoto.length,
    userEditPreview: userEdit.slice(0, 120),
  });

  room.status = "generating";
  room.gallerySyncComplete = false;
  await setProject(state);

  onProgress?.({
    phase: "generating",
    message: "Syncing views…",
    progress: 0.1,
    room: brief.roomName,
  });

  const result = await generateRoomViaFalPipeline({
    state,
    projectId,
    roomId,
    room,
    brief,
    targets: withPhoto,
    editFeedback: userEdit,
    onProgress,
  });

  if (!result.ok || room.renders.length === 0) {
    room.status = "review";
    await setProject(state);
    throw new Error(result.error ?? "Gallery sync failed");
  }

  room.gallerySyncComplete = true;
  room.status = "review";
  await setProject(state);

  onProgress?.({
    phase: "complete",
    message: "Gallery sync complete — review all views",
    progress: 1.0,
    room: brief.roomName,
    data: { room: sanitizeRoomResult(room) },
  });

  return state;
}

export async function selectRoomPhaseVersion(
  projectId: string,
  roomId: string,
  phase: DesignPhase,
  index: number,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  const room = state.rooms.find((r) => r.roomId === roomId);
  if (room?.phases) {
    const ps = room.phases[phase];
    if (ps.versions.length > 0) {
      ps.selectedIndex = Math.max(0, Math.min(index, ps.versions.length - 1));
      await setProject(state);
    }
  }
  return state;
}

/** How far finishRoom runs: all views, views only (pre-approve review), or approve only. */
export type FinishRoomMode = "full" | "views-only" | "approve-only";

/** When finishing secondary views after a hero edit, propagate the same user change. */
export type FinishRoomViewEdit = {
  userEdit: string;
  editAnnotation?: EditAnnotation;
};

/**
 * Compose the final room from the last generated phase: produce extra camera
 * angles (products locked), extract a material spec, and mark the room approved.
 */
export function finishRoom(
  projectId: string,
  roomId: string,
  onProgress?: ProgressCallback,
  mode: FinishRoomMode = "full",
  viewEdit?: FinishRoomViewEdit,
): Promise<ProjectState> {
  return runWithLogContext(projectId, () => finishRoomImpl(projectId, roomId, onProgress, mode, viewEdit));
}

/** Mark room approved after the user reviewed all viewpoint renders. */
export function approveRoomReview(
  projectId: string,
  roomId: string,
  onProgress?: ProgressCallback,
): Promise<ProjectState> {
  return finishRoom(projectId, roomId, onProgress, "approve-only");
}

async function finishRoomImpl(
  projectId: string,
  roomId: string,
  onProgress?: ProgressCallback,
  mode: FinishRoomMode = "full",
  viewEdit?: FinishRoomViewEdit,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.concept || !state.analysis) throw new Error("Project not initialized");

  const room = state.rooms.find((r) => r.roomId === roomId);
  if (!room?.phases) throw new Error("Room has not been generated");

  const terminal: DesignPhase =
    room.phases.decor.versions.length > 0
      ? "decor"
      : room.phases.furniture.versions.length > 0
        ? "furniture"
        : "base";
  let finalRender = selectedPhaseRender(room.phases[terminal]);
  if (!finalRender && room.renders[0]) {
    finalRender = room.renders[0];
  }
  if (!finalRender) throw new Error("No render available to finish this room");

  if (mode === "approve-only" && room.viewpointPhases) {
    for (const track of Object.values(room.viewpointPhases)) {
      track.base.status = "approved";
    }
  }

  const brief = room.brief;

  const finalImage = { base64: finalRender.base64, mimeType: finalRender.mimeType };
  const roomPhotos = getRoomPhotos(state, roomId);
  const detectedRoom = state.analysis.rooms.find((r) => r.id === roomId);
  const targets = getViewpointGenerationTargets(state, roomId);
  room.viewpointTargetCount = targets.length;
  const finishStrategy = resolveFinishRoomRenderStrategy(roomPhotos);
  const freeRender = isFreeRenderMode(resolveDesignMode(state.preferences.designMode));
  const allRoomPhotos = buildLabeledRoomPhotos(targets, detectedRoom);

  const angleDescriptionFor = (photo: (typeof targets)[number]): string => {
    const framing = photo.viewpoint ? resolveViewpointFraming(photo.viewpoint, detectedRoom) : null;
    return framing?.note ?? photo.label;
  };

  const photoTargets = targets.filter((t) => t.base64);
  const falAllRendered =
    room.renders.length >= photoTargets.length && photoTargets.length > 0;

  if (
    finishStrategy === "heroSecondary" &&
    photoTargets.length > 1 &&
    room.renders.length < photoTargets.length &&
    (mode === "approve-only" || mode === "full")
  ) {
    throw new Error(
      `Generate all ${photoTargets.length} views before approving. Open the room review and use "Generate next view".`,
    );
  }

  if (mode === "approve-only" && room.renders.length === 0) {
    room.renders = [{
      ...finalRender,
      angleIndex: 0,
      angleDescription: angleDescriptionFor(
        targets[0] ?? { id: "", label: brief.roomName, base64: "", mimeType: "", viewpoint: undefined },
      ),
      viewType: "standard",
    }];
  }

  const skipViewGeneration =
    falAllRendered || (mode === "approve-only" && room.renders.length > 0);

  if (!skipViewGeneration) {
    room.status = "generating";
    await setProject(state);
    onProgress?.({ phase: "generating", message: "Composing final views...", progress: 0.3, room: brief.roomName });
  } else {
    onProgress?.({ phase: "materials", message: "Approving room...", progress: 0.5, room: brief.roomName });
  }

  if (!skipViewGeneration) {
  // Custom mode is single-pass during generation, but with 2+ assigned photos we
  // only render the hero during generateRoomPhase — secondary views must still be
  // generated here (heroSecondary). The old shortcut duplicated the hero render
  // when viewpointPhases had no track for photo 2.
  const customGalleryFromTracks =
    freeRender &&
    finishStrategy !== "heroSecondary" &&
    targets.every((photo) => {
      const track = room.viewpointPhases?.[photo.id];
      return !!selectedPhaseRender(track?.base);
    });

  if (customGalleryFromTracks) {
    const renderFor = (photo: (typeof targets)[number], i: number): RenderResult => {
      const track = room.viewpointPhases?.[photo.id];
      const render = track ? selectedPhaseRender(track.base) : i === 0 ? finalRender : null;
      return { ...(render ?? finalRender), angleIndex: i, angleDescription: angleDescriptionFor(photo) };
    };
    room.renders =
      targets.length > 0
        ? targets.map((photo, i) => renderFor(photo, i))
        : [{ ...finalRender, angleIndex: 0, angleDescription: brief.roomName, viewType: "standard" }];
  }
  // Hero-secondary: 2+ real photos — secondary views come from sequential next-viewpoint.
  else if (finishStrategy === "heroSecondary") {
    pipelineLog("FINISH_ROOM", "hero-secondary finish — using existing sequential renders", {
      projectId,
      roomId,
      targetCount: targets.length,
      renderCount: room.renders.length,
      freeRender,
      assignedPhotoCount: allRoomPhotos.length,
      heroPhotoId: targets[0]?.id,
      renderModel: resolveProjectRenderModel(),
    });

    if (room.renders.length === 0) {
      room.renders = [{
        ...finalRender,
        angleIndex: 0,
        angleDescription: angleDescriptionFor(targets[0]),
        viewType: "standard",
      }];
      if (!room.photoRenderMap) room.photoRenderMap = {};
      room.photoRenderMap[targets[0].id] = 0;
    }
    if (!room.viewpointErrors) room.viewpointErrors = {};
    if (!room.photoRenderMap) room.photoRenderMap = {};

    const finishRenderModel = resolveProjectRenderModel();
    if (finishRenderModel === "edit-pipeline") {
      // Hero already seeded into renders[0]/photoRenderMap above → append-secondary
      // renders every remaining pending photo through the edit pipeline.
      await generateRoomViaFalPipeline({
        state,
        projectId,
        roomId,
        room,
        brief,
        targets,
        onProgress,
      });
    } else if (finishRenderModel !== "apartment-staging") {
    const baseDesignPrompt =
      room.masterRenderPrompt
      ?? buildProjectKontextPrompt({
        state,
        roomId,
        brief,
        detectedRoom: state.analysis.rooms.find((r) => r.id === roomId),
      });

    for (let i = 1; i < targets.length; i++) {
      const photo = targets[i];
      const detectedRoom = state.analysis.rooms.find((r) => r.id === roomId);
      onProgress?.({
        phase: "generating",
        message: `Rendering view ${i + 1} of ${targets.length}...`,
        progress: 0.3 + (0.6 * i) / targets.length,
        room: brief.roomName,
      });
      try {
        pipelineLog("FINISH_ROOM", "FAL secondary viewpoint render start", {
          projectId,
          roomId,
          photoId: photo.id,
          photoLabel: photo.label,
          secondaryIndex: i,
        });

        const designPrompt = buildSecondaryViewpointPrompt({
          state,
          roomId,
          photo,
          detectedRoom,
          designPrompt: baseDesignPrompt,
        });
        const finishPlan = state.roomRenderPlans?.[roomId];
        const finishLabel = `project-${brief.roomName}-viewpoint-${i}`;

        const renderSecondary = async (prompt: string, label: string) => {
          const rendered = await renderSecondaryAngle({
            heroBase64: finalRender.base64,
            heroMime: finalRender.mimeType,
            secondaryPhotoBase64: photo.base64,
            secondaryPhotoMime: photo.mimeType || "image/jpeg",
            prompt,
            seed: room.falRenderSeed,
            sessionId: projectId,
            label,
          });
          return rendered.images[0] ?? null;
        };

        const secondaryImage = await renderSecondary(designPrompt, finishLabel);
        const crossViewImage = secondaryImage
          ? await applyCrossViewConsistencyRetry({
              image: secondaryImage,
              heroBase64: finalRender.base64,
              heroMime: finalRender.mimeType,
              brief,
              plan: finishPlan,
              label: finishLabel,
              retryRender: (correctiveFeedback) =>
                renderSecondary(`${designPrompt}\n\n${correctiveFeedback}`, `${finishLabel}-crossview-retry`),
            })
          : null;

        if (crossViewImage) {
          room.photoRenderMap[photo.id] = room.renders.length;
          room.renders.push({
            base64: crossViewImage.base64,
            mimeType: crossViewImage.mimeType,
            angleIndex: i,
            angleDescription: angleDescriptionFor(photo),
            viewType: "standard",
          });
          pipelineLog("FINISH_ROOM", "FAL secondary viewpoint render done", {
            projectId,
            roomId,
            photoId: photo.id,
            bytes: crossViewImage.base64.length,
          });
        } else {
          room.viewpointErrors[photo.id] = "Fal viewpoint render returned no image";
          pipelineLog("FINISH_ROOM", `secondary render empty for ${photo.label}`, {
            projectId, roomId, photoId: photo.id,
          }, "warn");
        }
      } catch (err) {
        room.viewpointErrors[photo.id] = err instanceof Error ? err.message : String(err);
        pipelineLog("FINISH_ROOM", `secondary render failed for ${photo.label}`, {
          projectId, roomId, photoId: photo.id, error: String(err),
        }, "warn");
      }
    }
    }

    /* Gemini hero-secondary (disabled for FAL-direct project flow)
    const googleKey = getGoogleGenerativeAiApiKey();
    if (!googleKey) throw new Error("GOOGLE_AI_API_KEY or GEMINI_API_KEY is not configured");
    ... renderSecondaryCustomViewpoint loop ...
    */
  } else {
    // Legacy path: single photo or no photos — use existing re-shoot strategies.
    const finishRenderContext: ViewpointRenderContext = {
      floorPlanContext: await buildRoomFloorPlanContext(state, roomId),
      designConsistencyText: [
        buildConceptPromptBlock(state, brief),
        buildRoomIntentText(brief, detectedRoom),
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
    const viewpointPhotos = roomPhotos.filter((p) => p.viewpoint);
    if (finishStrategy === "viewpoint") {
      room.renders = await generateRoomViewpointRenders(
        finalImage,
        brief,
        state.analysis,
        viewpointPhotos,
        finishRenderContext,
      );
    } else if (finishStrategy === "photoReference") {
      room.renders = await generateRoomPhotoReferenceRenders(
        finalImage,
        brief,
        state.analysis,
        roomPhotos,
        finishRenderContext,
      );
    } else {
      room.renders = await generateRoomAngleVariations(finalImage, brief, state.analysis);
    }
  }
  }

  if (mode === "views-only") {
    room.status = "review";
    state.status = "reviewing";
    await setProject(state);
    pipelineLog("FINISH_ROOM", "all viewpoint renders ready for review", {
      projectId,
      roomId,
      renderCount: room.renders.length,
      targetCount: targets.length,
    });
    onProgress?.({
      phase: "complete",
      message: "All views ready — review every angle before approving",
      progress: 1.0,
      room: brief.roomName,
      data: { room: sanitizeRoomResult(room) },
    });
    return state;
  }

  // Custom design has no catalog tie — skip materials/products entirely. The
  // render + technical drawings (built from the floor-plan analysis) are still
  // produced downstream.
  if (isFreeRenderMode(resolveDesignMode(state.preferences.designMode))) {
    room.usedScrapedProducts = [];
    room.selectedCatalogIds = [];
    room.materials = null;
  } else {
    // Collect purchasable products from every phase (base + furniture + decor), not
    // just the terminal one — otherwise furniture confirmed in earlier phases is lost
    // and the PDF falls back to the flooring-only material spec. Mirrors the
    // selectedCatalogIds merge below.
    const allLinks = [
      ...room.phases.base.productLinks,
      ...room.phases.furniture.productLinks,
      ...room.phases.decor.productLinks,
    ];
    const seenMp = new Set<number>();
    room.usedScrapedProducts = allLinks
      .map(marketplaceMatchFromProductLink)
      .filter((m) => m.marketplaceId > 0 && !seenMp.has(m.marketplaceId) && seenMp.add(m.marketplaceId) !== undefined);
    room.selectedCatalogIds = [
      ...new Set([
        ...room.phases.base.selectedCatalogIds,
        ...room.phases.furniture.selectedCatalogIds,
        ...room.phases.decor.selectedCatalogIds,
      ]),
    ];

    onProgress?.({ phase: "materials", message: "Compiling materials...", progress: 0.8, room: brief.roomName });
    try {
      const allowIds = state.scrapedRoomAllowlists?.[roomId] ?? [];
      const merged = mergeAllowlistWithPinned(allowIds, state.pinnedProductIds);
      const materials = await buildMaterialSpecFromBrief(brief, {
        scrapedInventoryExclusive: true,
        scrapedAllowlistNumericIds: merged,
      });
      room.materials = materials;
      if (room.usedScrapedProducts.length === 0) {
        room.usedScrapedProducts = marketplaceMatchesFromMaterialSpec(materials);
      }
    } catch (err) {
      console.error(`Material extraction failed for ${brief.roomName}:`, err);
    }
  }

  room.status = "approved";
  room.version += 1;
  state.approvedDesignSummaries[roomId] = buildApprovedDesignSummary(room, state.concept);
  state.status = "reviewing";
  await setProject(state);

  onProgress?.({
    phase: "complete",
    message: "Room complete",
    progress: 1.0,
    room: brief.roomName,
    data: { room: sanitizeRoomResult(room) },
  });
  return state;
}

// ---------------------------------------------------------------------------
// Phase 3: Handle room action (interactive)
// ---------------------------------------------------------------------------

export async function handleRoomAction(
  projectId: string,
  action: RoomEditRequest,
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.concept || !state.analysis) throw new Error("Project not initialized");

  let room = state.rooms.find((r) => r.roomId === action.roomId);
  const brief = state.concept.rooms.find((b) => b.roomId === action.roomId);
  if (!brief) throw new Error(`Room ${action.roomId} not found in project`);

  if (!room) {
    room = {
      roomId: action.roomId,
      status: "pending",
      brief,
      renders: [],
      materials: null,
      editHistory: [],
      version: 1,
      usedScrapedProducts: [],
    };
    state.rooms.push(room);
  }

  if (action.action === "approve") {
    room.status = "approved";
    if (state.concept) {
      state.approvedDesignSummaries[action.roomId] = buildApprovedDesignSummary(room, state.concept);
    }

    if (canFinalizeProject(state)) {
      state.status = "reviewing";
    }

    await setProject(state);
    return state;
  }

  if (action.action === "regenerate") {
    room.status = "generating";
    await setProject(state);

    try {
      const allowIds = await ensureRoomScrapedAllowlist(state, room.brief.roomId, room.brief);
      const renderOpts = await buildRenderOptions(state, allowIds, room.brief.roomId);
      const renderResult = await generateRoomRenders(
        room.brief,
        state.concept,
        state.analysis,
        resolveRoomReferencePhoto(state, room.brief.roomId),
        renderOpts,
      );
      await finalizeRoomGeneration(
        room,
        room.brief,
        renderResult,
        toExtractOptions(renderOpts),
      );
      room.version += 1;
      room.status = "review";
    } catch (err) {
      room.status = "review";
      console.error(`Failed to regenerate room ${room.brief.roomName}:`, err);
    }
    await setProject(state);
    return state;
  }

  if (action.action === "edit" && action.editFeedback) {
    room.status = "editing";
    room.editHistory.push({
      feedback: action.editFeedback,
      timestamp: new Date().toISOString(),
    });
    await setProject(state);

    try {
      const crossRoomContext = buildCrossRoomConsistencyBlock(
        state.concept,
        state.approvedDesignSummaries,
      );
      const updatedBrief = await interpretRoomEdit(
        action.editFeedback,
        room.brief,
        state.concept,
        crossRoomContext,
      );
      room.brief = updatedBrief;

      room.status = "generating";
      await setProject(state);

      const allowIds = await ensureRoomScrapedAllowlist(state, updatedBrief.roomId, updatedBrief, true);
      const renderOpts = await buildRenderOptions(state, allowIds, updatedBrief.roomId);
      const renderResult = await generateRoomRenders(
        updatedBrief,
        state.concept,
        state.analysis,
        resolveRoomReferencePhoto(state, updatedBrief.roomId),
        renderOpts,
      );
      await finalizeRoomGeneration(
        room,
        updatedBrief,
        renderResult,
        toExtractOptions(renderOpts),
      );
      room.version += 1;
      room.status = "review";
    } catch (err) {
      room.status = "review";
      console.error(`Failed to edit room ${room.brief.roomName}:`, err);
    }
    await setProject(state);
    return state;
  }

  return state;
}

// ---------------------------------------------------------------------------
// Phase 4-5: Finalize project
// ---------------------------------------------------------------------------

export function finalizeProject(
  projectId: string,
  options?: { locale?: VistaLocale },
): Promise<ProjectState> {
  return runWithLogContext(projectId, () => finalizeProjectImpl(projectId, options));
}

async function finalizeProjectImpl(
  projectId: string,
  options?: { locale?: VistaLocale },
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.concept || !state.analysis) throw new Error("Project not initialized");

  if (!canFinalizeProject(state)) {
    throw new Error("Approve all rooms before finishing the project.");
  }

  if (options?.locale) {
    state.locale = options.locale;
  }

  state.status = "finalizing";
  await setProject(state);

  try {
    const locale =
      options?.locale ?? (state.locale && isVistaLocale(state.locale) ? state.locale : undefined);
    const pdfBuffer = await assemblePDF(state, { locale, rendersOnly: true });
    state.pdfBase64 = pdfBuffer.toString("base64");
    state.status = "complete";
    await setProject(state);

    if (state.laravelProjectId) {
      await persistProjectPdf(state.laravelProjectId, pdfBuffer);
    }

    return state;
  } catch (err) {
    state.status = "failed";
    state.error = err instanceof Error ? err.message : "Finalization failed";
    await setProject(state);
    throw err;
  }
}

/**
 * Re-assemble the PDF with a different section selection (e.g. the user
 * deselected the electrical/flooring plans on the complete screen). Reuses the
 * already-generated technical drawings, elevations, renders and materials — no
 * model calls — so this is cheap.
 */
export async function regenerateProjectPdf(
  projectId: string,
  options: { locale?: VistaLocale; sections?: PdfSectionSelection },
): Promise<ProjectState> {
  const state = await getProject(projectId);
  if (!state) throw new Error(`Project ${projectId} not found`);
  if (!state.concept || !state.analysis) throw new Error("Project not initialized");

  const locale =
    options.locale ?? (state.locale && isVistaLocale(state.locale) ? state.locale : undefined);
  if (options.locale) state.locale = options.locale;

  const pdfBuffer = await assemblePDF(state, {
    locale,
    sections: options.sections,
    rendersOnly: !state.technicalDrawings,
  });
  state.pdfBase64 = pdfBuffer.toString("base64");
  await setProject(state);

  if (state.laravelProjectId) {
    await persistProjectPdf(state.laravelProjectId, pdfBuffer);
  }

  return state;
}

export async function setRoomPhotos(
  projectId: string,
  photos: { roomId: string; base64: string; mimeType: string }[],
): Promise<void> {
  const state = await getProject(projectId);
  if (!state) return;
  for (const p of photos) {
    state.roomPhotos[p.roomId] = { base64: p.base64, mimeType: p.mimeType };
  }
  await setProject(state);
}

export async function isReadyToFinalize(projectId: string): Promise<boolean> {
  const state = await getProject(projectId);
  if (!state) return false;
  return canFinalizeProject(state);
}
