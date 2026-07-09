import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RoomAnalysis } from "./interiorDesignPrompts";
import {
  analyzeColumnInjectionSources,
  buildNoColumnHallucinationDirective,
  buildStructuralGeometryLock,
  detectAsymmetricLeftGeometry,
  hasPlanConfirmedColumn,
  isPlanSpeculativeColumnFeature,
} from "./structuralGeometryLock";

function sampleRecessRoomAnalysis(): RoomAnalysis {
  return {
    room_type: "living room",
    room_shape: "L-shape",
    estimated_dimensions: { width: 7, depth: 5, height: 2.8 },
    existing_furniture: [],
    architectural_features: [
      "recessed alcove on left behind foreground pier",
      "3-pane floor-to-ceiling curtain wall on right",
    ],
    lighting_sources: ["recessed spotlights in lower soffit above left recess"],
    current_style: "modern",
    color_palette: ["#808080"],
    suggestions: [],
    window_count: 5,
    door_count: 0,
    window_positions: [
      "left recess wall, first floor-to-ceiling panel (behind foreground pier)",
      "left recess wall, second panel (near back-wall corner)",
      "right wall (curtain wall), left pane — floor-to-ceiling glass panel",
      "right wall (curtain wall), center pane — floor-to-ceiling glass panel",
      "right wall (curtain wall), right pane — floor-to-ceiling glass panel",
    ],
    door_positions: [],
    camera_angle: "corner view from front-right, looking at back wall and right curtain wall",
    ceiling_type: "flat",
    structural_elements: [
      "white foreground pier on far left",
      "recessed alcove behind pier on left",
      "lower soffit with spotlights above left recess windows",
    ],
    has_staircase: false,
    staircase_description: null,
    has_floor_opening: false,
    floor_opening_description: null,
  };
}

describe("isPlanSpeculativeColumnFeature", () => {
  it("flags plan mislabels of wall jogs as columns", () => {
    assert.equal(
      isPlanSpeculativeColumnFeature(
        "structural/utility shaft or column protruding at southeast edge",
      ),
      true,
    );
    assert.equal(isPlanSpeculativeColumnFeature("white foreground pier on far left"), false);
  });
});

describe("detectAsymmetricLeftGeometry", () => {
  it("detects L-shape and recess cues", () => {
    assert.equal(detectAsymmetricLeftGeometry(sampleRecessRoomAnalysis()), true);
  });

  it("returns false for plain rectangular room", () => {
    const plain: RoomAnalysis = {
      ...sampleRecessRoomAnalysis(),
      room_shape: "rectangular",
      structural_elements: [],
      architectural_features: [],
      lighting_sources: ["natural light from window"],
      window_positions: ["back wall, center"],
    };
    assert.equal(detectAsymmetricLeftGeometry(plain), false);
  });

  it("does not trigger on irregular shape alone (8-corner wall jog)", () => {
    const irregularJog: RoomAnalysis = {
      ...sampleRecessRoomAnalysis(),
      room_shape: "irregular",
      structural_elements: [],
      architectural_features: [],
      lighting_sources: [],
      window_positions: ["far/back wall"],
    };
    assert.equal(detectAsymmetricLeftGeometry(irregularJog), false);
  });

  it("does not trigger on speculative plan column-at-corner feature", () => {
    const mislabeled: RoomAnalysis = {
      ...sampleRecessRoomAnalysis(),
      room_shape: "irregular",
      window_count: 1,
      window_positions: ["far/back wall"],
      architectural_features: ["structural/service shaft or column cut-out at south-east edge"],
      structural_elements: [],
      lighting_sources: [],
    };
    assert.equal(detectAsymmetricLeftGeometry(mislabeled), false);
  });
});

