/**
 * Combine object-removal and opening-freeze masks in canonical space:
 * white = inpaint, black = preserve. Apply VISTA_FAL_MASK_INVERT only via
 * applyFalMaskPolarity after this function returns.
 */
import sharp from "sharp";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import { pipelineLog } from "@/lib/pipelineLog";
import { buildOpeningFreezeRegionsCanonical, hasOpeningBoxes } from "@/lib/openingFreezeRegions";

export interface MergeRemovalWithOpeningFreezeInput {
  /** Canonical removal mask PNG (white = inpaint). */
  removalMaskPng: Buffer;
  photoWidth: number;
  photoHeight: number;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
}

export class RemovalMaskDimensionMismatchError extends Error {
  constructor(
    public readonly maskWidth: number,
    public readonly maskHeight: number,
    public readonly photoWidth: number,
    public readonly photoHeight: number,
  ) {
    super(
      `Removal mask ${maskWidth}x${maskHeight} !== photo ${photoWidth}x${photoHeight}`,
    );
    this.name = "RemovalMaskDimensionMismatchError";
  }
}

async function alignRemovalMaskToPhoto(
  removalMaskPng: Buffer,
  photoWidth: number,
  photoHeight: number,
): Promise<Buffer> {
  const meta = await sharp(removalMaskPng).metadata();
  const maskW = meta.width ?? 0;
  const maskH = meta.height ?? 0;
  if (maskW === photoWidth && maskH === photoHeight) return removalMaskPng;

  if (process.env.NODE_ENV !== "production") {
    throw new RemovalMaskDimensionMismatchError(maskW, maskH, photoWidth, photoHeight);
  }

  pipelineLog(
    "FAL_PIPELINE",
    "removal mask dimension mismatch — resizing to photo",
    { maskW, maskH, photoWidth, photoHeight },
    "warn",
  );
  return sharp(removalMaskPng)
    .resize(photoWidth, photoHeight, { fit: "fill" })
    .png()
    .toBuffer();
}

/**
 * Merge removal (white=inpaint) with opening boxes (forced black=preserve).
 * Returns canonical PNG buffer; pass-through when no opening boxes.
 */
export async function mergeRemovalWithOpeningFreeze(
  input: MergeRemovalWithOpeningFreezeInput,
): Promise<Buffer> {
  const aligned = await alignRemovalMaskToPhoto(
    input.removalMaskPng,
    input.photoWidth,
    input.photoHeight,
  );

  if (!hasOpeningBoxes(input.windowBoxes, input.doorBoxes)) {
    return aligned;
  }

  const freezeCanonical = await buildOpeningFreezeRegionsCanonical({
    width: input.photoWidth,
    height: input.photoHeight,
    windowBoxes: input.windowBoxes,
    doorBoxes: input.doorBoxes,
  });
  if (!freezeCanonical) return aligned;

  const { data: removalData, info } = await sharp(aligned)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: freezeData } = await sharp(freezeCanonical)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < out.length; i++) {
    const removalWhite = (removalData[i] ?? 0) > 128;
    const freezeBlack = (freezeData[i] ?? 255) <= 128;
    out[i] = removalWhite && !freezeBlack ? 255 : 0;
  }

  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .png()
    .toBuffer();
}
