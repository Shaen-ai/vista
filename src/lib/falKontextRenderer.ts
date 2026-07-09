import "server-only";

import { fal } from "@fal-ai/client";
import { ensureFalConfigured, uploadPublicImage } from "@/lib/falStorage";
import { validateOpenings, type OpeningValidation } from "@/lib/validateOpenings";
import { isFurnitureSpecValidationEnabled, validateFurnitureSpec } from "@/lib/validateFurnitureSpec";
import { pipelineLog, pipelineTimed, createFalQueueLogger } from "@/lib/pipelineLog";
import { renderRoomImageViaFal } from "@/lib/falRoomRenderer";
import type { OpeningBox, RoomAnalysis } from "@/lib/interiorDesignPrompts";
import {
  buildCompactOpeningLockForFal,
  buildCompactOpeningLockForRetry,
} from "@/lib/falOpeningLockCompact";
import { buildOpeningStructuralLock } from "@/lib/roomAnalysis";
import { buildKontextImageUrls } from "@/lib/falStyleReferenceUtils";
import { sanitizeDesignPromptForViewpoint } from "@/lib/falPipelinePrompt";
import {
  buildFurnishRetryPrompt,
  buildKontextStage2Prompt,
  buildStage2bKontextPrompt,
} from "@/lib/falKontextPrompt";
import { buildImageRolesBlock } from "@/lib/falStyleReferenceUtils";
import type { Phase2Trigger } from "@/lib/falDesignPrompt";
import {
  computePhase2Trigger,
  countRetryEligibleFurnitureItems,
} from "@/lib/falDesignPrompt";
import {
  fallbackInpaintUseCanny,
  isFalRecoveryBudgetExceeded,
  maxFalRecoveryCalls,
  shouldSkipFurnishRetry,
  shouldUseStage2bOnlyInpaintRecovery,
} from "@/lib/falKontextRecoveryUtils";
import { buildPhotoStructuralPreserveDirective } from "@/lib/photoStructuralElements";
import {
  detectStyleReferenceCopy,
  fetchImageBase64FromUrl,
  isStyleCopyGuardEnabled,
} from "@/lib/falStyleRefCopyGuardServer";
import {
  estimateFurnitureVisibleInStage2Input,
  type FurnitureVisibleInStage2Input,
} from "@/lib/falStage2Heuristic";
import type { ProgressEvent } from "@/lib/project/types";

export type KontextProgressCallback = (
  event: Pick<ProgressEvent, "phase" | "message" | "progress" | "room">,
) => void;

/**
 * Stage 2 of the two-stage render pipeline — Kontext design application.
 *
 * Primary: design overlay + short structural tail.
 * Opening retry: full overlay + opening lock (never strip furniture list).
 * Inpaint fallback → Stage 2b Kontext furnish on validated inpaint base.
 * Post-final: optional furniture spec vision gate + one furnish retry (no opening re-check).
 */

const FAL_KONTEXT_ENDPOINT: string = "fal-ai/flux-pro/kontext/multi";

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export {
  maxFalRecoveryCalls,
  fallbackInpaintUseCanny,
  shouldUseStage2bOnlyInpaintRecovery,
  shouldSkipFurnishRetry,
  isFalRecoveryBudgetExceeded,
} from "@/lib/falKontextRecoveryUtils";

export interface KontextDesignInput {
  lockedBaseUrl: string;
  designPrompt: string;
  designOverlay: string;
  designOverlayFurnitureCount: number;
  /** Furniture labels for post-final spec validation. */
  furnitureItems?: string[];
  stage1Base64?: string;
  lockAnalysis?: RoomAnalysis | null;
  /** Debug only — not sent to Kontext image_urls. */
  geometryReferenceUrl?: string;
  styleReferenceUrls?: string[];
  productImageUrls?: string[];
  /** @deprecated Secondary room photos — superseded by styleReferenceUrls in custom mode. */
  contextImageUrls?: string[];
  originalPhotoBase64?: string;
  originalPhotoMime?: string;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
  /** Floor plan + viewpoint opening metadata for validation. */
  openingContext?: string;
  lockedBaseFallback?: { base64: string; mimeType: string; url: string };
  inpaintFallback?: {
    photoBase64: string;
    photoMime: string;
    windowBoxes?: OpeningBox[];
    doorBoxes?: OpeningBox[];
    designPrompt: string;
    sessionId?: string;
    label?: string;
  };
  /** Which image fed the structural inpaint fallback (debug). */
  inpaintBase?: "stage1" | "original";
  styleRefCount?: number;
  geminiStyleRef?: boolean;
  compactRoomShapeBlock?: string;
  sessionId?: string;
  label?: string;
  roomName?: string;
  onProgress?: KontextProgressCallback;
}

function emitKontextProgress(
  input: KontextDesignInput,
  message: string,
  progress: number,
): void {
  input.onProgress?.({
    phase: "generating",
    message,
    progress,
    room: input.roomName,
  });
}

export type SelectedImageSource =
  | "primary"
  | "retry"
  | "stage2b"
  | "inpaint"
  | "furnish-retry"
  | "stage1";

type RenderCandidate = {
  source: SelectedImageSource;
  image: { base64: string; mimeType: string };
  openingMatch: boolean;
  confirmedCount: number;
};

