import { test } from "node:test";
import assert from "node:assert/strict";
import {
  graphFromAnalysis,
  graphToAnalysis,
  canonicalizeAnalysisTopology,
  moveNode,
  moveWall,
  splitWall,
  addOpening,
  wallRoomDegree,
  nodeRoomDegree,
  nodeIdForRoomVertex,
  wallForRoomEdge,
  nearestWallToPoint,
  findWallOpening,
  type FloorPlanGraph,
} from "./floorPlanGraph";
import { polygonArea, pointAlongEdge, type Point } from "./floorPlanGeometry";
import { floorPlanTo3D, type Apartment3D } from "./apartment3d";
import type { DetectedRoom, FloorPlanAnalysis } from "./types";

/** Count door/window openings the 3D renderer would actually cut (edge not suppressed). */
function renderedOpenings(apt: Apartment3D): number {
  let n = 0;
  for (const r of apt.rooms) {
    for (const op of r.openings) if (!r.suppressedWallEdges.includes(op.edgeIndex)) n++;
  }
  return n;
}

function room(id: string, polygon: Point[], extra: Partial<DetectedRoom> = {}): DetectedRoom {
  return {
    id,
    name: id,
    type: "living",
    estimatedArea: Math.round((polygonArea(polygon) / 1e6) * 100) / 100,
    dimensions: { width: 4, depth: 3, height: 2.7 },
    windows: [],
    doors: [],
    features: [],
    polygon,
    ...extra,
  };
}

function analysis(rooms: DetectedRoom[]): FloorPlanAnalysis {
  return {
    totalArea: rooms.reduce((s, r) => s + r.estimatedArea, 0),
    ceilingHeight: 2.7,
    rooms,
    wallSegments: [],
    overallShape: "rectangular",
    notes: "",
  };
}

// Two 4×3 m rooms side by side sharing the vertical wall at x=4000.
const RECT_A: Point[] = [
  [0, 0],
  [4000, 0],
  [4000, 3000],
  [0, 3000],
];
const RECT_B: Point[] = [
  [4000, 0],
  [8000, 0],
  [8000, 3000],
  [4000, 3000],
];

function nodeAt(graph: FloorPlanGraph, x: number, y: number): string | undefined {
  return graph.nodes.find((n) => Math.abs(n.x - x) <= 2 && Math.abs(n.y - y) <= 2)?.id;
}

function vtxIndex(poly: Point[], x: number, y: number): number {
  return poly.findIndex(([px, py]) => Math.abs(px - x) <= 2 && Math.abs(py - y) <= 2);
}

function hasCornerNear(poly: Point[] | undefined, x: number, y: number): boolean {
  return !!poly?.some(([px, py]) => Math.abs(px - x) <= 3 && Math.abs(py - y) <= 3);
}

test("graphFromAnalysis unifies a shared wall: 6 nodes, 7 walls, 2 rooms", () => {
  const g = graphFromAnalysis(analysis([room("a", RECT_A), room("b", RECT_B)]));
  assert.equal(g.nodes.length, 6);
  assert.equal(g.walls.length, 7);
  assert.equal(g.rooms.length, 2);

  // The shared wall (x=4000, y 0..3000) belongs to both rooms.
  const n1 = nodeAt(g, 4000, 0)!;
  const n2 = nodeAt(g, 4000, 3000)!;
  const shared = g.walls.find((w) => (w.a === n1 && w.b === n2) || (w.a === n2 && w.b === n1))!;
  assert.ok(shared, "shared wall exists");
  assert.equal(wallRoomDegree(g, shared), 2);
  assert.equal(nodeRoomDegree(g, n1), 2);
});

test("interior door reported in both rooms collapses to one WallOpening", () => {
  const a = room("a", RECT_A, {
    doors: [{ position: "east wall center", width: 900, connectsTo: "b", edgeIndex: 1, t: 0.5, hinge: "left", swing: "in" }],
  });
  const b = room("b", RECT_B, {
    doors: [{ position: "west wall center", width: 900, connectsTo: "a", edgeIndex: 3, t: 0.5, hinge: "left", swing: "in" }],
  });
  const g = graphFromAnalysis(analysis([a, b]));
  const totalOpenings = g.walls.reduce((s, w) => s + w.openings.length, 0);
  assert.equal(totalOpenings, 1, "the doubled door became one opening");
});

