import assert from "node:assert/strict";
import { test } from "node:test";
import { stubGalleryEditBrief } from "./galleryEditBrief";
import { buildQuickRoomGalleryEditPrompt } from "./quickRoomGalleryEditPrompt";
import {
  isQuickRoomGalleryEditRequest,
  parseHasEditAnnotationFlag,
  parseQuickRoomGalleryEditFlag,
} from "./quickRoomGalleryEditEligibility";

test("isQuickRoomGalleryEditRequest when all flags match", () => {
  assert.equal(
    isQuickRoomGalleryEditRequest({
      quickRoomGalleryEditRaw: "true",
      tokenAction: "edit",
      editFeedback: "Remove the washing machine and add a table.",
      hasRoomImage: true,
    }),
    true,
  );
});

test("isQuickRoomGalleryEditRequest accepts without keepRoomShape", () => {
  assert.equal(
    isQuickRoomGalleryEditRequest({
      quickRoomGalleryEditRaw: "1",
      tokenAction: "edit",
      editFeedback: "Add a chandelier.",
      hasRoomImage: true,
    }),
    true,
  );
});

test("isQuickRoomGalleryEditRequest rejects missing feedback", () => {
  assert.equal(
    isQuickRoomGalleryEditRequest({
      quickRoomGalleryEditRaw: "true",
      tokenAction: "edit",
      editFeedback: "  ",
      hasRoomImage: true,
    }),
    false,
  );
});

test("parseQuickRoomGalleryEditFlag and parseHasEditAnnotationFlag", () => {
  assert.equal(parseQuickRoomGalleryEditFlag("1"), true);
  assert.equal(parseQuickRoomGalleryEditFlag("false"), false);
  assert.equal(parseHasEditAnnotationFlag("true"), true);
});

test("buildQuickRoomGalleryEditPrompt preserves user edit and ONLY language", () => {
  const prompt = buildQuickRoomGalleryEditPrompt(
    "Remove the washing machine and add a dining table.",
  );
  assert.match(prompt, /Remove the washing machine and add a dining table/);
  assert.match(prompt, /Apply ONLY the user change/i);
  assert.match(prompt, /preserve the approved design/i);
  assert.match(prompt, /NO TEXT IN IMAGE/);
});

test("buildQuickRoomGalleryEditPrompt mentions annotation when flagged", () => {
  const prompt = buildQuickRoomGalleryEditPrompt("Add a chandelier here", true);
  assert.match(prompt, /marked in red/i);
  assert.match(prompt, /SECOND image/);
});

test("stubGalleryEditBrief carries prior fields", () => {
  const brief = stubGalleryEditBrief({
    fullPrompt: "Scandinavian living room",
    subject: "Cozy sofa",
    cameraAngle: "Wide angle",
  });
  assert.equal(brief.fullPrompt, "Scandinavian living room");
  assert.equal(brief.subject, "Cozy sofa");
  assert.equal(brief.cameraAngle, "Wide angle");
});