export interface KontextDesignResult {
  base64: string;
  mimeType: string;
  url: string;
  structuralFallback?: boolean;
  fallbackReason?: string;
  stage2Validation?: OpeningValidation;
  furnitureVisibleInStage2Input?: FurnitureVisibleInStage2Input;
  designOverlayFurnitureCount?: number;
  retryEligibleFurnitureCount?: number;
  phase2Trigger?: Phase2Trigger;
  usedInpaintFurnishPass?: boolean;
  inpaintFurnishTriggered?: boolean;
  inpaintBase?: "stage1" | "original";
  furnishRetryFailed?: boolean;
  furnishRetryOpeningDrift?: boolean;
  furnishRetryRan?: boolean;
  furnitureSpecRan?: boolean;
  furnitureSpecMatch?: boolean;
  furnitureSpecMissing?: string[];
  confirmedFurnitureCount?: number;
  stage2bFurnitureSpecMatch?: boolean;
  selectedImageSource?: SelectedImageSource;
  inpaintFluxRan?: boolean;
  inpaintFluxCount?: number;
  kontextCallCount?: number;
  recoveryBudgetExceeded?: boolean;
  stage2bOnlyRetry?: boolean;
  styleRefCopyDetected?: boolean;
  kontextStyleRefDropped?: boolean;
}

export {
  buildKontextStage2Prompt,
  buildStage2bKontextPrompt,
  buildFurnishRetryPrompt,
} from "@/lib/falKontextPrompt";

export { buildKontextImageUrls, buildImageRolesBlock } from "@/lib/falStyleReferenceUtils";

/** @deprecated Use buildKontextStage2Prompt — kept for tests / backward compat. */
export function buildKontextDesignPrompt(
  designPrompt: string,
  lockAnalysis: RoomAnalysis | null | undefined,
): string {
  const sanitized = sanitizeDesignPromptForViewpoint(designPrompt, lockAnalysis);
  const openingLock = buildCompactOpeningLockForFal(
    buildOpeningStructuralLock(lockAnalysis, null),
  );
  return openingLock ? `${openingLock}\n\n${sanitized}` : sanitized;
}

export function buildKontextStage2PromptFromAnalysis(opts: {
  designOverlay: string;
  lockAnalysis?: RoomAnalysis | null;
  mode: "primary" | "retry";
  retryUsesPrimaryOutput?: boolean;
  /** @deprecated Use retryUsesPrimaryOutput */
  preserveExistingFurniture?: boolean;
  structuralPreservePrefix?: string;
  styleRefCount?: number;
  geminiStyleRef?: boolean;
  compactRoomShapeBlock?: string;
}): string {
  const openingLock = buildCompactOpeningLockForFal(
    buildOpeningStructuralLock(opts.lockAnalysis ?? null, null),
  );
  const retryOpeningLock =
    opts.mode === "retry"
      ? buildCompactOpeningLockForRetry(buildOpeningStructuralLock(opts.lockAnalysis ?? null, null))
      : undefined;

  const roleBlock = buildImageRolesBlock({
    styleRefCount: opts.styleRefCount ?? 0,
    geminiStyleRef: opts.geminiStyleRef ?? false,
  });

  let designOverlay = opts.designOverlay;
  if (opts.compactRoomShapeBlock?.trim()) {
    designOverlay = `${opts.compactRoomShapeBlock.trim()}\n\n${designOverlay}`;
  }
  designOverlay = `${roleBlock}\n\n${designOverlay}`;
  if (opts.mode === "primary" && openingLock.trim()) {
    designOverlay = `${openingLock.trim()}\n\n${designOverlay}`;
  }

  return buildKontextStage2Prompt({
    designOverlay,
    mode: opts.mode,
    retryOpeningLock,
    retryUsesPrimaryOutput:
      opts.retryUsesPrimaryOutput ?? opts.preserveExistingFurniture,
    structuralPreservePrefix: opts.structuralPreservePrefix,
  });
}

async function validateRender(
  input: KontextDesignInput,
  renderedBase64: string,
  renderedMime: string,
  label?: string,
): Promise<OpeningValidation> {
  if (!input.originalPhotoBase64) {
    return { match: true, reason: "no original photo", failureType: "none" };
  }
  const hasOpenings = !!(input.windowBoxes?.length || input.doorBoxes?.length);
  const validateEnabled = (process.env.VISTA_FAL_VALIDATE || "1").trim() !== "0";
  if (!hasOpenings || !validateEnabled) {
    return { match: true, reason: "validation skipped", failureType: "none" };
  }

  return validateOpenings({
    originalBase64: input.originalPhotoBase64,
    originalMime: input.originalPhotoMime || "image/jpeg",
    renderedBase64,
    renderedMime,
    windowBoxes: input.windowBoxes,
    doorBoxes: input.doorBoxes,
    openingContext: input.openingContext,
    label,
  });
}

