import "server-only";

import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import { fetchCatalogProductImageBuffers, fetchSofaGalleryBuffers, isCatalogSofa } from "@/lib/consumerCatalog";
import { buildGeminiImageManifestBlock } from "@/lib/geminiImageManifest";
import { applyGeminiCollageBudget } from "@/lib/geminiPayloadBudget";
import { logGeminiCollagePayload } from "@/lib/logGeminiProductImages";
import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";
import {
  buildCollageSheetsForGroup,
  formatCellRef,
  type CollageCellInput,
} from "@/lib/productReferenceCollage";

export interface UserUploadImageItem {
  base64: string;
  mimeType: string;
  label: string;
}

export interface BuildGeminiVisualPartsResult {
  roomInline?: { mimeType: string; data: string };
  extraRoomInlines: Array<{ mimeType: string; data: string }>;
  roomByteLength: number;
  productImageParts: Array<{ inlineData: { mimeType: string; data: string } }>;
  manifestBlock: string;
  uploadGeminiNote: string;
  /** Prose directive instructing Gemini to faithfully place catalog SKUs from the collage. */
  catalogPlacementNote: string;
  /** Text to place BEFORE product collage images — tells Gemini these are reference-only. */
  productIntroText: string;
  /** Text to place AFTER product collage images (includes manifest) — closes reference section. */
  productCloseText: string;
  stats: {
    uploadCount: number;
    catalogImageCount: number;
    collageCount: number;
    droppedSheetCount: number;
    totalBytes: number;
    includedCatalogCount: number;
    textOnlyCatalogCount: number;
    pinIncludedCount: number;
    pinFetchFailedCount: number;
  };
  /** Catalog SKUs with reference images in Gemini collage sheets. */
  includedCatalogIds: string[];
  /** Catalog SKUs listed in manifest text_only (collage budget dropped). */
  textOnlyCatalogIds: string[];
  /** Pinned mp-* ids that successfully appear in the collage. */
  includedPinnedIds: string[];
  /** Pinned mp-* ids that had no usable image and never reached the collage. */
  pinFetchFailedIds: string[];
  /** Map of catalog id → collage cell ref (e.g. "Sheet2-B3"). Use to link merchant text to visuals. */
  cellRefByCatalogId: Map<string, string>;
}

