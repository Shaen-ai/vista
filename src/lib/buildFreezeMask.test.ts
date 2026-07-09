import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { buildFreezeMask } from "./buildFreezeMask";

async function pixelAt(png: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * info.width + x) * info.channels;
  return data[idx]; // first channel; mask is grayscale so R==G==B
}

describe("buildFreezeMask", () => {
  it("returns null when there are no openings or structural boxes", async () => {
    const mask = await buildFreezeMask({ width: 100, height: 100 });
    assert.equal(mask, null);
  });

  it("builds mask from structural boxes alone", async () => {
    const mask = await buildFreezeMask({
      width: 200,
      height: 200,
      structuralBoxes: [{ x: 0.4, y: 0.4, w: 0.1, h: 0.2 }],
      padding: 0,
    });
    assert.ok(mask);
    assert.ok((await pixelAt(mask!, 90, 100)) < 30);
  });

  it("returns null for zero-size images", async () => {
    const mask = await buildFreezeMask({ width: 0, height: 0, windowBoxes: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] });
    assert.equal(mask, null);
  });

  it("paints white=editable background and black=frozen over a window box", async () => {
    const mask = await buildFreezeMask({
      width: 200,
      height: 200,
      windowBoxes: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
      padding: 0,
    });
    assert.ok(mask, "expected a mask buffer");
    // Center of the box should be frozen (black ~0).
    assert.ok((await pixelAt(mask!, 100, 100)) < 30, "box center should be black (frozen)");
    // A corner far from the box should be editable (white ~255).
    assert.ok((await pixelAt(mask!, 5, 5)) > 225, "corner should be white (editable)");
  });

  it("inverts polarity when VISTA_FAL_MASK_INVERT=1", async () => {
    process.env.VISTA_FAL_MASK_INVERT = "1";
    try {
      const mask = await buildFreezeMask({
        width: 200,
        height: 200,
        doorBoxes: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }],
        padding: 0,
      });
      assert.ok(mask);
      assert.ok((await pixelAt(mask!, 100, 100)) > 225, "box center should be white when inverted");
      assert.ok((await pixelAt(mask!, 5, 5)) < 30, "corner should be black when inverted");
    } finally {
      delete process.env.VISTA_FAL_MASK_INVERT;
    }
  });
});
