import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPhotoStagingPromptFromPlan,
  buildFinishLockSnippet,
  buildSecondaryStagingPrompt,
  buildStagingPromptFromConcept,
  clampDesignConceptWords,
  countWords,
  deriveFurnitureLayoutLockFallback,
  MULTI_VIEW_LAYOUT_LOCK_ERROR,
  parseAllRoomsStagingResponse,
  requireFurnitureLayoutLock,
  sanitizeFinishLock,
  sanitizeSurfaceFinishText,
  STAGING_PROMPT_MAX_CHARS,
  DESIGN_CONCEPT_MIN_WORDS,
} from "./stagingConceptParse";
import type { FloorPlanAnalysis, RoomRenderPlan } from "./types";

const analysis: FloorPlanAnalysis = {
  rooms: [
    {
      id: "living-1",
      name: "Living Room",
      type: "living",
      estimatedArea: 22,
      dimensions: { width: 5, depth: 4.4, height: 2.7 },
      windows: [],
      doors: [],
      features: [],
      polygon: [
        [0, 0],
        [5000, 0],
        [5000, 4400],
        [0, 4400],
      ],
    },
  ],
  wallSegments: [],
  imageFrame: null,
};

function longConcept(words: number): string {
  return Array.from({ length: words }, (_, i) => `word${i}`).join(" ");
}

test("countWords and clampDesignConceptWords trim at 400 words", () => {
  const text = longConcept(450);
  assert.equal(countWords(text), 450);
  const clamped = clampDesignConceptWords(text);
  assert.equal(countWords(clamped), 400);
});

test("buildStagingPromptFromConcept starts with Furnish and respects max chars", () => {
  const prompt = buildStagingPromptFromConcept(longConcept(320), analysis.rooms[0], "Modern Neutral");
  assert.match(prompt, /^Furnish this/i);
  assert.ok(prompt.length <= STAGING_PROMPT_MAX_CHARS);
});

test("parseAllRoomsStagingResponse maps designConcept and stagingPrompt", () => {
  const concept = longConcept(320);
  const parsed = parseAllRoomsStagingResponse(
    {
      overallConcept: "Warm modern home.",
      overallStyle: "Modern Neutral",
      rooms: [
        {
          roomId: "living-1",
          roomName: "Living Room",
          designConcept: concept,
          stagingPrompt: "Furnish this room with a linen sectional, oak coffee table, and warm indirect lighting.",
          style: "Modern Neutral",
          furnitureList: ["sectional", "coffee table"],
        },
      ],
    },
    analysis,
  );
  const plan = parsed.plans["living-1"];
  assert.ok(plan);
  assert.ok(countWords(plan.designConcept) >= DESIGN_CONCEPT_MIN_WORDS);
  assert.ok(plan.stagingPrompt?.startsWith("Furnish"));
  assert.equal(plan.designConcept, plan.geminiPrompt);
});

test("parseAllRoomsStagingResponse rejects very short designConcept", () => {
  const parsed = parseAllRoomsStagingResponse(
    {
      rooms: [{ roomId: "living-1", designConcept: "Too short." }],
    },
    analysis,
  );
  assert.equal(Object.keys(parsed.plans).length, 0);
});

test("parseAllRoomsStagingResponse derives stagingPrompt when missing", () => {
  const parsed = parseAllRoomsStagingResponse(
    {
      rooms: [
        {
          roomId: "living-1",
          designConcept: longConcept(310),
          style: "Scandi",
        },
      ],
    },
    analysis,
  );
  const plan = parsed.plans["living-1"];
  assert.ok(plan?.stagingPrompt);
  assert.match(plan.stagingPrompt!, /^Furnish this/i);
});

