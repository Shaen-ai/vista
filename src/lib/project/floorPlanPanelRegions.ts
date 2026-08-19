import sharp from "sharp";
import type { PlanContentInset } from "./floorPlanContentCrop";
import { detectPlanContentInset } from "./floorPlanContentCrop";

const INK_THRESHOLD = 242;

export type PlanPanelInset = PlanContentInset & {
  /** ADU #1 (right plan) = 1, ADU #2 (left plan) = 2 */
  floorLevel: 1 | 2;
};

/**
 * Split a wide architectural sheet into left/right plan panels (vertical gutter).
 * Returns null when the layout does not look like two side-by-side plans.
 */
export async function detectDualPlanPanelInsets(
  imageBase64: string,
): Promise<PlanPanelInset[] | null> {
  const buf = Buffer.from(imageBase64, "base64");
  const { data, info } = await sharp(buf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!width || !height || !data.length) return null;

  const content = await detectPlanContentInset(imageBase64);
  const region = content ?? { left: 0, top: 0, width: 1, height: 1 };

  const x0 = Math.floor(region.left * width);
  const y0 = Math.floor(region.top * height);
  const x1 = Math.min(width - 1, Math.ceil((region.left + region.width) * width) - 1);
  const y1 = Math.min(height - 1, Math.ceil((region.top + region.height) * height) - 1);
  const regionW = x1 - x0 + 1;
  const regionH = y1 - y0 + 1;
  if (regionW < width * 0.45 || regionH < 40) return null;
  if (regionW / regionH < 1.15) return null;

  const stride = channels ?? 1;
  const colInk = new Array<number>(regionW).fill(0);
  for (let x = 0; x < regionW; x++) {
    let ink = 0;
    for (let y = y0; y <= y1; y++) {
      const px = x0 + x;
      const v = data[y * width * stride + px * stride]!;
      if (v < INK_THRESHOLD) ink += 1;
    }
    colInk[x] = ink;
  }

  const searchStart = Math.floor(regionW * 0.32);
  const searchEnd = Math.floor(regionW * 0.68);
  let bestIdx = -1;
  let bestInk = Number.POSITIVE_INFINITY;
  for (let i = searchStart; i <= searchEnd; i++) {
    const window =
      (colInk[i - 1] ?? colInk[i]) + colInk[i] + (colInk[i + 1] ?? colInk[i]);
    if (window < bestInk) {
      bestInk = window;
      bestIdx = i;
    }
  }

  const leftSlice = colInk.slice(0, Math.floor(regionW * 0.25));
  const rightSlice = colInk.slice(Math.floor(regionW * 0.75));
  const minSideInk = Math.max(
    leftSlice.length ? Math.max(...leftSlice) : 0,
    rightSlice.length ? Math.max(...rightSlice) : 0,
  );
  if (bestIdx < 0 || bestInk > minSideInk * 0.35) return null;

  const splitX = x0 + bestIdx;
  const leftWidthFrac = (splitX - x0) / width;
  const rightLeftFrac = (splitX + 1) / width;
  const rightWidthFrac = (x1 - splitX) / width;

  const left: PlanPanelInset = {
    left: x0 / width,
    top: region.top,
    width: leftWidthFrac,
    height: region.height,
    floorLevel: 2,
  };
  const right: PlanPanelInset = {
    left: rightLeftFrac,
    top: region.top,
    width: rightWidthFrac,
    height: region.height,
    floorLevel: 1,
  };

  if (left.width < 0.18 || right.width < 0.18) return null;
  return [left, right];
}
