import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { detectHeroCopy, detectStyleReferenceCopy } from "./falStyleRefCopyGuard";

async function patternBase64(
  paint: (x: number, y: number) => [number, number, number],
): Promise<string> {
  const width = 64;
  const height = 64;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 3;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  const buf = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return buf.toString("base64");
}

test("detectStyleReferenceCopy flags output matching style ref more than hero", async () => {
  const hero = await patternBase64((x) => (x < 32 ? [220, 40, 40] : [40, 40, 220]));
  const styleRef = await patternBase64((_, y) => (y < 32 ? [40, 200, 80] : [200, 180, 40]));

  const result = await detectStyleReferenceCopy({
    outputBase64: styleRef,
    heroBase64: hero,
    styleRefBase64: styleRef,
  });

  assert.equal(result.detected, true);
  assert.ok(result.styleRefCorrelation > result.heroCorrelation);
});

test("detectStyleReferenceCopy does not flag output matching hero", async () => {
  const hero = await patternBase64((x) => (x < 32 ? [220, 40, 40] : [40, 40, 220]));
  const styleRef = await patternBase64((_, y) => (y < 32 ? [40, 200, 80] : [200, 180, 40]));

  const result = await detectStyleReferenceCopy({
    outputBase64: hero,
    heroBase64: hero,
    styleRefBase64: styleRef,
  });

  assert.equal(result.detected, false);
  assert.ok(result.heroCorrelation >= result.styleRefCorrelation);
});

test("detectHeroCopy flags a secondary render that reproduces the hero", async () => {
  const hero = await patternBase64((x) => (x < 32 ? [220, 40, 40] : [40, 40, 220]));
  const editTarget = await patternBase64((_, y) => (y < 32 ? [40, 200, 80] : [200, 180, 40]));

  const result = await detectHeroCopy({
    outputBase64: hero,
    heroBase64: hero,
    editTargetBase64: editTarget,
  });

  assert.equal(result.detected, true);
  assert.ok(result.heroCorrelation > result.editTargetCorrelation);
});

test("detectHeroCopy does not flag a render matching the edit-target photo", async () => {
  const hero = await patternBase64((x) => (x < 32 ? [220, 40, 40] : [40, 40, 220]));
  const editTarget = await patternBase64((_, y) => (y < 32 ? [40, 200, 80] : [200, 180, 40]));

  const result = await detectHeroCopy({
    outputBase64: editTarget,
    heroBase64: hero,
    editTargetBase64: editTarget,
  });

  assert.equal(result.detected, false);
  assert.ok(result.editTargetCorrelation > result.heroCorrelation);
});
