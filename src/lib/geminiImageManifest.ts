import "server-only";

import type { CollageSheet } from "@/lib/productReferenceCollage";
import { COLLAGE_COLS, formatCellRef } from "@/lib/productReferenceCollage";
import type { CatalogItemSummary } from "@/lib/consumerCatalog";

export interface ManifestTextOnlyProduct {
  catalogId: string;
  name: string;
  sizeCm: string;
  pinned?: boolean;
}

export function buildGeminiImageManifestBlock(opts: {
  hasRoomImage: boolean;
  includedSheets: CollageSheet[];
  droppedCatalogIds: string[];
  catalogById: Map<string, CatalogItemSummary>;
  pinnedMpKeys: Set<string>;
}): string {
  const parts: Array<Record<string, unknown>> = [];
  let index = 0;

  for (const sheet of opts.includedSheets) {
    const catalogIds = new Set(sheet.cells.map((c) => c.catalogId).filter(Boolean));
    const isMultiView = catalogIds.size === 1 && sheet.cells.length > 1;
    const sheetEntry: Record<string, unknown> = {
      index,
      role: "product_collage",
      source: sheet.sourceGroup,
      layout: `${COLLAGE_COLS}x${Math.ceil(sheet.cells.length / COLLAGE_COLS)}`,
      cells: sheet.cells.map((c) => ({
        cell: formatCellRef(c.row, c.col),
        role: c.role,
        catalog_id: c.catalogId ?? null,
        label: c.label || null,
        name: c.name || null,
        size_cm: c.sizeCm || null,
        pinned: c.pinned === true,
      })),
    };
    if (isMultiView) {
      const singleId = [...catalogIds][0]!;
      sheetEntry.multi_view_product = true;
      sheetEntry.catalog_id = singleId;
      sheetEntry.view_count = sheet.cells.length;
    }
    parts.push(sheetEntry);
    index++;
  }

  if (opts.hasRoomImage) {
    parts.push({
      index,
      role: "room_reference",
      description: "Original room photo — preserve geometry, windows, doors, and camera angle exactly. This is the room to redesign.",
    });
    index++;
  }

  const includedCatalogIds = new Set<string>();
  for (const sheet of opts.includedSheets) {
    for (const cell of sheet.cells) {
      if (cell.catalogId) includedCatalogIds.add(cell.catalogId);
    }
  }

  const textOnly: ManifestTextOnlyProduct[] = [];
  for (const id of opts.droppedCatalogIds) {
    if (includedCatalogIds.has(id)) continue;
    const row = opts.catalogById.get(id);
    if (!row) continue;
    textOnly.push({
      catalogId: id,
      name: row.name,
      sizeCm: `${row.width_cm}x${row.depth_cm}x${row.height_cm}`,
      pinned: opts.pinnedMpKeys.has(id),
    });
  }

  const manifest = {
    image_manifest: {
      parts,
      text_only_products: textOnly,
      instructions:
        "Product collage images come FIRST as reference. The room photo follows AFTER. Match each collage cell to the listed product and place it as real furniture in the room. Do NOT render collage images as pictures/frames in the output. Sheets marked multi_view_product show multiple angles of the SAME sofa — use all views to match its exact silhouette (L-shape vs straight), depth, and proportions; do NOT treat cells as separate products.",
    },
  };

  return `\nIMAGE_MANIFEST (product collages → then room photo):\n${JSON.stringify(manifest, null, 2)}\n`;
}
