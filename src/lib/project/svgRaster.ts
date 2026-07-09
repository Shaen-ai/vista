import sharp from "sharp";

/**
 * Server-side SVG → PNG rasterization (libvips/librsvg via sharp).
 *
 * Shared by the PDF assembler (react-pdf's <Image> only decodes PNG/JPEG) and the
 * viewpoint cone diagram fed to Gemini. SVGs typically carry a viewBox but no
 * intrinsic width/height, so inject explicit dimensions to control resolution.
 */
export function sizeSvg(svg: string, targetWidth = 2400): string {
  const m = svg.match(/viewBox="(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)"/);
  if (!m) return svg;
  const vbW = parseFloat(m[3]);
  const vbH = parseFloat(m[4]);
  if (!(vbW > 0) || !(vbH > 0)) return svg;
  const height = Math.round((targetWidth * vbH) / vbW);
  return svg.replace(/<svg\s/, `<svg width="${targetWidth}" height="${height}" `);
}

/** Rasterize an SVG string to a raw PNG buffer, or null on failure. */
export async function svgToPngBuffer(svg: string, targetWidth = 2400): Promise<Buffer | null> {
  try {
    return await sharp(Buffer.from(sizeSvg(svg, targetWidth))).png().toBuffer();
  } catch (err) {
    console.error("Failed to rasterize SVG:", err);
    return null;
  }
}

/** Rasterize an SVG string to a PNG data URI, or null on failure. */
export async function svgToPngDataUri(svg: string, targetWidth = 2400): Promise<string | null> {
  const png = await svgToPngBuffer(svg, targetWidth);
  return png ? `data:image/png;base64,${png.toString("base64")}` : null;
}
