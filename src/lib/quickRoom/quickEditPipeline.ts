import "server-only";

import { renderEditStaging } from "@/lib/falEditRenderer";
import { applyPhotoPrepErase } from "@/lib/project/photoPrepErase";
import { pipelineLog } from "@/lib/pipelineLog";
import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import type { QuickRoomPlacementMode } from "@/lib/quickRoom/placementMode";
import {
  DEFAULT_SHAPE_CREATIVITY,
  resolveShapeCreativity,
} from "@/lib/quickRoom/shapeCreativity";
import { renderQuickStagingShell } from "./quickStagingShell";
import {
  buildQuickRoomEditInstruction,
  buildQuickRoomBananaImageRoles,
  buildQuickRoomImageRoles,
} from "./quickEditPrompt";
import {
  QUICK_ROOM_FAL_BANANA_ENDPOINT,
  logQuickRoomFalStep,
} from "./quickFalStepLog";

/** Collage sheets beyond this are dropped from the banana image list (SKUs stay in text). */
const MAX_PRODUCT_SHEETS = 6;

export interface QuickEditProgressEvent {
  step: "prep" | "shell" | "render";
  message: string;
  /** 0..1 within the render stage (the route maps this onto its own progress band). */
  progress: number;
}

export interface QuickEditPipelineInput {
  sessionId: string;
  roomPhotoBase64: string;
  roomPhotoMime: string;
  placementMode?: QuickRoomPlacementMode;
  objectRemovalMaskBase64?: string | null;
  /** Product collage sheets from buildGeminiProductVisualParts — banana only. */
  productSheetInlines: Array<{ mimeType: string; data: string }>;
  /** Style inspiration — banana only. */
  styleInspiration?: { base64: string; mimeType: string } | null;
  brief: DesignBrief;
  designStyleLabel: string;
  productIntroText?: string;
  productCloseText?: string;
  editContext?: string;
  /** 0 = keep room shape, 10 = creativity. Default 5. */
  shapeCreativity?: number;
  onProgress?: (ev: QuickEditProgressEvent) => void | Promise<void>;
}

