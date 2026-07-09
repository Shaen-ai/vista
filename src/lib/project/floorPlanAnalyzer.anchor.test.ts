import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorAnalysisToImage, normalizeAnalysis } from "./floorPlanAnalyzer";
import type { FloorPlanAnalysis, DetectedRoom } from "./types";

function rectRoom(
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): DetectedRoom {
  // Image coords: y grows downward. Trace clockwise.
  return {
    id,
    name: id,
    type: "other",
    estimatedArea: 0,
    dimensions: { width: 3, depth: 3, height: 2.7 },
    windows: [],
    doors: [],
    features: [],
    polygon: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  };
}

function baseAnalysis(rooms: DetectedRoom[]): FloorPlanAnalysis {
  return {
    totalArea: 0,
    ceilingHeight: 2.7,
    rooms,
    wallSegments: [],
    overallShape: "rectangular",
    notes: "",
  };
}

test("anchorAnalysisToImage: landscape image, two tiled rooms, area-calibrated", () => {
  // Landscape 1600×1200 → imageHeightUnits = 1000 × 1200/1600 = 750.
  // Hallway occupies left 0..400, Living right 400..1000, both full height.
  const analysis = baseAnalysis([
    rectRoom("hall", 0, 0, 400, 750),
    rectRoom("living", 400, 0, 1000, 750),
  ]);

  const out = anchorAnalysisToImage(analysis, 750, 75); // 75 m² total

  // Footprint = 1000×750 units; target 75 m² → scale = sqrt(75e6 / 750000) = 10 mm/unit.
  assert.equal(out.imageFrame?.width, 10000);
  assert.equal(out.imageFrame?.height, 7500);
  assert.ok(Math.abs(out.imageFrame!.width / out.imageFrame!.height - 1600 / 1200) < 1e-6);

  const hall = out.rooms.find((r) => r.id === "hall")!;
  const living = out.rooms.find((r) => r.id === "living")!;

  // Hall: 4 m × 7.5 m = 30 m²; Living: 6 m × 7.5 m = 45 m²; sum = 75.
  assert.equal(hall.dimensions.width, 4);
  assert.equal(hall.dimensions.depth, 7.5);
  assert.equal(hall.estimatedArea, 30);
  assert.equal(living.estimatedArea, 45);

  // Y is flipped to bottom-left origin: image-top (y=0) maps to the largest mm Y.
  const hallMaxY = Math.max(...hall.polygon!.map(([, y]) => y));
  assert.equal(hallMaxY, 7500);
  const hallMinY = Math.min(...hall.polygon!.map(([, y]) => y));
  assert.equal(hallMinY, 0);

  // Rooms still tile with no horizontal overlap (hall 0..4000, living 4000..10000).
  const hallMaxX = Math.max(...hall.polygon!.map(([x]) => x));
  const livingMinX = Math.min(...living.polygon!.map(([x]) => x));
  assert.equal(hallMaxX, 4000);
  assert.equal(livingMinX, 4000);
});

test("anchorAnalysisToImage: imageHeightUnits drives the frame aspect ratio (bug: model's guess squashes Y)", () => {
  // A landscape 1600×1200 plan → true imageHeightUnits = 1000 × 1200/1600 = 750.
  // The model placed vertices in the x-consistent scale (room fills 0..1000 × 0..750),
  // but if it *reports* a wrong imageHeightUnits (e.g. a square 1000) the vertical axis
  // is stretched and the overlay no longer matches the image. Same vertices, two values:
  const vertices = baseAnalysis([rectRoom("r", 0, 0, 1000, 750)]);

  // Wrong (model-guessed) value → frame aspect ratio does NOT match the image's 1600/1200.
  const wrong = anchorAnalysisToImage(vertices, 1000, undefined);
  assert.ok(Math.abs(wrong.imageFrame!.width / wrong.imageFrame!.height - 1600 / 1200) > 0.1);

  // Correct (pixel-derived) value → frame aspect ratio matches the uploaded image.
  const correct = anchorAnalysisToImage(vertices, 750, undefined);
  assert.ok(Math.abs(correct.imageFrame!.width / correct.imageFrame!.height - 1600 / 1200) < 1e-6);
});

