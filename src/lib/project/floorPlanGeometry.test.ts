import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dimensionsFromPolygon,
  snapPoint,
  snapAndCloseGaps,
  deriveWallSegments,
  computeSharedWalls,
  formatSharedWall,
  sharedWallsSummaryText,
  polygonArea,
  translatePolygon,
  moveEdge,
  pointInPolygon,
  assignUtilitiesToRooms,
  describeUtilityPosition,
  pointAlongEdge,
  nearestEdgeToPoint,
  compassForEdge,
  describeOpening,
  inferConnectsTo,
  openingEndpoints,
  snapPointToGeometry,
  orthogonalVertexDrag,
  orthogonalEdgePush,
  wallPerpendicularDelta,
  dropCollinearVertices,
  isCollinearVertex,
  axisAlignedRect,
  edgeLengthMm,
  isValidEdgeIndex,
  sanitizePolygon,
  repairOpeningAnchors,
  type Point,
} from "./floorPlanGeometry";
import type { DetectedRoom, UtilityEntryPoint } from "./types";

function room(id: string, polygon: Point[]): DetectedRoom {
  return {
    id,
    name: id,
    type: "kitchen",
    estimatedArea: 12,
    dimensions: { width: 4, depth: 3, height: 2.7 },
    windows: [],
    doors: [],
    features: [],
    polygon,
  };
}

function util(id: string, x: number, y: number): UtilityEntryPoint {
  return { id, type: "water_inlet", x, y, label: "" };
}

test("polygonArea returns the mm² area of a rectangle", () => {
  const poly: Point[] = [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ];
  assert.equal(polygonArea(poly), 12_000_000);
});

test("translatePolygon shifts every vertex", () => {
  const poly: Point[] = [
    [0, 0],
    [1000, 0],
    [1000, 1000],
  ];
  assert.deepEqual(translatePolygon(poly, 500, -200), [
    [500, -200],
    [1500, -200],
    [1500, 800],
  ]);
});

test("moveEdge shifts both endpoints of one edge only", () => {
  const poly: Point[] = [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ];
  // Edge 1 = vertices 1 and 2 (the right wall); push it +1000 in x.
  assert.deepEqual(moveEdge(poly, 1, 1000, 0), [
    [0, 0],
    [5000, 0],
    [5000, 3000],
    [0, 3000],
  ]);
});

test("moveEdge wraps for the closing edge", () => {
  const poly: Point[] = [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ];
  // Edge 3 = vertices 3 and 0 (the left/bottom closing wall); push it +0,+500.
  assert.deepEqual(moveEdge(poly, 3, 0, 500), [
    [0, 500],
    [4000, 0],
    [4000, 3000],
    [0, 3500],
  ]);
});

test("dimensionsFromPolygon converts mm bbox to metres", () => {
  const poly: Point[] = [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ];
  const dims = dimensionsFromPolygon(poly, 2.7);
  assert.equal(dims.width, 4);
  assert.equal(dims.depth, 3);
  assert.equal(dims.height, 2.7);
});

test("snapPoint snaps onto a nearby vertex over the grid", () => {
  const target: Point = [3050, 1980];
  const snapped = snapPoint([3000, 2000], [target], 100, 350);
  assert.deepEqual(snapped, target);
});

test("snapPoint falls back to grid when no vertex is near", () => {
  const snapped = snapPoint([1240, 2570], [], 100, 350);
  assert.deepEqual(snapped, [1200, 2600]);
});

test("snapAndCloseGaps merges near-coincident corners of adjacent rooms", () => {
  // Two rooms with a ~120mm gap along their shared edge.
  const roomA: Point[] = [
    [0, 0],
    [3000, 0],
    [3000, 3000],
    [0, 3000],
  ];
  const roomB: Point[] = [
    [3120, 0],
    [6000, 0],
    [6000, 3000],
    [3120, 3000],
  ];
  const [a, b] = snapAndCloseGaps([roomA, roomB], 100, 250);
  // roomB's left edge should now share roomA's right-edge X (3000 after grid+merge).
  assert.equal(a[1][0], b[0][0], "shared corner x should match");
  assert.equal(a[2][0], b[3][0], "shared corner x should match");
});

test("pointInPolygon detects inside vs outside", () => {
  const poly: Point[] = [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ];
  assert.equal(pointInPolygon([2000, 1500], poly), true);
  assert.equal(pointInPolygon([5000, 1500], poly), false);
  assert.equal(pointInPolygon([2000, 4000], poly), false);
});