test("parseAllRoomsStagingResponse parses finishLock and per-photo prompts", () => {
  const concept = longConcept(320);
  const parsed = parseAllRoomsStagingResponse(
    {
      rooms: [
        {
          roomId: "living-1",
          designConcept: concept,
          finishLock: {
            floorMaterial: "light oak",
            ceilingDesign: "flat white",
            wallColor: "soft white",
            lightingConcept: "warm indirect",
            paletteSummary: "sage accents",
          },
          photoPrompts: [
            {
              photoId: "photo-a",
              stagingPrompt:
                "Soft white walls, light oak floor, flat white ceiling. Furnish with linen sectional and oak table from entrance view.",
            },
            {
              photoId: "photo-b",
              stagingPrompt:
                "Soft white walls, light oak floor, flat white ceiling. Furnish with reading chair and floor lamp from window wall.",
            },
          ],
          stagingPrompt: "Soft white walls, light oak floor, flat white ceiling. Furnish with linen sectional.",
        },
      ],
    },
    analysis,
    {
      "living-1": [
        { photoId: "photo-a", label: "View 1", cameraNote: "from door" },
        { photoId: "photo-b", label: "View 2", cameraNote: "from window" },
      ],
    },
  );
  const plan = parsed.plans["living-1"];
  assert.ok(plan?.finishLock);
  assert.equal(plan.finishLock?.floorMaterial, "light oak");
  assert.equal(plan.photoPrompts?.length, 2);
  assert.equal(plan.photoPrompts?.[0]?.photoId, "photo-a");
  assert.match(plan.photoPrompts?.[0]?.stagingPrompt ?? "", /^Soft white walls/i);
  assert.notEqual(plan.photoPrompts?.[0]?.stagingPrompt, plan.photoPrompts?.[1]?.stagingPrompt);
});

test("parseAllRoomsStagingResponse derives photoPrompts when Claude omits them", () => {
  const concept = longConcept(320);
  const parsed = parseAllRoomsStagingResponse(
    {
      rooms: [
        {
          roomId: "living-1",
          designConcept: concept,
          finishLock: {
            floorMaterial: "light oak",
            ceilingDesign: "flat white",
            wallColor: "soft white",
            lightingConcept: "warm indirect",
          },
          stagingPrompt: "Furnish this room with a linen sectional and warm lighting.",
        },
      ],
    },
    analysis,
    {
      "living-1": [
        { photoId: "photo-a", cameraNote: "from door" },
        { photoId: "photo-b", cameraNote: "from window" },
      ],
    },
  );
  const plan = parsed.plans["living-1"];
  assert.equal(plan?.photoPrompts?.length, 2);
  assert.ok(plan?.photoPrompts?.every((p) => p.stagingPrompt.length <= STAGING_PROMPT_MAX_CHARS));
  const prefix = "soft white walls, light oak floor, flat white ceiling";
  assert.match(plan?.photoPrompts?.[0]?.stagingPrompt.toLowerCase() ?? "", new RegExp(prefix));
  assert.match(plan?.photoPrompts?.[1]?.stagingPrompt.toLowerCase() ?? "", new RegExp(prefix));
});

test("buildPhotoStagingPromptFromPlan embeds finish lock snippet", () => {
  const plan: RoomRenderPlan = {
    roomId: "living-1",
    roomName: "Living Room",
    designConcept: longConcept(310),
    finishLock: {
      floorMaterial: "light oak",
      ceilingDesign: "flat white",
      wallColor: "soft white",
      lightingConcept: "warm indirect",
    },
    stagingPrompt: "Furnish this room with sectional and coffee table.",
  };
  const prompt = buildPhotoStagingPromptFromPlan(plan, "photo-a", "from door");
  assert.match(prompt.toLowerCase(), /soft white walls, light oak floor/);
  assert.ok(prompt.length <= STAGING_PROMPT_MAX_CHARS);
});

test("parseAllRoomsStagingResponse parses furnitureLayoutLock", () => {
  const concept = longConcept(320);
  const parsed = parseAllRoomsStagingResponse(
    {
      rooms: [
        {
          roomId: "living-1",
          designConcept: concept,
          furnitureLayoutLock: "One loft bunk on north wall, one wardrobe west, round sage rug center.",
          finishLock: {
            floorMaterial: "light oak",
            ceilingDesign: "flat white",
            wallColor: "soft white",
            lightingConcept: "warm indirect",
          },
        },
      ],
    },
    analysis,
  );
  assert.equal(
    parsed.plans["living-1"]?.furnitureLayoutLock,
    "One loft bunk on north wall, one wardrobe west, round sage rug center.",
  );
});

