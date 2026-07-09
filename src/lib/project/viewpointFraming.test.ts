import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveViewpointFraming, framingVisibleOpenings, areViewpointsRoughlyOpposite, buildViewpointTransferDirective } from "./viewpointFraming";
import type { DetectedRoom } from "./types";

/**
 * 4 m × 3 m room in Y-up mm space. Edges (CCW from origin):
 *   0: south (y=0), 1: east (x=4000), 2: north (y=3000), 3: west (x=0)
 */
function room(
  windows: DetectedRoom["windows"] = [],
  doors: DetectedRoom["doors"] = [],
): DetectedRoom {
  return {
    id: "r1",
    name: "Living",
    type: "living",
    estimatedArea: 12,
    dimensions: { width: 4, depth: 3, height: 2.7 },
    windows,
    doors,
    features: [],
    polygon: [
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [0, 3000],
    ],
  };
}

test("camera in SW corner facing NE sees the north window (left) and east door (right)", () => {
  const r = room(
    [{ position: "north wall center", width: 1.2, height: 1.4, edgeIndex: 2, t: 0.5 }],
    [{ position: "east wall center", width: 0.8, connectsTo: "hall", edgeIndex: 1, t: 0.5 }],
  );
  const framing = resolveViewpointFraming({ x: 800, y: 600, angleDeg: 45 }, r);

  assert.equal(framing.aheadWall, "north");
  const window = framing.visibleOpenings.find((o) => o.kind === "window");
  const door = framing.visibleOpenings.find((o) => o.kind === "door");
  assert.ok(window, "window should be in frame");
  assert.equal(window?.wall, "north");
  assert.equal(window?.side, "left");
  assert.ok(door, "door should be in frame");
  assert.equal(door?.wall, "east");
  assert.equal(door?.side, "right");
  assert.match(framing.openingsSummary, /north wall/);
  assert.match(framing.openingsSummary, /east wall/);
});

test("facing the opposite way drops out-of-frame openings", () => {
  const r = room(
    [{ position: "north wall center", width: 1.2, height: 1.4, edgeIndex: 2, t: 0.5 }],
    [{ position: "east wall center", width: 0.8, connectsTo: "hall", edgeIndex: 1, t: 0.5 }],
  );
  const framing = resolveViewpointFraming({ x: 800, y: 600, angleDeg: 225 }, r);
  assert.equal(framing.visibleOpenings.length, 0);
  assert.match(framing.openingsSummary, /No windows or doors/);
});

test("camera centered on south wall facing north puts the north window dead ahead", () => {
  const r = room([
    { position: "north wall center", width: 1.2, height: 1.4, edgeIndex: 2, t: 0.5 },
  ]);
  const framing = resolveViewpointFraming({ x: 2000, y: 500, angleDeg: 90 }, r);
  assert.equal(framing.aheadWall, "north");
  const window = framing.visibleOpenings.find((o) => o.kind === "window");
  assert.equal(window?.side, "center");
});

test("openings without edge placement are kept when their wall is in view", () => {
  // No edgeIndex/t — auto-detected room; falls back to position string.
  const r = room([{ position: "north wall center", width: 1.2, height: 1.4 }]);
  const framing = resolveViewpointFraming({ x: 2000, y: 500, angleDeg: 90 }, r);
  assert.equal(framing.aheadWall, "north");
  assert.equal(framing.visibleOpenings.length, 1);
  assert.equal(framing.visibleOpenings[0].side, "center");
});

test("no polygon falls back to a facing-only note without throwing", () => {
  const r = room();
  r.polygon = undefined;
  const framing = resolveViewpointFraming({ x: 0, y: 0, angleDeg: 90 }, r);
  assert.equal(framing.note, "camera facing north");
  assert.equal(framing.visibleOpenings.length, 0);
});

test("framingVisibleOpenings excludes the door behind the camera (the reported bug)", () => {
  // Camera near the south wall facing north → window on the far (north) wall is
  // in view; door on the south wall is behind the camera. The lock/validator
  // must NOT demand the unseen door.
  const r = room(
    [{ position: "north wall center", width: 1.2, height: 1.4, edgeIndex: 2, t: 0.5 }],
    [{ position: "south wall center", width: 0.8, connectsTo: "hall", edgeIndex: 0, t: 0.5 }],
  );
  const framing = resolveViewpointFraming({ x: 2000, y: 500, angleDeg: 90 }, r);
  const expected = framingVisibleOpenings(framing);

  assert.equal(expected.windowCount, 1);
  assert.equal(expected.doorCount, 0, "door behind the camera must be excluded");
  assert.deepEqual(expected.windowPositions, ["far/back wall"]);
  assert.deepEqual(expected.doorPositions, []);
});

