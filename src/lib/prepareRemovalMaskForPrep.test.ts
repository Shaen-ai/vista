import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { prepareRemovalMaskForPrep } from "./prepareRemovalMaskForPrep";

async function solidMask(w: number, h: number, value: number): Promise<Buffer> {
  const buf = Buffer.alloc(w * h, value);
  return sharp(buf, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

async function solidPhoto(w: number, h: number, value: number): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, value);
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}

describe("prepareRemovalMaskForPrep", () => {
  it("aligns mismatched mask dimensions to photo size in production", async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const photo = await solidPhoto(200, 150, 128);
      const mask = await solidMask(100, 100, 255);
      const prepared = await prepareRemovalMaskForPrep({
        maskBase64: mask.toString("base64"),
        photoBase64: photo.toString("base64"),
        photoWidth: 200,
        photoHeight: 150,
      });
      const meta = await sharp(prepared).metadata();
      assert.equal(meta.width, 200);
      assert.equal(meta.height, 150);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it("preserves white removal pixels after alignment without openings", async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const photo = await solidPhoto(200, 200, 64);
      const mask = await solidMask(100, 100, 255);
      const prepared = await prepareRemovalMaskForPrep({
        maskBase64: mask.toString("base64"),
        photoBase64: photo.toString("base64"),
        photoWidth: 200,
        photoHeight: 200,
      });
      const { data, info } = await sharp(prepared).grayscale().raw().toBuffer({ resolveWithObject: true });
      const center = data[(100 * info.width + 100)] ?? 0;
      assert.ok(center > 200, "center should remain inpaintable after resize");
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