test("anchorAnalysisToImage: infers imageHeightUnits when missing/garbled", () => {
  const analysis = baseAnalysis([rectRoom("r", 0, 0, 1000, 500)]);
  const out = anchorAnalysisToImage(analysis, 0, undefined); // no height, no area
  // maxY=500 → inferred bottom = 525; default scale 12 → frame height 525×12.
  assert.equal(out.imageFrame?.height, 525 * 12);
  assert.equal(out.imageFrame?.width, 1000 * 12);
});

test("normalizeAnalysis: parses columns array", () => {
  const out = normalizeAnalysis({
    totalArea: 80,
    ceilingHeight: 2.7,
    overallShape: "rectangular",
    notes: "",
    rooms: [],
    columns: [
      { id: "col-1", x: 500, y: 300, width: 0.4, depth: 0.4, roomId: "room-1", shape: "square" },
      { id: "bad", x: "x", y: 200, width: 0, depth: 0 },
    ],
  });
  assert.equal(out.columns?.length, 2);
  assert.equal(out.columns![0].id, "col-1");
  assert.equal(out.columns![0].roomId, "room-1");
  assert.equal(out.columns![0].shape, "square");
  assert.equal(out.columns![1].width, 0.1);
});

test("anchorAnalysisToImage: scales column coordinates to mm", () => {
  const analysis = {
    ...baseAnalysis([rectRoom("r", 0, 0, 1000, 750)]),
    columns: [{ id: "col-1", x: 500, y: 375, width: 0.4, depth: 0.4, shape: "square" as const }],
  };
  const out = anchorAnalysisToImage(analysis, 750, 75);
  const col = out.columns![0];
  assert.equal(col.x, 5000);
  assert.equal(col.y, 3750);
});

test("normalizeAnalysis: clamps out-of-bounds edgeIndex to valid polygon edge", () => {
  const out = normalizeAnalysis({
    totalArea: 20,
    ceilingHeight: 2.7,
    overallShape: "rectangular",
    notes: "",
    rooms: [
      {
        id: "room-1",
        name: "Living",
        type: "living",
        estimatedArea: 20,
        dimensions: { width: 5, depth: 4, height: 2.7 },
        windows: [],
        doors: [
          {
            position: "east wall center",
            width: 0.9,
            height: 2.1,
            connectsTo: "exterior",
            edgeIndex: 7,
            t: 0.5,
          },
        ],
        polygon: [
          [0, 0],
          [5000, 0],
          [5000, 4000],
          [0, 4000],
        ],
      },
    ],
  });
  const door = out.rooms[0].doors[0];
  assert.ok(door.edgeIndex !== undefined);
  assert.ok(door.edgeIndex! >= 0);
  assert.ok(door.edgeIndex! < 4);
});

test("normalizeAnalysis: re-anchors openings after malformed polygon points are dropped", () => {
  const out = normalizeAnalysis({
    totalArea: 12,
    ceilingHeight: 2.7,
    overallShape: "rectangular",
    notes: "",
    rooms: [
      {
        id: "room-1",
        name: "Bedroom",
        type: "bedroom",
        estimatedArea: 12,
        dimensions: { width: 3, depth: 4, height: 2.7 },
        windows: [
          {
            position: "north wall center",
            width: 1.2,
            height: 1.5,
            edgeIndex: 4,
            t: 0.5,
          },
        ],
        doors: [],
        polygon: [
          [0, 0],
          null,
          [3000, 0],
          [3000, 4000],
          [0, 4000],
        ],
      },
    ],
  });
  const room = out.rooms[0];
  assert.equal(room.polygon?.length, 4);
  const win = room.windows[0];
  assert.ok(win.edgeIndex !== undefined);
  assert.ok(win.edgeIndex! < room.polygon!.length);
});
