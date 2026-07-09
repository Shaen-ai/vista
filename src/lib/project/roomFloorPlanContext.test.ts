import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderHighlightedFloorPlan,
  buildRoomFloorPlanContext,
  roomSummaryText,
} from "./roomFloorPlanContext";
import type { DetectedRoom, FloorPlanAnalysis, ProjectState } from "./types";

function room(id: string, name: string, polygon: [number, number][] | undefined): DetectedRoom {
  return {
    id,
    name,
    type: "living",
    estimatedArea: 20,
    dimensions: { width: 4, depth: 5, height: 2.7 },
    windows: [],
    doors: [],
    features: [],
    polygon,
  };
}

const twoRooms: DetectedRoom[] = [
  room("room-1", "Living Room", [
    [0, 0],
    [4000, 0],
    [4000, 5000],
    [0, 5000],
  ]),
  room("room-2", "Bedroom", [
    [4000, 0],
    [8000, 0],
    [8000, 5000],
    [4000, 5000],
  ]),
];

test("renderHighlightedFloorPlan returns a PNG for rooms with polygons", async () => {
  const out = await renderHighlightedFloorPlan(twoRooms, { width: 8000, height: 5000 }, "room-1");
  assert.ok(out, "expected a rendered image");
  assert.equal(out!.mimeType, "image/png");
  assert.ok(out!.base64.length > 100, "expected non-trivial base64");
  // PNG magic bytes: \x89PNG
  assert.equal(Buffer.from(out!.base64, "base64").subarray(0, 4).toString("hex"), "89504e47");
});

test("renderHighlightedFloorPlan returns null when no room has a usable polygon", async () => {
  const noPoly = [room("room-1", "Living Room", undefined)];
  const out = await renderHighlightedFloorPlan(noPoly, undefined, "room-1");
  assert.equal(out, null);
});

test("roomSummaryText lists every room with dims and openings", () => {
  const analysis = { rooms: twoRooms } as FloorPlanAnalysis;
  const text = roomSummaryText(analysis);
  assert.match(text, /Living Room/);
  assert.match(text, /Bedroom/);
  // Rooms with polygons report corner-labeled wall lengths (A-B, B-C, …).
  assert.match(text, /edges: A-B: 4\.00m, B-C: 5\.00m/);
});

test("roomSummaryText includes per-opening detail for the target room", () => {
  const rooms: DetectedRoom[] = [
    {
      ...room("room-1", "Living Room", [
        [0, 0],
        [4000, 0],
        [4000, 5000],
        [0, 5000],
      ]),
      // Edge-anchored openings → described by the diagram's corner letters only.
      windows: [{ position: "north wall, 1.2m from west corner", width: 1.2, height: 1.5, edgeIndex: 2, t: 0.3 }],
      doors: [{ position: "east wall near corner", width: 0.9, connectsTo: "hallway", edgeIndex: 1, t: 0.8 }],
    },
    room("room-2", "Bedroom", [
      [4000, 0],
      [8000, 0],
      [8000, 5000],
      [4000, 5000],
    ]),
  ];
  const analysis = { rooms } as FloorPlanAnalysis;
  const text = roomSummaryText(analysis, "room-1");
  // Placement is by corner-letter edge (diagram vocabulary), NOT compass — the
  // authoritative wall placement lives once in the camera-relative opening lock.
  assert.match(text, /Window 1 \[wall C-D, t=0\.30\], 1\.2m × 1\.5m/);
  assert.match(text, /Door 1 \[wall B-C, t=0\.80\]/);
  assert.doesNotMatch(text, /north wall/);
  assert.doesNotMatch(text, /Bedroom[\s\S]*Window 1/);
});

test("buildRoomFloorPlanContext assembles plan image, text, and all room photos", async () => {
  const analysis: FloorPlanAnalysis = {
    totalArea: 40,
    ceilingHeight: 2.7,
    rooms: twoRooms,
    wallSegments: [],
    overallShape: "rectangular",
    notes: "",
    imageFrame: { width: 8000, height: 5000 },
  };
  const state = {
    analysis,
    floorPlanBase64: "ZmFrZQ==",
    floorPlanMimeType: "image/png",
    uploadedPhotos: [
      { id: "p1", base64: "aQ==", mimeType: "image/jpeg", label: "a", roomId: "room-1" },
      { id: "p2", base64: "Yg==", mimeType: "image/jpeg", label: "b", roomId: "room-1" },
      { id: "p3", base64: "Yw==", mimeType: "image/jpeg", label: "c", roomId: "room-2" },
    ],
  } as unknown as ProjectState;

  const ctx = await buildRoomFloorPlanContext(state, "room-1");
  assert.deepEqual(ctx.originalPlan, { base64: "ZmFrZQ==", mimeType: "image/png" });
  assert.ok(ctx.highlightedPlan, "expected a highlighted schematic");
  assert.match(ctx.planText, /Target room to generate: "Living Room"/);
  // Only room-1's two photos, never room-2's.
  assert.equal(ctx.roomPhotos.length, 2);
  assert.deepEqual(ctx.roomPhotos.map((p) => p.id).sort(), ["p1", "p2"]);
});

test("roomSummaryText includes SHARED WALL ADJACENCY when sharedWalls is populated", () => {
  const analysis: FloorPlanAnalysis = {
    totalArea: 40,
    ceilingHeight: 2.7,
    rooms: twoRooms,
    wallSegments: [],
    overallShape: "rectangular",
    notes: "",
    sharedWalls: [
      {
        roomId: "room-1", roomName: "Living Room",
        neighborRoomId: "room-2", neighborRoomName: "Kitchen",
        compass: "east", edgeIndex: 1, spanAxis: "y",
        spanStartMm: 0, spanEndMm: 5000, lengthMm: 5000, fullWidth: true,
      },
    ],
  };
  const text = roomSummaryText(analysis);
  assert.match(text, /SHARED WALL ADJACENCY/);
  assert.match(text, /Living Room shares east wall with Kitchen/);
  assert.match(text, /full width/);
});