test("assignUtilitiesToRooms buckets points by containing room", () => {
  const a = room("a", [
    [0, 0],
    [3000, 0],
    [3000, 3000],
    [0, 3000],
  ]);
  const b = room("b", [
    [3000, 0],
    [6000, 0],
    [6000, 3000],
    [3000, 3000],
  ]);
  const map = assignUtilitiesToRooms([a, b], [util("u1", 1000, 1000), util("u2", 4500, 1500)]);
  assert.deepEqual(
    map.get("a")?.map((u) => u.id),
    ["u1"],
  );
  assert.deepEqual(
    map.get("b")?.map((u) => u.id),
    ["u2"],
  );
});

test("assignUtilitiesToRooms falls back to nearest room for outside points", () => {
  const a = room("a", [
    [0, 0],
    [3000, 0],
    [3000, 3000],
    [0, 3000],
  ]);
  // Point well outside, but closest to room a's centroid.
  const map = assignUtilitiesToRooms([a], [util("stray", -500, 1500)]);
  assert.deepEqual(
    map.get("a")?.map((u) => u.id),
    ["stray"],
  );
});

test("describeUtilityPosition maps to a relative grid label (Y-up = back)", () => {
  const r = room("a", [
    [0, 0],
    [3000, 0],
    [3000, 3000],
    [0, 3000],
  ]);
  assert.equal(describeUtilityPosition({ x: 200, y: 2800 }, r), "back-left corner");
  assert.equal(describeUtilityPosition({ x: 1500, y: 1500 }, r), "center of the room");
  assert.equal(describeUtilityPosition({ x: 2800, y: 1500 }, r), "right wall");
});

const RECT: Point[] = [
  [0, 0],
  [4000, 0],
  [4000, 3000],
  [0, 3000],
];

test("compassForEdge maps each rectangle wall (Y-up: +Y north, −Y south)", () => {
  assert.equal(compassForEdge(RECT, 0), "south"); // bottom edge
  assert.equal(compassForEdge(RECT, 1), "east"); // right edge
  assert.equal(compassForEdge(RECT, 2), "north"); // top edge
  assert.equal(compassForEdge(RECT, 3), "west"); // left edge
});

test("pointAlongEdge interpolates along an edge", () => {
  assert.deepEqual(pointAlongEdge(RECT, 0, 0.5), [2000, 0]);
  assert.deepEqual(pointAlongEdge(RECT, 1, 0.25), [4000, 750]);
});

test("nearestEdgeToPoint snaps a click to the closest wall with its fraction", () => {
  const near = nearestEdgeToPoint(RECT, [2000, 120]);
  assert.equal(near.edgeIndex, 0);
  assert.equal(near.t, 0.5);
  assert.equal(Math.round(near.distMm), 120);
});

test("describeOpening produces the wall + along-wall vocabulary", () => {
  assert.equal(describeOpening(RECT, 0, 0.5), "south wall center");
  assert.equal(describeOpening(RECT, 1, 0.1), "east wall near corner");
  assert.equal(describeOpening(RECT, 2, 0.35), "north wall off-center");
});

test("openingEndpoints spans the width centered on the wall point, clamped to the edge", () => {
  assert.deepEqual(openingEndpoints(RECT, 0, 0.5, 1000), [
    [1500, 0],
    [2500, 0],
  ]);
  // A center near the corner is pushed inward so the opening stays on the wall.
  const [a, b] = openingEndpoints(RECT, 0, 0, 1000);
  assert.deepEqual(a, [0, 0]);
  assert.deepEqual(b, [1000, 0]);
});

test("inferConnectsTo finds the room across a shared wall, else exterior", () => {
  const a = { id: "a", polygon: [[0, 0], [3000, 0], [3000, 3000], [0, 3000]] as Point[] };
  const b = { id: "b", polygon: [[3000, 0], [6000, 0], [6000, 3000], [3000, 3000]] as Point[] };
  // Edge 1 of room a is its right wall (shared with b).
  assert.equal(inferConnectsTo([a, b], a, 1, 0.5), "b");
  // Edge 3 of room a is its left wall → outside everything.
  assert.equal(inferConnectsTo([a, b], a, 3, 0.5), "exterior");
});

test("snapPointToGeometry: corner snap beats edge snap", () => {
  const corner: Point = [3000, 0];
  const edge: [Point, Point] = [[3000, 0], [3000, 3000]];
  // Near both a corner and the wall — the corner should win.
  const snapped = snapPointToGeometry([3100, 90], [corner], [edge], 100, 350, 250);
  assert.deepEqual(snapped, corner);
});

test("snapPointToGeometry: lands a corner on a neighbour's wall line", () => {
  // Dragging a corner near the middle of a vertical wall at x=3000 snaps onto it.
  const edge: [Point, Point] = [[3000, 0], [3000, 3000]];
  const snapped = snapPointToGeometry([3120, 1500], [], [edge], 100, 350, 250);
  assert.deepEqual(snapped, [3000, 1500]);
});

