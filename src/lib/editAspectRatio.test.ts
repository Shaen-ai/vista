import { test } from "node:test";
import assert from "node:assert/strict";
import { isOrientationFlip, nearestEditAspectRatio } from "./editAspectRatio";

test("nearestEditAspectRatio maps a landscape room photo to a landscape ratio", () => {
  // The user-reported failure case: 1259×783 (~1.61) source photo.
  assert.equal(nearestEditAspectRatio(1259, 783), "3:2");
  assert.equal(nearestEditAspectRatio(1920, 1080), "16:9");
  assert.equal(nearestEditAspectRatio(4000, 3000), "4:3");
});

test("nearestEditAspectRatio maps portrait and square sources", () => {
  assert.equal(nearestEditAspectRatio(1080, 1920), "9:16");
  assert.equal(nearestEditAspectRatio(1500, 2000), "3:4");
  assert.equal(nearestEditAspectRatio(1000, 1000), "1:1");
});

test("nearestEditAspectRatio rejects unusable dimensions", () => {
  assert.equal(nearestEditAspectRatio(0, 1000), undefined);
  assert.equal(nearestEditAspectRatio(1000, 0), undefined);
  assert.equal(nearestEditAspectRatio(-5, 10), undefined);
});

test("isOrientationFlip flags landscape source vs portrait output", () => {
  // The prod failure: landscape photo rendered as 1792×2400 portrait.
  assert.equal(isOrientationFlip(1259, 783, 1792, 2400), true);
  assert.equal(isOrientationFlip(1500, 2000, 2048, 1152), true);
});

test("isOrientationFlip passes same-orientation and near-square frames", () => {
  assert.equal(isOrientationFlip(1259, 783, 2048, 1152), false);
  assert.equal(isOrientationFlip(1500, 2000, 1792, 2400), false);
  // Near-square source or output never flags (within 5% of 1:1).
  assert.equal(isOrientationFlip(1000, 1020, 1792, 2400), false);
  assert.equal(isOrientationFlip(1259, 783, 1024, 1000), false);
});

test("isOrientationFlip skips when a dimension is unknown", () => {
  assert.equal(isOrientationFlip(0, 0, 1792, 2400), false);
  assert.equal(isOrientationFlip(1259, 783, 0, 0), false);
});
