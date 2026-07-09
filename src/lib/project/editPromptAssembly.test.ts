import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMasterRenderInstruction,
  buildSecondaryRenderInstruction,
  buildGeometryAnchorSentence,
  buildPreserveScaffold,
  framingFallbackOpeningCounts,
} from "./editPromptAssembly";
import { resolveViewpointFraming } from "./viewpointFraming";
import type { DetectedRoom, RoomRenderPlan } from "./types";

const plan: RoomRenderPlan = {
  roomId: "kids-1",
  roomName: "Kids Room",
  geminiPrompt: "",
  designConcept: "Scandinavian kids room with warm oak tones and sage accents.",
  finishLock: {
    floorMaterial: "light oak",
    ceilingDesign: "flat white",
    wallColor: "soft white",
    lightingConcept: "warm flush mount",
  },
  furnitureLayoutLock:
    "One bunk bed on the north wall, one wardrobe on the west wall, one desk under the east window, round sage rug in the center.",
};

test("preserve scaffold combines PRESERVE prefix, opening protection, and door directive", () => {
  const scaffold = buildPreserveScaffold({ windows: 2, doors: 1 });
  assert.match(scaffold, /^PRESERVE: Keep the exact room geometry/);
  assert.match(scaffold, /Protect 2 window\(s\) in their exact positions/);
  assert.match(scaffold, /exactly 1 door opening\(s\) in this photo/);

  const zeroDoors = buildPreserveScaffold({ windows: 1, doors: 0 });
  assert.match(zeroDoors, /contain NO doors/);

  const unanalyzed = buildPreserveScaffold(undefined);
  assert.match(unanalyzed, /^PRESERVE:/);
  assert.match(unanalyzed, /Never add a door or doorway that is not present/);
  assert.doesNotMatch(unanalyzed, /Protect/);
});

test("geometry anchor sentence locks exact opening counts for retries", () => {
  const anchor = buildGeometryAnchorSentence({ windows: 1, doors: 2 });
  assert.match(anchor, /GEOMETRY ANCHOR/);
  assert.match(anchor, /exactly 1 window\(s\) and 2 door opening\(s\)/);
  assert.match(anchor, /Do not add, remove, or relocate any opening/);
  assert.equal(buildGeometryAnchorSentence(undefined), "");
});

test("secondary instruction states image roles: first image is geometry authority", () => {
  const prompt = buildSecondaryRenderInstruction(plan, "camera faces north wall");
  assert.match(prompt, /IMAGE ROLES/);
  assert.match(prompt, /FIRST image .*ONLY authority for geometry/);
  assert.match(prompt, /SECOND image .*ONLY as a reference/);
  assert.match(prompt, /Decorative items — rug, cushions, wall art, curtains, plants — must be the identical items/);
  assert.match(
    prompt,
    /Do NOT reproduce walls, openings, or composition from the second image/,
  );
  assert.match(
    prompt,
    /Openings and walls not visible in the first image must NOT appear/,
  );
});

test("secondary instruction includes opening counts when provided", () => {
  const prompt = buildSecondaryRenderInstruction(plan, null, undefined, {
    windows: 2,
    doors: 1,
  });
  assert.match(prompt, /Protect 2 window\(s\) in their exact positions/);
  assert.match(prompt, /1 door opening\(s\) in their exact positions/);
});

test("secondary instruction omits opening sentence for zero counts", () => {
  const prompt = buildSecondaryRenderInstruction(plan, null, undefined, {
    windows: 0,
    doors: 0,
  });
  assert.doesNotMatch(prompt, /Protect/);
});

test("secondary instruction carries furniture layout lock and camera note", () => {
  const prompt = buildSecondaryRenderInstruction(plan, "camera faces north wall");
  assert.match(prompt, /Furniture layout lock: One bunk bed on the north wall/);
  assert.match(prompt, /This camera shows: camera faces north wall\./);
});

