import { test } from "node:test";
import assert from "node:assert/strict";
import { detectedRoomToRoomAnalysis } from "./detectedRoomToRoomAnalysis";
import type { DetectedRoom } from "./types";

function room(overrides: Partial<DetectedRoom> = {}): DetectedRoom {
  return {
    id: "r1",
    name: "Bedroom 1",
    type: "bedroom",
    estimatedArea: 14.7,
    dimensions: { width: 3, depth: 5, height: 2.7 },
    windows: [{ position: "north wall right", width: 1.2, height: 1.4 }],
    doors: [{ position: "north wall left", width: 0.9, connectsTo: "hallway" }],
    features: [],
    ...overrides,
  };
}

test("undefined room → null", () => {
  assert.equal(detectedRoomToRoomAnalysis(undefined), null);
});

test("maps counts, dimensions and formats positions", () => {
  const a = detectedRoomToRoomAnalysis(room())!;
  assert.equal(a.window_count, 1);
  assert.equal(a.door_count, 1);
  assert.deepEqual(a.estimated_dimensions, { width: 3, depth: 5, height: 2.7 });
  assert.match(a.window_positions[0]!, /north wall right/);
  assert.match(a.window_positions[0]!, /1\.2m × 1\.4m/);
  assert.match(a.door_positions[0]!, /connects to hallway/);
});

test("raw AI detection (no edgeIndex) → medium confidence → 'at least N'", () => {
  const a = detectedRoomToRoomAnalysis(room())!;
  assert.equal(a.confidence?.window_count, "medium");
  assert.equal(a.confidence?.door_count, "medium");
});

test("anchored but unconfirmed openings (edgeIndex only) → medium confidence", () => {
  // edgeIndex may be AI-derived (for editability); it no longer implies review.
  const a = detectedRoomToRoomAnalysis(
    room({
      windows: [{ position: "north wall right", width: 1.2, height: 1.4, edgeIndex: 0, t: 0.6 }],
      doors: [{ position: "north wall left", width: 0.9, connectsTo: "hallway", edgeIndex: 0, t: 0.2 }],
    }),
  )!;
  assert.equal(a.confidence?.window_count, "medium");
  assert.equal(a.confidence?.door_count, "medium");
});

test("confirmed openings → high confidence → 'EXACTLY N'", () => {
  const a = detectedRoomToRoomAnalysis(
    room({
      windows: [{ position: "north wall right", width: 1.2, height: 1.4, edgeIndex: 0, t: 0.6, confirmed: true }],
      doors: [{ position: "north wall left", width: 0.9, connectsTo: "hallway", edgeIndex: 0, t: 0.2, confirmed: true }],
    }),
  )!;
  assert.equal(a.confidence?.window_count, "high");
  assert.equal(a.confidence?.door_count, "high");
});

test("explicit confidence override wins (photo-present path)", () => {
  const a = detectedRoomToRoomAnalysis(room(), {
    windowConfidence: "high",
    doorConfidence: "high",
  })!;
  assert.equal(a.confidence?.window_count, "high");
  assert.equal(a.confidence?.door_count, "high");
});

test("photo opening overrides take precedence over plan counts", () => {
  const a = detectedRoomToRoomAnalysis(room(), {
    photoWindowCount: 1,
    photoWindowPositions: ["back wall center (large)"],
    photoDoorCount: 1,
    photoDoorPositions: ["left wall"],
  })!;
  assert.equal(a.window_count, 1);
  assert.deepEqual(a.window_positions, ["back wall center (large)"]);
  assert.deepEqual(a.door_positions, ["left wall"]);
});

test("photo-visible zero doors preserves plan door inventory separately", () => {
  const a = detectedRoomToRoomAnalysis(
    room({
      doors: [
        {
          position: "west wall, near north corner",
          width: 0.8,
          connectsTo: "exterior",
          edgeIndex: 5,
          t: 0.73,
          confirmed: true,
        },
      ],
    }),
    {
      photoDoorCount: 0,
      photoDoorPositions: [],
      planDoorCount: 1,
      planDoorPositions: ["left wall, west wall near north corner (0.8m wide, connects to exterior)"],
    },
  )!;
  assert.equal(a.door_count, 0);
  assert.equal(a.plan_door_count, 1);
  assert.deepEqual(a.door_positions, []);
  assert.match(a.plan_door_positions![0]!, /west wall near north corner/);
});