test("a door on a shared wall round-trips to opposite swings per room, hinge preserved", () => {
  const a = room("a", RECT_A, {
    doors: [{ position: "east wall center", width: 900, connectsTo: "b", edgeIndex: 1, t: 0.5, hinge: "left", swing: "in" }],
  });
  const b = room("b", RECT_B); // only room A authored the door
  const src = analysis([a, b]);
  const out = graphToAnalysis(graphFromAnalysis(src), src);

  const ra = out.rooms.find((r) => r.id === "a")!;
  const rb = out.rooms.find((r) => r.id === "b")!;
  assert.equal(ra.doors.length, 1);
  assert.equal(rb.doors.length, 1, "the shared door is emitted onto BOTH rooms (fixes 3D loss)");

  assert.equal(ra.doors[0].swing, "in", "room A keeps the authored swing");
  assert.equal(rb.doors[0].swing, "out", "room B sees the same physical door as out");
  assert.equal(ra.doors[0].hinge, "left", "room A hinge preserved");
  assert.equal(ra.doors[0].connectsTo, "b");
  assert.equal(rb.doors[0].connectsTo, "a");
  assert.ok(Math.abs((ra.doors[0].t ?? 0) - 0.5) < 0.02);
});

test("round-trip preserves room polygon areas and wall segment count", () => {
  const src = analysis([room("a", RECT_A), room("b", RECT_B)]);
  const out = graphToAnalysis(graphFromAnalysis(src), src);
  assert.equal(out.rooms.length, 2);
  for (const id of ["a", "b"]) {
    const before = polygonArea(src.rooms.find((r) => r.id === id)!.polygon!);
    const after = polygonArea(out.rooms.find((r) => r.id === id)!.polygon!);
    assert.ok(Math.abs(before - after) / before < 0.001, `${id} area preserved`);
  }
  // Shared wall deduped: 7 unique segments.
  assert.equal(out.wallSegments.length, 7);
  assert.ok((out.sharedWalls?.length ?? 0) >= 2, "shared-wall adjacency recomputed");
});

test("partial overlap (T-junction) splits the long wall at the neighbor's corner", () => {
  // A is tall (6m); B (3m) shares only the lower half of A's right wall.
  const tallA: Point[] = [
    [0, 0],
    [4000, 0],
    [4000, 6000],
    [0, 6000],
  ];
  const g = graphFromAnalysis(analysis([room("a", tallA), room("b", RECT_B)]));

  const split = nodeAt(g, 4000, 3000);
  assert.ok(split, "a node exists at the T-junction (4000,3000)");
  assert.equal(nodeRoomDegree(g, split!), 2, "the split node is shared by both rooms");

  // The lower sub-wall is shared; the upper sub-wall is exterior (room A only).
  const n0 = nodeAt(g, 4000, 0)!;
  const lower = g.walls.find((w) => (w.a === n0 && w.b === split) || (w.a === split && w.b === n0))!;
  assert.equal(wallRoomDegree(g, lower), 2);
});

test("moveNode on a shared corner moves both rooms", () => {
  const src = analysis([room("a", RECT_A), room("b", RECT_B)]);
  const g = graphFromAnalysis(src);
  const shared = nodeAt(g, 4000, 0)!;
  const moved = moveNode(g, shared, 4200, 100);
  const out = graphToAnalysis(moved, src);

  const ra = out.rooms.find((r) => r.id === "a")!;
  const rb = out.rooms.find((r) => r.id === "b")!;
  const hasCorner = (poly: Point[]) => poly.some(([x, y]) => Math.abs(x - 4200) <= 2 && Math.abs(y - 100) <= 2);
  assert.ok(hasCorner(ra.polygon!), "room A follows the moved shared corner");
  assert.ok(hasCorner(rb.polygon!), "room B follows the moved shared corner");
});

