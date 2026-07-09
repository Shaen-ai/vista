import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import type { CollageCellMeta, CollageSheet } from "@/lib/productReferenceCollage";

const TAG = "[gemini-product-images]";

function isEnabled(): boolean {
  return process.env.GEMINI_LOG_PRODUCT_IMAGES !== "0";
}

function resolveSourceUrls(row: CatalogItemSummary): string[] {
  const urls: string[] = [];
  if (row.galleryUrls?.length) {
    for (const u of row.galleryUrls) {
      if (u && /^https?:\/\//i.test(u)) urls.push(u);
    }
  }
  if (row.cleanImageUrl && /^https?:\/\//i.test(row.cleanImageUrl)) urls.push(row.cleanImageUrl);
  if (row.primaryImageUrl && /^https?:\/\//i.test(row.primaryImageUrl)) urls.push(row.primaryImageUrl);
  // Deduplicate preserving order
  return [...new Set(urls)];
}

// ─── Collage path ───────────────────────────────────────────────────────────

export function logGeminiCollagePayload(opts: {
  includedSheets: CollageSheet[];
  droppedSheets: CollageSheet[];
  droppedCatalogIds: string[];
  pinFetchFailedIds: string[];
  cellRefByCatalogId: Map<string, string>;
  catalogById: Map<string, CatalogItemSummary>;
  uploadInputs: Array<{ label?: string; buffer: Buffer }>;
  stats: Record<string, number>;
}): void {
  if (!isEnabled()) return;

  const includedProducts: Array<Record<string, unknown>> = [];
  const seenCatalogIds = new Set<string>();

  for (const sheet of opts.includedSheets) {
    for (const cell of sheet.cells) {
      if (!cell.catalogId || seenCatalogIds.has(cell.catalogId)) continue;
      seenCatalogIds.add(cell.catalogId);
      const row = opts.catalogById.get(cell.catalogId);
      includedProducts.push({
        role: cell.role,
        catalogId: cell.catalogId,
        name: cell.name ?? row?.name ?? null,
        cellRef: opts.cellRefByCatalogId.get(cell.catalogId) ?? null,
        sourceUrls: row ? resolveSourceUrls(row) : [],
        pinned: cell.pinned ?? false,
        sizeCm: cell.sizeCm ?? null,
      });
    }
  }

  const sheets = opts.includedSheets.map((sheet, idx) => ({
    sheetIndex: idx,
    sourceGroup: sheet.sourceGroup,
    cellCount: sheet.cells.length,
    bytesSent: sheet.byteLength,
    cells: sheet.cells.map((c: CollageCellMeta) => ({
      catalogId: c.catalogId ?? null,
      name: c.name ?? null,
      role: c.role,
      pinned: c.pinned ?? false,
    })),
  }));

  const userUploads = opts.uploadInputs.map((u) => ({
    role: "user_upload" as const,
    label: u.label ?? null,
    bytesSent: u.buffer.byteLength,
  }));

  const dropped: Array<Record<string, unknown>> = [];
  for (const id of opts.droppedCatalogIds) {
    const row = opts.catalogById.get(id);
    dropped.push({ catalogId: id, name: row?.name ?? null, reason: "text_only" });
  }
  for (const id of opts.pinFetchFailedIds) {
    if (opts.droppedCatalogIds.includes(id)) continue;
    const row = opts.catalogById.get(id);
    dropped.push({ catalogId: id, name: row?.name ?? null, reason: "fetch_failed" });
  }
  for (const sheet of opts.droppedSheets) {
    for (const cell of sheet.cells) {
      if (!cell.catalogId || seenCatalogIds.has(cell.catalogId)) continue;
      seenCatalogIds.add(cell.catalogId);
      const row = opts.catalogById.get(cell.catalogId);
      dropped.push({ catalogId: cell.catalogId, name: row?.name ?? null, reason: "budget" });
    }
  }

  console.info(
    `${TAG} collage_payload`,
    JSON.stringify({
      path: "collage",
      includedProducts,
      collageSheets: sheets,
      userUploads,
      dropped,
      stats: opts.stats,
    }),
  );
}

// ─── Individual (phased) path ───────────────────────────────────────────────

export function logGeminiIndividualPayload(opts: {
  phase: string;
  products: Array<{
    catalogId: string;
    name: string;
    referenceKind: string;
    sourceUrls: string[];
    viewByteSizes: number[];
    pinned?: boolean;
  }>;
  userUploads: Array<{ label: string; bytesSent: number }>;
  fetchFailedIds: string[];
  catalogById: Map<string, CatalogItemSummary>;
}): void {
  if (!isEnabled()) return;

  const includedProducts = opts.products.map((p) => ({
    role: "catalog_product" as const,
    catalogId: p.catalogId,
    name: p.name,
    referenceKind: p.referenceKind,
    sourceUrls: p.sourceUrls,
    viewCount: p.viewByteSizes.length,
    bytesSent: p.viewByteSizes.reduce((a, b) => a + b, 0),
    pinned: p.pinned ?? false,
  }));

  const dropped = opts.fetchFailedIds.map((id) => {
    const row = opts.catalogById.get(id);
    return { catalogId: id, name: row?.name ?? null, reason: "fetch_failed" as const };
  });

  console.info(
    `${TAG} individual_payload`,
    JSON.stringify({
      path: "individual",
      phase: opts.phase,
      includedProducts,
      userUploads: opts.userUploads,
      dropped,
      stats: {
        includedCount: includedProducts.length,
        uploadCount: opts.userUploads.length,
        fetchFailedCount: opts.fetchFailedIds.length,
      },
    }),
  );
}
