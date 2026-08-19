import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floorPlanTo3D, type Vec2 } from "./apartment3d";
import type { DetectedRoom, FloorPlanAnalysis, PlanColumn } from "./types";

function signedAreaXZ(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Index of the outline edge whose endpoints match {a, b} (either direction), or -1. */
function findEdge(outline: Vec2[], a: Vec2, b: Vec2, eps = 1e-6): number {
  const same = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) < eps && Math.abs(p.z - q.z) < eps;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    if ((same(p, a) && same(q, b)) || (same(p, b) && same(q, a))) return i;
  }
  return -1;
}

function room(
  id: string,
  polygon: [number, number][],
  extra: Partial<DetectedRoom> = {},
): DetectedRoom {
  return {
    id,
    name: extra.name ?? id,
    type: extra.type ?? "living",
    estimatedArea: extra.estimatedArea ?? 20,
    dimensions: extra.dimensions ?? { width: 2, depth: 1, height: 2.7 },
    windows: extra.windows ?? [],
    doors: extra.doors ?? [],
    features: extra.features ?? [],
    polygon,
  };
}

function analysis(rooms: DetectedRoom[], columns?: PlanColumn[]): FloorPlanAnalysis {
  return {
    totalArea: 80,
    ceilingHeight: 2.7,
    rooms,
    wallSegments: [],
    overallShape: "custom",
    notes: "",
    columns,
  };
}