test("framingVisibleOpenings returns nothing when no opening is in view", () => {
  const r = room(
    [{ position: "south wall center", width: 1.2, height: 1.4, edgeIndex: 0, t: 0.4 }],
    [{ position: "south wall near corner", width: 0.8, connectsTo: "hall", edgeIndex: 0, t: 0.9 }],
  );
  const framing = resolveViewpointFraming({ x: 2000, y: 500, angleDeg: 90 }, r);
  const expected = framingVisibleOpenings(framing);
  assert.equal(expected.windowCount, 0);
  assert.equal(expected.doorCount, 0);
});

test("elongated room: faced short wall is tagged narrow so the window stays off the long walls", () => {
  // 5.65 m × 2.6 m bedroom (the logged scenario). Window on the SHORT east wall;
  // camera near the west wall looking east down the room's length.
  const elongated: DetectedRoom = {
    id: "bed",
    name: "Bedroom",
    type: "bedroom",
    estimatedArea: 14.7,
    dimensions: { width: 5.65, depth: 2.6, height: 2.7 },
    windows: [{ position: "east wall center", width: 1.2, height: 1.5, edgeIndex: 1, t: 0.5 }],
    doors: [],
    features: [],
    polygon: [
      [0, 0],
      [5650, 0],
      [5650, 2600],
      [0, 2600],
    ],
  };
  const framing = resolveViewpointFraming({ x: 300, y: 1300, angleDeg: 0 }, elongated);

  assert.equal(framing.aheadWall, "east", "camera faces the short east wall");
  assert.equal(framing.aheadWallM, 2.6, "faced wall measured as the 2.6 m short wall");
  assert.equal(framing.wallLengthsM.back, 2.6, "lock map carries the short back-wall length");
  assert.ok((framing.leftWallM ?? 0) > 5, "side walls are the long walls");
  assert.ok((framing.rightWallM ?? 0) > 5, "side walls are the long walls");
  assert.match(framing.note, /narrow/, "note tells Gemini the far wall is narrow");
});

test("areViewpointsRoughlyOpposite detects ~180° pair", () => {
  assert.equal(areViewpointsRoughlyOpposite(0, 180), true);
  assert.equal(areViewpointsRoughlyOpposite(90, 270), true);
  assert.equal(areViewpointsRoughlyOpposite(0, 90), false);
});

test("buildViewpointTransferDirective emits wall-anchored placement for opposite cameras", () => {
  const text = buildViewpointTransferDirective({
    referenceAngleDeg: 0,
    editTargetAngleDeg: 178,
    referenceFacing: "east",
    editTargetFacing: "west",
  });
  assert.match(text, /OPPOSITE-CAMERA/);
  assert.match(text, /SAME PHYSICAL COMPASS WALL/);
  assert.match(text, /ARCHITECTURE IS FIXED/);
  assert.match(text, /EDIT TARGET photo/);
  assert.match(text, /Do NOT mirror, flip, or swap door positions/);
  assert.doesNotMatch(text, /LEFT↔RIGHT/, "must not use screen-relative mirror language");
  assert.doesNotMatch(text, /Walls that were BEHIND/, "must not narrate whole-room geometry flip");
});

test("buildViewpointTransferDirective includes compass wall map when framing provided", () => {
  const heroFraming = resolveViewpointFraming({ x: 300, y: 1300, angleDeg: 0 }, {
    id: "bed",
    name: "Bedroom",
    type: "bedroom",
    estimatedArea: 14.7,
    dimensions: { width: 5.65, depth: 2.6, height: 2.7 },
    windows: [],
    doors: [],
    features: [],
    polygon: [[0, 0], [5650, 0], [5650, 2600], [0, 2600]],
  });
  const editFraming = resolveViewpointFraming({ x: 5350, y: 1300, angleDeg: 180 }, {
    id: "bed",
    name: "Bedroom",
    type: "bedroom",
    estimatedArea: 14.7,
    dimensions: { width: 5.65, depth: 2.6, height: 2.7 },
    windows: [],
    doors: [],
    features: [],
    polygon: [[0, 0], [5650, 0], [5650, 2600], [0, 2600]],
  });
  const text = buildViewpointTransferDirective({
    referenceAngleDeg: 0,
    editTargetAngleDeg: 180,
    referenceFacing: "east",
    editTargetFacing: "west",
    heroFraming,
    editTargetFraming: editFraming,
  });
  assert.match(text, /FURNITURE WALL MAP/, "includes compass wall anchor block");
  assert.match(text, /EAST/i, "mentions the hero ahead wall");
  assert.match(text, /bed headboard wall/i, "anchors bed to its wall");
});
