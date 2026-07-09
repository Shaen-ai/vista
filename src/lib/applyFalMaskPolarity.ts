import sharp from "sharp";

/** True when fal inpaint polarity should be inverted (see VISTA_FAL_MASK_INVERT). */
export function isFalMaskInverted(): boolean {
  return (process.env.VISTA_FAL_MASK_INVERT || "").trim() === "1";
}

/**
 * Apply env polarity once before FAL upload.
 * Input/output convention: canonical white = inpaint, black = preserve.
 */
export async function applyFalMaskPolarity(maskPng: Buffer): Promise<Buffer> {
  if (!isFalMaskInverted()) return maskPng;
  return sharp(maskPng).negate().png().toBuffer();
}
