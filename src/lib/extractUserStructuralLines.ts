import sharp from "sharp";

export type StructuralLineMap = { base64: string; mimeType: "image/png" };

/** Red stroke color used by DrawingCanvas / StructuralBoundaryCanvas. */
const STROKE_R = 255;
const STROKE_G = 0;
const STROKE_B = 0;
const STROKE_TOLERANCE = 80;

/**
 * Normalize a user-drawn structural line map into white-on-black PNG for ControlNet.
 * Accepts stroke-only (black bg + white lines) or composite (photo + red strokes).
 */
export async function normalizeStructuralLineMap(opts: {
  lineMapBase64: string;
  originalPhotoBase64?: string;
  /** Client hint — skip composite extraction when true. */
  strokeOnly?: boolean;
}): Promise<StructuralLineMap> {
  const input = Buffer.from(opts.lineMapBase64, "base64");

  if (opts.strokeOnly || (await isStrokeOnlyMap(input))) {
    const normalized = await sharp(input)
      .grayscale()
      .threshold(128)
      .png()
      .toBuffer();
    return { base64: normalized.toString("base64"), mimeType: "image/png" };
  }

  if (!opts.originalPhotoBase64?.trim()) {
    const normalized = await sharp(input)
      .grayscale()
      .threshold(128)
      .png()
      .toBuffer();
    return { base64: normalized.toString("base64"), mimeType: "image/png" };
  }

  const original = Buffer.from(opts.originalPhotoBase64, "base64");
  const { data: lineData, info: lineInfo } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: origData, info: origInfo } = await sharp(original)
    .resize(lineInfo.width, lineInfo.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(lineInfo.width * lineInfo.height);
  const channels = lineInfo.channels;

  for (let i = 0; i < lineInfo.width * lineInfo.height; i++) {
    const o = i * channels;
    const r = lineData[o] ?? 0;
    const g = lineData[o + 1] ?? 0;
    const b = lineData[o + 2] ?? 0;

    const isRedStroke =
      r >= STROKE_R - STROKE_TOLERANCE &&
      g <= STROKE_G + STROKE_TOLERANCE &&
      b <= STROKE_B + STROKE_TOLERANCE &&
      r - Math.max(g, b) >= 40;

    if (isRedStroke) {
      out[i] = 255;
      continue;
    }

    const origO = i * origInfo.channels;
    const dr = Math.abs(r - (origData[origO] ?? 0));
    const dg = Math.abs(g - (origData[origO + 1] ?? 0));
    const db = Math.abs(b - (origData[origO + 2] ?? 0));
    if (dr + dg + db > 60) {
      out[i] = 255;
    }
  }

  const png = await sharp(out, { raw: { width: lineInfo.width, height: lineInfo.height, channels: 1 } })
    .png()
    .toBuffer();

  return { base64: png.toString("base64"), mimeType: "image/png" };
}

/** True when the image is mostly dark with sparse bright strokes. */
async function isStrokeOnlyMap(buf: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buf).grayscale().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let bright = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    sum += v;
    if (v > 128) bright++;
  }
  const mean = sum / data.length;
  const brightRatio = bright / data.length;
  return mean < 48 && brightRatio > 0.0005 && brightRatio < 0.25;
}
