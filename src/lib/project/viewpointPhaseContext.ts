/**
 * Per-viewpoint generation context.
 *
 * Extracts the viewpoint-specific logic from the orchestrator into reusable
 * helpers so each marked camera viewpoint gets its own independent phased
 * pipeline (base → furniture → decor) with per-viewpoint opening locks,
 * cone diagrams, and photo analysis — no cross-angle contamination.
 *
 * Multi-photo handling (unified FAL pipeline):
 *   Master photo (targets[0]) drives renderMasterAngle — inpainting with opening
 *   freeze mask when photoWindowBoxes/photoDoorBoxes are confirmed; inspiration
 *   IP-Adapter applies Pinterest style. Seed + prompt snapshot persist on RoomResult.
 *   Secondary photos render via renderSecondaryAngle — flux-general with hero
 *   IP-Adapter + locked seed, no opening freeze (boxes are primary-camera only).
 *   Opening bboxes empty → master falls back to img2img without mask.
 */

import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import { pipelineLog } from "@/lib/pipelineLog";
import {
  detectedRoomToRoomAnalysis,
  planDoorInventoryForLock,
  type DetectedRoomLockOptions,
} from "./detectedRoomToRoomAnalysis";
import type {
  DetectedRoom,
  DesignPhase,
  ProjectState,
  RoomPhases,
  RoomPhotoWithViewpoint,
} from "./types";
import { getRoomPhotos, getRoomPhoto } from "./types";
import {
  resolveViewpointFraming,
  framingVisibleOpenings,
  photoVerifiedVisibleOpenings,
  compassToCameraWallMap,
  type ViewpointFraming,
  type VisibleOpeningExpectation,
} from "./viewpointFraming";
import { analyzePhotoWithViewpoint } from "./viewpointPhotoAnalyzer";
import { formatViewpointAnalysisForPrompt } from "./viewpointPhotoAnalyzer";
import { renderViewpointDiagram } from "./viewpointDiagram";
import { annotateOpenings, OPENING_MARKER_PROMPT } from "@/lib/annotateOpenings";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import {
  allStructuralColumnBoxes,
  gatePhotoConfirmedColumns,
  PHOTO_STRUCTURAL_PROMPT_ELEMENT_MAX,
} from "@/lib/photoStructuralElements";
import { buildOpeningValidationContext } from "@/lib/openingValidationContext";

// Re-export for orchestrator convenience.
export { resolveViewpointFraming, framingVisibleOpenings, photoVerifiedVisibleOpenings };

export type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

export interface ViewpointPhaseContext {
  photo: RoomPhotoWithViewpoint;
  framing: ViewpointFraming | undefined;
  visibleOpenings: VisibleOpeningExpectation | undefined;
  lockAnalysis: RoomAnalysis | null;
  viewpointBlock: string;
  viewpointParts: GeminiPart[];
  /** Colored D/W box guide + prompt (subset of viewpointParts — no cone diagram). */
  openingGuideParts: GeminiPart[];
  /** Confirmed photo-space opening boxes for freeze-mask generation. */
  photoWindowBoxes: OpeningBox[];
  /** Confirmed photo-space door boxes for freeze-mask generation. */
  photoDoorBoxes: OpeningBox[];
  /** Confirmed photo-space column/post/pier boxes for Stage 1 freeze mask. */
  photoColumnBoxes: OpeningBox[];
  cameraAngleForLock: string | undefined;
  /** Authoritative floor plan + viewpoint data for opening validation gates. */
  openingValidationContext?: string;
}

function withPhotoStructuralElements(
  lockAnalysis: ReturnType<typeof detectedRoomToRoomAnalysis>,
  viewpointAnalysis: import("./types").ViewpointPhotoAnalysis | undefined,
  roomId: string,
  photoId: string,
): ReturnType<typeof detectedRoomToRoomAnalysis> {
  if (!lockAnalysis) return null;

  const gate = gatePhotoConfirmedColumns(viewpointAnalysis);
  const logPayload = { ...gate.log, roomId, photoId };
  if (gate.confirmed.length > PHOTO_STRUCTURAL_PROMPT_ELEMENT_MAX) {
    logPayload.structuralPromptTruncated = {
      total: gate.confirmed.length,
      inPrompt: PHOTO_STRUCTURAL_PROMPT_ELEMENT_MAX,
      inMask: gate.confirmed.length,
    };
  }
  pipelineLog("STRUCTURAL", "photo column gate", logPayload);

  return {
    ...lockAnalysis,
    photoConfirmedStructuralElements: gate.confirmed,
  };
}

