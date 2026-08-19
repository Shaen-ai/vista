import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  detectPlanContentInset,
  remapAnalysisFromCropToFull,
  remapImagePointFromCropToFull,
  remapRawParsedFromCropToFull,
} from "./floorPlanContentCrop";
import type { FloorPlanAnalysis } from "./types";

describe("remapImagePointFromCropToFull", () => {
  it("maps crop origin to inset offset on full image", () => {
    const inset = { left: 0.1, top: 0.2, width: 0.8, height: 0.6 };
    const fullH = 750;
    const [x, y] = remapImagePointFromCropToFull(0, 0, inset, fullH);
    assert.equal(x, 100);
    assert.equal(y, 150);
    const [x2, y2] = remapImagePointFromCropToFull(1000, (1000 * inset.height) / inset.width, inset, fullH);
    assert.ok(Math.abs(x2 - 900) < 0.01);
    assert.ok(Math.abs(y2 - (150 + 0.6 * fullH)) < 0.01);
  });
});

describe("remapAnalysisFromCropToFull", () => {
  it("remaps room polygon corners", () => {
    const inset = { left: 0.1, top: 0, width: 0.5, height: 0.5 };
    const fullH = 500;
    const analysis: FloorPlanAnalysis = {
      totalArea: 50,
      ceilingHeight: 2.7,
      rooms: [
        {
          id: "r1",
          name: "Room",
          type: "living room",
          dimensions: { width: 4, depth: 4, height: 2.7 },
          estimatedArea: 16,
          windows: [],
          doors: [],
          polygon: [
            [0, 0],
            [1000, 0],
            [1000, 250],
            [0, 250],
          ],
        },
      ],
      wallSegments: [],
      overallShape: "rect",
      notes: "",
    };
    const out = remapAnalysisFromCropToFull(analysis, inset, fullH);
    assert.deepEqual(out.rooms[0].polygon![0], [100, 0]);
  });
});

describe("remapRawParsedFromCropToFull", () => {
  it("remaps door x/y on raw JSON", () => {
    const inset = { left: 0.1, top: 0.1, width: 0.8, height: 0.8 };
    const fullH = 800;
    const raw = {
      rooms: [
        {
          doors: [{ x: 100, y: 100, position: "south" }],
          windows: [],
        },
      ],
    };
    const out = remapRawParsedFromCropToFull(raw, inset, fullH) as typeof raw;
    const d = out.rooms[0].doors[0];
    assert.ok(Math.abs(d.x - 180) < 1);
    assert.ok(Math.abs(d.y - 144) < 1);
  });
});

describe("detectPlanContentInset", () => {
  it("finds ink bbox on white margin image", async () => {
    const w = 400;
    const h = 300;
    const buf = await sharp({
      create: {
        width: w,
        height: h,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 200, height: 120, channels: 3, background: { r: 0, g: 0, b: 0 } },
          })
            .png()
            .toBuffer(),
          left: 80,
          top: 70,
        },
      ])
      .png()
      .toBuffer();
    const inset = await detectPlanContentInset(buf.toString("base64"));
    assert.ok(inset);
    assert.ok(inset.left > 0.15 && inset.left < 0.25);
    assert.ok(inset.top > 0.2 && inset.top < 0.3);
    assert.ok(inset.width > 0.45 && inset.width < 0.55);
  });
});
