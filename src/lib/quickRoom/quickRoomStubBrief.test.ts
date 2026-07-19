import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildQuickRoomRenderSession,
  buildQuickRoomStubBrief,
} from "./quickRoomStubBrief";

test("buildQuickRoomStubBrief populates prompt fields from text", () => {
  const brief = buildQuickRoomStubBrief({
    textPrompt: "Warm minimalist living room with oak floors",
    designStyleLabel: "Modern",
    roomType: "living room",
  });
  assert.equal(brief.fullPrompt, "Warm minimalist living room with oak floors");
  assert.equal(brief.subject, "Warm minimalist living room with oak floors");
  assert.equal(brief.style, "Modern");
  assert.equal(brief.roomType, "living room");
  assert.deepEqual(brief.requiredSlots, []);
  assert.deepEqual(brief.selectedCatalogIds, []);
});

test("buildQuickRoomRenderSession maps pinned product ids to mp keys", () => {
  process.env.FAL_KEY = "test-key";
  const form = new FormData();
  form.set("textPrompt", "Cozy bedroom");
  form.set("style", "modern");
  form.set("roomType", "bedroom");
  form.set("designBoardProductIds", JSON.stringify([42, 99]));

  const session = buildQuickRoomRenderSession(form);
  assert.equal(session.isCustomMode, true);
  assert.equal(session.scrapedInventoryExclusive, false);
  assert.deepEqual(session.designBoardProductIds, [42, 99]);
  assert.deepEqual(session.selectedForGemini, ["mp-42", "mp-99"]);
  assert.equal(session.brief.fullPrompt, "Cozy bedroom");
  assert.equal(session.renderMode, "initial");
  assert.equal(session.renderEngine, "edit-pipeline");
});
