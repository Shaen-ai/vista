import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { estimateFurnitureVisibleInStage2Input } from "./falStage2Heuristic";

async function solidPngBase64(r: number, g: number, b: number, w = 32, h = 32): Promise<string> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

test("missing stage1 returns unknown", async () => {
  const stage2 = await solidPngBase64(200, 100, 50);
  assert.equal(await estimateFurnitureVisibleInStage2Input(undefined, stage2), "unknown");
});

test("sparse stage2 similar to stage1 returns false", async () => {
  const stage1 = await solidPngBase64(220, 215, 210);
  const stage2 = await solidPngBase64(222, 217, 212);
  assert.equal(await estimateFurnitureVisibleInStage2Input(stage1, stage2), false);
});

test("furnished stage2 with large diff returns true", async () => {
  const stage1 = await solidPngBase64(240, 235, 230);
  const stage2 = await solidPngBase64(40, 80, 120);
  assert.equal(await estimateFurnitureVisibleInStage2Input(stage1, stage2), true);
});
