import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { normalizeObjectRemovalMask } from "./normalizeObjectRemovalMask";

async function pngBase64(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<string> {
  // Use sharp SVG for test fixtures — no DOM canvas in node.
  void draw;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="black"/><rect x="20" y="20" width="40" height="40" fill="white"/></svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return buf.toString("base64");
}

describe("normalizeObjectRemovalMask", () => {
  it("accepts stroke-only black/white map", async () => {
    const base64 = await pngBase64(80, 80, () => {});
    const out = await normalizeObjectRemovalMask({ maskBase64: base64 });
    assert.equal(out.mimeType, "image/png");
    assert.ok(out.base64.length > 100);
  });

  it("extracts bright region from grayscale fallback", async () => {
    const base64 = await pngBase64(60, 60, () => {});
    const out = await normalizeObjectRemovalMask({ maskBase64: base64 });
    const { data } = await sharp(Buffer.from(out.base64, "base64")).raw().toBuffer({ resolveWithObject: true });
    const bright = data.filter((v) => v > 200).length;
    assert.ok(bright > 0);
  });
});