export interface QuickEditPipelineResult {
  image: { base64: string; mimeType: string };
  validationPassed: boolean;
  attempts: number;
  droppedSheetCount: number;
}

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
  const shapeConfig = resolveShapeCreativity(input.shapeCreativity ?? DEFAULT_SHAPE_CREATIVITY);

  // 1. Optional object-removal prep (no opening analysis).
  const hadRemovalMask = !!input.objectRemovalMaskBase64?.trim();
  if (hadRemovalMask) {
    await emit({ step: "prep", message: "Removing the marked items…", progress: 0.08 });
  }
  const prep = await applyPhotoPrepErase({
    projectId,
    roomId,
    photoId,
    photoBase64: input.roomPhotoBase64,
    photoMime: input.roomPhotoMime,
    maskBase64: input.objectRemovalMaskBase64 ?? undefined,
    openingAnalysis: null,
  });

  if (hadRemovalMask) {
    logQuickRoomFalStep({
      step: "prep",
      sessionId: input.sessionId,
      endpoint: "fal-ai/flux-pro/v1/erase",
      falParams: {
        dilate_pixels: Number(process.env.VISTA_FAL_ERASE_DILATE_PIXELS) || 12,
        skipped: prep.skipped,
      },
      imageIndexRoles: ["0: room photo", "1: object-removal mask"],
      extra: { projectId, hadRemovalMask: true },
    });
  }

  // 2. Stage 1 — apartment-staging shell (skipped at levels 9–10).
  let geometryBase64 = prep.prepBase64;
  let geometryMime = prep.prepMime;
  let shellSeed: number | undefined;

  if (shapeConfig.runShell) {
    await emit({ step: "shell", message: "Locking room structure…", progress: 0.2 });
    const shell = await renderQuickStagingShell({
      photoBase64: prep.prepBase64,
      photoMime: prep.prepMime,
      designStyleLabel: input.designStyleLabel,
      sessionId: input.sessionId,
      label: "quick-room-staging-shell",
      loraScale: shapeConfig.loraScale,
    });
    geometryBase64 = shell.base64;
    geometryMime = shell.mimeType;
    shellSeed = shell.seed;
  } else {
    pipelineLog("FAL_PIPELINE", "quick room shell skipped — banana on original photo", {
      projectId,
      shapeCreativity: shapeConfig.level,
    });
  }

  // 3. Stage 2 — nano-banana furnish (geometry image first, then products + style).
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
    geometryBase64,
    ...sheets.map((s) => s.data),
    ...(input.styleInspiration ? [input.styleInspiration.base64] : []),
  ];
  const imageMimeList = [
    geometryMime,
    ...sheets.map((s) => s.mimeType),
    ...(input.styleInspiration ? [input.styleInspiration.mimeType] : []),
  ];

  const imageRoles = buildQuickRoomImageRoles({
    collageSheetCount: sheets.length,
    hasStyleInspiration: !!input.styleInspiration,
    runShell: shapeConfig.runShell,
  });
  const prompt = buildQuickRoomEditInstruction({
    brief: input.brief,
    designStyleLabel: input.designStyleLabel,
    imageRoles,
    productIntroText: input.productIntroText,
    productCloseText: input.productCloseText,
    editContext: input.editContext,
    placementMode: input.placementMode,
    preserveMode: shapeConfig.preserveMode,
    creativeMode: shapeConfig.creativeMode,
  });

  const bananaImageRoles = buildQuickRoomBananaImageRoles({
    collageSheetCount: sheets.length,
    hasStyleInspiration: !!input.styleInspiration,
    runShell: shapeConfig.runShell,
  });
  const editResolution = (process.env.VISTA_EDIT_RESOLUTION || "2K").trim().toUpperCase();

  logQuickRoomFalStep({
    step: "banana",
    sessionId: input.sessionId,
    endpoint: QUICK_ROOM_FAL_BANANA_ENDPOINT,
    prompt,
    falParams: {
      resolution: editResolution === "1K" || editResolution === "2K" ? editResolution : "4K",
      aspect_ratio: shapeConfig.runShell ? "auto (from staged shell)" : "auto (from original photo)",
      num_images: 1,
      output_format: "png",
      shapeCreativity: shapeConfig.level,
      runShell: shapeConfig.runShell,
      loraScale: shapeConfig.loraScale,
      preserveMode: shapeConfig.preserveMode,
      creativeMode: shapeConfig.creativeMode,
    },
    imageIndexRoles: bananaImageRoles,
    extra: {
      projectId,
      imageRolesText: imageRoles,
      imageCount: imageBase64List.length,
      collageSheetCount: sheets.length,
      hasStyleInspiration: !!input.styleInspiration,
      hadRemovalMask,
      droppedSheetCount,
      shellSeed,
      shapeCreativity: shapeConfig.level,
    },
  });

  pipelineLog("FAL_RENDER", "quick room staging→banana pipeline start", {
    projectId,
    imageCount: imageBase64List.length,
    promptChars: prompt.length,
    hadRemovalMask,
    droppedSheetCount,
    shapeCreativity: shapeConfig.level,
    runShell: shapeConfig.runShell,
    loraScale: shapeConfig.loraScale,
  });

  await emit({ step: "render", message: "Rendering your interior…", progress: 0.45 });

  const rendered = await renderEditStaging({
    imageBase64List,
    imageMimeList,
    prompt,
    projectId,
    roomId,
    photoId,
    stage: "master",
    sessionId: input.sessionId,
    label: "quick-room-banana-furnish",
  });

  pipelineLog("FAL_RENDER", "quick room staging→banana pipeline complete", {
    projectId,
    attempts: 1,
    validationPassed: true,
    validated: false,
    durationMs: Date.now() - pipelineStart,
    shapeCreativity: shapeConfig.level,
  });

  return {
    image: rendered,
    validationPassed: true,
    attempts: 1,
    droppedSheetCount,
  };
}
