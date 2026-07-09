import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  mergeRemovalWithOpeningFreeze,
  RemovalMaskDimensionMismatchError,
} from "./mergeRemovalWithOpeningFreeze";
import { applyFalMaskPolarity } from "./applyFalMaskPolarity";

async function pixelAt(png: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return data[idx] ?? 0;
}

async function solidMask(w: number, h: number, value: number): Promise<Buffer> {
  const buf = Buffer.alloc(w * h, value);
  return sharp(buf, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

describe("mergeRemovalWithOpeningFreeze", () => {
  it("passes through when opening box arrays are empty", async () => {
    const removal = await solidMask(100, 100, 255);
    const out = await mergeRemovalWithOpeningFreeze({
      removalMaskPng: removal,
      photoWidth: 100,
      photoHeight: 100,
      doorBoxes: [],
      windowBoxes: [],
    });
    assert.ok((await pixelAt(out, 50, 50)) > 200);
  });

  it("protects door box fully inside removal region", async () => {
    const removal = await solidMask(200, 200, 255);
    const out = await mergeRemovalWithOpeningFreeze({
      removalMaskPng: removal,
      photoWidth: 200,
      photoHeight: 200,
      doorBoxes: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
    });
    assert.ok((await pixelAt(out, 100, 100)) < 30, "door center should not be inpaintable");
    assert.ok((await pixelAt(out, 10, 10)) > 200, "corner still removable");
  });

  it("partial overlap keeps protected zone black", async () => {
    const removal = await solidMask(200, 200, 0);
    const { data } = await sharp(removal).raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 100; x++) {
        data[y * 200 + x] = 255;
      }
    }
    const halfRemoval = await sharp(data, { raw: { width: 200, height: 200, channels: 1 } })
      .png()
      .toBuffer();

    const out = await mergeRemovalWithOpeningFreeze({
      removalMaskPng: halfRemoval,
      photoWidth: 200,
      photoHeight: 200,
      doorBoxes: [{ x: 0.35, y: 0.35, w: 0.3, h: 0.3 }],
    });
    assert.ok((await pixelAt(out, 100, 100)) < 30);
    assert.ok((await pixelAt(out, 180, 100)) < 30, "outside removal stays black");
    assert.ok((await pixelAt(out, 20, 20)) > 200, "removal-only zone stays white");
  });

  it("box outside removal leaves removal mask unchanged in overlap-free areas", async () => {
    const removal = await solidMask(200, 200, 0);
    const { data } = await sharp(removal).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < 50 * 200; i++) data[i] = 255;
    const partial = await sharp(data, { raw: { width: 200, height: 200, channels: 1 } })
      .png()
      .toBuffer();

    const out = await mergeRemovalWithOpeningFreeze({
      removalMaskPng: partial,
      photoWidth: 200,
      photoHeight: 200,
      doorBoxes: [{ x: 0.7, y: 0.7, w: 0.2, h: 0.2 }],
    });
    assert.ok((await pixelAt(out, 25, 25)) > 200);
    assert.ok((await pixelAt(out, 150, 150)) < 30);
  });

  it("clamps edge float coordinates", async () => {
    const removal = await solidMask(200, 200, 255);
    const out = await mergeRemovalWithOpeningFreeze({
      removalMaskPng: removal,
      photoWidth: 200,
      photoHeight: 200,
      doorBoxes: [{ x: 0.98, y: 0.02, w: 0.05, h: 0.1 }],
    });
    assert.ok((await pixelAt(out, 199, 10)) < 30);
  });

  it("throws on dimension mismatch in non-production", async () => {
    const removal = await solidMask(100, 100, 255);
    await assert.rejects(
      () =>
        mergeRemovalWithOpeningFreeze({
          removalMaskPng: removal,
          photoWidth: 200,
          photoHeight: 200,
          doorBoxes: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
        }),
      RemovalMaskDimensionMismatchError,
    );
  });

  it("door stays protected after applyFalMaskPolarity when inverted", async () => {
    process.env.VISTA_FAL_MASK_INVERT = "1";
    try {
      const removal = await solidMask(200, 200, 255);
      const merged = await mergeRemovalWithOpeningFreeze({
        removalMaskPng: removal,
        photoWidth: 200,
        photoHeight: 200,
        doorBoxes: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
      });
      const finalMask = await applyFalMaskPolarity(merged);
      // When inverted, inpaint=white → door (preserve) should be white in final mask
      assert.ok((await pixelAt(finalMask, 100, 100)) > 225);
      assert.ok((await pixelAt(finalMask, 10, 10)) < 30);
    } finally {
      delete process.env.VISTA_FAL_MASK_INVERT;
    }
  });
});