test("moveWall on the shared wall shifts both rooms' boundary", () => {
  const src = analysis([room("a", RECT_A), room("b", RECT_B)]);
  const g = graphFromAnalysis(src);
  const n1 = nodeAt(g, 4000, 0)!;
  const n2 = nodeAt(g, 4000, 3000)!;
  const shared = g.walls.find((w) => (w.a === n1 && w.b === n2) || (w.a === n2 && w.b === n1))!;
  const out = graphToAnalysis(moveWall(g, shared.id, 500, 0), src);

  const ra = out.rooms.find((r) => r.id === "a")!;
  const rb = out.rooms.find((r) => r.id === "b")!;
  // A grew (its right wall moved to x=4500), B shrank — both still share the boundary.
  assert.ok(polygonArea(ra.polygon!) > polygonArea(RECT_A) - 1);
  assert.ok(ra.polygon!.some(([x]) => Math.abs(x - 4500) <= 2));
  assert.ok(rb.polygon!.some(([x]) => Math.abs(x - 4500) <= 2));
});

test("canonicalizeAnalysisTopology dedupes a doubled interior door and keeps both rooms", () => {
  const a = room("a", RECT_A, {
    doors: [{ position: "east wall center", width: 900, connectsTo: "b", edgeIndex: 1, t: 0.5, hinge: "left", swing: "in" }],
  });
  const b = room("b", RECT_B, {
    doors: [{ position: "west wall center", width: 900, connectsTo: "a", edgeIndex: 3, t: 0.5, hinge: "left", swing: "in" }],
  });
  const out = canonicalizeAnalysisTopology(analysis([a, b]));
  assert.equal(out.rooms.length, 2);
  const ra = out.rooms.find((r) => r.id === "a")!;
  const rb = out.rooms.find((r) => r.id === "b")!;
  // Each room still lists the door (needed so 3D's surviving wall carries the hole),
  // but the two authored copies represent one physical door.
  assert.equal(ra.doors.length, 1);
  assert.equal(rb.doors.length, 1);
  assert.equal(ra.doors[0].connectsTo, "b");
});

test("3D door-loss bug: door on the suppressed room is lost before canonicalize, rendered after", () => {
  // Door authored ONLY on room B (processed second → its shared edge is suppressed
  // in floorPlanTo3D, so the door's hole would be lost on the surviving wall).
  const a = room("a", RECT_A);
  const b = room("b", RECT_B, {
    doors: [{ position: "west wall center", width: 900, connectsTo: "a", edgeIndex: 3, t: 0.5, hinge: "left", swing: "in" }],
  });
  const raw = analysis([a, b]);

  assert.equal(renderedOpenings(floorPlanTo3D(raw)), 0, "raw plan loses the door in 3D");

  const fixed = canonicalizeAnalysisTopology(raw);
  assert.ok(renderedOpenings(floorPlanTo3D(fixed)) >= 1, "canonicalized plan renders the door in 3D");
});

test("canonicalizeAnalysisTopology leaves a single unshared room intact", () => {
  const src = analysis([
    room("a", RECT_A, {
      windows: [{ position: "south wall center", width: 1200, height: 1200, edgeIndex: 0, t: 0.5, confirmed: true }],
    }),
  ]);
  const out = canonicalizeAnalysisTopology(src);
  assert.equal(out.rooms.length, 1);
  const ra = out.rooms[0];
  assert.equal(ra.windows.length, 1);
  assert.ok(Math.abs(polygonArea(ra.polygon!) - polygonArea(RECT_A)) / polygonArea(RECT_A) < 0.001);
});

// --- Editor graph-mode wiring: simulate the exact map→mutate→re-derive sequence ---
// These mirror what FloorPlanEditor does in graph mode: it renders graphToAnalysis(graph),
// hit-tests a (roomId, vertexIndex|edgeIndex) or opening, maps back to graph ids, mutates
// the graph, and re-derives analysis. The index alignment (analysis vertex i ↔ nodeIds[i])
// is the crux, so we always map from the RENDERED analysis, not the source.