test("snapPointToGeometry: falls back to the grid when nothing is near", () => {
  const snapped = snapPointToGeometry([1240, 2570], [], [], 100, 350, 250);
  assert.deepEqual(snapped, [1200, 2600]);
});

test("deriveWallSegments dedupes the shared edge between two rooms", () => {
  const roomA: Point[] = [
    [0, 0],
    [3000, 0],
    [3000, 3000],
    [0, 3000],
  ];
  const roomB: Point[] = [
    [3000, 0],
    [6000, 0],
    [6000, 3000],
    [3000, 3000],
  ];
  const walls = deriveWallSegments([roomA, roomB]);
  // 4 + 4 edges minus 1 shared edge = 7 unique walls.
  assert.equal(walls.length, 7);
});

test("computeSharedWalls: full shared edge between two adjacent rectangles", () => {
  const kitchen = room("Kitchen", [
    [0, 0], [3000, 0], [3000, 3000], [0, 3000],
  ]);
  const living = room("Living Room", [
    [3000, 0], [6000, 0], [6000, 3000], [3000, 3000],
  ]);
  const shared = computeSharedWalls([kitchen, living]);
  // Two directed records: Kitchen→Living Room and Living Room→Kitchen.
  assert.equal(shared.length, 2);
  const kToL = shared.find((s) => s.roomId === "Kitchen")!;
  assert.equal(kToL.neighborRoomId, "Living Room");
  assert.equal(kToL.compass, "east");
  assert.equal(kToL.spanAxis, "y");
  assert.equal(kToL.spanStartMm, 0);
  assert.equal(kToL.spanEndMm, 3000);
  assert.equal(kToL.fullWidth, true);
  const lToK = shared.find((s) => s.roomId === "Living Room")!;
  assert.equal(lToK.neighborRoomId, "Kitchen");
  assert.equal(lToK.compass, "west");
  assert.equal(lToK.fullWidth, true);
});

test("computeSharedWalls: partial overlap", () => {
  const roomA = room("RoomA", [
    [0, 0], [4000, 0], [4000, 3000], [0, 3000],
  ]);
  const roomB = room("RoomB", [
    [4000, 1000], [7000, 1000], [7000, 2000], [4000, 2000],
  ]);
  const shared = computeSharedWalls([roomA, roomB]);
  const aToB = shared.find((s) => s.roomId === "RoomA")!;
  assert.equal(aToB.spanStartMm, 1000);
  assert.equal(aToB.spanEndMm, 2000);
  assert.equal(aToB.lengthMm, 1000);
  assert.equal(aToB.fullWidth, false);
  const bToA = shared.find((s) => s.roomId === "RoomB")!;
  assert.equal(bToA.fullWidth, true); // B's west edge is fully shared
});

test("computeSharedWalls: no adjacency for separated rooms", () => {
  const roomA = room("RoomA", [
    [0, 0], [1000, 0], [1000, 1000], [0, 1000],
  ]);
  const roomB = room("RoomB", [
    [5000, 5000], [6000, 5000], [6000, 6000], [5000, 6000],
  ]);
  assert.equal(computeSharedWalls([roomA, roomB]).length, 0);
});

test("formatSharedWall produces human-readable text", () => {
  const text = formatSharedWall({
    roomId: "k", roomName: "Kitchen",
    neighborRoomId: "l", neighborRoomName: "Living Room",
    compass: "north", edgeIndex: 2, spanAxis: "x",
    spanStartMm: 0, spanEndMm: 3200, lengthMm: 3200, fullWidth: true,
  });
  assert.match(text, /Kitchen shares north wall with Living Room/);
  assert.match(text, /x=0 to x=3200 mm/);
  assert.match(text, /full width/);
});

test("sharedWallsSummaryText returns empty string for no shared walls", () => {
  assert.equal(sharedWallsSummaryText([]), "");
});

// Every edge of a rectilinear polygon is horizontal or vertical.
function allEdgesAxisAligned(poly: Point[]): boolean {
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return a[0] === b[0] || a[1] === b[1];
  });
}

// RECT (declared above) is a 4000 × 3000 axis-aligned rectangle; vertex 2 = (4000,3000).
test("orthogonalVertexDrag keeps a rectangle a rectangle (neighbours slide)", () => {
  const poly = orthogonalVertexDrag(RECT, 2, [4100, 3100]);
  assert.deepEqual(poly, [
    [0, 0],
    [4100, 0], // neighbour on the vertical wall followed the new x
    [4100, 3100],
    [0, 3100], // neighbour on the horizontal wall followed the new y
  ]);
  assert.ok(allEdgesAxisAligned(poly));
});

