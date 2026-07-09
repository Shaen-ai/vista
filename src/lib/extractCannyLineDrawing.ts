import "server-only";

import sharp from "sharp";

export type CannyLineDrawing = { base64: string; mimeType: "image/png" };

/**
 * Extract a Canny-style edge map from a room photo for fal control_loras.
 * Grayscale → slight blur → Sobel magnitude → threshold → white edges on black.
 */
export async function extractCannyLineDrawing(
  photoBase64: string,
  opts?: { lowThreshold?: number; highThreshold?: number },
): Promise<CannyLineDrawing> {
  const low = opts?.lowThreshold ?? 40;
  const high = opts?.highThreshold ?? 120;

  const input = Buffer.from(photoBase64, "base64");
  const { data, info } = await sharp(input)
    .grayscale()
    .blur(0.6)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const out = Buffer.alloc(width * height);

  const at = (x: number, y: number) => data[y * width + x] ?? 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -at(x - 1, y - 1) + at(x + 1, y - 1) +
        -2 * at(x - 1, y) + 2 * at(x + 1, y) +
        -at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const mag = Math.hypot(gx, gy);
      out[y * width + x] = mag >= low && mag <= high * 2 ? 255 : mag >= high ? 255 : 0;
    }
  }

  const png = await sharp(out, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  return { base64: png.toString("base64"), mimeType: "image/png" };
}
