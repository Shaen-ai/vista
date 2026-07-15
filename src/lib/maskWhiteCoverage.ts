import sharp from "sharp";

/** Minimum white-pixel ratio before FAL erase/inpaint is invoked. */
export const EMPTY_MASK_WHITE_RATIO_THRESHOLD = 0.0005;

export async function maskWhiteCoverage(maskPng: Buffer): Promise<{
  whitePixelCount: number;
  totalPixels: number;
  ratio: number;
}> {
  const { data, info } = await sharp(maskPng)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const totalPixels = info.width * info.height;
  let whitePixelCount = 0;
  for (let i = 0; i < data.length; i++) {
    if ((data[i] ?? 0) > 128) whitePixelCount++;
  }
  return {
    whitePixelCount,
    totalPixels,
    ratio: totalPixels > 0 ? whitePixelCount / totalPixels : 0,
  };
}

export async function isRemovalMaskEffectivelyEmpty(maskPng: Buffer): Promise<boolean> {
  const { ratio } = await maskWhiteCoverage(maskPng);
  return ratio < EMPTY_MASK_WHITE_RATIO_THRESHOLD;
}