test("photo window boxes carry onto window_boxes (sill/size source of truth)", () => {
  const boxes = [{ x: 0.4, y: 0.2, w: 0.25, h: 0.4 }];
  const a = detectedRoomToRoomAnalysis(room(), { photoWindowBoxes: boxes })!;
  assert.deepEqual(a.window_boxes, boxes);
  // Absent when not provided.
  assert.equal(detectedRoomToRoomAnalysis(room())!.window_boxes, undefined);
});

test("camera angle passthrough; default 'unknown'", () => {
  assert.equal(detectedRoomToRoomAnalysis(room())!.camera_angle, "unknown");
  assert.equal(
    detectedRoomToRoomAnalysis(room(), { cameraAngle: "camera facing north" })!.camera_angle,
    "camera facing north",
  );
});

test("derives staircase / floor-opening flags from features", () => {
  const a = detectedRoomToRoomAnalysis(
    room({ features: ["staircase descending to lower level", "exposed floor opening void"] }),
  )!;
  assert.equal(a.has_staircase, true);
  assert.equal(a.has_floor_opening, true);
  const plain = detectedRoomToRoomAnalysis(room({ features: ["recessed ceiling"] }))!;
  assert.equal(plain.has_staircase, false);
  assert.equal(plain.has_floor_opening, false);
});

test("non-rectangular polygon → irregular shape token and corner count", () => {
  const poly: [number, number][] = [
    [0, 0], [3000, 0], [3000, 2000], [1500, 2000], [1500, 5000], [0, 5000],
  ];
  const irregular = detectedRoomToRoomAnalysis(room({ polygon: poly }))!;
  assert.equal(irregular.room_shape, "irregular");
  assert.equal(irregular.polygon_corner_count, 6);
  assert.equal(detectedRoomToRoomAnalysis(room())!.room_shape, "rectangle");
  assert.equal(detectedRoomToRoomAnalysis(room())!.polygon_corner_count, undefined);
});

test("8-corner polygon → polygon_corner_count === 8", () => {
  const poly: [number, number][] = [
    [0, 0], [5000, 0], [5000, 1000], [4000, 1000], [4000, 4000], [0, 4000], [0, 3000], [1000, 3000],
  ];
  const a = detectedRoomToRoomAnalysis(room({ polygon: poly }))!;
  assert.equal(a.room_shape, "irregular");
  assert.equal(a.polygon_corner_count, 8);
});

test("planColumns map to structural_elements for the room", () => {
  const a = detectedRoomToRoomAnalysis(room({ id: "room-1" }), {
    planColumns: [
      { id: "col-1", x: 1000, y: 2000, width: 0.4, depth: 0.5, roomId: "room-1" },
      { id: "col-2", x: 5000, y: 3000, width: 0.3, depth: 0.3, roomId: "other" },
    ],
  })!;
  assert.equal(a.structural_elements.length, 1);
  assert.match(a.structural_elements[0]!, /load-bearing column/);
  assert.match(a.structural_elements[0]!, /0\.4m × 0\.5m/);
});

test("speculative plan column-at-corner stays in features but not structural_elements", () => {
  const feature = "structural/utility shaft or column protruding at southeast edge";
  const a = detectedRoomToRoomAnalysis(room({ features: [feature, "built-in closet"] }))!;
  assert.deepEqual(a.architectural_features, [feature, "built-in closet"]);
  assert.deepEqual(a.structural_elements, ["built-in closet"]);
});

test("compassToCameraWall translates plan compass labels to camera-relative", () => {
  const a = detectedRoomToRoomAnalysis(room(), {
    compassToCameraWall: { north: "back", west: "left" },
  })!;
  // "north wall right" → prefixed with "back wall, "
  assert.match(a.window_positions[0]!, /^back wall, north wall right/);
  assert.match(a.door_positions[0]!, /^back wall, north wall left/);
});

test("compassToCameraWall leaves labels unchanged when compass not in map", () => {
  const a = detectedRoomToRoomAnalysis(room(), {
    compassToCameraWall: { east: "right" },
  })!;
  assert.match(a.window_positions[0]!, /^north wall right/);
});
