import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFalDesignOverlayPrompt } from "@/lib/falDesignPrompt";
import { FAL_GEOMETRY_LOCK, FINISH_MANDATE_GEOMETRY_SAFE } from "@/lib/falPipelinePrompt";
import { LIGHTING_REALISM_DIRECTIVE } from "@/lib/renderQualityDirective";
import { assembleProjectKontextPrompt } from "./assembleProjectKontextPrompt";
import type { RoomDesignBrief, UserPreferences } from "./types";

const brief: RoomDesignBrief = {
  roomId: "living-1",
  roomName: "Living Room",
  roomType: "living",
  wallColor: { hex: "#F5F0E8", ncs: "S 0500-N" },
  floorMaterial: "Light oak herringbone flooring",
  ceilingDesign: "Flat white ceiling with recessed LED perimeter strip",
  lightingConcept: "Warm indirect cove lighting plus symmetric recessed downlights",
  furnitureList: [],
  keyDesignElements: ["linen sofa", "walnut coffee table"],
  renderAngles: [],
  specialNotes: "",
};

const preferences: UserPreferences = {
  style: "scandinavian",
  familyMembers: 2,
  budgetTier: "mid",
  wishes: "cozy layered textiles",
  designMode: "custom",
};

const livingRoom = {
  id: "living-1",
  name: "Living Room",
  type: "living" as const,
  estimatedArea: 25,
  dimensions: { width: 5, depth: 5, height: 2.7 },
  windows: [{ position: "south", width: 2, height: 1.5 }],
  doors: [],
  features: [],
};

test("View 1 Kontext prompt bookends geometry lock twice", () => {
  const prompt = assembleProjectKontextPrompt({
    brief,
    preferences,
    detectedRoom: livingRoom,
  });

  const first = prompt.indexOf(FAL_GEOMETRY_LOCK);
  const last = prompt.lastIndexOf(FAL_GEOMETRY_LOCK);
  assert.ok(first >= 0);
  assert.ok(last > first, "geometry lock should appear at start and end");
});

test("View 1 Kontext prompt excludes Gemini lighting directive and floor-plan openings", () => {
  const prompt = assembleProjectKontextPrompt({
    brief,
    preferences,
    detectedRoom: livingRoom,
  });

  assert.doesNotMatch(prompt, /Preserve exactly \d+ window\(s\)/i);
  assert.doesNotMatch(prompt, /LIGHTING & CEILING — ARCHITECTURAL DESIGN/i);
  assert.doesNotMatch(prompt, new RegExp(LIGHTING_REALISM_DIRECTIVE.slice(0, 40)));
});

test("View 1 Kontext prompt uses in-place edit header not empty-room furnish", () => {
  const prompt = assembleProjectKontextPrompt({ brief, preferences });
  assert.match(prompt, /Modify the uploaded photo in place/i);
  assert.match(prompt, /Redesign this room in place/i);
  assert.doesNotMatch(prompt, /Furnish this empty room completely/i);
});

test("View 1 Kontext prompt includes design overlay and geometry-safe finish", () => {
  const prompt = assembleProjectKontextPrompt({
    brief,
    preferences,
    detectedRoom: livingRoom,
    conceptProse:
      "Warm Scandinavian living room with layered neutral textiles and a centered linen sectional.",
  });

  assert.ok(prompt.length > 200);
  assert.match(prompt, /Light oak herringbone flooring/i);
  assert.match(prompt, /sofa|sectional|coffee table/i);
  assert.match(prompt, /layered neutral textiles/i);
  assert.ok(prompt.includes(FINISH_MANDATE_GEOMETRY_SAFE.slice(0, 40)));
});

test("kontextMode overlay header differs from default furnish header", () => {
  const kontext = buildFalDesignOverlayPrompt({ brief, preferences, kontextMode: true });
  const defaultOverlay = buildFalDesignOverlayPrompt({ brief, preferences });
  assert.match(kontext.overlay, /Redesign this room in place/i);
  assert.match(defaultOverlay.overlay, /Furnish this empty room completely/i);
});

test("View 1 Kontext prompt omits ControlNet structural tail — markup is a Kontext image ref", () => {
  const withLines = assembleProjectKontextPrompt({
    brief,
    preferences,
    detectedRoom: livingRoom,
    hasStructuralLines: true,
  });
  const withoutLines = assembleProjectKontextPrompt({
    brief,
    preferences,
    detectedRoom: livingRoom,
    hasStructuralLines: false,
  });

  assert.doesNotMatch(withLines, /Follow the provided line map/i);
  assert.doesNotMatch(withoutLines, /Follow the provided line map/i);
});

test("View 1 Kontext prompt includes room shape block for irregular polygon", () => {
  const prompt = assembleProjectKontextPrompt({
    brief,
    preferences,
    detectedRoom: {
      ...livingRoom,
      polygon: [
        [0, 0],
        [5000, 0],
        [5000, 3000],
        [3500, 3000],
        [3500, 5000],
        [0, 5000],
      ],
    },
  });

  assert.match(prompt, /ROOM SHAPE|wall corners/i);
});