function emptyPhotoStructuralLock(
  detectedRoom: DetectedRoom | undefined,
  lockOpts?: DetectedRoomLockOptions,
): ReturnType<typeof detectedRoomToRoomAnalysis> {
  const base = detectedRoomToRoomAnalysis(detectedRoom, lockOpts);
  if (!base) return null;
  return { ...base, photoConfirmedStructuralElements: [] };
}

/**
 * Resolve which photos should each get their own designed render.
 * When 2+ photos are assigned, ALL get a render (viewpoint-marked sorted first
 * so index 0 is the primary/hero). Single photo → single target.
 */
export function getViewpointGenerationTargets(
  state: ProjectState,
  roomId: string,
): RoomPhotoWithViewpoint[] {
  const all = getRoomPhotos(state, roomId);
  if (all.length === 0) {
    const legacy = getRoomPhoto(state, roomId);
    if (legacy) {
      return [{
        id: `legacy-${roomId}`,
        base64: legacy.base64,
        mimeType: legacy.mimeType,
        label: "Room photo",
        viewpoint: undefined,
      }];
    }
    return [];
  }
  // When multiple photos are assigned, every photo is a render target.
  // Viewpoint-marked photos are sorted first so the primary hero is index 0.
  if (all.length >= 2) {
    return [...all].sort((a, b) => (b.viewpoint ? 1 : 0) - (a.viewpoint ? 1 : 0));
  }
  return [all[0]];
}

/** True when the room has multiple assigned photos (each gets its own render). */
export function isMultiViewpointRoom(
  state: ProjectState,
  roomId: string,
): boolean {
  return getViewpointGenerationTargets(state, roomId).length > 1;
}

/**
 * Build per-viewpoint context for a single photo target. This replaces the
 * inline viewpoint logic that was in `generateRoomPhase` (~L1040–1102).
 *
 * Performs lazy viewpoint photo analysis (cached on `uploadedPhotos[].viewpointAnalysis`).
 */
