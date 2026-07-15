import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  EMPTY_MASK_WHITE_RATIO_THRESHOLD,
  isRemovalMaskEffectivelyEmpty,
  maskWhiteCoverage,
} from "./maskWhiteCoverage";

async function solidMask(w: number, h: number, value: number): Promise<Buffer> {
  const buf = Buffer.alloc(w * h, value);
  return sharp(buf, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

describe("maskWhiteCoverage", () => {
  it("reports zero coverage for all-black mask", async () => {
    const mask = await solidMask(200, 200, 0);
    const coverage = await maskWhiteCoverage(mask);
    assert.equal(coverage.whitePixelCount, 0);
    assert.equal(coverage.totalPixels, 40000);
    assert.equal(coverage.ratio, 0);
    assert.equal(await isRemovalMaskEffectivelyEmpty(mask), true);
  });

  it("reports full coverage for all-white mask", async () => {
    const mask = await solidMask(100, 100, 255);
    const coverage = await maskWhiteCoverage(mask);
    assert.equal(coverage.whitePixelCount, 10000);
    assert.equal(coverage.ratio, 1);
    assert.equal(await isRemovalMaskEffectivelyEmpty(mask), false);
  });

  it("treats sparse white pixels below threshold as empty", async () => {
    const mask = await solidMask(1000, 1000, 0);
    const { data } = await sharp(mask).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < 4; i++) data[i] = 255;
    const sparse = await sharp(data, { raw: { width: 1000, height: 1000, channels: 1 } })
      .png()
      .toBuffer();

    const coverage = await maskWhiteCoverage(sparse);
    assert.ok(coverage.ratio < EMPTY_MASK_WHITE_RATIO_THRESHOLD);
    assert.equal(await isRemovalMaskEffectivelyEmpty(sparse), true);
  });

  it("treats meaningful brush strokes as non-empty", async () => {
    const mask = await solidMask(200, 200, 0);
    const { data } = await sharp(mask).raw().toBuffer({ resolveWithObject: true });
    for (let y = 90; y < 110; y++) {
      for (let x = 90; x < 110; x++) {
        data[y * 200 + x] = 255;
      }
    }
    const brushed = await sharp(data, { raw: { width: 200, height: 200, channels: 1 } })
      .png()
      .toBuffer();

    const coverage = await maskWhiteCoverage(brushed);
    assert.ok(coverage.ratio >= EMPTY_MASK_WHITE_RATIO_THRESHOLD);
    assert.equal(await isRemovalMaskEffectivelyEmpty(brushed), false);
  });
});
