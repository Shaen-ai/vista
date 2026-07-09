import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import { fetchProductPurchaseLinks, type ProductPurchaseLink } from "@/lib/productPurchaseLinks";
import { sortProductsForDisplay, catalogCategorySortKey, PRODUCT_DISPLAY_BAND } from "@/lib/productDisplayOrder";
import {
  buildProductIdentifyCandidateMpKeys,
  buildRenderPlanProductIds,
  finalizeRenderProductCatalogIds,
} from "@/lib/placementPlan";
import type { RequiredSlot, ResolvedCatalogSlot } from "@/lib/resolveCatalogSlots";
import { numericIdsFromMpKeys } from "@/lib/scrapedRoomGeneration";
import { identifyCatalogProductsInRender } from "@/lib/identifyRenderProducts";
import {
  summarizeCatalogIds,
  traceCatalogPipeline,
  ProductFunnelTracer,
} from "@/lib/catalogTrace";
import { debugIngest } from "@/lib/debugIngest";

export async function buildRenderProductLinks(opts: {
  selectedForGemini: string[];
  collageIncludedIds: string[];
  textOnlyCatalogIds?: string[];
  catalogById: Map<string, CatalogItemSummary>;
  pinnedMpKeys: string[];
  brief: Pick<DesignBrief, "fullPrompt" | "subject" | "arrangement">;
  /** When provided, runs a vision pass on this image to confirm which catalog SKUs are visible. */
  finalImageBase64?: string;
  finalImageMimeType?: string;
  /** Pre-computed vision result (e.g. produced earlier in the request). Skips the extra Claude call. */
  precomputedVisionIds?: string[];
  slots?: RequiredSlot[];
  tracePhase?: string;
  funnel?: ProductFunnelTracer;
  flooringSlotIds?: string[];
}): Promise<{ productLinks: ProductPurchaseLink[]; usedCatalogIds: string[]; source: "vision_confirmed" | "fallback_no_vision" }> {
  const allowedCatalogKeys = new Set(opts.catalogById.keys());
  let usedCatalogIds: string[] = [];
  let source: "vision_confirmed" | "fallback_no_vision" = "fallback_no_vision";

  const tryVision = async (): Promise<string[] | null> => {
    // A provided result is authoritative even when empty ("vision ran, found
    // nothing") — don't run a second identical vision call in that case.
    if (opts.precomputedVisionIds !== undefined) {
      return opts.precomputedVisionIds.filter((k) => allowedCatalogKeys.has(k));
    }
    if (!opts.finalImageBase64 || !opts.finalImageMimeType) return null;
    if (!getAnthropicApiKey()) return null;
    const candidates = buildProductIdentifyCandidateMpKeys({
      selectedForGemini: opts.selectedForGemini,
      pinnedMpKeys: opts.pinnedMpKeys,
      collageIncludedIds: opts.collageIncludedIds,
      allowedCatalogKeys,
      maxCandidates: 16,
    });
    if (candidates.length === 0) return null;
    try {
      const result = await identifyCatalogProductsInRender({
        imageBase64: opts.finalImageBase64,
        mimeType: opts.finalImageMimeType,
        catalogById: opts.catalogById,
        candidateMpKeys: candidates,
        brief: opts.brief,
        pinnedMpKeys: opts.pinnedMpKeys,
      });
      return result.catalogIds.filter((k) => allowedCatalogKeys.has(k));
    } catch (visionErr) {
      console.warn("buildRenderProductLinks: vision identification failed; falling back", visionErr);
      return null;
    }
  };

  const visionIds = await tryVision();
  if (visionIds && visionIds.length > 0) {
    usedCatalogIds = finalizeRenderProductCatalogIds({
      visionIds,
      collageIncludedIds: opts.collageIncludedIds,
      textOnlyCatalogIds: opts.textOnlyCatalogIds,
      selectedForGemini: opts.selectedForGemini,
      pinnedMpKeys: opts.pinnedMpKeys,
      allowedCatalogKeys,
      catalogById: opts.catalogById,
      fullPrompt: opts.brief.fullPrompt,
      slots: opts.slots,
      tracePhase: opts.tracePhase,
    });
    source = "vision_confirmed";
  } else {
    usedCatalogIds = buildRenderPlanProductIds({
      selectedForGemini: opts.selectedForGemini,
      pinnedMpKeys: opts.pinnedMpKeys,
      collageIncludedIds: opts.collageIncludedIds,
      allowedCatalogKeys,
      catalogById: opts.catalogById,
      fullPrompt: opts.brief.fullPrompt,
    });
  }

  if (opts.flooringSlotIds?.length) {
    for (const fid of opts.flooringSlotIds) {
      if (allowedCatalogKeys.has(fid) && !usedCatalogIds.includes(fid)) {
        usedCatalogIds.push(fid);
      }
    }
  }

  opts.funnel?.snapshot("merged_final", usedCatalogIds);

  const linkIds = numericIdsFromMpKeys(usedCatalogIds);
  traceCatalogPipeline("8_plan_ids_for_links", {
    phase: opts.tracePhase ?? "unknown",
    source,
    visionCount: visionIds?.length ?? 0,
    usedCount: usedCatalogIds.length,
    usedCatalogIds,
    linkIds,
    summarize: summarizeCatalogIds(usedCatalogIds, opts.catalogById),
  });
  traceCatalogPipeline("products_in_render_source", {
    phase: opts.tracePhase ?? "unknown",
    source,
    outCount: usedCatalogIds.length,
  });

  debugIngest(
    "generate/route.ts:buildRenderProductLinks",
    "product_list_source",
    {
      source,
      usedCatalogIds,
      usedNames: usedCatalogIds.map((k) => opts.catalogById.get(k)?.name ?? k),
      selectedForGemini: opts.selectedForGemini,
      visionIds: visionIds ?? [],
    },
    "B",
    "vision-v1",
  );

  const productLinks =
    linkIds.length > 0
      ? sortProductsForDisplay(await fetchProductPurchaseLinks(linkIds))
      : [];

  traceCatalogPipeline("9_product_links_out", {
    phase: opts.tracePhase ?? "unknown",
    usedCount: usedCatalogIds.length,
    linksCount: productLinks.length,
    linkProductIds: productLinks.map((l) => l.id),
    missingLinks: linkIds.filter((id) => !productLinks.some((l) => l.id === id)),
  });

  opts.funnel?.snapshot(
    "product_links_out",
    productLinks.map((l) => `mp-${l.id}`),
  );
  opts.funnel?.audit(
    productLinks.map((l) => `mp-${l.id}`),
    opts.catalogById,
    "render",
  );

  return { productLinks, usedCatalogIds, source };
}

export function extractFlooringSlotIds(
  slots: ResolvedCatalogSlot[] | undefined,
  catalogById: Map<string, CatalogItemSummary>,
  selectedForGemini?: string[],
): string[] {
  if (slots?.length) {
    return slots
      .filter((s) => s.family === "flooring" && s.product_ids?.length)
      .flatMap((s) => s.product_ids!.map((id) => `mp-${id}`))
      .filter((id) => catalogById.has(id));
  }
  if (selectedForGemini?.length) {
    return selectedForGemini.filter((id) => {
      const row = catalogById.get(id);
      if (!row) return false;
      if (row.product_family === "flooring") return true;
      return catalogCategorySortKey(row.category ?? "", row.name) === PRODUCT_DISPLAY_BAND.flooring;
    });
  }
  return [];
}