export async function buildViewpointPhaseContext(
  state: ProjectState,
  roomId: string,
  photo: RoomPhotoWithViewpoint,
  detectedRoom: DetectedRoom | undefined,
  hasPhoto: boolean,
): Promise<ViewpointPhaseContext> {
  if (!photo.viewpoint) {
    const lockAnalysis = emptyPhotoStructuralLock(detectedRoom, {
      planColumns: state.analysis?.columns,
    });
    return {
      photo,
      framing: undefined,
      visibleOpenings: undefined,
      lockAnalysis,
      viewpointBlock: "",
      viewpointParts: [],
      openingGuideParts: [],
      photoWindowBoxes: [],
      photoDoorBoxes: [],
      photoColumnBoxes: [],
      cameraAngleForLock: undefined,
      openingValidationContext: buildOpeningValidationContext({
        lockAnalysis,
        detectedRoom,
      }),
    };
  }

  const framing = resolveViewpointFraming(photo.viewpoint, detectedRoom);
  const cameraAngleForLock = framing.note;
  let visibleOpenings: VisibleOpeningExpectation | undefined = framingVisibleOpenings(framing);

  // Lazy viewpoint photo analysis disabled for FAL-direct — plan geometry + framing only.
  /* GPT viewpoint photo analysis (disabled for FAL-direct project flow)
  const uploadedPhoto = state.uploadedPhotos.find((p) => p.id === photo.id);
  if (uploadedPhoto && !uploadedPhoto.viewpointAnalysis) {
    try {
      const cone = detectedRoom
        ? await renderViewpointDiagram(detectedRoom, photo.viewpoint)
        : null;
      uploadedPhoto.viewpointAnalysis = await analyzePhotoWithViewpoint(
        photo.base64,
        photo.mimeType,
        framing,
        cone ?? undefined,
      );
      ...
    } catch (err) { ... }
  }
  */

  const uploadedPhoto = state.uploadedPhotos.find((p) => p.id === photo.id);
  if (uploadedPhoto?.viewpointAnalysis && uploadedPhoto.viewpointAnalysis.walls.length > 0) {
    const photoOpenings = photoVerifiedVisibleOpenings(uploadedPhoto.viewpointAnalysis);
    // Cap photo-detected doors: in hallways/corridors the photo analysis may
    // over-detect wall edges as door openings. The camera can see at most the
    // room's own doors + 1 doorway from an adjacent room visible through one.
    const planDoors = detectedRoom?.doors.length ?? 0;
    const maxVisibleDoors = Math.max(planDoors + 1, 1);
    if (photoOpenings.doorCount > maxVisibleDoors) {
      pipelineLog("ROOM_OPENINGS", "clamping photo door count", {
        roomId,
        photoId: photo.id,
        photoDoorCount: photoOpenings.doorCount,
        planDoorCount: planDoors,
        clampedTo: maxVisibleDoors,
      }, "warn");
      photoOpenings.doorCount = maxVisibleDoors;
      photoOpenings.doorPositions = photoOpenings.doorPositions.slice(0, maxVisibleDoors);
    }

    // Cap photo-detected windows the same way: the floor plan is the authority
    // for how many windows the room actually has. The photo analyzer can
    // misidentify reflective surfaces, glass panels, or light patches as windows.
    const planWindows = detectedRoom?.windows.length ?? 0;
    const maxVisibleWindows = Math.max(planWindows + 1, planWindows === 0 ? 0 : 1);
    if (photoOpenings.windowCount > maxVisibleWindows) {
      pipelineLog("ROOM_OPENINGS", "clamping photo window count", {
        roomId,
        photoId: photo.id,
        photoWindowCount: photoOpenings.windowCount,
        planWindowCount: planWindows,
        clampedTo: maxVisibleWindows,
      }, "warn");
      photoOpenings.windowCount = maxVisibleWindows;
      photoOpenings.windowPositions = photoOpenings.windowPositions.slice(0, maxVisibleWindows);
    }

    visibleOpenings = photoOpenings;
  }

  let viewpointBlock = "";
  if (uploadedPhoto?.viewpointAnalysis) {
    viewpointBlock = formatViewpointAnalysisForPrompt(framing, uploadedPhoto.viewpointAnalysis, detectedRoom);
  } else {
    viewpointBlock = `CAMERA VANTAGE (match the reference photo's exact viewpoint, do NOT change the camera): ${framing.note}\n${framing.openingsSummary}`;
  }

  // Collect the confirmed window/door bounding boxes from the photo analysis once.
  // Windows carry true vertical placement (sill/head) + visible width that a 2D
  // floor plan can't — they feed both the opening lock (sill directive) and the
  // annotated guide image below.
  let windowBoxes: OpeningBox[] = [];
  const doorBoxes: OpeningBox[] = [];
  for (const wall of uploadedPhoto?.viewpointAnalysis?.walls ?? []) {
    for (const op of wall.openings) {
      if (!op.confirmed || !op.bbox) continue;
      (op.type === "door" ? doorBoxes : windowBoxes).push(op.bbox);
    }
  }

  // If windows were clamped to 0, drop all window boxes too — no phantom markers.
  if (visibleOpenings && visibleOpenings.windowCount === 0) {
    windowBoxes = [];
  } else if (visibleOpenings && windowBoxes.length > visibleOpenings.windowCount) {
    windowBoxes = windowBoxes.slice(0, visibleOpenings.windowCount);
  }

  const lockOpts: DetectedRoomLockOptions = {
    cameraAngle: cameraAngleForLock,
    planColumns: state.analysis?.columns,
    windowConfidence: hasPhoto ? "high" : undefined,
    doorConfidence: hasPhoto ? "high" : undefined,
    compassToCameraWall: compassToCameraWallMap(framing),
    wallLengthsM: framing.wallLengthsM,
    ...(windowBoxes.length ? { photoWindowBoxes: windowBoxes } : {}),
    ...planDoorInventoryForLock(detectedRoom, compassToCameraWallMap(framing)),
    ...(visibleOpenings
      ? {
          photoWindowCount: visibleOpenings.windowCount,
          photoDoorCount: visibleOpenings.doorCount,
          photoWindowPositions: visibleOpenings.windowPositions,
          photoDoorPositions: visibleOpenings.doorPositions,
        }
      : {}),
  };
  const lockAnalysis = withPhotoStructuralElements(
    detectedRoomToRoomAnalysis(detectedRoom, lockOpts),
    uploadedPhoto?.viewpointAnalysis,
    roomId,
    photo.id,
  );
  const photoColumnBoxes = allStructuralColumnBoxes(
    lockAnalysis?.photoConfirmedStructuralElements ?? [],
  );
  pipelineLog("ROOM_OPENINGS", "viewpoint opening lock composed", {
    roomId,
    photoId: photo.id,
    visibleWindowCount: visibleOpenings?.windowCount ?? null,
    visibleDoorCount: visibleOpenings?.doorCount ?? null,
    planDoorCount: lockAnalysis?.plan_door_count ?? null,
    lockWindowCount: lockAnalysis?.window_count ?? null,
    lockDoorCount: lockAnalysis?.door_count ?? null,
  });

  const viewpointParts: GeminiPart[] = [];
  if (detectedRoom) {
    const cone = await renderViewpointDiagram(detectedRoom, photo.viewpoint);
    if (cone) {
      viewpointParts.push({
        text: "VANTAGE DIAGRAM (top-down floor plan): the dot is the camera and the shaded wedge is its field of view. Spatial reference ONLY — keep the photo's exact camera; use this to place walls, windows, doors, and finishes correctly.",
      });
      viewpointParts.push({ inlineData: { mimeType: cone.mimeType, data: cone.base64 } });
    }
  }

  const openingGuideParts: GeminiPart[] = [];
  if (uploadedPhoto?.viewpointAnalysis) {
    const guide = await annotateOpenings(photo.base64, photo.mimeType, windowBoxes, doorBoxes);
    if (guide) {
      openingGuideParts.push({ text: OPENING_MARKER_PROMPT });
      openingGuideParts.push({ inlineData: { mimeType: guide.mimeType, data: guide.data } });
      viewpointParts.push(...openingGuideParts);
    }
  }

  const openingValidationContext = buildOpeningValidationContext({
    framing,
    visibleOpenings,
    lockAnalysis,
    detectedRoom,
  });

  return {
    photo,
    framing,
    visibleOpenings,
    lockAnalysis,
    viewpointBlock,
    viewpointParts,
    openingGuideParts,
    photoWindowBoxes: windowBoxes,
    photoDoorBoxes: doorBoxes,
    photoColumnBoxes,
    cameraAngleForLock,
    openingValidationContext,
  };
}

/**
 * Resolve the base image for a specific phase within a viewpoint track.
 * - base phase: the original room photo
 * - furniture: the selected base render from this track
 * - decor: the selected furniture render from this track
 */
export function resolvePhaseBaseImage(
  phase: DesignPhase,
  photo: RoomPhotoWithViewpoint,
  trackPhases: RoomPhases | undefined,
): { base64: string; mimeType: string } | null {
  if (phase === "base") {
    // A photo-less fallback target carries an empty base64 — treat it as "no
    // base image" so the base phase renders floor-plan-grounded instead of
    // sending an empty inline image to Gemini.
    if (!photo.base64) return null;
    return { base64: photo.base64, mimeType: photo.mimeType };
  }
  if (!trackPhases) return null;
  const prev = phase === "furniture" ? trackPhases.base : trackPhases.furniture;
  if (prev.versions.length === 0) return null;
  const selected = prev.versions[prev.selectedIndex] ?? prev.versions[prev.versions.length - 1];
  return { base64: selected.base64, mimeType: selected.mimeType };
}
