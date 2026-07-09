import "server-only";

import sharp from "sharp";
import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";

export const COLLAGE_MAX_IMAGES = 4;
export const COLLAGE_COLS = 2;

const CELL_SIZE = 280;
const GUTTER = 8;
const BG = { r: 255, g: 255, b: 255, alpha: 1 };

export interface CollageCellInput {
  candidateId: string;
  buffer: Buffer;
  role: "user_upload" | "catalog_product";
  catalogId?: string;
  label?: string;
  name?: string;
  sizeCm?: string;
  pinned?: boolean;
}

export interface CollageCellMeta {
  cellIndex: number;
  row: number;
  col: number;
  role: "user_upload" | "catalog_product";
  catalogId?: string;
  label?: string;
  name?: string;
  sizeCm?: string;
  pinned?: boolean;
  candidateId: string;
}

export interface CollageSheet {
  inlineData: { mimeType: string; data: string };
  byteLength: number;
  cells: CollageCellMeta[];
  sourceGroup: "user_uploads" | "catalog";
  priority: number;
  hasPinned: boolean;
  hasUserUpload: boolean;
}

function cellLabel(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

function batchImages<T>(items: T[], maxPerSheet: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += maxPerSheet) {
    out.push(items.slice(i, i + maxPerSheet));
  }
  return out;
}

async function buildOneCollage(
  images: CollageCellInput[],
  sourceGroup: "user_uploads" | "catalog",
  priority: number,
): Promise<CollageSheet | null> {
  if (!images.length) return null;

  const cols = COLLAGE_COLS;
  const rows = Math.ceil(images.length / cols);
  const width = cols * CELL_SIZE + (cols + 1) * GUTTER;
  const height = rows * CELL_SIZE + (rows + 1) * GUTTER;

  const composites: sharp.OverlayOptions[] = [];
  const cells: CollageCellMeta[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const row = Math.floor(i / cols);
    const col = i % cols;
    const left = GUTTER + col * (CELL_SIZE + GUTTER);
    const top = GUTTER + row * (CELL_SIZE + GUTTER);

    const resized = await sharp(img.buffer, { failOn: "none" })
      .rotate()
      .resize(CELL_SIZE, CELL_SIZE, { fit: "contain", background: BG })
      .png()
      .toBuffer();

    composites.push({ input: resized, left, top });
    cells.push({
      cellIndex: i,
      row,
      col,
      role: img.role,
      catalogId: img.catalogId,
      label: img.label,
      name: img.name,
      sizeCm: img.sizeCm,
      pinned: img.pinned,
      candidateId: img.candidateId,
    });
  }

  const rawCollage = await sharp({
    create: { width, height, channels: 4, background: BG },
  })
    .composite(composites)
    .png()
    .toBuffer();

  const optimized = await optimizeImageBufferForAiWithBuffer(rawCollage, { quality: 75 });

  return {
    inlineData: { mimeType: optimized.mimeType, data: optimized.base64 },
    byteLength: optimized.byteLength,
    cells,
    sourceGroup,
    priority,
    hasPinned: cells.some((c) => c.pinned),
    hasUserUpload: cells.some((c) => c.role === "user_upload"),
  };
}

export async function buildCollageSheetsForGroup(
  images: CollageCellInput[],
  sourceGroup: "user_uploads" | "catalog",
  basePriority: number,
): Promise<CollageSheet[]> {
  const batches = batchImages(images, COLLAGE_MAX_IMAGES);
  const sheets: CollageSheet[] = [];

  for (let i = 0; i < batches.length; i++) {
    const sheet = await buildOneCollage(batches[i]!, sourceGroup, basePriority + i);
    if (sheet) sheets.push(sheet);
  }

  return sheets;
}

export function formatCellRef(row: number, col: number): string {
  return cellLabel(row, col);
}
