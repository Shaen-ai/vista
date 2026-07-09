import { test } from "node:test";
import assert from "node:assert/strict";

import { renderOpeningsDiagram } from "./viewpointDiagram";
import { openingEdgeLabel } from "./roomFloorPlanContext";
import type { DetectedRoom } from "./types";

function room(polygon: [number, number][] | undefined): DetectedRoom {
  return {
    id: "room-1",
    name: "Living Room",
    type: "living",
    estimatedArea: 20,
    dimensions: { width: 4, depth: 5, height: 2.7 },
    windows: [],
    doors: [],
    features: [],
    polygon,
  };
}

const square: [number, number][] = [
  [0, 0],
  [4000, 0],
  [4000, 5000],
  [0, 5000],
];

test("renderOpeningsDiagram returns a PNG for a room with edge-anchored openings", async () => {
  const r: DetectedRoom = {
    ...room(square),
    windows: [
      { position: "north wall, left of center", width: 1.2, height: 1.5, edgeIndex: 0, t: 0.3 },
      { position: "north wall, right of center", width: 1.2, height: 1.5, edgeIndex: 0, t: 0.7 },
    ],
    doors: [{ position: "east wall near corner", width: 0.9, connectsTo: "hallway", edgeIndex: 1, t: 0.8 }],
  };
  const out = await renderOpeningsDiagram(r);
  assert.ok(out, "expected a rendered image");
  assert.equal(out!.mimeType, "image/png");
  assert.ok(out!.base64.length > 100, "expected non-trivial base64");
  // PNG magic bytes: \x89PNG
  assert.equal(Buffer.from(out!.base64, "base64").subarray(0, 4).toString("hex"), "89504e47");
});

test("renderOpeningsDiagram returns null when the room has no usable polygon", async () => {
  assert.equal(await renderOpeningsDiagram(room(undefined)), null);
  assert.equal(await renderOpeningsDiagram(undefined), null);
});

test("openingEdgeLabel references the same A-B-C-D wall scheme", () => {
  assert.equal(openingEdgeLabel(0, 0.3, square), " [wall A-B, t=0.30]");
  assert.equal(openingEdgeLabel(1, 0.8, square), " [wall B-C, t=0.80]");
  // Degrades to empty string when geometry is absent.
  assert.equal(openingEdgeLabel(undefined, 0.5, square), "");
  assert.equal(openingEdgeLabel(0, 0.5, undefined), "");
});
