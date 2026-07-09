import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleLayeredStagingPrompt,
  assembleStagingPrompt,
  buildFurnitureStagingPrompt,
  buildShellStagingPrompt,
  LAYERED_STAGING_PROMPT_MAX_CHARS,
} from "./stagingPromptAssembly";
import type { RoomRenderPlan } from "./types";

const OPENING_PREFIX = "Keep all walls, doors, windows, ceiling from input photo unchanged.";
const LONG_OPENING = `${OPENING_PREFIX} Preserve exactly: 1 door on far/back wall — do not cover, remove, or repaint openings.`;

const samplePlan: RoomRenderPlan = {
  roomId: "room_1",
  roomName: "Bedroom",
  designConcept: "x".repeat(400),
  geminiPrompt: "x".repeat(400),
  stagingPrompt: "Warm beige walls with sage botanical feature wallpaper, light oak floor, soft-ivory ceiling with recessed lights. Two-storey oak loft bed south-west, slim oak wardrobe on long wall, sand boucle rug centered, bench and desk under window. Ahead: door wall, loft bed and wardrobe in view.",
  finishLock: {
    floorMaterial: "light oak engineered wood flooring",
    ceilingDesign: "flat soft-ivory ceiling with recessed perimeter downlights",
    wallColor: "warm beige walls with a muted-sage botanical feature wallpaper on the long wall",
    lightingConcept: "symmetric ambient flush ceiling light",
    paletteSummary: "light oak, warm beige, sage accents",
  },
  furnitureLayoutLock:
    "One two-storey light-oak loft bed against the south-west wall, one slim 1m oak wardrobe on the long north wall, one sand boucle rug centered on the walkway.",
  photoPrompts: [
    {
      photoId: "photo-a",
      stagingPrompt: "Warm beige walls with sage botanical feature wallpaper, light oak floor, soft-ivory ceiling with recessed lights. Two-storey oak loft bed south-west, slim oak wardrobe on long wall, sand boucle rug centered, bench and desk under window. Ahead: door wall, loft bed and wardrobe in view.",
      cameraNote: "camera near north-east corner facing west toward door opening visible",
    },
  ],
};

describe("assembleStagingPrompt", () => {
  it("preserves opening lock when body is at max length", () => {
    const body = "A".repeat(220);
    const openingLock = `${OPENING_PREFIX} Preserve exactly: 1 door on west wall — do not cover, remove, or repaint openings.`;
    const out = assembleStagingPrompt({ openingLock, body, maxChars: 220 });
    assert.ok(out.startsWith(OPENING_PREFIX));
    assert.ok(out.includes("Preserve exactly"));
    assert.ok(out.length <= 220);
  });

  it("appends edit feedback within budget after opening lock", () => {
    const out = assembleStagingPrompt({
      openingLock: OPENING_PREFIX,
      body: "Add freestanding loft bed only.",
      editFeedback: "Keep door open.",
      maxChars: 220,
    });
    assert.ok(out.includes(OPENING_PREFIX));
    assert.ok(out.includes("Keep door open"));
  });
});

describe("assembleLayeredStagingPrompt", () => {
  it("flux path omits long opening lock and preserves full furnish body", () => {
    const body = buildFurnitureStagingPrompt(samplePlan, "photo-a", "camera facing west");
    const out = assembleLayeredStagingPrompt({
      layer: "furnish",
      renderer: "flux-opening-freeze",
      openingLock: LONG_OPENING,
      body,
    });
    assert.ok(!out.startsWith(LONG_OPENING));
    assert.ok(!out.includes("Preserve exactly: 1 door"));
    assert.match(out, /loft bed/i);
    assert.match(out, /wardrobe/i);
    assert.ok(out.length <= LAYERED_STAGING_PROMPT_MAX_CHARS);
    assert.ok(body.length > 100);
  });

  it("apartment-staging path uses compact geometry prefix only", () => {
    const out = assembleLayeredStagingPrompt({
      layer: "shell",
      renderer: "apartment-staging",
      openingLock: LONG_OPENING,
      body: buildShellStagingPrompt(samplePlan),
    });
    assert.ok(out.startsWith(OPENING_PREFIX));
    assert.ok(!out.includes("Preserve exactly"));
    assert.match(out, /Empty room/i);
  });
});

describe("layered prompt builders", () => {
  it("shell prompt has finishes and no furniture placement", () => {
    const shell = buildShellStagingPrompt(samplePlan);
    assert.match(shell, /warm beige/i);
    assert.match(shell, /light oak/i);
    assert.match(shell, /Empty room/i);
    assert.match(shell, /No furniture/i);
    assert.doesNotMatch(shell, /loft bed south-west/i);
  });

  it("furniture prompt uses layout lock and freestanding hint", () => {
    const furnish = buildFurnitureStagingPrompt(
      samplePlan,
      "photo-a",
      "camera facing west toward door opening visible",
    );
    assert.match(furnish, /loft bed/i);
    assert.match(furnish, /Freestanding/i);
    assert.doesNotMatch(furnish, /botanical feature wallpaper/i);
  });
});
