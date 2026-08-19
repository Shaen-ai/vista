import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconcileOpeningPixels } from "./floorPlanAnalyzer";
import type { DetectedRoom, FloorPlanAnalysis } from "./types";

function room(id: string, polygon: [number, number][]): DetectedRoom {
  return {
    id,
    name: id,
    type: "living",
    estimatedArea: 10,
    dimensions: { width: 3, depth: 3, height: 2.7 },
    windows: [],
    doors: [],
    features: [],
    polygon,
  };
}

function analysis(rooms: DetectedRoom[]): FloorPlanAnalysis {
  return { totalArea: 0, ceilingHeight: 2.7, rooms, wallSegments: [], overallShape: "x", notes: "" };
}

describe("reconcileOpeningPixels", () => {
  // Square room; edges: 0 = bottom (y=0), 1 = right (x=1000), 2 = top, 3 = left.
  const square = (): [number, number][] => [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];

  it("snaps a door pixel center onto the nearest edge, overriding a wrong edgeIndex", () => {
    const a = analysis([
      {
        ...room("r", square()),
        // Model claimed edge 0 (bottom) but the pixel (500, 1000) is on the top edge (edge 2).
        doors: [{ position: "south", width: 0.8, connectsTo: "x", edgeIndex: 0, t: 0.5 }],
      },
    ]);
    const raw = { rooms: [{ doors: [{ x: 500, y: 1000 }], windows: [] }] };
    const out = reconcileOpeningPixels(a, raw);
    assert.equal(out.rooms[0].doors[0].edgeIndex, 2);
    assert.ok(Math.abs((out.rooms[0].doors[0].t ?? -1) - 0.5) < 0.01);
  });

  it("snaps a window pixel center onto the right edge", () => {
    const a = analysis([
      { ...room("r", square()), windows: [{ position: "?", width: 1.2, height: 1.5, edgeIndex: 0, t: 0.1 }] },
    ]);
    const raw = { rooms: [{ doors: [], windows: [{ x: 1000, y: 250 }] }] };
    const out = reconcileOpeningPixels(a, raw);
    assert.equal(out.rooms[0].windows[0].edgeIndex, 1);
    assert.ok(Math.abs((out.rooms[0].windows[0].t ?? -1) - 0.25) < 0.01);
  });

  it("leaves openings without pixel coords untouched", () => {
    const a = analysis([
      { ...room("r", square()), doors: [{ position: "south", width: 0.8, connectsTo: "x", edgeIndex: 3, t: 0.7 }] },
    ]);
    const raw = { rooms: [{ doors: [{ position: "south" }], windows: [] }] };
    const out = reconcileOpeningPixels(a, raw);
    assert.equal(out.rooms[0].doors[0].edgeIndex, 3);
    assert.equal(out.rooms[0].doors[0].t, 0.7);
  });

  it("is a no-op when raw has no rooms", () => {
    const a = analysis([room("a", [[0, 0], [500, 0], [500, 500], [0, 500]])]);
    const out = reconcileOpeningPixels(a, { foo: 1 });
    assert.equal(out, a);
  });

  it("stays index-aligned when a non-record raw opening precedes a real one", () => {
    // normalizeAnalysis drops the non-record raw window, so the typed list has one
    // window. reconcile must filter the raw list the same way, or index 0 would
    // point at the stray entry and the real pixel-snap would be skipped.
    const a = analysis([
      { ...room("r", square()), windows: [{ position: "?", width: 1.2, height: 1.5, edgeIndex: 0, t: 0.1 }] },
    ]);
    const raw = { rooms: [{ doors: [], windows: [null, { x: 1000, y: 250 }] }] };
    const out = reconcileOpeningPixels(a, raw);
    assert.equal(out.rooms[0].windows[0].edgeIndex, 1);
    assert.ok(Math.abs((out.rooms[0].windows[0].t ?? -1) - 0.25) < 0.01);
  });
});