function logKontextPrompt(opts: {
  label: string;
  promptMode: "primary" | "retry" | "stage2b" | "furnish-retry";
  prompt: string;
  designOverlay: string;
  designOverlayFurnitureCount: number;
  openingLockChars?: number;
  imageCount: number;
  contextImages: number;
  productImages: number;
  imageRoles?: string[];
  geometrySchematicIncluded?: boolean;
  furnitureVisibleInStage2Input?: FurnitureVisibleInStage2Input;
  phase2Trigger?: Phase2Trigger;
  retryUsesPrimaryOutput?: boolean;
}): void {
  pipelineLog("FAL_KONTEXT", "kontext design request", {
    label: opts.label,
    promptMode: opts.promptMode,
    imageCount: opts.imageCount,
    contextImages: opts.contextImages,
    productImages: opts.productImages,
    imageRoles: opts.imageRoles,
    geometrySchematicIncluded: opts.geometrySchematicIncluded ?? false,
    designOverlayChars: opts.designOverlay.length,
    designOverlayFurnitureCount: opts.designOverlayFurnitureCount,
    designOverlayPreview: opts.designOverlay.slice(0, 200),
    openingLockChars: opts.openingLockChars ?? 0,
    totalPromptChars: opts.prompt.length,
    furnitureVisibleInStage2Input: opts.furnitureVisibleInStage2Input,
    phase2Trigger: opts.phase2Trigger,
    retryUsesPrimaryOutput: opts.retryUsesPrimaryOutput,
  });
}

