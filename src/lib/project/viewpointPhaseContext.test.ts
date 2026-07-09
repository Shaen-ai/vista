import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getViewpointGenerationTargets,
  resolvePhaseBaseImage,
} from "./viewpointPhaseContext";
import { buildSecondaryViewpointPromptParts } from "./secondaryViewpointPromptParts";
import type { DetectedRoom, ProjectState, RoomPhases } from "./types";
import { emptyRoomPhases } from "./types";

function makeRoom(): DetectedRoom {
  return {
    id: "r1",
    name: "Bedroom",
    type: "bedroom",
    estimatedArea: 15,
    dimensions: { width: 4, depth: 5, height: 2.7 },
    windows: [{ position: "south wall center", width: 1.2, height: 1.4, edgeIndex: 0, t: 0.5 }],
    doors: [{ position: "north wall center", width: 0.9, connectsTo: "hall", edgeIndex: 2, t: 0.5 }],
    features: [],
    polygon: [[0, 0], [4000, 0], [4000, 5000], [0, 5000]],
  };
}

function makeState(
  roomId = "r1",
  photos: Array<{ id: string; viewpoint?: { x: number; y: number; angleDeg: number } }> = [],
): ProjectState {
  return {
    id: "proj-1",
    status: "reviewing",
    preferences: { style: "modern", familyMembers: 2, budgetTier: "mid", wishes: "" },
    floorPlanBase64: "",
    floorPlanMimeType: "image/png",
    analysis: { totalArea: 50, ceilingHeight: 2.7, rooms: [makeRoom()], wallSegments: [], overallShape: "rectangular", notes: "" },
    concept: null,
    rooms: [],
    currentRoomIndex: 0,
    technicalDrawings: null,
    wallElevations: null,
    pdfBase64: null,
    error: null,
    createdAt: "",
    updatedAt: "",
    roomPhotos: {},
    uploadedPhotos: photos.map((p) => ({
      id: p.id,
      base64: "base64data",
      mimeType: "image/jpeg",
      label: p.id,
      roomId,
      viewpoint: p.viewpoint,
    })),
    scrapedRoomAllowlists: null,
    pinnedProductIds: [],
    inspirationUploads: [],
    suggestedRoomOrder: [],
    approvedDesignSummaries: {},
    floorPlanConfirmed: true,
    utilityEntryPoints: [],
  };
}

test("getViewpointGenerationTargets returns all photos sorted viewpoint-first", () => {
  const state = makeState("r1", [
    { id: "photo-door", viewpoint: { x: 2000, y: 300, angleDeg: 90 } },
    { id: "photo-window", viewpoint: { x: 2000, y: 4700, angleDeg: 270 } },
    { id: "photo-nomark" },
  ]);

  const targets = getViewpointGenerationTargets(state, "r1");
  assert.equal(targets.length, 3, "Should return all 3 assigned photos");
  assert.equal(targets[0].id, "photo-door");
  assert.equal(targets[1].id, "photo-window");
  assert.equal(targets[2].id, "photo-nomark");
});

test("getViewpointGenerationTargets returns all photos when none have viewpoints", () => {
  const state = makeState("r1", [{ id: "photo-a" }, { id: "photo-b" }]);

  const targets = getViewpointGenerationTargets(state, "r1");
  assert.equal(targets.length, 2, "Both assigned photos are targets");
  assert.equal(targets[0].id, "photo-a");
  assert.equal(targets[1].id, "photo-b");
});

test("getViewpointGenerationTargets returns empty for room with no photos", () => {
  const state = makeState("r1", []);
  const targets = getViewpointGenerationTargets(state, "r1");
  assert.equal(targets.length, 0);
});

test("resolvePhaseBaseImage returns original photo for base phase", () => {
  const photo = { id: "p1", base64: "origdata", mimeType: "image/jpeg", label: "p1" };
  const result = resolvePhaseBaseImage("base", photo, undefined);
  assert.deepEqual(result, { base64: "origdata", mimeType: "image/jpeg" });
});

