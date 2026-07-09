import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultViewpointForRoom } from "./defaultViewpoint";
import { pointInPolygon, polygonCentroid, type Point } from "./floorPlanGeometry";

// 4m × 3m rectangle, mm, Y-up, origin at bottom-left.
const rect: Point[] = [
  [0, 0],
  [4000, 0],
  [4000, 3000],
  [0, 3000],
];

describe("defaultViewpointForRoom", () => {
  it("places the camera inside the polygon, facing the centroid", () => {
    const vp = defaultViewpointForRoom({ polygon: rect }, 0);
    assert.ok(vp);
    assert.ok(pointInPolygon([vp.x, vp.y], rect), "camera must be inside the room");

    const [cx, cy] = polygonCentroid(rect);
    const toCentroid =
      ((Math.atan2(cy - vp.y, cx - vp.x) * 180) / Math.PI + 360) % 360;
    const diff = Math.abs(((vp.angleDeg - toCentroid + 540) % 360) - 180);
    assert.ok(diff < 5, `angle ${vp.angleDeg} should face the centroid (${toCentroid})`);
  });

  it("gives successive photos in the same room distinct cameras", () => {
    const a = defaultViewpointForRoom({ polygon: rect }, 0);
    const b = defaultViewpointForRoom({ polygon: rect }, 1);
    assert.ok(a && b);
    assert.notDeepEqual([a.x, a.y], [b.x, b.y]);
  });

  it("prefers the longest wall for the first photo", () => {
    const vp = defaultViewpointForRoom({ polygon: rect }, 0);
    assert.ok(vp);
    // Longest walls are the 4m horizontal ones → camera inset 500mm from y=0 or y=3000.
    assert.equal(vp.x, 2000);
    assert.ok(vp.y === 500 || vp.y === 2500);
  });

  it("returns null without a usable polygon", () => {
    assert.equal(defaultViewpointForRoom({ polygon: undefined }, 0), null);
    assert.equal(defaultViewpointForRoom({ polygon: [[0, 0], [1000, 0]] as Point[] }, 0), null);
  });

  it("skips walls too short to host a camera", () => {
    // 4m × 0.8m sliver: the 0.8m end walls are below the 1m minimum.
    const sliver: Point[] = [
      [0, 0],
      [4000, 0],
      [4000, 800],
      [0, 800],
    ];
    for (const i of [0, 1, 2, 3]) {
      const vp = defaultViewpointForRoom({ polygon: sliver }, i);
      assert.ok(vp);
      assert.ok(pointInPolygon([vp.x, vp.y], sliver));
      // Only the two long walls qualify → camera always at x midpoint.
      assert.equal(vp.x, 2000);
    }
  });
});