test("master instruction still includes opening preserve sentence", () => {
  const prompt = buildMasterRenderInstruction(plan, "photo-1", "from door", undefined, {
    windows: 1,
    doors: 1,
  });
  assert.match(prompt, /Protect 1 window\(s\)/);
  assert.match(prompt, /PRESERVE/);
});

test("master instruction omits style-ref image roles by default", () => {
  const prompt = buildMasterRenderInstruction(plan, "photo-1", "from door");
  assert.doesNotMatch(prompt, /IMAGE ROLES/);
});

test("master instruction prepends style-ref image roles when a reference is attached", () => {
  const prompt = buildMasterRenderInstruction(
    plan,
    "photo-1",
    "from door",
    undefined,
    { windows: 1, doors: 1 },
    true,
  );
  assert.match(prompt, /^IMAGE ROLES:/);
  assert.match(prompt, /FIRST image .*ONLY authority for geometry/);
  assert.match(prompt, /SECOND image .*style inspiration/);
  assert.match(prompt, /Do NOT copy the second image's room shape, layout, openings, or camera/);
  assert.match(prompt, /PRESERVE/);
});

test("master instruction with per-photo renderInstruction still carries style-ref roles", () => {
  const planWithPhotoPrompt: RoomRenderPlan = {
    ...plan,
    photoPrompts: [
      {
        photoId: "photo-1",
        renderInstruction:
          "PRESERVE: exact geometry. CHANGE: stage with pink desk, fairy lights, ivy garlands.",
        stagingPrompt: "pink desk, fairy lights, ivy garlands",
      },
    ],
  };
  const prompt = buildMasterRenderInstruction(
    planWithPhotoPrompt,
    "photo-1",
    null,
    undefined,
    undefined,
    true,
  );
  assert.match(prompt, /^IMAGE ROLES:/);
  assert.match(prompt, /pink desk, fairy lights, ivy garlands/);
});

const bedroomRoom: DetectedRoom = {
  id: "bed-1",
  name: "Bedroom",
  type: "bedroom",
  estimatedArea: 14.7,
  dimensions: { width: 5.65, depth: 2.6, height: 2.7 },
  windows: [],
  doors: [],
  features: [],
  polygon: [
    [0, 0],
    [5650, 0],
    [5650, 2600],
    [0, 2600],
  ],
};

test("secondary instruction includes opposite-camera transfer directive", () => {
  const prompt = buildSecondaryRenderInstruction(
    plan,
    "camera faces west wall",
    undefined,
    { windows: 1, doors: 1 },
    {
      photoId: "photo-2",
      heroViewpoint: { x: 300, y: 1300, angleDeg: 0 },
      secondaryViewpoint: { x: 5350, y: 1300, angleDeg: 180 },
      detectedRoom: bedroomRoom,
    },
  );
  assert.match(prompt, /OPPOSITE-CAMERA/);
  assert.match(prompt, /ARCHITECTURE IS FIXED/);
  assert.match(prompt, /FIRST image \(the real photo\)/);
  assert.match(prompt, /FURNITURE WALL MAP/);
  assert.match(prompt, /columns/);
  assert.doesNotMatch(prompt, /EDIT TARGET photo/, "FAL pipeline must use FIRST image label");
});

test("secondary instruction uses per-photo renderInstruction when present", () => {
  const planWithPhotoPrompts: RoomRenderPlan = {
    ...plan,
    photoPrompts: [
      {
        photoId: "photo-2",
        label: "View 2",
        stagingPrompt: "",
        renderInstruction:
          "PRESERVE: Keep geometry. CHANGE: Bunk bed on north wall, desk at east window from this west-facing camera.",
      },
    ],
  };
  const prompt = buildSecondaryRenderInstruction(
    planWithPhotoPrompts,
    "camera faces west wall",
    undefined,
    { windows: 1, doors: 0 },
    {
      photoId: "photo-2",
      heroViewpoint: { x: 300, y: 1300, angleDeg: 0 },
      secondaryViewpoint: { x: 5350, y: 1300, angleDeg: 180 },
      detectedRoom: bedroomRoom,
    },
  );
  assert.match(prompt, /Bunk bed on north wall, desk at east window/);
  assert.match(prompt, /IMAGE ROLES/);
  assert.match(prompt, /OPPOSITE-CAMERA/);
});

test("all four builder branches emit the DOORS finish sentence", () => {
  const planWithPhotoPrompts: RoomRenderPlan = {
    ...plan,
    photoPrompts: [
      {
        photoId: "photo-1",
        label: "View 1",
        stagingPrompt: "",
        renderInstruction: "PRESERVE: Keep geometry. CHANGE: Stage the room.",
      },
    ],
  };
  const prompts = [
    // master per-photo branch
    buildMasterRenderInstruction(planWithPhotoPrompts, "photo-1"),
    // master fallback branch
    buildMasterRenderInstruction(plan, "photo-1", "from door", undefined, {
      windows: 1,
      doors: 1,
    }),
    // secondary per-photo branch
    buildSecondaryRenderInstruction(planWithPhotoPrompts, null, undefined, undefined, {
      photoId: "photo-1",
    }),
    // secondary fallback branch
    buildSecondaryRenderInstruction(plan, "camera faces north wall"),
  ];
  for (const prompt of prompts) {
    assert.match(prompt, /DOORS: Render every door-sized opening/);
    assert.match(prompt, /is NOT a geometry change/);
    assert.match(prompt, /Keep wide archways and open passages open/);
  }
});

test("opening preserve sentence requires a finished closed door", () => {
  const prompt = buildSecondaryRenderInstruction(plan, null, undefined, {
    windows: 0,
    doors: 2,
  });
  assert.match(
    prompt,
    /2 door opening\(s\) in their exact positions, each fitted with a finished closed door \(leaf, frame, and casing\)/,
  );
});

test("secondary instruction appends hero placement map when provided", () => {
  const placementMap = [
    "FURNITURE PLACEMENT MAP (observed in the approved master design — mandatory):",
    "- wardrobe: NORTH wall at the right corner, rattan bench immediately to its left",
    "Never swap two pieces' positions or mirror their left/right relationship.",
  ].join("\n");
  const prompt = buildSecondaryRenderInstruction(
    plan,
    "camera faces west wall",
    undefined,
    { windows: 1, doors: 1 },
    {
      photoId: "photo-2",
      heroViewpoint: { x: 300, y: 1300, angleDeg: 0 },
      secondaryViewpoint: { x: 5350, y: 1300, angleDeg: 180 },
      detectedRoom: bedroomRoom,
      heroPlacementMap: placementMap,
    },
  );
  assert.match(prompt, /FURNITURE PLACEMENT MAP/);
  assert.match(prompt, /wardrobe: NORTH wall at the right corner/);
  // Map must come after the viewpoint transfer directive.
  assert.ok(prompt.indexOf("FURNITURE PLACEMENT MAP") > prompt.indexOf("OPPOSITE-CAMERA"));
});

test("secondary instruction appends placement map even without viewpoints", () => {
  const prompt = buildSecondaryRenderInstruction(plan, null, undefined, undefined, {
    photoId: "photo-2",
    heroPlacementMap: "FURNITURE PLACEMENT MAP:\n- bed: NORTH wall",
  });
  assert.match(prompt, /FURNITURE PLACEMENT MAP/);
});

test("secondary instruction omits placement map when absent", () => {
  const prompt = buildSecondaryRenderInstruction(plan, "camera faces north wall");
  assert.doesNotMatch(prompt, /FURNITURE PLACEMENT MAP/);
});

test("secondary instruction appends decor lock when provided", () => {
  const decorLock = [
    "DECOR IDENTITY LOCK (observed in the approved master — mandatory):",
    "- round light-blue rug with a single large white star in the center",
    "- bunk bed lower bunk: three pillows — medium blue, burnt orange, dark navy",
    "Every listed decor item is the exact same physical object in this view",
  ].join("\n");
  const prompt = buildSecondaryRenderInstruction(plan, "camera faces west wall", undefined, undefined, {
    photoId: "photo-2",
    heroDecorLock: decorLock,
  });
  assert.match(prompt, /DECOR IDENTITY LOCK/);
  assert.match(prompt, /round light-blue rug with a single large white star/);
  assert.match(prompt, /three pillows — medium blue, burnt orange, dark navy/);
});

test("secondary instruction appends both placement map and decor lock", () => {
  const placementMap = "FURNITURE PLACEMENT MAP:\n- bed: NORTH wall";
  const decorLock = "DECOR IDENTITY LOCK:\n- round sage rug in the center";
  const prompt = buildSecondaryRenderInstruction(plan, null, undefined, undefined, {
    photoId: "photo-2",
    heroPlacementMap: placementMap,
    heroDecorLock: decorLock,
  });
  assert.match(prompt, /FURNITURE PLACEMENT MAP/);
  assert.match(prompt, /DECOR IDENTITY LOCK/);
  assert.ok(prompt.indexOf("DECOR IDENTITY LOCK") > prompt.indexOf("FURNITURE PLACEMENT MAP"));
});

test("secondary instruction omits decor lock when absent", () => {
  const prompt = buildSecondaryRenderInstruction(plan, "camera faces north wall");
  assert.doesNotMatch(prompt, /DECOR IDENTITY LOCK/);
});

test("zero analyzed doors → NO-doors directive, no door-finish sentence", () => {
  const planWithPhotoPrompts: RoomRenderPlan = {
    ...plan,
    photoPrompts: [
      {
        photoId: "photo-1",
        label: "View 1",
        stagingPrompt: "",
        renderInstruction: "PRESERVE: Keep geometry. CHANGE: Stage the room.",
      },
    ],
  };
  const prompts = [
    // master per-photo branch
    buildMasterRenderInstruction(planWithPhotoPrompts, "photo-1", null, undefined, {
      windows: 1,
      doors: 0,
    }),
    // master fallback branch
    buildMasterRenderInstruction(plan, "photo-1", "from door", undefined, {
      windows: 1,
      doors: 0,
    }),
    // secondary per-photo branch
    buildSecondaryRenderInstruction(
      planWithPhotoPrompts,
      null,
      undefined,
      { windows: 1, doors: 0 },
      { photoId: "photo-1" },
    ),
    // secondary fallback branch
    buildSecondaryRenderInstruction(plan, "camera faces north wall", undefined, {
      windows: 1,
      doors: 0,
    }),
  ];
  for (const prompt of prompts) {
    assert.match(prompt, /contain NO doors/);
    assert.match(prompt, /Do NOT add any door, door leaf, door frame, or doorway/);
    assert.doesNotMatch(prompt, /Render every door-sized opening/);
  }
});

test("analyzed door count locks the exact number of doors", () => {
  const master = buildMasterRenderInstruction(plan, "photo-1", null, undefined, {
    windows: 0,
    doors: 2,
  });
  assert.match(master, /DOORS: Render every door-sized opening/);
  assert.match(
    master,
    /There are exactly 2 door opening\(s\) in this photo; do not add a door anywhere else\./,
  );
});

test("opposite-camera placement map gets the left/right translation note", () => {
  const placementMap =
    "FURNITURE PLACEMENT MAP (observed in the approved master design — mandatory):\n- bed: NORTH wall, along the left side";
  const opposite = buildSecondaryRenderInstruction(
    plan,
    "camera faces west wall",
    undefined,
    undefined,
    {
      photoId: "photo-2",
      heroViewpoint: { x: 300, y: 1300, angleDeg: 0 },
      secondaryViewpoint: { x: 5350, y: 1300, angleDeg: 180 },
      detectedRoom: bedroomRoom,
      heroPlacementMap: placementMap,
    },
  );
  assert.match(opposite, /THIS camera faces the opposite direction/);
  assert.match(opposite, /every 'left' in the map appears on YOUR RIGHT/);
  assert.ok(
    opposite.indexOf("THIS camera faces the opposite direction") >
      opposite.indexOf("FURNITURE PLACEMENT MAP"),
    "translation note must follow the map",
  );

  const sameDirection = buildSecondaryRenderInstruction(
    plan,
    "camera faces east wall",
    undefined,
    undefined,
    {
      photoId: "photo-2",
      heroViewpoint: { x: 300, y: 1300, angleDeg: 0 },
      secondaryViewpoint: { x: 300, y: 2300, angleDeg: 10 },
      detectedRoom: bedroomRoom,
      heroPlacementMap: placementMap,
    },
  );
  assert.doesNotMatch(sameDirection, /THIS camera faces the opposite direction/);
});

test("hero-free secondary instruction never references a second image", () => {
  const planWithPhotoPrompts: RoomRenderPlan = {
    ...plan,
    photoPrompts: [
      {
        photoId: "photo-2",
        label: "View 2",
        stagingPrompt: "",
        renderInstruction:
          "PRESERVE: Keep geometry. CHANGE: Bunk bed on north wall from this west-facing camera.",
      },
    ],
  };
  for (const p of [planWithPhotoPrompts, plan]) {
    const prompt = buildSecondaryRenderInstruction(
      p,
      "camera faces west wall",
      undefined,
      { windows: 0, doors: 1 },
      {
        photoId: "photo-2",
        heroViewpoint: { x: 300, y: 1300, angleDeg: 0 },
        secondaryViewpoint: { x: 5350, y: 1300, angleDeg: 180 },
        detectedRoom: bedroomRoom,
        heroPlacementMap: "FURNITURE PLACEMENT MAP:\n- bed: NORTH wall",
        heroImageAttached: false,
      },
    );
    assert.match(prompt, /Only ONE image is provided/);
    assert.match(prompt, /master design described in the text below|master design \(described in text\)/);
    assert.match(prompt, /Decorative items — rug, cushions, wall art, curtains, plants — must be the identical items/);
    assert.doesNotMatch(prompt, /SECOND image/);
    assert.match(prompt, /OPPOSITE-CAMERA/);
  }
});

test("framing fallback derives door counts from the floor plan, never asserts zero", () => {
  const roomWithDoor: DetectedRoom = {
    ...bedroomRoom,
    // West wall = edge 3 of the polygon: (0,2600)→(0,0).
    doors: [
      { position: "west", width: 900, connectsTo: "hallway", edgeIndex: 3, t: 0.5, confirmed: true },
    ],
  };
  // Camera at the east end facing west — the door wall is dead ahead.
  const framing = resolveViewpointFraming({ x: 5350, y: 1300, angleDeg: 180 }, roomWithDoor);
  assert.deepEqual(framingFallbackOpeningCounts(framing), { windows: 0, doors: 1 });

  // Plan shows no doors in view → undefined (generic directive), NOT {doors: 0}.
  const noDoorFraming = resolveViewpointFraming({ x: 5350, y: 1300, angleDeg: 180 }, bedroomRoom);
  assert.equal(framingFallbackOpeningCounts(noDoorFraming), undefined);
  assert.equal(framingFallbackOpeningCounts(null), undefined);

  const prompt = buildSecondaryRenderInstruction(
    plan,
    null,
    undefined,
    framingFallbackOpeningCounts(framing),
  );
  assert.match(prompt, /There are exactly 1 door opening\(s\) in this photo/);
});

test("unanalyzed photo keeps door finish but forbids inventing doors", () => {
  const master = buildMasterRenderInstruction(plan, "photo-1");
  assert.match(master, /DOORS: Render every door-sized opening/);
  assert.match(
    master,
    /Never add a door or doorway that is not present in the original photo\./,
  );
  assert.doesNotMatch(master, /contain NO doors/);

  const secondary = buildSecondaryRenderInstruction(plan, "camera faces north wall");
  assert.match(secondary, /Never add a door or doorway that is not present in the original photo\./);
});
