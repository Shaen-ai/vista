import sharp from "sharp";

/**
 * Overlay normalized structural strokes onto the room photo as visible markup
 * (gold lines on photo) for Kontext reference — NOT for ControlNet conditioning.
 */
export async function buildStructuralMarkupComposite(opts: {
  photoBase64: string;
  strokeMapBase64: string;
}): Promise<{ base64: string; mimeType: "image/png" }> {
  const photo = Buffer.from(opts.photoBase64, "base64");
  const stroke = Buffer.from(opts.strokeMapBase64, "base64");

  const photoMeta = await sharp(photo).metadata();
  const width = photoMeta.width ?? 0;
  const height = photoMeta.height ?? 0;

  const { data: strokeData, info: strokeInfo } = await sharp(stroke)
    .resize(width, height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: photoData, info: photoInfo } = await sharp(photo)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(photoData);
  const channels = photoInfo.channels;

  for (let i = 0; i < strokeInfo.width * strokeInfo.height; i++) {
    const v = strokeData[i] ?? 0;
    if (v < 128) continue;
    const o = i * channels;
    out[o] = Math.min(255, Math.round((out[o] ?? 0) * 0.35 + 255 * 0.65));
    out[o + 1] = Math.min(255, Math.round((out[o + 1] ?? 0) * 0.55 + 200 * 0.45));
    out[o + 2] = Math.min(255, Math.round((out[o + 2] ?? 0) * 0.65 + 80 * 0.35));
  }

  const png = await sharp(out, {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();

  return { base64: png.toString("base64"), mimeType: "image/png" };
}