export async function runKontextDesign(input: KontextDesignInput): Promise<KontextDesignResult> {
  ensureFalConfigured();

  const structuralPreservePrefix = buildPhotoStructuralPreserveDirective(input.lockAnalysis);
  const recoveryCallMax = maxFalRecoveryCalls();
  let falRecoveryCalls = 0;
  let kontextCallCount = 0;
  let inpaintFluxCount = 0;
  let inpaintFluxRan = false;
  let recoveryBudgetExceeded = false;
  let stage2bOnlyRetry = false;
  let styleRefCopyDetected = false;
  let kontextStyleRefDropped = false;

  const tryAcquireFalCall = (label: string): boolean => {
    if (isFalRecoveryBudgetExceeded(falRecoveryCalls, recoveryCallMax)) {
      if (!recoveryBudgetExceeded) {
        recoveryBudgetExceeded = true;
        pipelineLog(
          "FAL_KONTEXT",
          "recovery budget exceeded",
          {
            label: input.label ?? "kontext-design",
            falRecoveryCalls,
            max: recoveryCallMax,
            skipped: label,
          },
          "warn",
        );
      }
      return false;
    }
    falRecoveryCalls++;
    return true;
  };

  const imageUrls = buildKontextImageUrls({
    baseUrl: input.lockedBaseUrl,
    styleReferenceUrls: input.styleReferenceUrls,
    productImageUrls: input.productImageUrls,
  });

  const styleRefCount = input.styleReferenceUrls?.length ?? 0;
  const contextImages = styleRefCount + (input.contextImageUrls?.length ?? 0);
  const imageRoles = [
    "room",
    ...(styleRefCount > 0 ? ["style"] : []),
    ...((input.productImageUrls?.length ?? 0) > 0 ? ["product"] : []),
  ];

  const primaryPrompt = input.designPrompt;

  logKontextPrompt({
    label: input.label ?? "kontext-design",
    promptMode: "primary",
    prompt: primaryPrompt,
    designOverlay: input.designOverlay,
    designOverlayFurnitureCount: input.designOverlayFurnitureCount,
    openingLockChars: buildCompactOpeningLockForFal(
      buildOpeningStructuralLock(input.lockAnalysis ?? null, null),
    ).length,
    imageCount: imageUrls.length,
    contextImages,
    productImages: input.productImageUrls?.length ?? 0,
    imageRoles,
    geometrySchematicIncluded: false,
  });

  const runKontext = async (
    promptOverride: string,
    mode: "primary" | "retry" | "stage2b" | "furnish-retry",
    observability?: {
      furnitureVisibleInStage2Input?: FurnitureVisibleInStage2Input;
      phase2Trigger?: Phase2Trigger;
      retryImageUrls?: string[];
      retryUsesPrimaryOutput?: boolean;
    },
  ): Promise<{ base64: string; mimeType: string }[]> => {
    if (mode !== "primary") {
      if (!tryAcquireFalCall(`kontext-${mode}`)) {
        return [];
      }
    } else {
      falRecoveryCalls++;
    }
    kontextCallCount++;

    const kontextImageUrls = observability?.retryImageUrls ?? imageUrls;

    if (mode !== "primary") {
      const openingLockChars =
        mode === "retry"
          ? buildCompactOpeningLockForRetry(
              buildOpeningStructuralLock(input.lockAnalysis ?? null, null),
            ).length
          : mode === "stage2b"
            ? buildCompactOpeningLockForFal(
                buildOpeningStructuralLock(input.lockAnalysis ?? null, null),
              ).length
            : 0;
      logKontextPrompt({
        label: input.label ?? "kontext-design",
        promptMode: mode,
        prompt: promptOverride,
        designOverlay: input.designOverlay,
        designOverlayFurnitureCount: input.designOverlayFurnitureCount,
        openingLockChars,
        imageCount: kontextImageUrls.length,
        contextImages,
        productImages: input.productImageUrls?.length ?? 0,
        imageRoles,
        geometrySchematicIncluded: false,
        furnitureVisibleInStage2Input: observability?.furnitureVisibleInStage2Input,
        phase2Trigger: observability?.phase2Trigger,
        retryUsesPrimaryOutput: observability?.retryUsesPrimaryOutput,
      });
    }

    const queueLog = createFalQueueLogger("FAL_KONTEXT", "kontext queue update", {
      label: input.label ?? "kontext-design",
      promptMode: mode,
    });

    const result = await pipelineTimed(
      "FAL_KONTEXT",
      "kontext subscribe",
      () =>
        fal.subscribe(FAL_KONTEXT_ENDPOINT, {
          input: {
            prompt: promptOverride,
            image_urls: kontextImageUrls,
            guidance_scale: num("VISTA_FAL_KONTEXT_GUIDANCE", 3.5),
            output_format: "png",
          } as Record<string, unknown>,
          logs: false,
          onQueueUpdate: queueLog,
        }),
      {
        meta: {
          label: input.label ?? "kontext-design",
          promptMode: mode,
          endpoint: FAL_KONTEXT_ENDPOINT,
        },
      },
    );

    const images = (result.data as { images?: Array<{ url?: string }> })?.images ?? [];
    const out: { base64: string; mimeType: string }[] = [];
    for (const img of images) {
      if (!img.url) continue;
      try {
        const item = await pipelineTimed(
          "FAL_KONTEXT",
          "fetch kontext result",
          async () => {
            const res = await fetch(img.url!);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const mimeType = res.headers.get("content-type") || "image/png";
            const buf = Buffer.from(await res.arrayBuffer());
            return { base64: buf.toString("base64"), mimeType };
          },
          {
            meta: {
              label: input.label ?? "kontext-design",
              promptMode: mode,
            },
          },
        );
        out.push(item);
      } catch (err) {
        pipelineLog(
          "FAL_KONTEXT",
          "fetch kontext result — unreachable URL skipped",
          { label: input.label ?? "kontext-design", error: String(err).slice(0, 120) },
          "warn",
        );
      }
    }

    pipelineLog("FAL_KONTEXT", "kontext design response", {
      label: input.label ?? "kontext-design",
      promptMode: mode,
      images: out.length,
    });

    return out;
  };

  let images = await runKontext(primaryPrompt, "primary");
  if (!images[0]) throw new Error("Stage 2 Kontext design returned no image");

  if (
    isStyleCopyGuardEnabled() &&
    styleRefCount > 0 &&
    input.styleReferenceUrls?.[0]
  ) {
    const heroBase64 = input.stage1Base64 || input.originalPhotoBase64;
    if (heroBase64) {
      const styleRefBase64 = await fetchImageBase64FromUrl(input.styleReferenceUrls[0]);
      if (styleRefBase64) {
        const copyCheck = await detectStyleReferenceCopy({
          outputBase64: images[0].base64,
          heroBase64,
          styleRefBase64,
        });
        if (copyCheck.detected) {
          styleRefCopyDetected = true;
          kontextStyleRefDropped = true;
          pipelineLog(
            "FAL_KONTEXT",
            "style ref copy detected — retrying kontext room-only",
            {
              label: input.label ?? "kontext-design",
              heroCorrelation: Number(copyCheck.heroCorrelation.toFixed(3)),
              styleRefCorrelation: Number(copyCheck.styleRefCorrelation.toFixed(3)),
            },
            "warn",
          );
          const roomOnlyPrompt = buildKontextStage2PromptFromAnalysis({
            designOverlay: input.designOverlay,
            lockAnalysis: input.lockAnalysis,
            mode: "primary",
            structuralPreservePrefix,
            styleRefCount: 0,
            geminiStyleRef: false,
            compactRoomShapeBlock: input.compactRoomShapeBlock,
          });
          const roomOnlyImages = await runKontext(roomOnlyPrompt, "retry", {
            retryImageUrls: [input.lockedBaseUrl],
          });
          if (roomOnlyImages[0]) {
            images = roomOnlyImages;
          }
        }
      }
    }
  }

  let furnitureVisibleInStage2Input = await estimateFurnitureVisibleInStage2Input(
    input.stage1Base64,
    images[0].base64,
  );

  pipelineLog("FAL_KONTEXT", "stage 2 primary complete", {
    label: input.label ?? "kontext-design",
    furnitureVisibleInStage2Input,
    designOverlayFurnitureCount: input.designOverlayFurnitureCount,
  });

  emitKontextProgress(input, "Checking room structure...", 0.7);

  let lastValidation = await validateRender(input, images[0].base64, images[0].mimeType);
  let usedInpaintFurnishPass = false;
  let validatedInpaintFallback: { base64: string; mimeType: string } | undefined;
  let selectedImageSource: SelectedImageSource = "primary";

  const revertToValidatedInpaint = (reason: string): boolean => {
    if (!validatedInpaintFallback) return false;
    images = [validatedInpaintFallback];
    selectedImageSource = "inpaint";
    pipelineLog(
      "FAL_KONTEXT",
      "reverting to validated inpaint base",
      { label: input.label ?? "kontext-design", reason: reason.slice(0, 200) },
      "warn",
    );
    return true;
  };

  type InpaintRecoveryTrigger = "opening_drift" | "unfurnished" | "unfurnished_stage2b_only";

  type InpaintStage2bResult = {
    images: { base64: string; mimeType: string }[];
    selectedImageSource: SelectedImageSource;
    lastValidation: OpeningValidation;
    validatedInpaint?: { base64: string; mimeType: string };
    confirmedCount?: number;
    stage2bFurnitureSpecMatch?: boolean;
  };

  const applyInpaintRecoveryResult = (inpaintResult: InpaintStage2bResult | null): void => {
    if (!inpaintResult) return;
    images = inpaintResult.images;
    lastValidation = inpaintResult.lastValidation;
    selectedImageSource = inpaintResult.selectedImageSource;
    if (inpaintResult.validatedInpaint) {
      validatedInpaintFallback = inpaintResult.validatedInpaint;
      inpaintFluxRan = true;
      usedInpaintFurnishPass = inpaintResult.selectedImageSource === "stage2b";
    }
  };

  const runStage2bOnInpaintBase = async (
    validatedInpaint: { base64: string; mimeType: string },
    trigger: InpaintRecoveryTrigger,
    inpaintCheck: OpeningValidation,
    inpaintImages: { base64: string; mimeType: string }[],
  ): Promise<InpaintStage2bResult | null> => {
    if (trigger === "unfurnished_stage2b_only") {
      stage2bOnlyRetry = true;
    }

    const inpaintBuf = Buffer.from(validatedInpaint.base64, "base64");
    const inpaintBaseUrl = await uploadPublicImage(inpaintBuf, validatedInpaint.mimeType, {
      sessionId: input.sessionId,
      type: "generated",
    });

    const stage2bPrompt = buildStage2bKontextPrompt({
      designOverlay: input.designOverlay,
      lockAnalysis: input.lockAnalysis,
      structuralPreservePrefix: structuralPreservePrefix || undefined,
    });

    pipelineLog("FAL_KONTEXT", "stage 2b — kontext furnish after inpaint", {
      label: input.label ?? "kontext-design",
      inpaintBase: input.inpaintBase ?? "original",
      trigger,
      stage2bOnly: trigger === "unfurnished_stage2b_only",
    });

    const stage2b = await runKontext(stage2bPrompt, "stage2b", {
      retryImageUrls: buildKontextImageUrls({
        baseUrl: input.lockedBaseUrl,
        styleReferenceUrls: input.styleReferenceUrls,
        productImageUrls: input.productImageUrls,
        retryPrimaryUrl: inpaintBaseUrl,
      }),
    });

    if (!stage2b[0]) {
      if (recoveryBudgetExceeded) {
        return {
          images: inpaintImages,
          selectedImageSource: "inpaint",
          lastValidation: inpaintCheck,
          validatedInpaint,
        };
      }
      return null;
    }

    const stage2bCheck = await validateRender(input, stage2b[0].base64, stage2b[0].mimeType);
    if (stage2bCheck.match) {
      let confirmedCount: number | undefined;
      let stage2bFurnitureSpecMatch: boolean | undefined;
      if (
        isFurnitureSpecValidationEnabled() &&
        countRetryEligibleFurnitureItems(input.furnitureItems ?? []) >= 3 &&
        input.furnitureItems?.length
      ) {
        const stage2bSpec = await validateFurnitureSpec({
          renderedBase64: stage2b[0].base64,
          renderedMime: stage2b[0].mimeType,
          furnitureItems: input.furnitureItems,
        });
        confirmedCount = stage2bSpec.confirmed.length;
        stage2bFurnitureSpecMatch = stage2bSpec.match;
      }
      pipelineLog("FAL_KONTEXT", "stage 2b passed opening validation", {
        label: input.label ?? "kontext-design",
        trigger,
        confirmedCount,
        stage2bFurnitureSpecMatch,
        stage2bOnly: trigger === "unfurnished_stage2b_only",
      });
      return {
        images: stage2b,
        selectedImageSource: "stage2b",
        lastValidation: stage2bCheck,
        validatedInpaint,
        confirmedCount,
        stage2bFurnitureSpecMatch,
      };
    }

    pipelineLog(
      "FAL_KONTEXT",
      "stage2bOpeningFail — keeping inpaint base",
      { reason: stage2bCheck.reason.slice(0, 200), trigger },
      "warn",
    );
    return {
      images: inpaintImages,
      selectedImageSource: "inpaint",
      lastValidation: inpaintCheck,
      validatedInpaint,
    };
  };

  const runInpaintFlux = async (
    trigger: InpaintRecoveryTrigger,
  ): Promise<{
    validatedInpaint: { base64: string; mimeType: string };
    inpaintCheck: OpeningValidation;
    inpaintImages: { base64: string; mimeType: string }[];
  } | null> => {
    if (!input.inpaintFallback) return null;
    if (!tryAcquireFalCall("inpaint-flux")) return null;

    emitKontextProgress(input, "Refining render...", 0.8);
    pipelineLog("FAL_KONTEXT", "trying inpaint fallback with freeze mask", {
      label: input.inpaintFallback.label ?? input.label ?? "kontext-design",
      inpaintBase: input.inpaintBase ?? "original",
      trigger,
      useCanny: fallbackInpaintUseCanny(),
    });

    inpaintFluxRan = true;
    inpaintFluxCount++;

    try {
      const inpaintImages = await renderRoomImageViaFal({
        photoBase64: input.inpaintFallback.photoBase64,
        photoMime: input.inpaintFallback.photoMime,
        windowBoxes: input.inpaintFallback.windowBoxes,
        doorBoxes: input.inpaintFallback.doorBoxes,
        prompt: input.inpaintFallback.designPrompt,
        useCanny: fallbackInpaintUseCanny(),
        renderMode: "hero",
        sessionId: input.inpaintFallback.sessionId ?? input.sessionId,
        label: input.inpaintFallback.label ?? "kontext-inpaint-fallback",
      });
      if (!inpaintImages.images[0]) return null;

      const inpaintCheck = await validateRender(
        input,
        inpaintImages.images[0].base64,
        inpaintImages.images[0].mimeType,
      );
      if (!inpaintCheck.match) {
        pipelineLog(
          "FAL_KONTEXT",
          "inpaint fallback failed validation — using stage 1 base",
          { reason: inpaintCheck.reason.slice(0, 200), trigger },
          "warn",
        );
        return null;
      }

      return {
        validatedInpaint: inpaintImages.images[0],
        inpaintCheck,
        inpaintImages: inpaintImages.images,
      };
    } catch (err) {
      pipelineLog(
        "FAL_KONTEXT",
        "inpaint fallback error",
        { error: String(err).slice(0, 200), trigger },
        "warn",
      );
      return null;
    }
  };

  const tryInpaintStage2bFurnish = async (
    trigger: "opening_drift" | "unfurnished",
  ): Promise<InpaintStage2bResult | null> => {
    const flux = await runInpaintFlux(trigger);
    if (!flux) return null;
    return runStage2bOnInpaintBase(
      flux.validatedInpaint,
      trigger,
      flux.inpaintCheck,
      flux.inpaintImages,
    );
  };

  const tryStage2bOnlyOnCachedInpaint = async (): Promise<InpaintStage2bResult | null> => {
    if (!validatedInpaintFallback) return null;
    pipelineLog("FAL_KONTEXT", "unfurnished — stage2b only on cached inpaint base", {
      label: input.label ?? "kontext-design",
    });
    const inpaintCheck = await validateRender(
      input,
      validatedInpaintFallback.base64,
      validatedInpaintFallback.mimeType,
    );
    if (!inpaintCheck.match) return null;
    return runStage2bOnInpaintBase(
      validatedInpaintFallback,
      "unfurnished_stage2b_only",
      inpaintCheck,
      [validatedInpaintFallback],
    );
  };

  if (!lastValidation.match) {
    const retryUsesPrimaryOutput = furnitureVisibleInStage2Input === true;
    let retryImageUrls: string[] | undefined;

    if (retryUsesPrimaryOutput) {
      const primaryBuf = Buffer.from(images[0].base64, "base64");
      const primaryUrl = await uploadPublicImage(primaryBuf, images[0].mimeType, {
        sessionId: input.sessionId,
        type: "generated",
      });
      retryImageUrls = buildKontextImageUrls({
        baseUrl: input.lockedBaseUrl,
        styleReferenceUrls: input.styleReferenceUrls,
        productImageUrls: input.productImageUrls,
        retryPrimaryUrl: primaryUrl,
      });
    }

    pipelineLog("FAL_KONTEXT", "opening drift — retrying kontext stage 2", {
      label: input.label ?? "kontext-design",
      reason: lastValidation.reason.slice(0, 200),
      furnitureVisibleInStage2Input,
      retryUsesPrimaryOutput,
    });

    emitKontextProgress(input, "Refining render...", 0.8);

    const retryPrompt = buildKontextStage2PromptFromAnalysis({
      designOverlay: input.designOverlay,
      lockAnalysis: input.lockAnalysis,
      mode: "retry",
      retryUsesPrimaryOutput,
      structuralPreservePrefix: structuralPreservePrefix || undefined,
      styleRefCount: input.styleRefCount,
      geminiStyleRef: input.geminiStyleRef,
      compactRoomShapeBlock: input.compactRoomShapeBlock,
    });
    const retry = await runKontext(retryPrompt, "retry", {
      furnitureVisibleInStage2Input,
      retryImageUrls,
      retryUsesPrimaryOutput,
    });
    if (retry[0]) {
      const recheck = await validateRender(input, retry[0].base64, retry[0].mimeType);
      if (recheck.match) {
        images = retry;
        lastValidation = recheck;
        selectedImageSource = "retry";
      } else {
        lastValidation = recheck;
        pipelineLog(
          "FAL_KONTEXT",
          "opening drift persists after kontext retry",
          { label: input.label ?? "kontext-design", reason: recheck.reason.slice(0, 200) },
          "warn",
        );

        if (input.inpaintFallback) {
          const inpaintResult = await tryInpaintStage2bFurnish("opening_drift");
          applyInpaintRecoveryResult(inpaintResult);
        }

        if (!lastValidation.match && input.lockedBaseFallback) {
          pipelineLog(
            "FAL_KONTEXT",
            "returning stage 1 locked base (structural fallback)",
            { label: input.label ?? "kontext-design", reason: lastValidation.reason.slice(0, 200) },
            "warn",
          );
          return {
            base64: input.lockedBaseFallback.base64,
            mimeType: input.lockedBaseFallback.mimeType,
            url: input.lockedBaseFallback.url,
            structuralFallback: true,
            fallbackReason: lastValidation.reason,
            stage2Validation: lastValidation,
            furnitureVisibleInStage2Input,
            designOverlayFurnitureCount: input.designOverlayFurnitureCount,
            retryEligibleFurnitureCount: countRetryEligibleFurnitureItems(input.furnitureItems ?? []),
            phase2Trigger: "none",
            usedInpaintFurnishPass,
            inpaintBase: input.inpaintBase,
            selectedImageSource: "stage1",
            kontextCallCount,
            inpaintFluxCount,
            inpaintFluxRan,
            recoveryBudgetExceeded,
          };
        }
      }
    }
  }

  let phase2Trigger: Phase2Trigger = "none";
  let furnishRetryFailed = false;
  let furnishRetryOpeningDrift = false;
  let furnishRetryRan = false;
  let furnitureSpecRan = false;
  let furnitureSpecMatch: boolean | undefined;
  let furnitureSpecMissing: string[] | undefined;
  let confirmedFurnitureCount = 0;
  let stage2bFurnitureSpecMatch: boolean | undefined;
  let inpaintFurnishTriggered = false;
  const candidates: RenderCandidate[] = [];

  const retryEligibleCount = countRetryEligibleFurnitureItems(input.furnitureItems ?? []);
  phase2Trigger = computePhase2Trigger(retryEligibleCount, furnitureVisibleInStage2Input);

  // Furniture spec runs only on opening-valid final candidates (A4).
  if (
    lastValidation.match &&
    isFurnitureSpecValidationEnabled() &&
    retryEligibleCount >= 3 &&
    input.furnitureItems?.length
  ) {
    furnitureSpecRan = true;
    const specCheck = await validateFurnitureSpec({
      renderedBase64: images[0].base64,
      renderedMime: images[0].mimeType,
      furnitureItems: input.furnitureItems,
    });
    furnitureSpecMatch = specCheck.match;
    furnitureSpecMissing = specCheck.missing;
    confirmedFurnitureCount = specCheck.confirmed.length;

    candidates.push({
      source: selectedImageSource,
      image: images[0],
      openingMatch: true,
      confirmedCount: specCheck.confirmed.length,
    });

    if (specCheck.confirmed.length === 0) {
      furnitureVisibleInStage2Input = false;
    }

    const isUnfurnished = specCheck.match === false && specCheck.confirmed.length === 0;

    if (isUnfurnished && input.inpaintFallback && !furnitureSpecMatch) {
      inpaintFurnishTriggered = true;
      let inpaintResult: InpaintStage2bResult | null;
      if (shouldUseStage2bOnlyInpaintRecovery(validatedInpaintFallback)) {
        inpaintResult = await tryStage2bOnlyOnCachedInpaint();
      } else {
        pipelineLog("FAL_KONTEXT", "unfurnished primary — triggering inpaint furnish pass", {
          label: input.label ?? "kontext-design",
          confirmedCount: specCheck.confirmed.length,
        });
        inpaintResult = await tryInpaintStage2bFurnish("unfurnished");
      }
      if (inpaintResult?.validatedInpaint) {
        validatedInpaintFallback = inpaintResult.validatedInpaint;
        inpaintFluxRan = true;
        usedInpaintFurnishPass = inpaintResult.selectedImageSource === "stage2b";
        if (inpaintResult.lastValidation.match) {
          images = inpaintResult.images;
          lastValidation = inpaintResult.lastValidation;
          selectedImageSource = inpaintResult.selectedImageSource;
          stage2bFurnitureSpecMatch = inpaintResult.stage2bFurnitureSpecMatch;
          const inpaintConfirmed = inpaintResult.confirmedCount ?? 0;
          confirmedFurnitureCount = Math.max(confirmedFurnitureCount, inpaintConfirmed);
          candidates.push({
            source: inpaintResult.selectedImageSource,
            image: inpaintResult.images[0]!,
            openingMatch: true,
            confirmedCount: inpaintConfirmed,
          });
          if (inpaintResult.stage2bFurnitureSpecMatch) {
            furnitureSpecMatch = true;
            furnitureSpecMissing = [];
          } else if (inpaintConfirmed > 0) {
            const recheck = await validateFurnitureSpec({
              renderedBase64: inpaintResult.images[0]!.base64,
              renderedMime: inpaintResult.images[0]!.mimeType,
              furnitureItems: input.furnitureItems,
            });
            furnitureSpecMatch = recheck.match;
            furnitureSpecMissing = recheck.missing;
            confirmedFurnitureCount = recheck.confirmed.length;
            const idx = candidates.findIndex((c) => c.source === inpaintResult!.selectedImageSource);
            if (idx >= 0) candidates[idx]!.confirmedCount = recheck.confirmed.length;
          }
        } else if (!inpaintResult.lastValidation.match) {
          lastValidation = inpaintResult.lastValidation;
        }
      }
    }

    if (!furnitureSpecMatch) {
      const currentSpec = await validateFurnitureSpec({
        renderedBase64: images[0].base64,
        renderedMime: images[0].mimeType,
        furnitureItems: input.furnitureItems,
      });
      furnitureSpecMatch = currentSpec.match;
      furnitureSpecMissing = currentSpec.missing;
      confirmedFurnitureCount = currentSpec.confirmed.length;

      const candidateIdx = candidates.findIndex((c) => c.source === selectedImageSource);
      if (candidateIdx >= 0) {
        candidates[candidateIdx]!.confirmedCount = currentSpec.confirmed.length;
      }

      if (
        shouldSkipFurnishRetry({
          match: currentSpec.match,
          confirmedCount: currentSpec.confirmed.length,
          missing: currentSpec.missing,
          retryEligibleCount,
        })
      ) {
        pipelineLog("FAL_KONTEXT", "skipping furnish-retry — current image sufficient", {
          label: input.label ?? "kontext-design",
          confirmedCount: currentSpec.confirmed.length,
          missing: currentSpec.missing.slice(0, 8),
          retryEligibleCount,
        });
      } else {
      phase2Trigger = "candidate";
      const preRetryImage = images[0];
      const furnishPrompt = buildFurnishRetryPrompt({
        designOverlay: input.designOverlay,
        missingItems: currentSpec.missing.length > 0 ? currentSpec.missing : input.furnitureItems,
        lockAnalysis: input.lockAnalysis,
        structuralPreservePrefix: structuralPreservePrefix || undefined,
      });

      pipelineLog("FAL_KONTEXT", "furniture spec retry", {
        label: input.label ?? "kontext-design",
        missing: currentSpec.missing.slice(0, 8),
        retryEligibleCount,
      });

      emitKontextProgress(input, "Refining render...", 0.8);

      const preUrl = await uploadPublicImage(
        Buffer.from(preRetryImage.base64, "base64"),
        preRetryImage.mimeType,
        { sessionId: input.sessionId, type: "generated" },
      );

      furnishRetryRan = true;
      const furnishRetry = await runKontext(furnishPrompt, "furnish-retry", {
        retryImageUrls: buildKontextImageUrls({
          baseUrl: input.lockedBaseUrl,
          styleReferenceUrls: input.styleReferenceUrls,
          productImageUrls: input.productImageUrls,
          retryPrimaryUrl: preUrl,
        }),
      });

      if (furnishRetry[0]) {
        const openingAfterFurnish = await validateRender(
          input,
          furnishRetry[0].base64,
          furnishRetry[0].mimeType,
          "furnish-retry",
        );

        if (openingAfterFurnish.match) {
          const recheckSpec = await validateFurnitureSpec({
            renderedBase64: furnishRetry[0].base64,
            renderedMime: furnishRetry[0].mimeType,
            furnitureItems: input.furnitureItems,
          });
          candidates.push({
            source: "furnish-retry",
            image: furnishRetry[0],
            openingMatch: true,
            confirmedCount: recheckSpec.confirmed.length,
          });

          if (recheckSpec.match) {
            images = furnishRetry;
            lastValidation = openingAfterFurnish;
            selectedImageSource = "furnish-retry";
            furnitureSpecMatch = true;
            furnitureSpecMissing = recheckSpec.missing;
            confirmedFurnitureCount = recheckSpec.confirmed.length;
          } else {
            furnishRetryFailed = true;
            if (usedInpaintFurnishPass) {
              revertToValidatedInpaint("furnish_retry_still_missing_furniture");
            }
            pipelineLog(
              "FAL_KONTEXT",
              "furnishRetryFailed — keeping pre-retry final image",
              {
                label: input.label ?? "kontext-design",
                missing: recheckSpec.missing.slice(0, 8),
                reason: recheckSpec.reason.slice(0, 200),
                selectedImageSource,
              },
              "warn",
            );
          }
        } else {
          furnishRetryOpeningDrift = true;
          furnishRetryFailed = true;
          if (usedInpaintFurnishPass) {
            revertToValidatedInpaint(openingAfterFurnish.reason);
          }
          pipelineLog(
            "FAL_KONTEXT",
            "furnish retry opening drift — keeping pre-furnish image",
            {
              label: input.label ?? "kontext-design",
              reason: openingAfterFurnish.reason.slice(0, 200),
              failureType: openingAfterFurnish.failureType,
              selectedImageSource,
            },
            "warn",
          );
        }
      }
      }
    }

    const viable = candidates.filter((c) => c.openingMatch);
    if (viable.length > 1) {
      const best = viable.reduce((a, b) => (b.confirmedCount > a.confirmedCount ? b : a));
      const currentConfirmed =
        candidates.find((c) => c.source === selectedImageSource)?.confirmedCount ?? confirmedFurnitureCount;
      if (best.confirmedCount > currentConfirmed) {
        images = [best.image];
        selectedImageSource = best.source;
        confirmedFurnitureCount = best.confirmedCount;
        pipelineLog("FAL_KONTEXT", "selected best candidate by confirmed furniture count", {
          label: input.label ?? "kontext-design",
          selectedImageSource: best.source,
          confirmedCount: best.confirmedCount,
          previousConfirmed: currentConfirmed,
        });
      }
    }
  }

  if (
    usedInpaintFurnishPass &&
    validatedInpaintFallback &&
    furnitureSpecRan &&
    furnitureSpecMatch === false &&
    selectedImageSource === "stage2b"
  ) {
    revertToValidatedInpaint("furniture_spec_missing_after_stage2b");
  }

  const buf = Buffer.from(images[0].base64, "base64");
  const url = await uploadPublicImage(buf, images[0].mimeType, {
    sessionId: input.sessionId,
    type: "generated",
  });

  return {
    base64: images[0].base64,
    mimeType: images[0].mimeType,
    url,
    structuralFallback: false,
    stage2Validation: lastValidation,
    furnitureVisibleInStage2Input,
    designOverlayFurnitureCount: input.designOverlayFurnitureCount,
    retryEligibleFurnitureCount: retryEligibleCount,
    phase2Trigger,
    usedInpaintFurnishPass,
    inpaintBase: input.inpaintBase,
    furnishRetryFailed,
    furnishRetryOpeningDrift,
    furnishRetryRan,
    furnitureSpecRan,
    furnitureSpecMatch,
    furnitureSpecMissing,
    confirmedFurnitureCount,
    stage2bFurnitureSpecMatch,
    inpaintFurnishTriggered,
    selectedImageSource,
    inpaintFluxRan,
    inpaintFluxCount,
    kontextCallCount,
    recoveryBudgetExceeded,
    stage2bOnlyRetry,
    styleRefCopyDetected,
    kontextStyleRefDropped,
  };
}