export async function buildGeminiProductVisualParts(opts: {
  roomImageBytes?: ArrayBuffer | null;
  extraRoomImageBytes?: ArrayBuffer[];
  userUploads: UserUploadImageItem[];
  selectedCatalogIds: string[];
  pinnedMpKeys: string[];
  catalogById: Map<string, CatalogItemSummary>;
}): Promise<BuildGeminiVisualPartsResult> {
  const pinnedSet = new Set(opts.pinnedMpKeys);
  let roomInline: { mimeType: string; data: string } | undefined;
  let roomByteLength = 0;

  if (opts.roomImageBytes && opts.roomImageBytes.byteLength > 0) {
    const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(opts.roomImageBytes));
    roomInline = { mimeType: optimized.mimeType, data: optimized.base64 };
    roomByteLength = optimized.byteLength;
  }

  // Optimize extra room images in parallel; preserve input order and per-item skip-on-error.
  const extraRoomResults = await Promise.all(
    (opts.extraRoomImageBytes ?? []).map(async (buf) => {
      if (buf.byteLength <= 0) return null;
      try {
        const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(buf));
        return { mimeType: optimized.mimeType, data: optimized.base64 };
      } catch {
        console.warn("buildGeminiProductVisualParts: skip extra room image");
        return null;
      }
    }),
  );
  const extraRoomInlines: Array<{ mimeType: string; data: string }> = extraRoomResults.filter(
    (r): r is { mimeType: string; data: string } => r !== null,
  );

  // Optimize user uploads in parallel; preserve input order and per-item skip-on-error.
  const uploadResults = await Promise.all(
    opts.userUploads.map(async (item, i): Promise<CollageCellInput | null> => {
      try {
        const buf = Buffer.from(item.base64, "base64");
        const optimized = await optimizeImageBufferForAiWithBuffer(buf);
        return {
          candidateId: `upload-${i}`,
          buffer: optimized.buffer,
          role: "user_upload",
          label: item.label || `Product ${i + 1}`,
        };
      } catch {
        console.warn(`buildGeminiProductVisualParts: skip upload ${i}`);
        return null;
      }
    }),
  );
  const uploadInputs: CollageCellInput[] = uploadResults.filter(
    (r): r is CollageCellInput => r !== null,
  );

  const sofaIds = opts.selectedCatalogIds.filter((id) => {
    const row = opts.catalogById.get(id);
    return row != null && isCatalogSofa(row);
  });
  const nonSofaIds = opts.selectedCatalogIds.filter((id) => !sofaIds.includes(id));

  const catalogBuffers = await fetchCatalogProductImageBuffers(nonSofaIds, opts.catalogById);

  const otherInputs: CollageCellInput[] = catalogBuffers.map((entry) => ({
    candidateId: entry.catalogId,
    buffer: entry.buffer,
    role: "catalog_product" as const,
    catalogId: entry.catalogId,
    name: entry.name,
    sizeCm: entry.sizeCm,
    pinned: pinnedSet.has(entry.catalogId),
  }));

  const sofaSheets: Awaited<ReturnType<typeof buildCollageSheetsForGroup>> = [];
  const sofaIdsWithImages = new Set<string>();
  let totalSofaImages = 0;
  const sofaGalleries = await Promise.all(
    sofaIds.map((sofaId) => fetchSofaGalleryBuffers(sofaId, opts.catalogById)),
  );
  for (let i = 0; i < sofaIds.length; i++) {
    const sofaId = sofaIds[i]!;
    const gallery = sofaGalleries[i]!;
    if (!gallery.length) continue;
    sofaIdsWithImages.add(sofaId);
    totalSofaImages += gallery.length;
    const cells: CollageCellInput[] = gallery.map((entry, viewIdx) => ({
      candidateId: `${entry.catalogId}-view-${viewIdx}`,
      buffer: entry.buffer,
      role: "catalog_product" as const,
      catalogId: entry.catalogId,
      name: entry.name,
      sizeCm: entry.sizeCm,
      pinned: pinnedSet.has(entry.catalogId),
    }));
    const sheets = await buildCollageSheetsForGroup(cells, "catalog", 50 + i);
    sofaSheets.push(...sheets);
  }

  const fetchedCatalogIds = new Set([
    ...catalogBuffers.map((b) => b.catalogId),
    ...sofaIdsWithImages,
  ]);
  const pinFetchFailedIds = [...pinnedSet].filter((id) => !fetchedCatalogIds.has(id));
  if (pinFetchFailedIds.length > 0) {
    console.warn(
      "buildGeminiProductVisualParts: pinned catalog ids without usable image",
      pinFetchFailedIds,
    );
  }

  const uploadSheets = await buildCollageSheetsForGroup(uploadInputs, "user_uploads", 0);
  const otherSheets = await buildCollageSheetsForGroup(otherInputs, "catalog", 100);
  const catalogSheets = [...sofaSheets, ...otherSheets];

  const budget = applyGeminiCollageBudget([...uploadSheets, ...catalogSheets], roomByteLength);
  const includedSheets = budget.includedSheets;
  const droppedSheets = budget.droppedSheets;

  const includedCatalogIds = new Set<string>();
  const includedPinnedSet = new Set<string>();
  const cellRefByCatalogId = new Map<string, string>();
  includedSheets.forEach((sheet, sheetIdx) => {
    for (const cell of sheet.cells) {
      if (!cell.catalogId) continue;
      includedCatalogIds.add(cell.catalogId);
      if (cell.pinned) includedPinnedSet.add(cell.catalogId);
      if (!cellRefByCatalogId.has(cell.catalogId)) {
        cellRefByCatalogId.set(
          cell.catalogId,
          `Sheet${sheetIdx + 1}-${formatCellRef(cell.row, cell.col)}`,
        );
      }
    }
  });

  const droppedCatalogIds = opts.selectedCatalogIds.filter((id) => !includedCatalogIds.has(id));
  const includedCatalogIdsList = [...includedCatalogIds];
  const includedPinnedIds = [...includedPinnedSet];

  const manifestBlock = buildGeminiImageManifestBlock({
    hasRoomImage: Boolean(roomInline),
    includedSheets,
    droppedCatalogIds,
    catalogById: opts.catalogById,
    pinnedMpKeys: pinnedSet,
  });

  const uploadGeminiNote =
    uploadInputs.length > 0
      ? `\nUSER-PROVIDED PRODUCT IMAGES (${uploadInputs.length} in collage sheets — these are products the user wants placed in the room): Match their exact appearance — shape, color, material, proportions — and place each one in the design.${opts.userUploads.map((item, i) => (item.label ? `\n- Upload ${i + 1}: "${item.label}"` : "")).filter(Boolean).join("")}\nSee IMAGE_MANIFEST for collage cell mapping.\n`
      : "";

  const catalogPlacementNote = buildCatalogPlacementNote({
    includedCatalogIds: includedCatalogIdsList,
    includedPinnedIds,
    catalogById: opts.catalogById,
    cellRefByCatalogId,
  });

  const productImageParts = includedSheets.map((s) => ({ inlineData: s.inlineData }));

  const productIntroText = productImageParts.length > 0
    ? `PRODUCT REFERENCE IMAGES (DO NOT render these images in the output — they show individual products to place AS FURNITURE in the room):\nEach collage sheet below contains product photos on a plain background. These are isolated product shots for visual reference ONLY. Place these products as real 3D furniture/objects in the room — do NOT display the reference photos themselves as pictures, frames, screens, or posters in the final image.\nSofa sheets show up to 4 views of the SAME sofa (front, side, angle, detail). Use all views to match the exact L-shape vs straight silhouette, depth, and proportions along with size_cm dimensions.`
    : "";

  const productCloseText = productImageParts.length > 0
    ? `END OF PRODUCT REFERENCES.\nThe images above show isolated products to place as real furniture in the redesigned room. Do NOT show the reference photos themselves in the final image — they must appear ONLY as physical 3D furniture/objects placed naturally in the room.\n${manifestBlock}${uploadGeminiNote}${catalogPlacementNote}`
    : "";

  const stats = {
    uploadCount: uploadInputs.length,
    catalogImageCount: otherInputs.length + totalSofaImages,
    collageCount: includedSheets.length,
    droppedSheetCount: droppedSheets.length,
    totalBytes: budget.totalBytes,
    includedCatalogCount: includedCatalogIdsList.length,
    textOnlyCatalogCount: droppedCatalogIds.length,
    pinIncludedCount: includedPinnedIds.length,
    pinFetchFailedCount: pinFetchFailedIds.length,
  };

  logGeminiCollagePayload({
    includedSheets,
    droppedSheets,
    droppedCatalogIds,
    pinFetchFailedIds,
    cellRefByCatalogId,
    catalogById: opts.catalogById,
    uploadInputs,
    stats,
  });

  return {
    roomInline,
    extraRoomInlines,
    roomByteLength,
    productImageParts,
    manifestBlock,
    uploadGeminiNote,
    catalogPlacementNote,
    productIntroText,
    productCloseText,
    stats,
    includedCatalogIds: includedCatalogIdsList,
    textOnlyCatalogIds: droppedCatalogIds,
    includedPinnedIds,
    pinFetchFailedIds,
    cellRefByCatalogId,
  };
}