test("orthogonalVertexDrag keeps an L-shape rectilinear", () => {
  const lShape: Point[] = [
    [0, 0],
    [4000, 0],
    [4000, 1500],
    [2000, 1500], // inner corner (index 3)
    [2000, 3000],
    [0, 3000],
  ];
  const poly = orthogonalVertexDrag(lShape, 3, [2200, 1600]);
  assert.deepEqual(poly[3], [2200, 1600]);
  assert.deepEqual(poly[2], [4000, 1600]); // shared horizontal wall slid in y
  assert.deepEqual(poly[4], [2200, 3000]); // shared vertical wall slid in x
  assert.ok(allEdgesAxisAligned(poly));
});

test("orthogonalEdgePush resizes a rectangle wall without adding corners", () => {
  const poly = orthogonalEdgePush(RECT, 0, 0, -500); // push the bottom wall down
  assert.deepEqual(poly, [
    [0, -500],
    [4000, -500],
    [4000, 3000],
    [0, 3000],
  ]);
});

test("orthogonalEdgePush jogs a straight sub-segment into a notch", () => {
  // Bottom wall split into three collinear runs; push the middle run down.
  const poly: Point[] = [
    [0, 0],
    [1000, 0],
    [3000, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ];
  const out = orthogonalEdgePush(poly, 1, 0, -500);
  assert.equal(out.length, 8); // two right-angle jogs inserted
  assert.deepEqual(out, [
    [0, 0],
    [1000, 0],
    [1000, -500],
    [3000, -500],
    [3000, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ]);
  assert.ok(allEdgesAxisAligned(out));
});

test("wallPerpendicularDelta zeros the component parallel to the wall", () => {
  assert.deepEqual(wallPerpendicularDelta(RECT, 0, 123, -500), [0, -500]); // horizontal wall
  assert.deepEqual(wallPerpendicularDelta(RECT, 1, 123, -500), [123, 0]); // vertical wall
});

test("dropCollinearVertices removes 180° corners", () => {
  const poly: Point[] = [
    [0, 0],
    [2000, 0], // collinear midpoint on the bottom wall
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ];
  assert.deepEqual(dropCollinearVertices(poly), [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ]);
});

test("isCollinearVertex flags a freshly inserted midpoint corner but not real corners", () => {
  const poly: Point[] = [
    [0, 0],
    [2000, 0], // 1: collinear midpoint on the bottom wall
    [4000, 0],
    [4000, 3000], // 3: real 90° corner
    [0, 3000],
  ];
  assert.equal(isCollinearVertex(poly, 1), true);
  assert.equal(isCollinearVertex(poly, 3), false);
});

test("axisAlignedRect builds a CCW rectangle from two opposite corners", () => {
  assert.deepEqual(axisAlignedRect([1000, 2000], [0, 0]), [
    [0, 0],
    [1000, 0],
    [1000, 2000],
    [0, 2000],
  ]);
});

test("edgeLengthMm returns 0 for empty polygon or out-of-bounds edge index", () => {
  const rect: Point[] = [
    [0, 0],
    [4000, 0],
    [4000, 3000],
    [0, 3000],
  ];
  assert.equal(edgeLengthMm([], 0), 0);
  assert.equal(edgeLengthMm(rect, 99), 0);
  assert.equal(edgeLengthMm(rect, -1), 0);
});

test("sanitizePolygon drops malformed vertices", () => {
  const raw = [
    [100, 200],
    null,
    ["bad", "data"],
    [300, 400],
    { x: 1, y: 2 },
    [500, 600],
  ];
  assert.deepEqual(sanitizePolygon(raw), [
    [100, 200],
    [300, 400],
    [500, 600],
  ]);
});

test("isValidEdgeIndex rejects out-of-range indices", () => {
  const poly: Point[] = [
    [0, 0],
    [4000, 0],
    [4000, 3000],
  ];
  assert.equal(isValidEdgeIndex(poly, 0), true);
  assert.equal(isValidEdgeIndex(poly, 2), true);
  assert.equal(isValidEdgeIndex(poly, 3), false);
  assert.equal(isValidEdgeIndex(poly, -1), false);
});

test("repairOpeningAnchors re-anchors OOB edgeIndex from position text", () => {
  const poly: Point[] = [
    [0, 7500],
    [4000, 7500],
    [4000, 0],
    [0, 0],
  ];
  const repaired = repairOpeningAnchors({
    ...room("living", poly),
    doors: [
      {
        position: "south wall center",
        width: 0.9,
        connectsTo: "exterior",
        edgeIndex: 99,
        t: 0.5,
      },
    ],
  });
  assert.ok(repaired.doors[0].edgeIndex !== undefined);
  assert.ok(repaired.doors[0].edgeIndex! >= 0);
  assert.ok(repaired.doors[0].edgeIndex! < poly.length);
  assert.equal(isValidEdgeIndex(poly, repaired.doors[0].edgeIndex!), true);
});
