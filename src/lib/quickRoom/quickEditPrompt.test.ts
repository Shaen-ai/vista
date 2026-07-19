import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import {
  PROMPT_CHAR_CAP,
  buildPreserveBlock,
  buildQuickRoomBananaImageRoles,
  buildQuickRoomEditInstruction,
  buildQuickRoomImageRoles,
  buildStyleInspirationPromptBlock,
} from "./quickEditPrompt";

const brief: Pick<DesignBrief, "subject" | "arrangement"> = {
  subject: "Cozy scandinavian living room with a sage green sofa.",
  arrangement: "Sofa against the north wall, round rug in the center.",
};

test("image roles: staged shell is sole geometry authority", () => {
  const roles = buildQuickRoomImageRoles({
    collageSheetCount: 0,
    runShell: true,
  });
  assert.match(roles, /FIRST image is the staged empty room/);
  assert.match(roles, /sole authority for walls, openings, ceiling, floor, and camera/);
  assert.doesNotMatch(roles, /PRODUCT REFERENCE/);
  assert.doesNotMatch(roles, /STYLE INSPIRATION/);
});

test("image roles: original photo when runShell is false", () => {
  const roles = buildQuickRoomImageRoles({
    collageSheetCount: 0,
    runShell: false,
  });
  assert.match(roles, /FIRST image is the original room photo/);
  assert.doesNotMatch(roles, /staged empty room/);
});

test("banana image roles: original photo when runShell is false", () => {
  const roles = buildQuickRoomBananaImageRoles({
    collageSheetCount: 0,
    runShell: false,
  });
  assert.equal(roles[0], "0: original room photo — geometry authority");
});

test("image roles enumerate product sheets only (no style image index)", () => {
  const roles = buildQuickRoomImageRoles({
    collageSheetCount: 2,
    runShell: true,
  });
  assert.match(roles, /Images 2-3 are PRODUCT REFERENCE SHEETS/);
  assert.doesNotMatch(roles, /STYLE INSPIRATION/);
});

test("style inspiration prompt block forbids geometry copy", () => {
  const block = buildStyleInspirationPromptBlock(
    "STYLE FROM INSPIRATION: warm neutrals, oak floors, soft daylight.",
  );
  assert.match(block, /text only — do NOT copy any room geometry/);
  assert.match(block, /FIRST image's room only/);
});

test("edit instruction injects style inspiration text in core prompt", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Scandinavian",
    imageRoles: "IMAGE ROLES: test.",
    styleInspirationText: "STYLE FROM INSPIRATION: warm oak and linen.",
  });
  assert.match(prompt, /STYLE INSPIRATION \(text only/);
  assert.match(prompt, /warm oak and linen/);
  assert.match(prompt, /PRESERVE: Keep the exact room shape from the FIRST image/);
});

test("preserve block always present for all modes", () => {
  assert.match(buildPreserveBlock("veryStrong"), /^PRESERVE:/);
  assert.match(buildPreserveBlock("strong"), /^PRESERVE:/);
  assert.match(buildPreserveBlock("soft"), /^PRESERVE:/);
  assert.doesNotMatch(buildPreserveBlock("soft"), /drift|may change|can change/i);
});

test("edit instruction uses place-only CHANGE when placementMode is placeOnly", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Scandinavian",
    imageRoles: "IMAGE ROLES: test.",
    placementMode: "placeOnly",
  });
  assert.match(prompt, /CHANGE: Place only the user-provided product\(s\)/);
  assert.doesNotMatch(prompt, /CHANGE: Furnish this room/);
});

test("edit instruction preserves room shape and caps length", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Scandinavian",
    imageRoles: "IMAGE ROLES: test.",
    productIntroText: "INTRO. ".repeat(200),
    productCloseText: "MANIFEST. ".repeat(200),
    editContext: "Make the rug blue.",
  });
  assert.match(prompt, /PRESERVE: Keep the exact room shape from the FIRST image/);
  assert.match(prompt, /CHANGE: Furnish this room as a photorealistic Scandinavian interior/);
  assert.match(prompt, /Focus: Cozy scandinavian living room/);
  assert.match(prompt, /Adjustments: Make the rug blue\./);
  assert.ok(prompt.length <= PROMPT_CHAR_CAP);
  assert.doesNotMatch(prompt, /MERCHANT/);
});

test("veryStrong preserve adds extra geometry lock", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Modern",
    imageRoles: "ROLES.",
    preserveMode: "veryStrong",
  });
  assert.match(prompt, /Do not alter room geometry, openings, or perspective/);
});

test("creative mode uses expressive CHANGE wording", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Modern",
    imageRoles: "ROLES.",
    creativeMode: "creative",
  });
  assert.match(prompt, /fresh, expressive Modern interior/);
  assert.match(prompt, /PRESERVE:/);
});

test("moreCreative mode uses bold CHANGE wording", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Modern",
    imageRoles: "ROLES.",
    creativeMode: "moreCreative",
  });
  assert.match(prompt, /bold, imaginative Modern interior/);
});

test("product manifest text is included when within budget", () => {
  const prompt = buildQuickRoomEditInstruction({
    brief,
    designStyleLabel: "Modern",
    imageRoles: "ROLES.",
    productIntroText: "PRODUCT IMAGES BELOW.",
    productCloseText: "IMAGE MANIFEST: Sheet1-A1 = mp-1.",
  });
  assert.match(prompt, /PRODUCT IMAGES BELOW/);
  assert.match(prompt, /IMAGE MANIFEST/);
});
