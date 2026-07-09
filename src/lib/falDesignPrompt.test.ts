import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFalDesignOverlayPrompt,
  countRetryEligibleFurnitureItems,
  filterOpeningLikeFurnitureItems,
  formatBudgetTierLine,
  isSurfaceOnlyFurnitureItem,
  selectRoomTypeDefaults,
  trimFurnitureListLastResort,
  FAL_DESIGN_OVERLAY_MAX,
  FAL_DESIGN_OVERLAY_MAX_COMPLEX,
} from "./falDesignPrompt";
import { buildCompactOpeningLockForRetry } from "./falOpeningLockCompact";
import type { RoomDesignBrief, UserPreferences } from "./project/types";

const baseBrief: RoomDesignBrief = {
  roomId: "r1",
  roomName: "Bedroom",
  roomType: "bedroom",
  wallColor: { hex: "#fff", ncs: "S 0500-N" },
  floorMaterial: "",
  ceilingDesign: "",
  lightingConcept: "",
  furnitureList: [],
  keyDesignElements: [],
  renderAngles: [],
  specialNotes: "",
};

const basePrefs: UserPreferences = {
  style: "modern-neutral",
  familyMembers: 2,
  budgetTier: "mid",
  wishes: "",
  designMode: "custom",
};

test("bedroom with empty furnitureList produces defaults under cap", () => {
  const { overlay, furnitureCount } = buildFalDesignOverlayPrompt({
    brief: baseBrief,
    preferences: basePrefs,
    detectedRoom: { id: "r1", name: "Bedroom", type: "bedroom", estimatedArea: 15, dimensions: { width: 4, depth: 4, height: 2.7 }, windows: [], doors: [], features: [] },
  });
  assert.ok(overlay.length <= FAL_DESIGN_OVERLAY_MAX);
  assert.ok(furnitureCount >= 4);
  assert.match(overlay, /queen bed/i);
  assert.match(overlay, /wardrobe|rug/i);
  assert.doesNotMatch(overlay, /### CRITICAL/i);
});

test("premium budget tier wording", () => {
  const mid = formatBudgetTierLine("mid");
  const premium = formatBudgetTierLine("premium");
  assert.match(mid, /mid-range/i);
  assert.match(premium, /premium|richer/i);
  assert.doesNotMatch(mid, /luxury/i);
});

test("narrow room selects slim defaults and scale note", () => {
  const { items, scaleNote } = selectRoomTypeDefaults("bedroom", { width: 5.7, depth: 2.7, height: 2.7 });
  assert.match(items.join(" "), /slim wardrobe|compact/i);
  assert.match(scaleNote ?? "", /5\.7m × 2\.7m/);

  const { overlay } = buildFalDesignOverlayPrompt({
    brief: baseBrief,
    preferences: basePrefs,
    detectedRoom: {
      id: "r1",
      name: "Bedroom",
      type: "bedroom",
      estimatedArea: 15,
      dimensions: { width: 5.7, depth: 2.7, height: 2.7 },
      windows: [],
      doors: [],
      features: [],
    },
  });
  assert.match(overlay, /narrow|scale furniture/i);
});

test("filterOpeningLikeFurnitureItems strips archway when doorCount is 0", () => {
  const filtered = filterOpeningLikeFurnitureItems(
    ["queen bed", "archway to hallway"],
    { doorCount: 0, windowCount: 1, doorPositions: [], windowPositions: ["far wall"] },
  );
  assert.deepEqual(filtered, ["queen bed"]);
});

test("buildCompactOpeningLockForRetry respects 1400 cap", () => {
  const longLock = Array.from({ length: 200 }, (_, i) => `Line ${i}: keep window on far wall exactly`).join("\n");
  const compact = buildCompactOpeningLockForRetry(longLock);
  assert.ok(compact.length <= 1400);
});

test("trimOverlayToCap preserves concept head and FURNITURE block with long concept", () => {
  const jogHead =
    "CRITICAL: preserve 8-corner wall jog on left wall — shallow recess must remain visible. ";
  const longConcept = jogHead + "Luxury bedroom with green botanical wallpaper, bespoke bunk bed frame, ".repeat(18);
  const { overlay, furnitureCount, overlayTrimmedSections } = buildFalDesignOverlayPrompt({
    brief: {
      ...baseBrief,
      furnitureList: [
        "Queen bed",
        "Wardrobe",
        "Nightstand",
        "Rug",
        "Curtains",
        "Wall art",
      ],
    },
    preferences: { ...basePrefs, budgetTier: "luxury" },
    conceptProse: longConcept,
    detectedRoom: {
      id: "r1",
      name: "Bedroom",
      type: "bedroom",
      estimatedArea: 15,
      dimensions: { width: 5.7, depth: 2.7, height: 2.7 },
      windows: [],
      doors: [],
      features: [],
    },
  });
  assert.ok(overlay.length <= FAL_DESIGN_OVERLAY_MAX);
  assert.ok(furnitureCount >= 5);
  assert.match(overlay, /FURNITURE \(6 pieces\)/);
  assert.match(overlay, /8-corner wall jog/);
  assert.ok(overlayTrimmedSections?.length);
});

test("trimFurnitureListLastResort pins bunk bed over surface items", () => {
  const items = [
    "velvet area rug",
    "marble window ledge",
    "double-decker bunk bed",
    "emerald carpet",
    "floor-to-ceiling curtains",
  ];
  const trimmed = trimFurnitureListLastResort(items, 3);
  assert.ok(trimmed.some((i) => /bunk bed/i.test(i)));
  assert.equal(trimmed.length, 3);
});

test("countRetryEligibleFurnitureItems excludes surface-only items", () => {
  assert.equal(
    countRetryEligibleFurnitureItems(["velvet area rug", "marble window ledge", "emerald carpet"]),
    0,
  );
  assert.equal(
    countRetryEligibleFurnitureItems(["bunk bed", "wardrobe", "rug", "nightstand"]),
    3,
  );
  assert.equal(isSurfaceOnlyFurnitureItem("double-decker bunk bed"), false);
  assert.equal(isSurfaceOnlyFurnitureItem("velvet area rug"), true);
});

test("8-corner bedroom uses 1400 overlay cap and preserves bunk bed + wardrobe", () => {
  const jogHead =
    "CRITICAL: preserve 8-corner wall jog on left wall — shallow recess must remain visible. ";
  const conceptProse = jogHead + "Emerald botanical wallpaper bunk room concept. ".repeat(12);
  const { overlay, furnitureCount } = buildFalDesignOverlayPrompt({
    brief: {
      ...baseBrief,
      ceilingDesign: "Flat white ceiling with recessed LED perimeter strip",
      lightingConcept: "Warm indirect cove lighting plus two bedside sconces symmetrically placed",
      floorMaterial: "Wide-plank dark walnut with matte finish",
      furnitureList: [
        "double-decker bunk bed for two children",
        "two bedside units at bed foot",
        "built-in walnut wardrobe along NE wall",
        "marble window ledge",
        "velvet area rug",
      ],
      keyDesignElements: ["emerald velvet", "dark walnut", "antique gold", "green-veined marble"],
    },
    preferences: { ...basePrefs, budgetTier: "luxury" },
    conceptProse,
    detectedRoom: {
      id: "r1",
      name: "Bedroom",
      type: "bedroom",
      estimatedArea: 15,
      dimensions: { width: 5.74, depth: 2.66, height: 2.7 },
      windows: [{ position: "east", width: 1.1, height: 1.4 }],
      doors: [{ position: "west", width: 0.85, height: 2.1, connectsTo: "exterior" }],
      features: [],
      polygon: [
        [0, 0],
        [5740, 0],
        [5740, 2660],
        [4430, 2660],
        [4430, 3780],
        [3310, 3780],
        [3310, 7720],
        [0, 7720],
      ],
    },
    visibleOpenings: { windowCount: 1, doorCount: 0 },
  });
  assert.ok(overlay.length <= FAL_DESIGN_OVERLAY_MAX_COMPLEX);
  assert.ok(furnitureCount >= 3);
  assert.match(overlay, /bunk bed/i);
  assert.match(overlay, /wardrobe/i);
});

test("trimOverlayToCap preserves concept prose", () => {
  const longConcept = "Luxury bedroom with green botanical wallpaper, bespoke bunk bed frame, ".repeat(20);
  const { overlay } = buildFalDesignOverlayPrompt({
    brief: {
      ...baseBrief,
      furnitureList: ["Queen bed", "Wardrobe", "Nightstand", "Rug", "Curtains", "Art"],
    },
    preferences: { ...basePrefs, budgetTier: "luxury" },
    conceptProse: longConcept,
    detectedRoom: {
      id: "r1",
      name: "Bedroom",
      type: "bedroom",
      estimatedArea: 15,
      dimensions: { width: 5.7, depth: 2.7, height: 2.7 },
      windows: [],
      doors: [],
      features: [],
    },
  });
  assert.ok(overlay.length <= FAL_DESIGN_OVERLAY_MAX);
  assert.match(overlay, /Luxury bedroom with green botanical wallpaper/);
});
