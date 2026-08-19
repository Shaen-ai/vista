import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FloorPlanAnalysis } from "./types";
import {
  computeFloorBounds,
  filterAnalysisForFloorView,
  roomsOnFloor,
} from "./floorPlanFloorView";

const dualFloorAnalysis: FloorPlanAnalysis = {
  totalArea: 100,
  overallShape: "rectangular",
  ceilingHeight: 2.7,
  rooms: [
    {
      id: "r1",
      name: "Living",
      type: "living",
      estimatedArea: 20,
      dimensions: { width: 4, length: 4, height: 2.7 },
      features: [],
      floorLevel: 1,
      polygon: [
        [5000, 0],
        [9000, 0],
        [9000, 4000],
        [5000, 4000],
      ],
      doors: [],
      windows: [],
    },
    {
      id: "r2",
      name: "Bed",
      type: "bedroom",
      estimatedArea: 15,
      dimensions: { width: 4, length: 3.5, height: 2.7 },
      features: [],
      floorLevel: 2,
      polygon: [
        [0, 0],
        [4000, 0],
        [4000, 3500],
        [0, 3500],
      ],
      doors: [],
      windows: [],
    },
  ],
  wallSegments: [
    { x1: 5000, y1: 0, x2: 9000, y2: 0, thickness: 200, lengthMm: 4000 },
    { x1: 0, y1: 0, x2: 4000, y2: 0, thickness: 200, lengthMm: 4000 },
    { x1: 4500, y1: 0, x2: 4500, y2: 1000, thickness: 200, lengthMm: 1000 },
  ],
};

describe("floorPlanFloorView", () => {
  it("roomsOnFloor filters by floorLevel", () => {
    assert.equal(roomsOnFloor(dualFloorAnalysis.rooms, 1).length, 1);
    assert.equal(roomsOnFloor(dualFloorAnalysis.rooms, 2)[0]?.id, "r2");
  });

  it("computeFloorBounds uses room polygons on that floor only", () => {
    const b1 = computeFloorBounds(dualFloorAnalysis, 1);
    assert.ok(b1.minX >= 4500);
    assert.ok(b1.maxX <= 9500);

    const b2 = computeFloorBounds(dualFloorAnalysis, 2);
    assert.ok(b2.maxX <= 4500);
  });

  it("filterAnalysisForFloorView keeps walls whose midpoint is on that floor", () => {
    const f1 = filterAnalysisForFloorView(dualFloorAnalysis, 1);
    assert.equal(f1.rooms.length, 1);
    assert.equal(f1.wallSegments.length, 1);
    assert.equal(f1.wallSegments[0]?.x1, 5000);

    const f2 = filterAnalysisForFloorView(dualFloorAnalysis, 2);
    assert.equal(f2.rooms.length, 1);
    assert.equal(f2.wallSegments.length, 1);
    assert.equal(f2.wallSegments[0]?.x1, 0);
  });
});
