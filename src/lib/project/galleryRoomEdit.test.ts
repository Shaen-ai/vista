import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGalleryEditPrompt, isGalleryEditEligible } from "./galleryRoomEdit";

test("isGalleryEditEligible when all targets have renders", () => {
  assert.equal(isGalleryEditEligible(2, 2), true);
  assert.equal(isGalleryEditEligible(1, 1), true);
  assert.equal(isGalleryEditEligible(1, 2), false);
});

test("buildGalleryEditPrompt preserves user edit and forbids text overlays", () => {
  const prompt = buildGalleryEditPrompt("Add a wardrobe on the north wall", {
    note: "camera facing east",
  } as { note: string });
  assert.match(prompt, /Add a wardrobe on the north wall/);
  assert.match(prompt, /preserve the approved design/i);
  assert.match(prompt, /NO TEXT IN IMAGE/);
  assert.match(prompt, /camera facing east/);
});

test("buildGalleryEditPrompt mentions marked area when annotation attached", () => {
  const prompt = buildGalleryEditPrompt("Add a chandelier here", null, true);
  assert.match(prompt, /marked in red/i);
});
