import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import {
  buildQuickRoomEditInstruction,
  buildQuickRoomImageRoles,
} from "./quickEditPrompt";

const brief: Pick<DesignBrief, "subject" | "arrangement" | "fullPrompt" | "doorDesign"> = {
  subject: "Cozy scandinavian living room with a sage green sofa.",
  arrangement: "Sofa against the north wall, round rug in the center.",
  fullPrompt: "A calm scandinavian living room in soft whites and sage greens. ".repeat(10),
  doorDesign: "Matte white door leaf with brass handle.",
};

test("image roles: first image is sole geometry authority", () => {
  const roles = buildQuickRoomImageRoles({
    collageSheetCount: 0,
    hasStyleInspiration: false,
    hasStructuralMarkup: false,
  });
  assert.match(roles, /IMAGE ROLES/);
  assert.match(roles, /FIRST image is the real photo .* ONLY authority for geometry/);
  assert.match(roles, /Geometry comes exclusively from the first image/);
  assert.doesNotMatch(roles, /PRODUCT REFERENCE/);
});

test("image roles enumerate product sheets, style inspiration, and structural markup", () => {
  const roles = buildQuickRoomImageRoles({
    collageSheetCount: 3,
    hasStyleInspiration: true,
    hasStructuralMarkup: true,
  });
  assert.match(roles, /Images 2-4 are PRODUCT REFERENCE SHEETS/);
  assert.match(roles, /NEVER render a collage sheet itself/);
  assert.match(roles, /Image 5 is the user's STYLE INSPIRATION/);
  assert.match(roles, /LAST image is the same room photo with GOLD LINES/);
  assert.match(roles, /Never draw gold lines in the output/);
});

test("single sheet uses singular image role numbering", () => {
  const roles = buildQuickRoomImageRoles({
    collageSheetCount: 1,
    hasStyleInspiration: true,
    hasStructuralMarkup: false,
  });
  assert.match(roles, /Image 2 is a PRODUCT REFERENCE SHEET/);
  assert.match(roles, /Image 3 is the user's STYLE INSPIRATION/);
});

test("edit instruction carries PRESERVE scaffold with opening counts", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Scandinavian",
    openingBoxCounts: { windows: 2, doors: 1 },
    imageRoles: "IMAGE ROLES: test.",
  });
  assert.match(prompt, /^IMAGE ROLES: test\./);
  assert.match(prompt, /PRESERVE: Keep the exact room geometry/);
  assert.match(prompt, /Protect 2 window\(s\) in their exact positions/);
  assert.match(prompt, /1 door opening\(s\) in their exact positions/);
  assert.match(prompt, /exactly 1 door opening\(s\) in this photo/);
  assert.match(prompt, /CHANGE: Redesign this room as a photorealistic Scandinavian interior/);
  assert.match(prompt, /Design: Cozy scandinavian living room/);
  assert.match(prompt, /Furniture arrangement: Sofa against the north wall/);
  assert.match(prompt, /Door styling: Matte white door leaf/);
});

test("zero doors asserts NO doors; unknown counts forbid inventing doors", () => {
  const zeroDoors = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Modern",
    openingBoxCounts: { windows: 1, doors: 0 },
    imageRoles: "ROLES.",
  });
  assert.match(zeroDoors, /walls visible in this photo contain NO doors/);

  const unknown = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Modern",
    imageRoles: "ROLES.",
  });
  assert.match(unknown, /Never add a door or doorway that is not present/);
});

test("product manifest text is never trimmed; brief fullPrompt and appendix drop under budget pressure", () => {
  const bigIntro = "PRODUCT IMAGES BELOW. ".repeat(100);
  const bigClose = `IMAGE MANIFEST: Sheet1-A1 = mp-1. ${"Pinned by user — MANDATORY. ".repeat(120)}`;
  const appendix = "MERCHANT CATALOG: ".repeat(300);
  const prompt = buildQuickRoomEditInstruction({
    brief: { ...brief, fullPrompt: "UNIQUE-DESIGN-DIRECTION ".repeat(200) },
    designStyleLabel: "Modern",
    imageRoles: "ROLES.",
    productIntroText: bigIntro,
    productCloseText: bigClose,
    merchantAppendix: appendix,
  });
  assert.match(prompt, /PRODUCT IMAGES BELOW/);
  assert.match(prompt, /IMAGE MANIFEST/);
  assert.doesNotMatch(prompt, /UNIQUE-DESIGN-DIRECTION/);
  assert.doesNotMatch(prompt, /MERCHANT CATALOG/);
});

test("under budget everything is included, appendix capped at 3800 chars", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Modern",
    imageRoles: "ROLES.",
    productIntroText: "INTRO.",
    productCloseText: "MANIFEST.",
    merchantAppendix: "APPENDIX-LINE. ",
    editContext: "Make the rug blue.",
  });
  assert.match(prompt, /INTRO\./);
  assert.match(prompt, /MANIFEST\./);
  assert.match(prompt, /APPENDIX-LINE\./);
  assert.match(prompt, /Design direction: A calm scandinavian living room/);
  assert.match(prompt, /User adjustments: Make the rug blue\./);
});

test("surface material overrides become a mandatory finishes sentence", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Modern",
    imageRoles: "ROLES.",
    surfaceMaterials: { floor: "light oak parquet", walls: "sage green paint" },
  });
  assert.match(prompt, /Surface finishes \(user-selected, mandatory\): floor: light oak parquet; walls: sage green paint\./);
});
