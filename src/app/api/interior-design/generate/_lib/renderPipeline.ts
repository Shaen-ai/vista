import "server-only";

import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import { buildProductIdentifyCandidateMpKeys } from "@/lib/placementPlan";
import { identifyCatalogProductsInRender } from "@/lib/identifyRenderProducts";
import { traceCatalogPipeline } from "@/lib/catalogTrace";
import type { StepTimer } from "@/lib/generationDebug";

export type RenderedImage = { base64: string; mimeType: string };

/**
 * Run the first render, retrying once if it returns no images.
 * Identical in both render and full phases.
 */
export async function renderWithEmptyRetry(
  renderOnce: () => Promise<RenderedImage[]>,
  timer: StepTimer,
): Promise<RenderedImage[]> {
  let images = await renderOnce();
  timer.mark("gemini_render", { imageCount: images.length });

  if (images.length === 0) {
    timer.mark("gemini_retry_attempt");
    images = await renderOnce();
    timer.mark("gemini_retry_result", { imageCount: images.length });
  }

  return images;
}

export interface RenderVisionParams {
  images: RenderedImage[];
  anthropicKey: string | null | undefined;
  selectedForGemini: string[];
  /** Pinned mp-keys passed to the vision identifier (caller chooses session vs board list). */
  pinnedMpKeysForVision: string[];
  collageIncludedIds: string[];
  allowedCatalogKeys: Set<string>;
  catalogById: Map<string, CatalogItemSummary>;
  brief: DesignBrief;
  /** Pinned ids that made it into the collage (logged for pin-verification telemetry). */
  includedPinnedIds: string[];
  timer: StepTimer;
  /** Trace phase label ("render" or the full-flow phase). */
  phase: string;
}

/**
 * Identify catalog products visible in the first rendered image and log which
 * collage-included pinned products actually appear.
 *
 * Note: this used to re-render once when a pin was missing, but that retry fed
 * `priorityPinIds` into an appendix builder that discarded them and reused the
 * already-built collage — so the re-render had byte-identical inputs and only
 * doubled image-gen + vision cost without improving pin inclusion. On the fal
 * photo path (which does not place exact SKUs) it fired on nearly every request.
 * The futile re-render has been removed; pin verification is now telemetry only.
 */
export async function runRenderVision(
  params: RenderVisionParams,
): Promise<{ images: RenderedImage[]; finalVisionIds: string[] | null }> {
  const {
    anthropicKey,
    selectedForGemini,
    pinnedMpKeysForVision,
    collageIncludedIds,
    allowedCatalogKeys,
    catalogById,
    brief,
    includedPinnedIds,
    timer,
    phase,
  } = params;
  const images = params.images;

  const runFullPoolVision = async (img: RenderedImage): Promise<string[] | null> => {
    if (!anthropicKey) return null;
    const candidates = buildProductIdentifyCandidateMpKeys({
      selectedForGemini,
      pinnedMpKeys: pinnedMpKeysForVision,
      collageIncludedIds,
      allowedCatalogKeys,
      maxCandidates: 16,
    });
    if (candidates.length === 0) return null;
    try {
      const result = await identifyCatalogProductsInRender({
        imageBase64: img.base64,
        mimeType: img.mimeType,
        catalogById,
        candidateMpKeys: candidates,
        brief,
        pinnedMpKeys: pinnedMpKeysForVision,
      });
      return result.catalogIds;
    } catch (err) {
      console.warn("identifyCatalogProductsInRender failed", err);
      return null;
    }
  };

  let finalVisionIds: string[] | null = null;
  if (images[0]) {
    finalVisionIds = await runFullPoolVision(images[0]);
    if (finalVisionIds) {
      const visibleSet = new Set(finalVisionIds);
      const pinVerificationMissing = includedPinnedIds.filter((p) => !visibleSet.has(p));
      timer.mark("pin_verify", {
        checked: includedPinnedIds.length,
        visible: finalVisionIds.length,
        missing: pinVerificationMissing.length,
      });
      traceCatalogPipeline("pin_verify", {
        phase,
        visibleIds: finalVisionIds.filter((id) => includedPinnedIds.includes(id)),
        missingIds: pinVerificationMissing,
        source: "full_pool_vision",
      });
    }
  }

  return { images, finalVisionIds };
}
