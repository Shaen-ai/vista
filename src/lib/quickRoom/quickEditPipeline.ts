import "server-only";

import sharp from "sharp";
import { isOrientationFlip } from "@/lib/editAspectRatio";
import { renderEditStaging } from "@/lib/falEditRenderer";
import { validateProjectRender, isRenderValidationEnabled } from "@/lib/project/renderValidation";
import {
  hasStructuralFailure,
  pickBestEditAttempt,
  resolveEditRetryLimit,
  type EditAttemptRecord,
} from "@/lib/project/editRetryPolicy";
import { buildGeometryAnchorSentence } from "@/lib/project/editPromptAssembly";
import { analyzePhotoOpenings } from "@/lib/project/photoOpeningAnalysis";
import { applyPhotoPrepErase } from "@/lib/project/photoPrepErase";
import { normalizeStructuralLineMap } from "@/lib/extractUserStructuralLines";
import { buildStructuralMarkupComposite } from "@/lib/buildStructuralMarkupComposite";
import { detectHeroCopy, isHeroCopyGuardEnabled } from "@/lib/falStyleRefCopyGuard";
import { pipelineLog } from "@/lib/pipelineLog";
import type { DesignBrief, OpeningBox, RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { QuickRoomPlacementMode } from "@/lib/quickRoom/placementMode";
import {
  buildQuickRoomEditInstruction,
  buildQuickRoomImageRoles,
} from "./quickEditPrompt";

/** Collage sheets beyond this are dropped from the image list (their SKUs stay in the text manifest). */
const MAX_PRODUCT_SHEETS = 6;

export interface QuickEditProgressEvent {
  step: "openings" | "prep" | "render" | "validate" | "retry";
  message: string;
  /** 0..1 within the render stage (the route maps this onto its own progress band). */
  progress: number;
}

export interface QuickEditPipelineInput {
  sessionId: string;
  roomPhotoBase64: string;
  roomPhotoMime: string;
  /** Client-provided analysis (window/door boxes measured on the original photo). */
  roomAnalysis: RoomAnalysis | null;
  /** True when the "photo" is a previously generated render (keepRoomShape edit loop) — client boxes are stale. */
  isEditOfRender: boolean;
  placementMode?: QuickRoomPlacementMode;
  objectRemovalMaskBase64?: string | null;
  structuralLineMap?: { base64: string; strokeOnly: boolean } | null;
  /** Product collage sheets from buildGeminiProductVisualParts. */
  productSheetInlines: Array<{ mimeType: string; data: string }>;
  styleInspiration?: { base64: string; mimeType: string } | null;
  brief: DesignBrief;
  designStyleLabel: string;
  productIntroText?: string;
  productCloseText?: string;
  merchantAppendix?: string;
  editContext?: string;
  furnitureLabels?: string[];
  onProgress?: (ev: QuickEditProgressEvent) => void | Promise<void>;
}

export interface QuickEditPipelineResult {
  image: { base64: string; mimeType: string };
  validationPassed: boolean;
  attempts: number;
  validationWarning?: string;
  openingBoxCounts?: { windows: number; doors: number };
  droppedSheetCount: number;
}

const COLLAGE_COPY_CORRECTION =
  "CORRECTION: Your previous output reproduced a PRODUCT REFERENCE SHEET (a collage grid of product photos) instead of editing the room photo. That is wrong. The output must be the FIRST image's room, redesigned — never a collage, grid, or product sheet.";

const ORIENTATION_FLIP_CORRECTION =
  "CORRECTION: Your previous output changed the image orientation (landscape vs portrait) relative to the FIRST image. That reframes the room and distorts its geometry. The output must keep the FIRST image's exact orientation, aspect ratio, camera position, and framing.";

/** Attempt-record marker so acceptBest can avoid orientation-flipped frames. */
const ORIENTATION_FLIP_FAILURE = "orientation_flip";

export async function runQuickRoomEditPipeline(
  input: QuickEditPipelineInput,
): Promise<QuickEditPipelineResult> {
  const pipelineStart = Date.now();
  const emit = async (ev: QuickEditProgressEvent) => {
    await input.onProgress?.(ev);
  };
  const projectId = `quick-${input.sessionId}`;
  const roomId = "quick";
  const photoId = "master";

  // 1. Opening boxes — client analysis when trustworthy, else Claude detection.
  let windowBoxes: OpeningBox[] | undefined = input.roomAnalysis?.window_boxes;
  let doorBoxes: OpeningBox[] | undefined = input.roomAnalysis?.door_boxes;
  const clientBoxesUsable =
    !input.isEditOfRender && ((windowBoxes?.length ?? 0) > 0 || (doorBoxes?.length ?? 0) > 0);
  if (!clientBoxesUsable) {
    await emit({ step: "openings", message: "Reading the room's windows and doors…", progress: 0.05 });
    const analyzed = await analyzePhotoOpenings({
      photoBase64: input.roomPhotoBase64,
      photoMime: input.roomPhotoMime,
      photoId,
      projectId,
      roomId,
    });
    windowBoxes = analyzed?.window_boxes;
    doorBoxes = analyzed?.door_boxes;
  }
  const hasBoxes = (windowBoxes?.length ?? 0) > 0 || (doorBoxes?.length ?? 0) > 0;
  const openingBoxCounts = hasBoxes
    ? { windows: windowBoxes?.length ?? 0, doors: doorBoxes?.length ?? 0 }
    : undefined;

  // 2. Erase prep — object removal with opening-freeze protection (pass-through without a mask).
  const hadRemovalMask = !!input.objectRemovalMaskBase64?.trim();
  if (hadRemovalMask) {
    await emit({ step: "prep", message: "Removing the marked items…", progress: 0.12 });
  }
  const prep = await applyPhotoPrepErase({
    projectId,
    roomId,
    photoId,
    photoBase64: input.roomPhotoBase64,
    photoMime: input.roomPhotoMime,
    maskBase64: input.objectRemovalMaskBase64 ?? undefined,
    openingAnalysis: hasBoxes ? { window_boxes: windowBoxes, door_boxes: doorBoxes } : null,
  });

  // 3. User-drawn structural boundary lines → gold-line markup as a separate
  //    roles image (baking strokes into the edit target risks them bleeding
  //    into the output — same pattern as the gallery-refine annotation image).
  let structuralMarkup: { base64: string; mimeType: string } | null = null;
  if (input.structuralLineMap?.base64?.trim()) {
    try {
      const normalized = await normalizeStructuralLineMap({
        lineMapBase64: input.structuralLineMap.base64,
        originalPhotoBase64: input.roomPhotoBase64,
        strokeOnly: input.structuralLineMap.strokeOnly,
      });
      structuralMarkup = await buildStructuralMarkupComposite({
        photoBase64: prep.prepBase64,
        strokeMapBase64: normalized.base64,
      });
    } catch (err) {
      pipelineLog(
        "FAL_PIPELINE",
        "quick room structural markup failed — continuing without it",
        { projectId, error: String(err).slice(0, 200) },
        "warn",
      );
    }
  }

  // 4. Image list: room photo first (sole geometry authority), then product
  //    sheets, optional style inspiration, optional structural markup last.
  const sheets = input.productSheetInlines.slice(0, MAX_PRODUCT_SHEETS);
  const droppedSheetCount = input.productSheetInlines.length - sheets.length;
  if (droppedSheetCount > 0) {
    pipelineLog("FAL_PIPELINE", "quick room collage sheets over cap — dropped from image list", {
      projectId,
      kept: sheets.length,
      dropped: droppedSheetCount,
    });
  }
  const imageBase64List = [
    prep.prepBase64,
    ...sheets.map((s) => s.data),
    ...(input.styleInspiration ? [input.styleInspiration.base64] : []),
    ...(structuralMarkup ? [structuralMarkup.base64] : []),
  ];
  const imageMimeList = [
    prep.prepMime,
    ...sheets.map((s) => s.mimeType),
    ...(input.styleInspiration ? [input.styleInspiration.mimeType] : []),
    ...(structuralMarkup ? [structuralMarkup.mimeType] : []),
  ];

  const imageRoles = buildQuickRoomImageRoles({
    collageSheetCount: sheets.length,
    hasStyleInspiration: !!input.styleInspiration,
    hasStructuralMarkup: !!structuralMarkup,
  });
  const basePrompt = buildQuickRoomEditInstruction({
    brief: input.brief,
    designStyleLabel: input.designStyleLabel,
    openingBoxCounts,
    imageRoles,
    productIntroText: input.productIntroText,
    productCloseText: input.productCloseText,
    merchantAppendix: input.merchantAppendix,
    editContext: input.editContext,
    placementMode: input.placementMode,
  });
  pipelineLog("FAL_RENDER", "quick room edit pipeline start", {
    projectId,
    imageCount: imageBase64List.length,
    promptChars: basePrompt.length,
    openingBoxCounts,
    hadRemovalMask,
    hasStructuralMarkup: !!structuralMarkup,
    droppedSheetCount,
  });

  // 5. Render + validate ladder (master-only port of the Full Project
  //    runEditWithValidation retry pattern).
  const validationEnabled = isRenderValidationEnabled();
  const attemptRecords: EditAttemptRecord[] = [];
  let prompt = basePrompt;
  let attempt = 1;

  // Edit-target dimensions for the deterministic orientation gate below.
  let targetWidth = 0;
  let targetHeight = 0;
  try {
    const targetMeta = await sharp(Buffer.from(prep.prepBase64, "base64")).metadata();
    targetWidth = targetMeta.width ?? 0;
    targetHeight = targetMeta.height ?? 0;
  } catch {
    /* gate simply skips when the probe fails */
  }

  for (;;) {
    await emit({
      step: attempt === 1 ? "render" : "retry",
      message:
        attempt === 1
          ? "Rendering your interior…"
          : `Refining the render (attempt ${attempt})…`,
      progress: attempt === 1 ? 0.25 : 0.55,
    });

    const rendered = await renderEditStaging({
      imageBase64List,
      imageMimeList,
      prompt,
      projectId,
      roomId,
      photoId,
      stage: "master",
      sessionId: input.sessionId,
      label: `quick-room-edit-attempt-${attempt}`,
    });

    if (!validationEnabled) {
      pipelineLog("FAL_RENDER", "quick room edit pipeline complete", {
        projectId,
        attempts: attempt,
        validationPassed: true,
        validated: false,
        durationMs: Date.now() - pipelineStart,
      });
      return {
        image: rendered,
        validationPassed: true,
        attempts: attempt,
        openingBoxCounts,
        droppedSheetCount,
      };
    }

    await emit({ step: "validate", message: "Checking the room's shape…", progress: 0.82 });

    // Deterministic orientation gate: a landscape→portrait (or reverse) output
    // means the model reframed the room instead of editing it — the geometry is
    // re-invented to fill the new canvas. Free check, runs before any judge.
    if (
      isOrientationFlip(targetWidth, targetHeight, rendered.width ?? 0, rendered.height ?? 0)
    ) {
      pipelineLog(
        "VALIDATE",
        "quick room render flipped orientation vs room photo",
        {
          projectId,
          attempt,
          target: `${targetWidth}x${targetHeight}`,
          rendered: `${rendered.width}x${rendered.height}`,
        },
        "warn",
      );
      attemptRecords.push({
        attempt,
        rendered,
        validation: {
          pass: false,
          reason: "render orientation flipped vs room photo",
          failureTypes: ["geometry_drift", ORIENTATION_FLIP_FAILURE],
          correctiveFeedback: ORIENTATION_FLIP_CORRECTION,
        },
        validationPassed: false,
      });
      if (attempt < resolveEditRetryLimit(["geometry_drift"])) {
        prompt = `${prompt} ${ORIENTATION_FLIP_CORRECTION}`;
        attempt += 1;
        continue;
      }
      return acceptBest(attemptRecords, openingBoxCounts, droppedSheetCount, projectId, pipelineStart);
    }

    // Deterministic collage-copy gate: the model occasionally re-renders a
    // product sheet instead of the room. Cheap Pearson check before the judge.
    if (sheets.length > 0 && isHeroCopyGuardEnabled()) {
      const copyCheck = await detectHeroCopy({
        outputBase64: rendered.base64,
        heroBase64: sheets[0].data,
        editTargetBase64: prep.prepBase64,
      });
      if (copyCheck.detected) {
        pipelineLog(
          "VALIDATE",
          "quick room render copied a product reference sheet",
          { projectId, attempt },
          "warn",
        );
        attemptRecords.push({
          attempt,
          rendered,
          validation: {
            pass: false,
            reason: "render copied a product reference sheet",
            failureTypes: ["hero_copy"],
            correctiveFeedback: COLLAGE_COPY_CORRECTION,
          },
          validationPassed: false,
        });
        if (attempt < resolveEditRetryLimit(["hero_copy"])) {
          prompt = `${prompt} ${COLLAGE_COPY_CORRECTION}`;
          attempt += 1;
          continue;
        }
        return acceptBest(attemptRecords, openingBoxCounts, droppedSheetCount, projectId, pipelineStart);
      }
    }

    const validation = await validateProjectRender({
      mode: "master",
      originalBase64: input.roomPhotoBase64,
      originalMime: input.roomPhotoMime,
      renderedBase64: rendered.base64,
      renderedMime: rendered.mimeType,
      windowBoxes,
      doorBoxes,
      hadRemovalMask,
      projectId,
      roomId,
      photoId,
      label: `quick-master-attempt-${attempt}`,
      furnitureLabels: input.furnitureLabels,
    });

    attemptRecords.push({ attempt, rendered, validation, validationPassed: validation.pass });

    if (validation.pass) {
      pipelineLog("FAL_RENDER", "quick room edit pipeline complete", {
        projectId,
        attempts: attempt,
        validationPassed: true,
        validated: true,
        durationMs: Date.now() - pipelineStart,
      });
      return {
        image: rendered,
        validationPassed: true,
        attempts: attempt,
        openingBoxCounts,
        droppedSheetCount,
      };
    }

    const retryLimit = resolveEditRetryLimit(validation.failureTypes);
    if (attempt >= retryLimit) {
      return acceptBest(attemptRecords, openingBoxCounts, droppedSheetCount, projectId, pipelineStart);
    }

    const corrective = validation.correctiveFeedback ?? validation.reason;
    const geometryAnchor = hasStructuralFailure(validation.failureTypes)
      ? buildGeometryAnchorSentence(openingBoxCounts)
      : "";
    prompt = [prompt, geometryAnchor, corrective ? `CORRECTION: ${corrective}` : ""]
      .filter(Boolean)
      .join(" ");
    attempt += 1;
  }
}

function acceptBest(
  attemptRecords: EditAttemptRecord[],
  openingBoxCounts: { windows: number; doors: number } | undefined,
  droppedSheetCount: number,
  projectId: string,
  pipelineStart: number,
): QuickEditPipelineResult {
  // An orientation-flipped frame is never deliverable while an upright
  // attempt exists — the flipped one's geometry is invented wholesale.
  const upright = attemptRecords.filter(
    (r) => !r.validation.failureTypes.includes(ORIENTATION_FLIP_FAILURE),
  );
  const best = pickBestEditAttempt(upright.length > 0 ? upright : attemptRecords);
  pipelineLog(
    "VALIDATE",
    "quick room render accepted with validation warnings (best attempt)",
    {
      projectId,
      chosenAttempt: best.attempt,
      attemptCount: attemptRecords.length,
      failureTypes: best.validation.failureTypes,
    },
    "warn",
  );
  pipelineLog("FAL_RENDER", "quick room edit pipeline complete", {
    projectId,
    attempts: attemptRecords.length,
    validationPassed: false,
    validated: true,
    chosenAttempt: best.attempt,
    durationMs: Date.now() - pipelineStart,
  });
  return {
    image: best.rendered,
    validationPassed: false,
    attempts: attemptRecords.length,
    validationWarning:
      (best.validation.correctiveFeedback ?? best.validation.reason)?.trim() || undefined,
    openingBoxCounts,
    droppedSheetCount,
  };
}
