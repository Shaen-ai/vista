import sharp from "sharp";

export type ObjectRemovalMask = { base64: string; mimeType: "image/png" };

const MAGENTA_R = 255;
const MAGENTA_G = 0;
const MAGENTA_B = 255;
const COLOR_TOLERANCE = 80;

/**
 * Normalize a user-drawn object removal mask into white-on-black PNG for prompts.
 * Accepts stroke-only (black bg + white marks) or composite (photo + magenta strokes).
 */
export async function normalizeObjectRemovalMask(opts: {
  maskBase64: string;
  originalPhotoBase64?: string;
}): Promise<ObjectRemovalMask> {
  const input = Buffer.from(opts.maskBase64, "base64");

  if (await isStrokeOnlyRemovalMap(input)) {
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
  const { data: maskData, info: maskInfo } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: origData, info: origInfo } = await sharp(original)
    .resize(maskInfo.width, maskInfo.height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(maskInfo.width * maskInfo.height);
  const channels = maskInfo.channels;

  for (let i = 0; i < maskInfo.width * maskInfo.height; i++) {
    const o = i * channels;
    const r = maskData[o] ?? 0;
    const g = maskData[o + 1] ?? 0;
    const b = maskData[o + 2] ?? 0;

    const isMagentaStroke =
      r >= MAGENTA_R - COLOR_TOLERANCE &&
      g <= MAGENTA_G + COLOR_TOLERANCE &&
      b >= MAGENTA_B - COLOR_TOLERANCE &&
      r - g >= 40 &&
      b - g >= 40;

    if (isMagentaStroke) {
      out[i] = 255;
      continue;
    }

    if (r > 128 || g > 128 || b > 128) {
      const origO = i * origInfo.channels;
      const dr = Math.abs(r - (origData[origO] ?? 0));
      const dg = Math.abs(g - (origData[origO + 1] ?? 0));
      const db = Math.abs(b - (origData[origO + 2] ?? 0));
      if (dr + dg + db > 60) {
        out[i] = 255;
      }
    }
  }

  const png = await sharp(out, {
    raw: { width: maskInfo.width, height: maskInfo.height, channels: 1 },
  })
    .png()
    .toBuffer();

  return { base64: png.toString("base64"), mimeType: "image/png" };
}

async function isStrokeOnlyRemovalMap(buf: Buffer): Promise<boolean> {
  const { data } = await sharp(buf).grayscale().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let bright = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] ?? 0;
    sum += v;
    if (v > 128) bright++;
  }
  const mean = sum / data.length;
  const brightRatio = bright / data.length;
  return mean < 48 && brightRatio > 0.0005 && brightRatio < 0.35;
}
