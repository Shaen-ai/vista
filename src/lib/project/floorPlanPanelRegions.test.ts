import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { detectDualPlanPanelInsets } from "./floorPlanPanelRegions";
import { normalizeAnalysis } from "./floorPlanAnalyzer";
import { groupRoomsByFloor, analysisHasMultipleFloors } from "./floorPlanFloors";

/** Wide sheet: two ink blocks separated by a vertical gutter. */
async function makeDualPlanFixtureBase64(): Promise<string> {
  const width = 800;
  const height = 400;
  const raw = Buffer.alloc(width * height, 255);
  const ink = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        raw[y * width + x] = 0;
      }
    }
  };
  ink(40, 360, 40, 360);
  ink(440, 760, 40, 360);
  const png = await sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return png.toString("base64");
}

describe("detectDualPlanPanelInsets", () => {
  it("splits a wide dual-panel sheet into left floor 2 and right floor 1", async () => {
    const base64 = await makeDualPlanFixtureBase64();
    const panels = await detectDualPlanPanelInsets(base64);
    assert.ok(panels && panels.length === 2);
    const left = panels.find((p) => p.floorLevel === 2);
    const right = panels.find((p) => p.floorLevel === 1);
    assert.ok(left && right);
    assert.ok(left.left < right.left);
    assert.ok(left.width > 0.15 && right.width > 0.15);
  });

  it("detects two panels on the bundled A202 ADU sheet asset when present", async () => {
    const assetPath =
      "/Users/shahen1/.cursor/projects/Users-shahen1-apps-mebel/assets/image-732ad409-7caa-4121-8787-ce29f3efe3d1.png";
    let base64: string;
    try {
      const fs = await import("node:fs");
      if (!fs.existsSync(assetPath)) return;
      base64 = fs.readFileSync(assetPath).toString("base64");
    } catch {
      return;
    }
    const panels = await detectDualPlanPanelInsets(base64);
    assert.ok(panels && panels.length === 2, "expected left/right ADU panels on A202 sheet");
  });
});

describe("normalizeAnalysis floorLevel", () => {
  it("preserves floorLevel and defaults missing to 1", () => {
    const analysis = normalizeAnalysis({
      totalArea: 100,
      ceilingHeight: 2.7,
      rooms: [
        {
          id: "a",
          name: "Living",
          type: "living_room",
          floorLevel: 2,
          estimatedArea: 20,
          dimensions: { width: 4, depth: 5, height: 2.7 },
          windows: [],
          doors: [],
          polygon: [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ],
        },
        {
          id: "b",
          name: "Bed",
          type: "bedroom",
          estimatedArea: 15,
          dimensions: { width: 3, depth: 5, height: 2.7 },
          windows: [],
          doors: [],
          polygon: [
            [200, 0],
            [300, 0],
            [300, 100],
            [200, 100],
          ],
        },
      ],
      wallSegments: [],
    });
    assert.equal(analysis.rooms[0]?.floorLevel, 2);
    assert.equal(analysis.rooms[1]?.floorLevel, 1);
    assert.ok(analysisHasMultipleFloors(analysis.rooms));
    const groups = groupRoomsByFloor(analysis.rooms);
    assert.equal(groups.length, 2);
  });
});
