import "server-only";

import type { RoomDesignBrief, MasterDesignConcept, MarketplaceMatch } from "@/lib/project/types";
import {
  fetchMarketplaceProductsAsCatalog,
  buildGeminiMerchantFurnitureCatalogBlock,
  type CatalogItemSummary,
} from "@/lib/consumerCatalog";
import {
  buildGeminiProductVisualParts,
  type UserUploadImageItem,
} from "@/lib/buildGeminiProductVisualParts";
import { normalizeInteriorDesignCoverage } from "@/lib/interiorDesignCatalog";
import {
  resolveCatalogSlots,
  vectorConfirmedCatalogIds,
  filterSlotsForRoomType,
  type RequiredSlot,
  type DesignConstraints,
} from "@/lib/resolveCatalogSlots";
import { getRoomSlotTemplate, mergeRoomSlots } from "@/lib/roomSlotTemplates";
import { normalizeRoomTypeValue } from "@/lib/interiorDesignPrompts";
import {
  summarizeCatalogIds,
  summarizeResolvedSlots,
  traceCatalogPipeline,
} from "@/lib/catalogTrace";
import {
  buildVisionCandidateMpKeys,
  dedupeSingletonCatalogIds,
  geminiPlanCatalogIds,
  orderIdsForGemini,
} from "@/lib/placementPlan";
import { fetchProductPurchaseLinks, type ProductPurchaseLink } from "@/lib/productPurchaseLinks";
import { sortProductsForDisplay } from "@/lib/productDisplayOrder";

export interface ResolvedRoomCatalog {
  selectedForGemini: string[];
  plannedCatalogIds: string[];
  catalogById: Map<string, CatalogItemSummary>;
  resolvedNumericIds: number[];
  pinnedMpKeys: string[];
  collageIncludedIds?: string[];
  textOnlyCatalogIds?: string[];
}

export interface GeminiCatalogPayload {
  merchantAppendix: string;
  productImageParts: Array<{ inlineData: { mimeType: string; data: string } }>;
  manifestBlock: string;
  uploadGeminiNote: string;
  combinedMerchantAppendix: string;
  plannedCatalogIds: string[];
  includedCatalogIds: string[];
  textOnlyCatalogIds: string[];
  productIntroText: string;
  productCloseText: string;
  cellRefByCatalogId: Map<string, string>;
}

const CURTAIN_RE = /\b(curtain|drape|blind|sheer|valance)\b/i;
const WALL_FINISH_RE = /\b(wallpaper|wall panel|wainscot|accent wall)\b/i;

function inferFlooringSubtype(floorMaterial: string): string | undefined {
  const s = floorMaterial.toLowerCase();
  if (/\blaminate\b/.test(s)) return "laminate";
  if (/\bparquet|hardwood|engineered wood|wood floor|oak floor\b/.test(s)) return "parquet";
  if (/\btile|porcelain|ceramic\b/.test(s)) return "tile";
  if (/\bvinyl|lvt|spc\b/.test(s)) return "vinyl";
  if (/\brug|carpet\b/.test(s)) return "rug";
  return undefined;
}

export function slotsFromRoomDesignBrief(brief: RoomDesignBrief): RequiredSlot[] {
  const slots: RequiredSlot[] = [];

  if (brief.floorMaterial.trim()) {
    slots.push({
      family: "flooring",
      subtype: inferFlooringSubtype(brief.floorMaterial),
      quantity: 1,
      placement: brief.floorMaterial,
    });
  }

  if (brief.lightingConcept.trim()) {
    slots.push({
      family: "lighting",
      quantity: 1,
      placement: brief.lightingConcept,
    });
  }

  for (const line of brief.furnitureList) {
    const t = line.trim();
    if (!t) continue;
    slots.push({
      family: "furniture",
      quantity: 1,
      placement: t,
    });
  }

  for (const el of brief.keyDesignElements) {
    if (CURTAIN_RE.test(el)) {
      slots.push({ family: "window_treatments", quantity: 1, placement: el });
    } else if (WALL_FINISH_RE.test(el)) {
      slots.push({ family: "walls", quantity: 1, placement: el });
    }
  }

  if (brief.ceilingDesign.trim()) {
    slots.push({
      family: "lighting",
      subtype: "ceiling",
      quantity: 1,
      placement: brief.ceilingDesign,
    });
  }

  return slots;
}

export function buildDesignIntentFromRoomBrief(
  brief: RoomDesignBrief,
  concept: MasterDesignConcept,
): string {
  return [
    `${brief.roomName} (${brief.roomType})`,
    concept.overallStyle,
    brief.floorMaterial,
    brief.lightingConcept,
    brief.ceilingDesign,
    brief.furnitureList.join("; "),
    brief.keyDesignElements.join("; "),
    brief.specialNotes,
  ]
    .filter(Boolean)
    .join(". ");
}

