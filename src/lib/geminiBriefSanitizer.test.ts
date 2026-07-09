import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  geometryForGeminiPrompt,
  hasAuthoritativeAnalysisOpenings,
  sanitizeDesignBriefForGemini,
} from "./geminiBriefSanitizer";
import type { DesignBrief } from "./interiorDesignPrompts";
import type { RoomAnalysis } from "./interiorDesignPrompts";
import type { RoomGeometry } from "./roomGeometryTypes";

const sampleBrief: DesignBrief = {
  subject: "Warm oak flooring and floor-to-ceiling windows on the back wall",
  arrangement: "Sofa facing three large windows on the left wall",
  context: "Soft afternoon light through panoramic view",
  composition: "Reference photo determines angle",
  style: "Scandinavian calm",
  fullPrompt:
    "Redesign this room's interior: add expansive windows along the far wall with city view",
  roomType: "living room",
  cameraAngle: "corner view",
  designIntent: "",
  requiredSlots: [],
  constraints: {},
  selectedCatalogIds: [],
  productIntents: [],
  productDescriptions: [],
};

const sampleAnalysis: RoomAnalysis = {
  room_type: "living room",
  room_shape: "rectangular",
  estimated_dimensions: { width: 4, depth: 5, height: 2.7 },
  existing_furniture: [],
  architectural_features: [],
  lighting_sources: [],
  current_style: "modern",
  color_palette: [],
  suggestions: [],
  window_count: 2,
  door_count: 1,
  window_positions: ["back wall, left of center", "back wall, right of center"],
  door_positions: ["right wall, near corner"],
  camera_angle: "corner view from front-right",
  ceiling_type: "flat",
  structural_elements: [],
  has_staircase: false,
  staircase_description: null,
  has_floor_opening: false,
  floor_opening_description: null,
};

const sampleGeometry: RoomGeometry = {
  room_shape: "rectangle",
  approximate_dimensions: { longest_wall_m: 5, shortest_wall_m: 4 },
  walls: [{ id: "W1", position: "north", approx_length_m: 5 }],
  doors: [{ wall_id: "W2", approx_offset_from_left_m: 0.5, width_m: 0.9 }],
  windows: [{ wall_id: "W1", approx_offset_from_left_m: 1, width_m: 1.2, height_m: 1.5 }],
  fixed_elements: [],
  ceiling_height_m: 2.7,
  confidence: "high",
};

describe("sanitizeDesignBriefForGemini", () => {
  it("strips architectural leakage from brief fields", () => {
    const cleaned = sanitizeDesignBriefForGemini(sampleBrief);
    assert.doesNotMatch(cleaned.subject, /floor-to-ceiling/i);
    assert.doesNotMatch(cleaned.arrangement, /windows on the left wall/i);
    assert.doesNotMatch(cleaned.context, /panoramic view/i);
    assert.doesNotMatch(cleaned.fullPrompt, /expansive windows/i);
    assert.match(cleaned.subject, /Warm oak flooring/i);
  });

  it("strips curtain language when window_count is 0", () => {
    const briefWithCurtains: DesignBrief = {
      ...sampleBrief,
      subject: "Warm linen curtains and oak flooring",
      fullPrompt: "Add sheer drapes on the back wall with velvet blinds",
    };
    const noWindowAnalysis = { ...sampleAnalysis, window_count: 0, window_positions: [] };
    const cleaned = sanitizeDesignBriefForGemini(briefWithCurtains, noWindowAnalysis);
    assert.doesNotMatch(cleaned.subject, /curtains/i);
    assert.doesNotMatch(cleaned.fullPrompt, /drapes/i);
    assert.doesNotMatch(cleaned.fullPrompt, /blinds/i);
    assert.match(cleaned.subject, /oak flooring/i);
  });

  it("keeps curtain language when windows exist", () => {
    const briefWithCurtains: DesignBrief = {
      ...sampleBrief,
      subject: "Warm linen curtains and oak flooring",
    };
    const cleaned = sanitizeDesignBriefForGemini(briefWithCurtains, sampleAnalysis);
    assert.match(cleaned.subject, /curtains/i);
  });

  it("strips plaid and tartan textile references from brief fields", () => {
    const briefWithPlaid: DesignBrief = {
      ...sampleBrief,
      subject: "Oak flooring with a cozy plaid throw on the sofa",
      style: "Warm tartan accent textiles",
      fullPrompt: "Add a checkered throw blanket and plaid cushions on the bed",
    };
    const cleaned = sanitizeDesignBriefForGemini(briefWithPlaid);
    assert.doesNotMatch(cleaned.subject, /plaid/i);
    assert.doesNotMatch(cleaned.style, /tartan/i);
    assert.doesNotMatch(cleaned.fullPrompt, /checkered throw/i);
    assert.doesNotMatch(cleaned.fullPrompt, /plaid/i);
    assert.match(cleaned.subject, /Oak flooring/i);
  });

  it("strips indirect throw and blanket phrases without plaid keyword", () => {
    const briefWithThrows: DesignBrief = {
      ...sampleBrief,
      subject: "Oak flooring with a cozy knitted throw on the sofa",
      arrangement: "Soft woven blanket draped across the bed",
      fullPrompt: "Add accent throw over the armchair and knitted blankets on seating",
    };
    const cleaned = sanitizeDesignBriefForGemini(briefWithThrows);
    assert.doesNotMatch(cleaned.subject, /throw/i);
    assert.doesNotMatch(cleaned.arrangement, /blanket/i);
    assert.doesNotMatch(cleaned.fullPrompt, /throw/i);
    assert.doesNotMatch(cleaned.fullPrompt, /blanket/i);
    assert.match(cleaned.subject, /Oak flooring/i);
  });

  it("locks composition and clears context when keepRoomShape is true", () => {
    const cleaned = sanitizeDesignBriefForGemini(sampleBrief, sampleAnalysis, {
      keepRoomShape: true,
    });
    assert.equal(cleaned.context, "");
    assert.match(cleaned.composition, /Preserve exact camera angle/i);
  });
});

describe("geometryForGeminiPrompt", () => {
  it("omits windows and doors when room analysis has opening positions", () => {
    const geom = geometryForGeminiPrompt(sampleGeometry, sampleAnalysis);
    assert.equal(geom.windows?.length ?? 0, 0);
    assert.equal(geom.doors?.length ?? 0, 0);
    assert.equal(geom.walls.length, sampleGeometry.walls.length);
  });

  it("keeps geometry openings when analysis has no positions", () => {
    const geom = geometryForGeminiPrompt(sampleGeometry, {
      ...sampleAnalysis,
      window_positions: [],
      door_positions: [],
    });
    assert.equal(geom.windows?.length, 1);
    assert.equal(geom.doors?.length, 1);
  });
});

describe("hasAuthoritativeAnalysisOpenings", () => {
  it("returns true when window positions are populated", () => {
    assert.equal(hasAuthoritativeAnalysisOpenings(sampleAnalysis), true);
  });
});