describe("analyzeColumnInjectionSources", () => {
  it("detects concept column language and speculative plan features", () => {
    const report = analyzeColumnInjectionSources(
      {
        ...sampleRecessRoomAnalysis(),
        room_shape: "irregular",
        structural_elements: [],
        architectural_features: ["structural shaft or column protruding at southeast edge"],
        lighting_sources: [],
        window_positions: ["far/back wall"],
      },
      "Lock geometry: bedroom with a small notch/column at the south-east corner.",
    );
    assert.equal(report.roomShapeIrregular, true);
    assert.equal(report.speculativePlanFeatures.length, 1);
    assert.equal(report.conceptMentionsColumn, true);
    assert.equal(report.confirmedPierOrColumn, false);
    assert.equal(report.triggersGeometryLock, false);
  });
});

describe("buildStructuralGeometryLock", () => {
  it("preserves pier/recess/soffit geometry without asserting any openings", () => {
    const text = buildStructuralGeometryLock(sampleRecessRoomAnalysis());
    assert.match(text, /STRUCTURAL GEOMETRY LOCK/);
    assert.match(text, /LEFT FOREGROUND:.*foreground pier/i);
    assert.match(text, /LEFT RECESS:/);
    assert.match(text, /CEILING:.*soffit/i);
    assert.match(text, /ARCHITECTURAL \(must preserve\)/);
    assert.match(text, /Left side retains its stepped asymmetric geometry/);
    assert.match(text, /The foreground pier remains visible and intact/);
    assert.match(text, /do NOT clad it into the wall plane, box it inside a wardrobe/i);
    assert.match(text, /dropped beam\/soffit.*MUST be kept/i);
    assert.doesNotMatch(text, /floor-to-ceiling window panel/i);
    assert.doesNotMatch(text, /window panel\(s\) on recess wall/i);
    assert.doesNotMatch(text, /RIGHT WALL: \d+ opening/);
    assert.doesNotMatch(text, /BACK WALL: Continuous solid surface/);
    assert.doesNotMatch(text, /Left recess windows stay on the recessed alcove wall/);
  });

  it("does not fire for irregular polygon with only a speculative corner column feature", () => {
    const text = buildStructuralGeometryLock({
      ...sampleRecessRoomAnalysis(),
      room_shape: "irregular",
      window_count: 1,
      window_positions: ["far/back wall"],
      architectural_features: ["structural/service shaft or column cut-out at south-east edge"],
      structural_elements: ["structural/service shaft or column cut-out at south-east edge"],
      lighting_sources: [],
    });
    assert.equal(text, "");
  });

  it("returns empty string when no asymmetric cues", () => {
    assert.equal(
      buildStructuralGeometryLock({
        ...sampleRecessRoomAnalysis(),
        room_shape: "rectangular",
        structural_elements: [],
        architectural_features: [],
        window_positions: ["right wall, center pane"],
        lighting_sources: [],
      }),
      "",
    );
  });
});

describe("buildNoColumnHallucinationDirective", () => {
  it("emits anti-column line when no confirmed pier", () => {
    const line = buildNoColumnHallucinationDirective({
      ...sampleRecessRoomAnalysis(),
      room_shape: "irregular",
      structural_elements: [],
      architectural_features: [],
    });
    assert.match(line, /Do NOT add any/);
    assert.match(line, /beams\/lintels/i);
  });

  it("is empty when a real pier is confirmed", () => {
    assert.equal(buildNoColumnHallucinationDirective(sampleRecessRoomAnalysis()), "");
  });

  it("emits preserve directive when photo columns confirmed", () => {
    const line = buildNoColumnHallucinationDirective({
      ...sampleRecessRoomAnalysis(),
      structural_elements: [],
      architectural_features: [],
      photoConfirmedStructuralElements: [
        {
          type: "column",
          position: "left",
          label: "column at left",
          bbox: { x: 0.1, y: 0.2, w: 0.1, h: 0.5 },
        },
      ],
    });
    assert.match(line, /PRESERVE COLUMNS/);
  });
});

describe("hasPlanConfirmedColumn", () => {
  it("detects plan-confirmed pier text", () => {
    assert.equal(hasPlanConfirmedColumn(sampleRecessRoomAnalysis()), true);
  });
});