export function constraintsFromRoomBrief(
  brief: RoomDesignBrief,
  concept: MasterDesignConcept,
): DesignConstraints {
  return {
    colors: [
      concept.colorPalette.primary.name,
      concept.colorPalette.secondary.name,
      concept.colorPalette.accent.name,
    ].filter(Boolean),
    materials: [
      concept.materialPalette.woodType,
      concept.materialPalette.metalFinish,
      concept.materialPalette.textilePrimary,
    ].filter(Boolean),
    style_keywords: concept.overallStyle
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8),
  };
}

export function buildBriefContextForRender(
  brief: RoomDesignBrief,
  concept: MasterDesignConcept,
): { subject: string; arrangement: string; fullPrompt: string } {
  return {
    subject: `${brief.roomName}: ${brief.keyDesignElements.join(", ") || brief.roomType}`,
    arrangement: brief.furnitureList.join("; "),
    fullPrompt: buildDesignIntentFromRoomBrief(brief, concept),
  };
}

export async function resolveRoomCatalogProducts(opts: {
  brief: RoomDesignBrief;
  concept: MasterDesignConcept;
  allowlistIds: number[];
  pinnedProductIds?: number[];
}): Promise<ResolvedRoomCatalog> {
  const allowlistIds = opts.allowlistIds.filter((n) => Number.isFinite(n) && n > 0);
  const pinnedProductIds = (opts.pinnedProductIds ?? []).filter((n) => Number.isFinite(n) && n > 0);

  const catalogById = new Map<string, CatalogItemSummary>();
  if (allowlistIds.length > 0) {
    const rows = await fetchMarketplaceProductsAsCatalog(allowlistIds);
    for (const row of rows) catalogById.set(row.id, row);
  }
  if (pinnedProductIds.length > 0) {
    const pinnedRows = await fetchMarketplaceProductsAsCatalog(pinnedProductIds);
    for (const row of pinnedRows) catalogById.set(row.id, row);
  }

  const pinnedMpKeys = pinnedProductIds
    .map((id) => `mp-${id}`)
    .filter((k) => catalogById.has(k));

  const roomType = normalizeRoomTypeValue(opts.brief.roomType);
  const mergedSlots = filterSlotsForRoomType(
    mergeRoomSlots({
      template: getRoomSlotTemplate(roomType),
      extras: slotsFromRoomDesignBrief(opts.brief),
    }),
    roomType,
  );

  const vectorResolved = await resolveCatalogSlots({
    designIntent: buildDesignIntentFromRoomBrief(opts.brief, opts.concept),
    slots: mergedSlots,
    pinnedProductIds,
    allowlistIds: allowlistIds.length > 0 ? allowlistIds : undefined,
    constraints: constraintsFromRoomBrief(opts.brief, opts.concept),
    roomType,
  });

  if (vectorResolved.metrics) {
    console.info("catalog.resolve_slots.metrics", vectorResolved.metrics);
  }

  traceCatalogPipeline("1_backend_slots", {
    phase: "project",
    metrics: vectorResolved.metrics,
    apiIds: vectorResolved.ids,
    slots: summarizeResolvedSlots(vectorResolved.slots),
  });

  const resolvedNumericIds = vectorConfirmedCatalogIds({
    slots: vectorResolved.slots,
    pinnedProductIds,
    apiIds: vectorResolved.ids,
  });

  const mpKeysFromConfirmed = resolvedNumericIds.map((n) => `mp-${n}`);
  traceCatalogPipeline("2_vector_confirmed", {
    phase: "project",
    numericIds: resolvedNumericIds,
    mpKeys: mpKeysFromConfirmed,
  });

  let extraRowsLoaded = 0;
  if (resolvedNumericIds.length > 0) {
    const extraRows = await fetchMarketplaceProductsAsCatalog(resolvedNumericIds);
    extraRowsLoaded = extraRows.length;
    for (const row of extraRows) catalogById.set(row.id, row);
  }
  traceCatalogPipeline("3_catalog_rows_loaded", {
    phase: "project",
    requested: resolvedNumericIds.length,
    loaded: extraRowsLoaded,
    missing: mpKeysFromConfirmed.filter((k) => !catalogById.has(k)),
  });

  let selectedForGemini = resolvedNumericIds
    .map((n) => `mp-${n}`)
    .filter((k) => catalogById.has(k));

  if (pinnedMpKeys.length > 0) {
    selectedForGemini = [...new Set([...pinnedMpKeys, ...selectedForGemini])];
  }

  traceCatalogPipeline("4_selected_before_order_dedupe", {
    phase: "project",
    count: selectedForGemini.length,
    ids: summarizeCatalogIds(selectedForGemini, catalogById),
  });

  selectedForGemini = orderIdsForGemini({
    pinnedMpKeys,
    briefSelectedIds: selectedForGemini,
    catalogById,
  });

  selectedForGemini = dedupeSingletonCatalogIds(
    selectedForGemini,
    catalogById,
    buildDesignIntentFromRoomBrief(opts.brief, opts.concept),
    mergedSlots,
  );

  traceCatalogPipeline("6_selected_after_dedupe", {
    phase: "project",
    count: selectedForGemini.length,
    ids: summarizeCatalogIds(selectedForGemini, catalogById),
  });

  const plannedCatalogIds = buildVisionCandidateMpKeys({
    briefSelectedIds: selectedForGemini,
    pinnedMpKeys,
    allowedCatalogKeys: new Set(catalogById.keys()),
  });

  return {
    selectedForGemini,
    plannedCatalogIds,
    catalogById,
    resolvedNumericIds,
    pinnedMpKeys,
  };
}

