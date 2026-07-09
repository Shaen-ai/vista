import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCurtainPolicyLines,
  buildWallPlacementLockLines,
  buildDoorWallPlacementLockLines,
  parseWindowWallLabel,
} from "./windowWallPlacement";

describe("parseWindowWallLabel", () => {
  it("classifies left wall even when position mentions back-left corner", () => {
    assert.equal(
      parseWindowWallLabel("left wall, near back-left corner, tall narrow window"),
      "left",
    );
  });

  it("classifies back wall from first segment", () => {
    assert.equal(parseWindowWallLabel("back wall, left of center"), "back");
    assert.equal(parseWindowWallLabel("far wall, right of center"), "back");
  });

  it("classifies right wall from first segment", () => {
    assert.equal(
      parseWindowWallLabel("right wall (curtain wall), left pane — floor-to-ceiling glass panel"),
      "right",
    );
  });

  it("classifies left recess wall as left", () => {
    assert.equal(
      parseWindowWallLabel(
        "left recess wall, first floor-to-ceiling panel (behind foreground pier)",
      ),
      "left",
    );
  });
});

describe("buildWallPlacementLockLines", () => {
  const sideWallPositions = [
    "left wall, near back-left corner, tall narrow window (first from back)",
    "left wall, center-left, tall narrow window (second from back)",
    "right wall (curtain wall), left pane — floor-to-ceiling glass panel",
    "right wall (curtain wall), center pane — floor-to-ceiling glass panel",
    "right wall (curtain wall), right pane — floor-to-ceiling glass panel",
  ];

  it("marks back wall as none for side-wall-only rooms", () => {
    const lines = buildWallPlacementLockLines(sideWallPositions);
    const text = lines.join("\n");
    assert.match(text, /BACK\/FAR WALL: Solid, unbroken wall/);
    assert.doesNotMatch(text, /BACK\/FAR WALL \(1 opening/);
    assert.doesNotMatch(text, /BACK\/FAR WALL: 1 opening/);
  });

  it("groups left and right wall openings with counts", () => {
    const lines = buildWallPlacementLockLines(sideWallPositions);
    const text = lines.join("\n");
    assert.match(text, /LEFT WALL: 2 opening/);
    assert.match(text, /RIGHT WALL: 3 opening/);
    assert.match(text, /Side-wall windows remain on their original side walls/);
  });

  it("adds back-wall finish note only when back wall has windows", () => {
    const backOnly = ["back wall, left of center, tall window"];
    const text = buildWallPlacementLockLines(backOnly).join("\n");
    assert.match(text, /BACK\/FAR WALL: 1 opening/);
    assert.match(text, /finish note: decorative slats/);
  });

  it("adds left recess note when recess window labels are present", () => {
    const recessPositions = [
      "left recess wall, first floor-to-ceiling panel (behind foreground pier)",
      "left recess wall, second panel (near back-wall corner)",
      "right wall (curtain wall), center pane",
    ];
    const text = buildWallPlacementLockLines(recessPositions).join("\n");
    assert.match(text, /LEFT RECESS: windows sit on the recess/);
  });
});

describe("buildCurtainPolicyLines", () => {
  it("emits omit-all when windowCount is 0", () => {
    const lines = buildCurtainPolicyLines([], 0);
    const text = lines.join("\n");
    assert.match(text, /0 window openings/);
    assert.match(text, /omit all window treatments/);
  });

  it("forbids curtains on solid back wall when windows are on side walls only", () => {
    const positions = [
      "left wall, near back-left corner, tall narrow window",
      "right wall (curtain wall), center pane — floor-to-ceiling glass panel",
    ];
    const text = buildCurtainPolicyLines(positions, 2).join("\n");
    assert.match(text, /CURTAIN POLICY/);
    assert.match(text, /BACK\/FAR WALL: 0 openings.*no curtain fabric/);
    assert.match(text, /LEFT WALL: 1 opening.*curtains at these openings only/);
    assert.match(text, /RIGHT WALL: 1 opening.*curtains at these openings only/);
  });

  it("uses photo-grounded fallback when all positions parse as unknown", () => {
    const positions = ["some weird label that won't parse", "another one"];
    const lines = buildCurtainPolicyLines(positions, 2);
    const text = lines.join("\n");
    assert.match(text, /CURTAIN POLICY/);
    assert.match(text, /reference photo is authoritative/);
    assert.match(text, /Dress exactly 2 opening/);
    assert.doesNotMatch(text, /BACK\/FAR WALL/);
  });

  it("allows curtains on recess wall when recess positions are present", () => {
    const positions = [
      "left recess wall, first floor-to-ceiling panel (behind foreground pier)",
      "left recess wall, second panel (near back-wall corner)",
    ];
    const text = buildCurtainPolicyLines(positions, 2).join("\n");
    assert.match(text, /LEFT WALL: 2 opening.*curtains at these openings only/);
    assert.match(text, /BACK\/FAR WALL: 0 openings.*no curtain fabric/);
  });

  it("marks FRONT WALL with 'if visible in frame' suffix", () => {
    const positions = ["back wall, center, large window"];
    const text = buildCurtainPolicyLines(positions, 1).join("\n");
    assert.match(text, /FRONT WALL: 0 openings.*if visible in frame/);
  });
});

describe("parseWindowWallLabel — broadened phrasings", () => {
  it("recognizes 'rear wall' and 'facing wall' as back", () => {
    assert.equal(parseWindowWallLabel("rear wall, center"), "back");
    assert.equal(parseWindowWallLabel("facing wall, near left"), "back");
  });

  it("recognizes 'wall on the left' / 'left-hand wall'", () => {
    assert.equal(parseWindowWallLabel("wall on the left, mid"), "left");
    assert.equal(parseWindowWallLabel("left-hand wall, by the corner"), "left");
    assert.equal(parseWindowWallLabel("wall to the right"), "right");
  });

  it("stays 'unknown' for a bare compass label with no camera map", () => {
    assert.equal(parseWindowWallLabel("south wall left"), "unknown");
  });

  it("resolves a compass label to camera-relative when a map is supplied", () => {
    const map = { south: "back", west: "left", east: "right" } as const;
    assert.equal(parseWindowWallLabel("south wall left", map), "back");
    assert.equal(parseWindowWallLabel("west wall, near corner", map), "left");
    assert.equal(parseWindowWallLabel("north wall", map), "unknown"); // not in map
  });
});

describe("buildDoorWallPlacementLockLines", () => {
  it("locks doors to their walls and marks door-free walls solid", () => {
    const text = buildDoorWallPlacementLockLines(["right wall, near bottom"]).join("\n");
    assert.match(text, /RIGHT WALL: 1 door\/passage opening/);
    assert.match(text, /BACK\/FAR WALL: No door or passage/);
    assert.match(text, /LEFT WALL: No door or passage/);
  });

  it("returns nothing when no positions parse to a known wall", () => {
    assert.deepEqual(buildDoorWallPlacementLockLines(["somewhere"]), []);
    assert.deepEqual(buildDoorWallPlacementLockLines([]), []);
  });
});
