import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatOpeningLockParts } from "./stagingOpeningLockFormat";
import { prepFingerprint, shellFingerprint } from "./stagingCacheFingerprint";
import type { RoomFinishLock } from "./types";

describe("formatOpeningLockParts", () => {
  it("does not double-append wall when position already contains wall", () => {
    const out = formatOpeningLockParts(1, ["far/back wall"], "door");
    assert.equal(out, "1 door on far/back wall");
    assert.doesNotMatch(out, /wall wall/);
  });

  it("appends wall when position is a bare side label", () => {
    const out = formatOpeningLockParts(1, ["west"], "door");
    assert.equal(out, "1 door on west wall");
  });
});

describe("staging cache fingerprints", () => {
  const finish: RoomFinishLock = {
    floorMaterial: "oak",
    ceilingDesign: "white",
    wallColor: "beige",
    lightingConcept: "warm",
  };

  it("prep fingerprint changes when mask or boxes change", () => {
    const base = prepFingerprint({});
    const withMask = prepFingerprint({ objectRemovalMask: { base64: "abc" } });
    const withBox = prepFingerprint({
      openingAnalysis: { door_boxes: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] },
    });
    assert.notEqual(base, withMask);
    assert.notEqual(withMask, withBox);
  });

  it("shell fingerprint changes when finishLock changes", () => {
    const photo = { objectRemovalMask: { base64: "m" } };
    const a = shellFingerprint(photo, finish);
    const b = shellFingerprint(photo, { ...finish, wallColor: "grey" });
    assert.notEqual(a, b);
  });
});