test("resolvePhaseBaseImage returns null for base phase when photo has no base64", () => {
  // Photo-less fallback target (no assigned room photo) → floor-plan-only render.
  const photo = { id: "nophoto-r1", base64: "", mimeType: "", label: "No photo" };
  const result = resolvePhaseBaseImage("base", photo, undefined);
  assert.equal(result, null);
});

test("resolvePhaseBaseImage returns previous phase render for furniture", () => {
  const photo = { id: "p1", base64: "origdata", mimeType: "image/jpeg", label: "p1" };
  const phases = emptyRoomPhases();
  phases.base.versions.push({
    angleIndex: 0,
    angleDescription: "base v1",
    viewType: "standard",
    base64: "base_render",
    mimeType: "image/png",
  });
  phases.base.selectedIndex = 0;

  const result = resolvePhaseBaseImage("furniture", photo, phases);
  assert.deepEqual(result, { base64: "base_render", mimeType: "image/png" });
});

test("resolvePhaseBaseImage returns furniture render for decor phase", () => {
  const photo = { id: "p1", base64: "origdata", mimeType: "image/jpeg", label: "p1" };
  const phases = emptyRoomPhases();
  phases.base.versions.push({
    angleIndex: 0, angleDescription: "base v1", viewType: "standard",
    base64: "base_render", mimeType: "image/png",
  });
  phases.furniture.versions.push({
    angleIndex: 0, angleDescription: "furn v1", viewType: "standard",
    base64: "furn_render", mimeType: "image/png",
  });
  phases.furniture.selectedIndex = 0;

  const result = resolvePhaseBaseImage("decor", photo, phases);
  assert.deepEqual(result, { base64: "furn_render", mimeType: "image/png" });
});

test("resolvePhaseBaseImage returns null when previous phase has no renders", () => {
  const photo = { id: "p1", base64: "origdata", mimeType: "image/jpeg", label: "p1" };
  const phases = emptyRoomPhases();
  const result = resolvePhaseBaseImage("furniture", photo, phases);
  assert.equal(result, null);
});

test("per-viewpoint opening lock: door-view includes window, window-view excludes it", () => {
  // Bedroom: window on south (edgeIndex 0), door on north (edgeIndex 2), 4×5m
  const state = makeState("r1", [
    { id: "from-door", viewpoint: { x: 2000, y: 4700, angleDeg: 270 } },
    { id: "from-window", viewpoint: { x: 2000, y: 300, angleDeg: 90 } },
  ]);

  const targets = getViewpointGenerationTargets(state, "r1");
  assert.equal(targets.length, 2);

  // Import framing helpers inline for the assertion
  const { resolveViewpointFraming, framingVisibleOpenings } = require("./viewpointFraming");
  const room = state.analysis!.rooms[0];

  // From the door (facing south toward the window): window should be visible
  const framingDoor = resolveViewpointFraming(targets[0].viewpoint!, room);
  const visDoor = framingVisibleOpenings(framingDoor);
  assert.equal(visDoor.windowCount, 1, "Door viewpoint should see the window");
  assert.equal(visDoor.doorCount, 0, "Door viewpoint should NOT see the door (it's behind)");

  // From the window (facing north toward the door): door should be visible
  const framingWin = resolveViewpointFraming(targets[1].viewpoint!, room);
  const visWin = framingVisibleOpenings(framingWin);
  assert.equal(visWin.doorCount, 1, "Window viewpoint should see the door");
  assert.equal(visWin.windowCount, 0, "Window viewpoint should NOT see the window (it's behind)");
});

test("buildSecondaryViewpointPromptParts prefixes camera framing and opening lock", () => {
  const prompt = buildSecondaryViewpointPromptParts({
    framingNote: "camera near east corner, facing west",
    openingLock: "Preserve room geometry. Preserve exactly: 1 door ahead.",
    designPrompt: "Modern bedroom with oak bed.",
  });

  assert.match(prompt, /^CAMERA VIEW \(strict — secondary viewpoint\):/);
  assert.match(prompt, /camera near east corner, facing west/);
  assert.match(prompt, /Modern bedroom with oak bed\./);
  assert.match(prompt, /Do NOT reproduce walls, openings, or composition from the hero/);
});