test("requireFurnitureLayoutLock returns explicit lock for multi-photo rooms", () => {
  const plan: RoomRenderPlan = {
    roomId: "living-1",
    roomName: "Living Room",
    designConcept: longConcept(310),
    geminiPrompt: longConcept(310),
    furnitureLayoutLock: "One loft bunk on north wall, one wardrobe west, round sage rug center.",
  };
  const result = requireFurnitureLayoutLock(plan, 2);
  assert.equal(result.derived, false);
  assert.match(result.lock, /loft bunk/i);
});

test("requireFurnitureLayoutLock blocks when lock missing and fallback too short", () => {
  const plan: RoomRenderPlan = {
    roomId: "living-1",
    roomName: "Living Room",
    designConcept: "Short.",
    geminiPrompt: "Short.",
    stagingPrompt: "Too short",
  };
  assert.throws(
    () => requireFurnitureLayoutLock(plan, 2),
    (err: Error) => err.message === MULTI_VIEW_LAYOUT_LOCK_ERROR,
  );
});

test("requireFurnitureLayoutLock derives fallback from furnitureList", () => {
  const plan: RoomRenderPlan = {
    roomId: "living-1",
    roomName: "Living Room",
    designConcept: longConcept(310),
    geminiPrompt: longConcept(310),
    furnitureList: ["loft bunk bed", "wardrobe", "round rug", "reading bench"],
  };
  const result = requireFurnitureLayoutLock(plan, 3);
  assert.equal(result.derived, true);
  assert.match(result.lock, /loft bunk bed/i);
});

test("buildSecondaryStagingPrompt uses shared layout lock not per-photo furnish variants", () => {
  const plan: RoomRenderPlan = {
    roomId: "living-1",
    roomName: "Living Room",
    designConcept: longConcept(310),
    geminiPrompt: longConcept(310),
    finishLock: {
      floorMaterial: "light oak",
      ceilingDesign: "flat white",
      wallColor: "soft white",
      lightingConcept: "warm indirect",
    },
    furnitureLayoutLock: "One loft bunk north wall, wardrobe west, round sage rug center.",
    photoPrompts: [
      {
        photoId: "photo-a",
        stagingPrompt: "Soft white walls. Wardrobe near west door and bunk north.",
      },
      {
        photoId: "photo-b",
        stagingPrompt: "Soft white walls. Reading bench under east window and bunk north.",
      },
    ],
  };
  const lock = deriveFurnitureLayoutLockFallback(plan);
  const secondary = buildSecondaryStagingPrompt(
    plan,
    lock,
    "Keep all walls, doors, windows, ceiling from input photo unchanged.",
  );
  assert.match(secondary, /loft bunk north wall/i);
  assert.doesNotMatch(secondary, /reading bench under east window/i);
  assert.doesNotMatch(secondary, /wardrobe near west door/i);
});

test("sanitizeSurfaceFinishText strips remodeling vocabulary", () => {
  const raw = "perimeter tray step with LED cove and built-in channel";
  const cleaned = sanitizeSurfaceFinishText(raw, "flat painted ceiling");
  assert.doesNotMatch(cleaned.toLowerCase(), /tray|cove|built-in/);
  assert.match(cleaned.toLowerCase(), /perimeter|led/);
});

test("sanitizeFinishLock removes soffit and paneling language from finishLock", () => {
  const sanitized = sanitizeFinishLock({
    floorMaterial: "light oak",
    ceilingDesign: "tray ceiling with perimeter cove lighting",
    wallColor: "recessed panel accent wall in sage",
    lightingConcept: "LED cove around tray perimeter",
  });
  assert.doesNotMatch(sanitized.ceilingDesign.toLowerCase(), /tray|cove/);
  assert.doesNotMatch(sanitized.wallColor.toLowerCase(), /panel|recessed/);
  assert.doesNotMatch(sanitized.lightingConcept.toLowerCase(), /cove|tray/);
});

test("buildFinishLockSnippet uses sanitized surface-only finishes", () => {
  const snippet = buildFinishLockSnippet({
    floorMaterial: "light oak",
    ceilingDesign: "soffit bulkhead with coffered panels",
    wallColor: "warm white",
    lightingConcept: "built-in LED channels",
  });
  assert.doesNotMatch(snippet.toLowerCase(), /soffit|bulkhead|coffer|built-in/);
  assert.match(snippet.toLowerCase(), /warm white walls/);
});
