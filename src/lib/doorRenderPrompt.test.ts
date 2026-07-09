import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFalRedesignPrompt } from "./falPipelinePrompt";
import { buildDoorDesignPromptBlock, DOOR_CLEARANCE_DIRECTIVE } from "./doorRenderPrompt";
import type { RoomAnalysis } from "./interiorDesignPrompts";

const roomAnalysis: RoomAnalysis = {
  room_type: "bedroom",
  room_shape: "rectangular",
  estimated_dimensions: { width: 4, depth: 3.5, height: 2.7 },
  existing_furniture: [],
  architectural_features: [],
  lighting_sources: [],
  current_style: "minimal",
  color_palette: [],
  suggestions: [],
  window_count: 0,
  door_count: 1,
  window_positions: [],
  door_positions: ["right wall near corner"],
  camera_angle: "from entrance",
  ceiling_type: "flat",
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

test("buildDoorDesignPromptBlock uses Claude concept when provided", () => {
  const block = buildDoorDesignPromptBlock("Light oak flush door with brushed brass handle");
  assert.match(block, /Light oak flush door/);
  assert.match(block, /DOOR FINISH/);
  assert.match(block, /dark empty openings/i);
});

test("buildFalRedesignPrompt includes compact opening lock, door design, and clearance", () => {
  const prompt = buildFalRedesignPrompt({
    designPrompt: "Redesign this room's interior with Scandinavian kids furniture.",
    styleId: "scandinavian",
    roomAnalysis,
    doorDesign: "Painted white shaker door with matte black knob",
  });
  assert.match(prompt, /OPENING COUNT LOCK/);
  assert.match(prompt, /DOORS \/ PASSAGES/);
  assert.match(prompt, /right wall near corner/i);
  assert.match(prompt, /Painted white shaker door/);
  assert.match(prompt, /DOOR FINISH/);
  assert.match(prompt, new RegExp(DOOR_CLEARANCE_DIRECTIVE.slice(0, 40)));
});