export async function buildGeminiCatalogPayload(opts: {
  selectedForGemini: string[];
  catalogById: Map<string, CatalogItemSummary>;
  pinnedMpKeys: string[];
  plannedCatalogIds: string[];
  referencePhotoBytes?: ArrayBuffer | null;
  userUploads?: UserUploadImageItem[];
  scrapedInventoryExclusive?: boolean;
}): Promise<GeminiCatalogPayload> {
  const coverage = normalizeInteriorDesignCoverage({ mode: "percent", value: 100 });

  const visualParts = await buildGeminiProductVisualParts({
    roomImageBytes: opts.referencePhotoBytes ?? null,
    userUploads: opts.userUploads ?? [],
    selectedCatalogIds: opts.selectedForGemini,
    pinnedMpKeys: opts.pinnedMpKeys,
    catalogById: opts.catalogById,
  });

  const merchantBlockIds: string[] = [];
  const seenMerchantIds = new Set<string>();
  const pushMerchantId = (id: string) => {
    if (seenMerchantIds.has(id)) return;
    seenMerchantIds.add(id);
    merchantBlockIds.push(id);
  };
  for (const id of visualParts.includedCatalogIds) pushMerchantId(id);
  for (const id of opts.pinnedMpKeys) pushMerchantId(id);

  const geminiMerchantAppendix =
    merchantBlockIds.length === 0
      ? ""
      : buildGeminiMerchantFurnitureCatalogBlock(
          merchantBlockIds,
          opts.catalogById,
          coverage,
          {
            armeniaLocalExclusive: opts.scrapedInventoryExclusive ?? true,
            cellRefByCatalogId: visualParts.cellRefByCatalogId,
          },
        );

  const combinedMerchantAppendix = [
    visualParts.manifestBlock,
    geminiMerchantAppendix,
    visualParts.uploadGeminiNote,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    merchantAppendix: geminiMerchantAppendix,
    productImageParts: visualParts.productImageParts,
    manifestBlock: visualParts.manifestBlock,
    uploadGeminiNote: visualParts.uploadGeminiNote,
    combinedMerchantAppendix,
    plannedCatalogIds: opts.plannedCatalogIds,
    includedCatalogIds: visualParts.includedCatalogIds,
    textOnlyCatalogIds: visualParts.textOnlyCatalogIds,
    productIntroText: visualParts.productIntroText,
    productCloseText: visualParts.productCloseText,
    cellRefByCatalogId: visualParts.cellRefByCatalogId,
  };
}

export function productLinksToMarketplaceMatches(links: ProductPurchaseLink[]): MarketplaceMatch[] {
  return links.map((link) => ({
    marketplaceId: link.id,
    name: link.name,
    price: link.price,
    currency: link.currency,
    url: link.sourceUrl,
    imageUrl: link.imageUrl,
    sourceMarketplace: link.sourceMarketplace,
  }));
}

export function numericIdsFromMpKeys(keys: string[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const key of keys) {
    const m = /^mp-(\d+)$/i.exec(String(key).trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export async function verifyProductsInRender(opts: {
  selectedCatalogIds: string[];
  plannedCatalogIds?: string[];
  collageIncludedIds?: string[];
  textOnlyCatalogIds?: string[];
  imageBase64?: string;
  mimeType?: string;
  brief?: { subject?: string; fullPrompt?: string; arrangement?: string };
  pinnedMpKeys?: string[];
}): Promise<{ catalogIds: string[]; usedProducts: MarketplaceMatch[] }> {
  void opts.imageBase64;
  void opts.mimeType;
  void opts.brief;
  void opts.plannedCatalogIds;
  void opts.collageIncludedIds;
  void opts.textOnlyCatalogIds;

  const numericIds = numericIdsFromMpKeys([
    ...opts.selectedCatalogIds,
    ...(opts.pinnedMpKeys ?? []),
  ]);
  const catalogRows =
    numericIds.length > 0 ? await fetchMarketplaceProductsAsCatalog(numericIds) : [];
  const allowedCatalogKeys = new Set(catalogRows.map((r) => r.id));

  const usedCatalogIds = geminiPlanCatalogIds({
    selectedForGemini: opts.selectedCatalogIds,
    pinnedMpKeys: opts.pinnedMpKeys ?? [],
    allowedCatalogKeys,
  });

  const linkIds = numericIdsFromMpKeys(usedCatalogIds);
  const links =
    linkIds.length > 0
      ? sortProductsForDisplay(await fetchProductPurchaseLinks(linkIds))
      : [];

  return {
    catalogIds: usedCatalogIds,
    usedProducts: productLinksToMarketplaceMatches(links),
  };
}