export function buildCatalogPlacementNote(opts: {
  includedCatalogIds: string[];
  includedPinnedIds: string[];
  catalogById: Map<string, CatalogItemSummary>;
  cellRefByCatalogId: Map<string, string>;
  /** When set, an extra RETRY block tells Gemini these specific pins were missing from a previous render and MUST be placed prominently this time. */
  priorityPinIds?: string[];
}): string {
  if (opts.includedCatalogIds.length === 0) return "";

  const lines: string[] = [];
  lines.push(
    `\nCATALOG PRODUCTS TO PLACE (${opts.includedCatalogIds.length} in collage sheets — these are real SKUs from our store that the user wants placed in the room).`,
  );
  lines.push(
    "Match each product's exact appearance — silhouette, color, upholstery, wood tone, finish — as shown in its collage cell. The final render MUST visibly contain each one (do not invent or substitute lookalikes).",
  );

  if (opts.includedPinnedIds.length > 0) {
    const pinDescriptions = opts.includedPinnedIds.slice(0, 6).map((id) => {
      const row = opts.catalogById.get(id);
      const cellRef = opts.cellRefByCatalogId.get(id);
      const name = row?.name ?? id;
      return cellRef ? `"${name}" (collage ${cellRef})` : `"${name}"`;
    });
    const more =
      opts.includedPinnedIds.length > pinDescriptions.length
        ? ` and ${opts.includedPinnedIds.length - pinDescriptions.length} more`
        : "";
    lines.push(
      `Pinned by user — MANDATORY in final render: ${pinDescriptions.join(", ")}${more}.`,
    );
  }

  const priorities = (opts.priorityPinIds ?? []).filter((id) =>
    opts.includedPinnedIds.includes(id) || opts.includedCatalogIds.includes(id),
  );
  if (priorities.length > 0) {
    const priorityDescriptions = priorities.slice(0, 6).map((id) => {
      const row = opts.catalogById.get(id);
      const cellRef = opts.cellRefByCatalogId.get(id);
      const name = row?.name ?? id;
      return cellRef ? `"${name}" (collage ${cellRef})` : `"${name}"`;
    });
    lines.push(
      `RETRY ALERT — the previous render did NOT show ${priorityDescriptions.join(", ")}. Place each one prominently and visibly in the foreground or focal area of this render. They are MANDATORY; the render is unacceptable without them.`,
    );
  }

  lines.push("See IMAGE_MANIFEST for the full cell → SKU mapping.\n");
  return lines.join("\n");
}