describe("floorPlanTo3D", () => {
  it("maps mm/Y-up → meters/XZ", () => {
    const apt = floorPlanTo3D(analysis([room("r1", [[0, 0], [2000, 0], [2000, 1000], [0, 1000]])]));
    assert.equal(apt.rooms.length, 1);
    const pts = apt.rooms[0].outline;
    // every vertex should be within the 0..2m X and -1..0 Z box
    for (const p of pts) {
      assert.ok(p.x >= 0 && p.x <= 2, `x in range: ${p.x}`);
      assert.ok(p.z >= -1 && p.z <= 0, `z in range: ${p.z}`);
    }
  });

  it("normalizes winding to positive XZ signed area (reverses a Y-up-CCW ring)", () => {
    // Y-up-CCW rectangle → negative XZ area → must be reversed.
    const r = room("r1", [[0, 0], [2000, 0], [2000, 1000], [0, 1000]], {
      windows: [{ position: "south", width: 1000, height: 1200, edgeIndex: 0, t: 0.25 }],
    });
    const apt = floorPlanTo3D(analysis([r]));
    assert.ok(signedAreaXZ(apt.rooms[0].outline) > 0, "outline is CCW (positive area)");

    // Opening on old edge 0 (n=4) remaps to edge (n-2-0)=2, t→1-0.25=0.75, position=0.5.
    const op = apt.rooms[0].openings[0];
    assert.equal(op.edgeIndex, 2);
    assert.ok(Math.abs(op.position - 0.5) < 1e-9, `position=${op.position}`);
    assert.equal(op.type, "window");
    assert.ok(Math.abs(op.width - 1.0) < 1e-9);
    assert.ok(Math.abs(op.height - 1.2) < 1e-9);
  });

  it("leaves an already-CCW (positive XZ) ring unreversed and maps t→position directly", () => {
    // Y-up-CW rectangle → positive XZ area → NOT reversed.
    const r = room("r1", [[0, 0], [0, 1000], [2000, 1000], [2000, 0]], {
      windows: [{ position: "x", width: 800, height: 1500, edgeIndex: 0, t: 0.25 }],
    });
    const apt = floorPlanTo3D(analysis([r]));
    assert.ok(signedAreaXZ(apt.rooms[0].outline) > 0);
    const op = apt.rooms[0].openings[0];
    assert.equal(op.edgeIndex, 0);
    assert.ok(Math.abs(op.position - -0.5) < 1e-9, `position=${op.position}`);
  });

  it("applies default opening heights when missing (door 2.1m, window 1.2m)", () => {
    const r = room("r1", [[0, 0], [0, 1000], [2000, 1000], [2000, 0]], {
      windows: [{ position: "x", width: 800, height: 0, edgeIndex: 1, t: 0.5 }],
      doors: [
        {
          position: "y",
          width: 900,
          connectsTo: "hall",
          edgeIndex: 2,
          t: 0.5,
          hinge: "left",
          swing: "in",
        },
      ],
    });
    const apt = floorPlanTo3D(analysis([r]));
    const win = apt.rooms[0].openings.find((o) => o.type === "window")!;
    const door = apt.rooms[0].openings.find((o) => o.type === "door")!;
    assert.ok(Math.abs(win.height - 1.2) < 1e-9, `window default height ${win.height}`);
    assert.ok(Math.abs(door.height - 2.1) < 1e-9, `door default height ${door.height}`);
    assert.equal(door.hinge, "left");
    assert.equal(door.swing, "in");
  });

  it("dedupes a shared wall — exactly one side suppresses the boundary edge", () => {
    const r1 = room("r1", [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]);
    const r2 = room("r2", [[1000, 0], [2000, 0], [2000, 1000], [1000, 1000]]);
    const apt = floorPlanTo3D(analysis([r1, r2]));
    const [a, b] = apt.rooms;

    // Boundary in XZ: x=1, z from 0 to -1.
    const p = { x: 1, z: 0 };
    const q = { x: 1, z: -1 };
    const edgeA = findEdge(a.outline, p, q);
    const edgeB = findEdge(b.outline, p, q);
    assert.ok(edgeA >= 0 && edgeB >= 0, "both rooms have the boundary edge");

    // r1 processed first claims the wall; r2 suppresses it.
    assert.ok(!a.suppressedWallEdges.includes(edgeA), "r1 renders the shared wall");
    assert.ok(b.suppressedWallEdges.includes(edgeB), "r2 suppresses the shared wall");
  });

  it("passes column width/depth through as meters, scaling only x,y from mm", () => {
    const apt = floorPlanTo3D(
      analysis([room("r1", [[0, 0], [2000, 0], [2000, 2000], [0, 2000]])], [
        { id: "c1", x: 1500, y: 500, width: 0.4, depth: 0.6, shape: "rectangular" },
      ]),
    );
    assert.equal(apt.columns.length, 1);
    const c = apt.columns[0];
    assert.ok(Math.abs(c.x - 1.5) < 1e-9, `x=${c.x}`);
    assert.ok(Math.abs(c.z - -0.5) < 1e-9, `z=${c.z}`);
    assert.ok(Math.abs(c.width - 0.4) < 1e-9, "width already meters");
    assert.ok(Math.abs(c.depth - 0.6) < 1e-9, "depth already meters");
  });

  it("drops degenerate rooms (too few vertices / near-zero area)", () => {
    const good = room("ok", [[0, 0], [2000, 0], [2000, 2000], [0, 2000]]);
    const twoPoint = room("bad1", [[0, 0], [100, 0]]);
    const tiny = room("bad2", [[0, 0], [100, 0], [100, 100], [0, 100]]); // 0.01 m²
    const apt = floorPlanTo3D(analysis([good, twoPoint, tiny]));
    assert.deepEqual(apt.rooms.map((r) => r.id), ["ok"]);
  });

  it("emits ~90° corner angles for a rectangle", () => {
    const apt = floorPlanTo3D(analysis([room("r1", [[0, 0], [2000, 0], [2000, 1000], [0, 1000]])]));
    for (const ang of apt.rooms[0].cornerAnglesDeg) {
      assert.ok(Math.abs(ang - 90) < 1e-6, `corner ${ang}`);
    }
  });

  it("emits an acute (<90°) corner angle for a diagonal notch", () => {
    // A wedge with a sharp corner at the origin.
    const apt = floorPlanTo3D(analysis([room("r1", [[0, 0], [3000, 0], [3000, 1000]])]));
    const angles = apt.rooms[0].cornerAnglesDeg;
    // corner at the far vertex where the diagonal meets the vertical is acute.
    assert.ok(Math.min(...angles) < 90, `has an acute corner: ${angles.join(",")}`);
  });

  it("computes meter bounds across all rooms", () => {
    const apt = floorPlanTo3D(
      analysis([
        room("r1", [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]),
        room("r2", [[1000, 0], [3000, 0], [3000, 1000], [1000, 1000]]),
      ]),
    );
    assert.ok(Math.abs(apt.bounds.minX - 0) < 1e-9);
    assert.ok(Math.abs(apt.bounds.maxX - 3) < 1e-9);
    assert.ok(Math.abs(apt.bounds.minZ - -1) < 1e-9);
    assert.ok(Math.abs(apt.bounds.maxZ - 0) < 1e-9);
  });
});
