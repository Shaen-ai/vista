import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffWalls, wallsMatch } from "./wallDiff";
import type { WallSegment } from "./types";

function w(x1: number, y1: number, x2: number, y2: number): WallSegment {
  return { x1, y1, x2, y2, thickness: 120, lengthMm: Math.round(Math.hypot(x2 - x1, y2 - y1)) };
}

describe("wallDiff", () => {
  it("identical geometry with sub-tolerance jitter → zero demolish/build", () => {
    const original = [w(0, 0, 3000, 0), w(3000, 0, 3000, 2000), w(0, 0, 0, 2000)];
    const proposed = [
      w(20, -15, 3010, 25), // ~<50mm jitter on endpoints
      w(2990, 10, 3020, 1990),
      w(-30, 5, 12, 2010),
    ];
    const d = diffWalls(original, proposed);
    assert.equal(d.demolished.length, 0);
    assert.equal(d.built.length, 0);
    assert.equal(d.unchanged.length, 3);
    assert.ok(d.noChanges);
  });

  it("matches segments regardless of endpoint direction", () => {
    assert.ok(wallsMatch(w(0, 0, 3000, 0), w(3000, 0, 0, 0)));
  });

  it("flags a removed wall as demolished", () => {
    const original = [w(0, 0, 3000, 0), w(1500, 0, 1500, 2000)]; // a partition
    const proposed = [w(0, 0, 3000, 0)]; // partition removed
    const d = diffWalls(original, proposed);
    assert.equal(d.demolished.length, 1);
    assert.equal(d.built.length, 0);
    assert.ok(!d.noChanges);
  });

  it("flags a new wall as built", () => {
    const original = [w(0, 0, 3000, 0)];
    const proposed = [w(0, 0, 3000, 0), w(1500, 0, 1500, 2000)]; // new partition
    const d = diffWalls(original, proposed);
    assert.equal(d.built.length, 1);
    assert.equal(d.demolished.length, 0);
    assert.ok(!d.noChanges);
  });

  it("does not match a beyond-tolerance shifted wall (treated as demolish + build)", () => {
    const original = [w(0, 0, 3000, 0)];
    const proposed = [w(0, 500, 3000, 500)]; // shifted 500mm — a real change
    const d = diffWalls(original, proposed);
    assert.equal(d.built.length, 1);
    assert.equal(d.demolished.length, 1);
  });

  it("does not double-match one original to two proposed segments", () => {
    const original = [w(0, 0, 3000, 0)];
    const proposed = [w(0, 0, 3000, 0), w(5, 5, 3005, 5)];
    const d = diffWalls(original, proposed);
    assert.equal(d.unchanged.length, 1);
    assert.equal(d.built.length, 1); // the second proposed can't reuse the matched original
  });
});
