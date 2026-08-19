import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anchorAnalysisToImage, assessGeometryQuality } from "./floorPlanAnalyzer";
import { polygonArea } from "./floorPlanGeometry";
import type { DetectedRoom, FloorPlanAnalysis } from "./types";

function room(id: string, polygon: [number, number][], estimatedArea = 10): DetectedRoom {
  return {
    id,
    name: id,
    type: "living",
    estimatedArea,
    dimensions: { width: 3, depth: 3, height: 2.7 },
    windows: [],
    doors: [],
    features: [],
    polygon,
  };
}

function analysis(rooms: DetectedRoom[], totalArea = 0): FloorPlanAnalysis {
  return { totalArea, ceilingHeight: 2.7, rooms, wallSegments: [], overallShape: "x", notes: "" };
}

describe("assessGeometryQuality", () => {
  it("flags zero rooms as problematic", () => {
    const q = assessGeometryQuality(analysis([]));
    assert.equal(q.roomCount, 0);
    assert.ok(q.problematic);
  });

  it("clean side-by-side tiling → not problematic, no overlap", () => {
    const a = analysis([
      room("a", [[0, 0], [500, 0], [500, 500], [0, 500]]),
      room("b", [[500, 0], [1000, 0], [1000, 500], [500, 500]]),
    ]);
    const q = assessGeometryQuality(a, 1000 / 500); // expected aspect 2.0 matches
    assert.equal(q.worstOverlapPct, 0);
    assert.ok(!q.problematic);
  });

  it("heavily overlapping rooms → problematic", () => {
    const a = analysis([
      room("a", [[0, 0], [600, 0], [600, 600], [0, 600]]),
      room("b", [[100, 100], [700, 100], [700, 700], [100, 700]]), // large overlap
    ]);
    const q = assessGeometryQuality(a);
    assert.ok(q.worstOverlapPct > 15);
    assert.ok(q.problematic);
  });

  it("aspect wildly off the image → problematic", () => {
    const a = analysis([room("wide", [[0, 0], [1000, 0], [1000, 100], [0, 100]])]); // aspect 10
    const q = assessGeometryQuality(a, 0.5); // tall image expected
    assert.ok(q.problematic);
  });
});

describe("anchorAnalysisToImage scale fallback", () => {
  const twoRooms = () => [
    room("a", [[0, 0], [500, 0], [500, 500], [0, 500]], 30),
    room("b", [[500, 0], [1000, 0], [1000, 500], [500, 500]], 30),
  ];

  function footprintM2(a: FloorPlanAnalysis): number {
    return a.rooms.reduce((s, r) => s + (r.polygon ? polygonArea(r.polygon) : 0), 0) / 1_000_000;
  }

  it("uses summed per-room area labels when no user area is given", () => {
    const anchored = anchorAnalysisToImage(analysis(twoRooms(), 0), 500, undefined);
    assert.ok(Math.abs(footprintM2(anchored) - 60) < 0.5, `footprint ${footprintM2(anchored)}`);
  });

  it("user-stated total area overrides the label sum", () => {
    const anchored = anchorAnalysisToImage(analysis(twoRooms(), 0), 500, 100);
    assert.ok(Math.abs(footprintM2(anchored) - 100) < 0.5, `footprint ${footprintM2(anchored)}`);
  });

  it("falls back to model totalArea when no labels and no user area", () => {
    const rooms = twoRooms().map((r) => ({ ...r, estimatedArea: 0 }));
    const anchored = anchorAnalysisToImage(analysis(rooms, 80), 500, undefined);
    assert.ok(Math.abs(footprintM2(anchored) - 80) < 0.5, `footprint ${footprintM2(anchored)}`);
  });
});
