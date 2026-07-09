import sharp from "sharp";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";

export interface OpeningFreezeRegionsInput {
  width: number;
  height: number;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
  structuralBoxes?: OpeningBox[];
  padding?: number;
}

function freezeRects(
  boxes: OpeningBox[] | undefined,
  imgW: number,
  imgH: number,
  pad: number,
  fill: string,
): string {
  if (!boxes?.length) return "";
  return boxes
    .map((b) => {
      const padX = b.w * imgW * pad;
      const padY = b.h * imgH * pad;
      const x = Math.max(0, Math.round(b.x * imgW - padX));
      const y = Math.max(0, Math.round(b.y * imgH - padY));
      const w = Math.min(imgW - x, Math.round(b.w * imgW + padX * 2));
      const h = Math.min(imgH - y, Math.round(b.h * imgH + padY * 2));
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" />`;
    })
    .join("");
}

export function hasOpeningBoxes(
  windowBoxes?: OpeningBox[],
  doorBoxes?: OpeningBox[],
  structuralBoxes?: OpeningBox[],
): boolean {
  return (
    (windowBoxes?.length ?? 0) > 0 ||
    (doorBoxes?.length ?? 0) > 0 ||
    (structuralBoxes?.length ?? 0) > 0
  );
}

/**
 * Canonical opening freeze map: white = editable, black = frozen (preserve).
 * Does NOT apply VISTA_FAL_MASK_INVERT — combine other masks in this space first.
 */
export async function buildOpeningFreezeRegionsCanonical(
  input: OpeningFreezeRegionsInput,
): Promise<Buffer | null> {
  const { width, height, windowBoxes, doorBoxes, structuralBoxes } = input;
  if (!hasOpeningBoxes(windowBoxes, doorBoxes, structuralBoxes)) return null;
  if (!(width > 0) || !(height > 0)) return null;

  const pad = typeof input.padding === "number" ? Math.max(0, input.padding) : 0.04;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="white"/>` +
    freezeRects(windowBoxes, width, height, pad, "black") +
    freezeRects(doorBoxes, width, height, pad, "black") +
    freezeRects(structuralBoxes, width, height, pad, "black") +
    `</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