test("editor vertex drag: nodeIdForRoomVertex + moveNode moves the shared corner in both rooms", () => {
  const src = analysis([room("a", RECT_A), room("b", RECT_B)]);
  const g = graphFromAnalysis(src);
  const rendered = graphToAnalysis(g, src);
  const ra = rendered.rooms.find((r) => r.id === "a")!;
  const vi = vtxIndex(ra.polygon!, 4000, 0); // shared corner
  assert.ok(vi >= 0);
  const nodeId = nodeIdForRoomVertex(g, "a", vi)!;
  assert.ok(nodeId && nodeRoomDegree(g, nodeId) === 2, "maps to the shared node");

  const out = graphToAnalysis(moveNode(g, nodeId, 4300, 150), src);
  assert.ok(hasCornerNear(out.rooms.find((r) => r.id === "a")?.polygon, 4300, 150));
  assert.ok(hasCornerNear(out.rooms.find((r) => r.id === "b")?.polygon, 4300, 150));
});

test("editor wall drag: wallForRoomEdge + moveWall shifts the shared wall in both rooms", () => {
  const src = analysis([room("a", RECT_A), room("b", RECT_B)]);
  const g = graphFromAnalysis(src);
  const rendered = graphToAnalysis(g, src);
  const ra = rendered.rooms.find((r) => r.id === "a")!;
  // The shared edge starts at the (4000,0) corner.
  const ei = vtxIndex(ra.polygon!, 4000, 0);
  const we = wallForRoomEdge(g, "a", ei)!;
  assert.ok(we, "maps room edge to a wall");

  const out = graphToAnalysis(moveWall(g, we.wall.id, 500, 0), src);
  assert.ok(hasCornerNear(out.rooms.find((r) => r.id === "a")?.polygon, 4500, 0), "room A wall moved");
  assert.ok(hasCornerNear(out.rooms.find((r) => r.id === "b")?.polygon, 4500, 0), "room B wall moved");
});

test("editor place door: nearestWallToPoint + addOpening yields one door mapped back by findWallOpening", () => {
  const src = analysis([room("a", RECT_A), room("b", RECT_B)]);
  const g = graphFromAnalysis(src);
  const near = nearestWallToPoint(g, [4000, 1500])!; // on the shared wall
  assert.ok(near && wallRoomDegree(g, near.wall) === 2, "nearest is the shared wall");

  const g2 = addOpening(g, near.wall.id, { type: "door", t: near.t, width: 0.8, confirmed: true });
  const out = graphToAnalysis(g2, src);
  assert.equal(out.rooms.find((r) => r.id === "a")!.doors.length, 1);
  assert.equal(out.rooms.find((r) => r.id === "b")!.doors.length, 1, "one placed door shows in both rooms");

  // Map the rendered door back to its single graph opening (as the editor does on select).
  const ra = out.rooms.find((r) => r.id === "a")!;
  const d = ra.doors[0];
  const mid = pointAlongEdge(ra.polygon!, d.edgeIndex!, d.t ?? 0.5);
  const ref = findWallOpening(g2, mid, "door")!;
  assert.equal(ref.wallId, near.wall.id, "door maps back to the wall it was placed on");
});

test("splitWall inserts a shared node into both rooms and preserves total wall coverage", () => {
  const src = analysis([room("a", RECT_A), room("b", RECT_B)]);
  const g = graphFromAnalysis(src);
  const n1 = nodeAt(g, 4000, 0)!;
  const n2 = nodeAt(g, 4000, 3000)!;
  const shared = g.walls.find((w) => (w.a === n1 && w.b === n2) || (w.a === n2 && w.b === n1))!;
  const after = splitWall(g, shared.id, 0.5);

  const mid = nodeAt(after, 4000, 1500);
  assert.ok(mid, "a midpoint node was created");
  assert.equal(nodeRoomDegree(after, mid!), 2, "both rooms received the split node");
  // Original shared wall replaced by two child walls.
  assert.ok(!after.walls.some((w) => w.id === shared.id));
});
