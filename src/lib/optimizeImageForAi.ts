import "server-only";

import sharp from "sharp";

export interface OptimizeImageOptions {
  maxEdge?: number;
  quality?: number;
  /** Re-encode at lower quality when output exceeds this size (default 250 KB). */
  maxBytes?: number;
}

/** Higher fidelity for hallway photo-edit — preserves wall jogs and door edges. */
export const HALLWAY_PHOTO_OPTIMIZE_OPTIONS: OptimizeImageOptions = {
  maxEdge: 1920,
  quality: 88,
  maxBytes: 600_000,
};

export interface OptimizedImageResult {
  base64: string;
  mimeType: string;
  byteLength: number;
  width: number;
  height: number;
}

const DEFAULT_MAX_EDGE = 1200;
const DEFAULT_QUALITY = 75;
const DEFAULT_MAX_BYTES = 250_000;

export async function optimizeImageBufferForAi(
  input: Buffer,
  options?: OptimizeImageOptions,
): Promise<OptimizedImageResult> {
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  let quality = options?.quality ?? DEFAULT_QUALITY;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;

  const run = async (q: number) => {
    const pipeline = sharp(input, { failOn: "none" })
      .rotate()
      .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: q, mozjpeg: true });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      base64: data.toString("base64"),
      mimeType: "image/jpeg" as const,
      byteLength: data.byteLength,
      width: info.width,
      height: info.height,
      buffer: data,
    };
  };

  try {
    let result = await run(quality);
    if (result.byteLength > maxBytes && quality > 60) {
      result = await run(60);
    }
    return {
      base64: result.base64,
      mimeType: result.mimeType,
      byteLength: result.byteLength,
      width: result.width,
      height: result.height,
    };
  } catch (err) {
    console.warn("optimizeImageBufferForAi: sharp failed, using raw bytes", err);
    return {
      base64: input.toString("base64"),
      mimeType: "image/jpeg",
      byteLength: input.byteLength,
      width: maxEdge,
      height: maxEdge,
    };
  }
}

/**
 * Resize to 512x512 with white background padding, preserving aspect ratio.
 * Used for individual product reference images sent to Gemini.
 */
export async function normalizeProductImageForGemini(
  input: Buffer,
): Promise<OptimizedImageResult & { buffer: Buffer }> {
  const TARGET = 512;
  const QUALITY = 80;

  try {
    const resized = await sharp(input, { failOn: "none" })
      .rotate()
      .resize(TARGET, TARGET, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
        withoutEnlargement: false,
      })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      base64: resized.data.toString("base64"),
      mimeType: "image/jpeg",
      byteLength: resized.data.byteLength,
      width: resized.info.width,
      height: resized.info.height,
      buffer: resized.data,
    };
  } catch (err) {
    console.warn("normalizeProductImageForGemini: sharp failed", err);
    return {
      base64: input.toString("base64"),
      mimeType: "image/jpeg",
      byteLength: input.byteLength,
      width: TARGET,
      height: TARGET,
      buffer: input,
    };
  }
}

export async function optimizeImageBufferForAiWithBuffer(
  input: Buffer,
  options?: OptimizeImageOptions,
): Promise<OptimizedImageResult & { buffer: Buffer }> {
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  let quality = options?.quality ?? DEFAULT_QUALITY;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;

  try {
    let pipeline = sharp(input, { failOn: "none" })
      .rotate()
      .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true });

    let { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    if (data.byteLength > maxBytes && quality > 60) {
      ({ data, info } = await sharp(input, { failOn: "none" })
        .rotate()
        .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 60, mozjpeg: true })
        .toBuffer({ resolveWithObject: true }));
    }

    return {
      base64: data.toString("base64"),
      mimeType: "image/jpeg",
      byteLength: data.byteLength,
      width: info.width,
      height: info.height,
      buffer: data,
    };
  } catch (err) {
    console.warn("optimizeImageBufferForAiWithBuffer: sharp failed", err);
    return {
      base64: input.toString("base64"),
      mimeType: "image/jpeg",
      byteLength: input.byteLength,
      width: maxEdge,
      height: maxEdge,
      buffer: input,
    };
  }
}
