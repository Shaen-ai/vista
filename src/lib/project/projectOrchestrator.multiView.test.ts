import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRoomPhases } from "./types";
import type { RoomResult, RoomPhases } from "./types";

/**
 * Unit tests for the per-viewpoint multi-photo flow state logic.
 * These test state shape expectations without calling Gemini.
 */

function makeViewpointPhases(
  photoIds: string[],
  statuses: Array<"pending" | "review" | "approved">,
): Record<string, RoomPhases> {
  const map: Record<string, RoomPhases> = {};
  for (let i = 0; i < photoIds.length; i++) {
    const phases = emptyRoomPhases();
    phases.base.status = statuses[i] ?? "pending";
    if (statuses[i] !== "pending") {
      phases.base.versions.push({
        angleIndex: 0,
        angleDescription: `View ${i + 1}`,
        viewType: "standard",
        base64: `fake-base64-${i}`,
        mimeType: "image/png",
      });
      phases.base.selectedIndex = 0;
    }
    map[photoIds[i]!] = phases;
  }
  return map;
}

function makeRoom(opts: {
  viewpointPhases: Record<string, RoomPhases>;
  viewpointTargetCount: number;
  gallerySyncComplete?: boolean;
}): RoomResult {
  return {
    roomId: "r1",
    status: "review",
    brief: { roomId: "r1", roomName: "Bedroom", roomType: "bedroom", wallColor: { hex: "#ffffff", ncs: "S 0500-N" }, floorMaterial: "wood", ceilingDesign: "flat", lightingConcept: "recessed", furnitureList: [], keyDesignElements: [], renderAngles: [], specialNotes: "" },
    renders: [],
    materials: null,
    editHistory: [],
    version: 1,
    usedScrapedProducts: [],
    phases: emptyRoomPhases(),
    viewpointPhases: opts.viewpointPhases,
    viewpointTargetCount: opts.viewpointTargetCount,
    gallerySyncComplete: opts.gallerySyncComplete ?? false,
    viewpointErrors: {},
    photoRenderMap: {},
  };
}

test("viewpointPhases tracks per-photo status independently", () => {
  const vp = makeViewpointPhases(
    ["photo-1", "photo-2", "photo-3"],
    ["approved", "review", "pending"],
  );
  assert.equal(vp["photo-1"]!.base.status, "approved");
  assert.equal(vp["photo-2"]!.base.status, "review");
  assert.equal(vp["photo-3"]!.base.status, "pending");
});

test("approve gate: all previous viewpoints must be approved", () => {
  const photoIds = ["photo-1", "photo-2", "photo-3"];
  const vp = makeViewpointPhases(photoIds, ["approved", "review", "pending"]);

  // photo-2 is in review — photo-3 should be gated.
  const activeIdx = 2; // photo-3
  const previousApproved = photoIds.slice(0, activeIdx).every(
    (pid) => vp[pid]!.base.status === "approved",
  );
  assert.equal(previousApproved, false, "photo-3 should be gated because photo-2 is not approved");
});

test("approve gate passes when all prior viewpoints approved", () => {
  const photoIds = ["photo-1", "photo-2", "photo-3"];
  const vp = makeViewpointPhases(photoIds, ["approved", "approved", "pending"]);

  const activeIdx = 2;
  const previousApproved = photoIds.slice(0, activeIdx).every(
    (pid) => vp[pid]!.base.status === "approved",
  );
  assert.equal(previousApproved, true, "photo-3 should be unlocked");
});

test("all viewpoints approved detection", () => {
  const photoIds = ["photo-1", "photo-2", "photo-3"];
  const vpAllApproved = makeViewpointPhases(photoIds, ["approved", "approved", "approved"]);
  const vpPartial = makeViewpointPhases(photoIds, ["approved", "approved", "review"]);

  const allDone = (vp: Record<string, RoomPhases>) =>
    photoIds.every((pid) => vp[pid]!.base.status === "approved");

  assert.equal(allDone(vpAllApproved), true);
  assert.equal(allDone(vpPartial), false);
});

test("gallerySyncComplete flag on room", () => {
  const room = makeRoom({
    viewpointPhases: makeViewpointPhases(["p1", "p2"], ["approved", "approved"]),
    viewpointTargetCount: 2,
    gallerySyncComplete: false,
  });
  assert.equal(room.gallerySyncComplete, false);
  room.gallerySyncComplete = true;
  assert.equal(room.gallerySyncComplete, true);
});

test("viewpointPhases stores versions per photo", () => {
  const vp = makeViewpointPhases(["p1", "p2", "p3", "p4", "p5"], ["review", "review", "review", "review", "review"]);
  assert.equal(Object.keys(vp).length, 5);
  for (const pid of Object.keys(vp)) {
    assert.equal(vp[pid]!.base.versions.length, 1);
    assert.ok(vp[pid]!.base.versions[0]!.base64.startsWith("fake-base64"));
  }
});
