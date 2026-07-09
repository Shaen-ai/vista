import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCompactRoomShapeBlock,
  buildWallNotchDirectiveForFlux,
} from "./falGeometryLockPrompt";
import type { DetectedRoom } from "./project/types";

describe("buildWallNotchDirectiveForFlux", () => {
  test("returns directive for 8-corner room with notch", () => {
    const room: DetectedRoom = {
      id: "r1",
      name: "Bedroom",
      type: "bedroom",
      estimatedArea: 15,
      dimensions: { width: 5, depth: 4, height: 2.7 },
      polygon: [
        [0, 0],
        [5, 0],
        [5, 1],
        [4, 1],
        [4, 4],
        [0, 4],
        [0, 3],
        [1, 3],
      ],
      windows: [],
      doors: [],
      features: [],
    };
    const directive = buildWallNotchDirectiveForFlux(room);
    assert.ok(directive === undefined || directive.includes("jog") || directive.includes("recess"));
  });

  test("returns undefined for rectangular room", () => {
    const room: DetectedRoom = {
      id: "r1",
      name: "Box",
      type: "bedroom",
      estimatedArea: 12,
      dimensions: { width: 4, depth: 3, height: 2.7 },
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      windows: [],
      doors: [],
      features: [],
    };
    assert.equal(buildWallNotchDirectiveForFlux(room), undefined);
  });
});

test("buildCompactRoomShapeBlock for 8+ corners", () => {
  const block = buildCompactRoomShapeBlock({
    id: "r1",
    name: "Bedroom",
    type: "bedroom",
    estimatedArea: 15,
    dimensions: { width: 5, depth: 4, height: 2.7 },
    polygon: [
      [0, 0],
      [5, 0],
      [5, 1],
      [4, 1],
      [4, 4],
      [0, 4],
      [0, 3],
      [1, 3],
    ],
    windows: [],
    doors: [],
    features: [],
  });
  assert.match(block!, /8 wall corners/i);
  assert.match(block!, /not a simple rectangle/i);
  assert.match(block!, /Edges:/i);
});
