import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alongWallOffsetPhrase,
  buildOpeningValidationContext,
} from "./openingValidationContext";
import type { ViewpointFraming } from "@/lib/project/viewpointFraming";

test("alongWallOffsetPhrase marks t=0.61 as right-of-center not centered", () => {
  assert.equal(alongWallOffsetPhrase(0.61), "right-of-center along the wall (NOT centered)");
  assert.equal(alongWallOffsetPhrase(0.2), "left-of-center along the wall");
  assert.equal(alongWallOffsetPhrase(0.5), "near center along the wall");
});

test("buildOpeningValidationContext includes floor plan t and geometry summary", () => {
  const framing: ViewpointFraming = {
    fovDeg: 85,
    facing: "east",
    aheadWall: "east",
    leftWall: "north",
    rightWall: "south",
    aheadWallM: 2.7,
    leftWallM: 5.7,
    rightWallM: 5.7,
    standingDesc: "camera near west corner facing east",
    visibleOpenings: [
      {
        kind: "window",
        wall: "east",
        side: "right",
        widthM: 1.1,
        label: "1.1 m window",
      },
    ],
    note: "camera near west corner facing east.",
    openingsSummary: "In view: 1.1 m window on the east wall on the right",
    wallLengthsM: { back: 2.7, left: 5.7, right: 5.7 },
  };

  const ctx = buildOpeningValidationContext({
    framing,
    visibleOpenings: {
      windowCount: 1,
      doorCount: 0,
      windowPositions: ["right wall"],
      doorPositions: [],
    },
    detectedRoom: {
      id: "room-1",
      name: "Bedroom",
      type: "bedroom",
      dimensions: { length: 5.74, width: 2.66, height: 2.7 },
      windows: [
        {
          position: "east wall",
          width: 1.1,
          height: 1.4,
          edgeIndex: 1,
          t: 0.61,
          confirmed: true,
        },
      ],
      doors: [],
      features: [],
    },
    lockAnalysis: {
      room_type: "bedroom",
      room_shape: "irregular",
      estimated_dimensions: { length: 5.74, width: 2.66, height: 2.7 },
      existing_furniture: [],
      architectural_features: [],
      lighting_sources: [],
      current_style: "",
      color_palette: [],
      suggestions: [],
      window_count: 1,
      door_count: 0,
      window_positions: ["right wall"],
      door_positions: [],
      camera_angle: "facing east toward short wall",
      ceiling_type: "",
      structural_elements: [],
      has_staircase: false,
      staircase_description: null,
      has_floor_opening: false,
      floor_opening_description: null,
      confidence: {
        room_type: "high",
        dimensions: "medium",
        style: "low",
        window_count: "high",
        door_count: "high",
      },
    },
  });

  assert.ok(ctx);
  assert.match(ctx!, /plan t=0\.61/);
  assert.match(ctx!, /right-of-center along the wall \(NOT centered\)/);
  assert.match(ctx!, /Geometry-visible openings/);
  assert.match(ctx!, /do NOT confuse that with a right-side-wall window/);
});
