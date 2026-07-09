import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeDesignPromptForViewpoint } from "./falPipelinePrompt";
import { buildKontextStage2Prompt, buildStage2bKontextPrompt } from "./falKontextPrompt";
import type { RoomAnalysis } from "./interiorDesignPrompts";

const lockAnalysis: RoomAnalysis = {
  room_type: "bedroom",
  room_shape: "irregular",
  estimated_dimensions: { width: 5.74, depth: 2.66, height: 2.7 },
  existing_furniture: [],
  architectural_features: [],
  lighting_sources: [],
  current_style: "",
  color_palette: [],
  suggestions: [],
  window_count: 1,
  door_count: 0,
  window_positions: ["center wall (1.1m × 1.4m)"],
  door_positions: [],
  plan_door_count: 1,
  plan_door_positions: ["left wall off-center (0.85m → exterior)"],
  camera_angle: "facing east",
  ceiling_type: "",
  structural_elements: [],
  has_staircase: false,
  staircase_description: null,
  has_floor_opening: false,
  floor_opening_description: null,
  confidence: {
    room_type: "high",
    dimensions: "medium",
    style: "low",
    window_count: "high",
    door_count: "high",
  },
};

test("sanitizeDesignPromptForViewpoint replaces plan door line when lockDoorCount is 0", () => {
  const prompt =
    "### GUARDRAILS\n- Existing Wall Openings — Doors: 1: wall H-A at t=0.72\n- Existing Wall Openings — Windows: 1: wall B-C";
  const out = sanitizeDesignPromptForViewpoint(prompt, lockAnalysis);
  assert.match(out, /Doors: none on this viewpoint/);
  assert.doesNotMatch(out, /wall H-A/);
});

test("buildKontextStage2Prompt primary puts design overlay first", () => {
  const overlay = "Furnish with queen bed and wardrobe.";
  const prompt = buildKontextStage2Prompt({
    designOverlay: overlay,
    mode: "primary",
  });
  assert.ok(prompt.startsWith(overlay));
  assert.match(prompt, /Furnish completely/);
  assert.doesNotMatch(prompt, /WINDOWS:/);
});

test("buildKontextStage2Prompt retry keeps design overlay when reusing primary output", () => {
  const overlay = "FURNITURE (5 pieces):\n  1. queen bed";
  const prompt = buildKontextStage2Prompt({
    designOverlay: overlay,
    mode: "retry",
    retryOpeningLock: "WINDOWS: 1 on far wall",
    retryUsesPrimaryOutput: true,
  });
  assert.match(prompt, /queen bed/);
  assert.match(prompt, /WINDOWS:/);
  assert.match(prompt, /Keep furniture already visible/);
  assert.match(prompt, /Furnish completely per the design above/);
});

test("buildStage2bKontextPrompt includes compact opening lock and overlay", () => {
  const overlay = "FURNITURE (5 pieces):\n  1. queen bed";
  const prompt = buildStage2bKontextPrompt({
    designOverlay: overlay,
    lockAnalysis,
  });
  assert.match(prompt, /queen bed/);
  assert.match(prompt, /window/i);
  assert.match(prompt, /Furnish completely/);
});

test("buildKontextStage2Prompt retry re-furnishes empty stage-1 shell", () => {
  const overlay = "FURNITURE (5 pieces):\n  1. queen bed";
  const prompt = buildKontextStage2Prompt({
    designOverlay: overlay,
    mode: "retry",
    retryOpeningLock: "WINDOWS: 1 on far wall",
    retryUsesPrimaryOutput: false,
  });
  assert.match(prompt, /queen bed/);
  assert.match(prompt, /WINDOWS:/);
  assert.match(prompt, /Furnish completely per the design above/);
});
