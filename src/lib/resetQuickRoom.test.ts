import assert from "node:assert/strict";
import test from "node:test";
import { useConsumerDesignStore } from "@/app/store";
import { markJustHydratedFromHub, consumeJustHydratedFromHub } from "@/lib/projectHydrationSkip";

test("resetQuickRoom clears generation state and project id", () => {
  useConsumerDesignStore.getState().reset();

  const store = useConsumerDesignStore.getState();
  store.setGeneratedImage("img123", "image/png");
  store.setQuickRoomView("result");
  store.setCurrentProjectDbId("project-abc");
  store.setTextPrompt("modern living room");
  store.setRoomImage("room123", "image/jpeg");

  store.resetQuickRoom();

  const after = useConsumerDesignStore.getState();
  assert.equal(after.generatedImageBase64, null);
  assert.equal(after.generatedImageMimeType, null);
  assert.equal(after.quickRoomView, "compose");
  assert.equal(after.currentProjectDbId, null);
  assert.equal(after.textPrompt, "");
  assert.equal(after.roomImageBase64, null);
  assert.equal(after.searchQuery, "");
});

test("markJustHydratedFromHub is consumed once", () => {
  assert.equal(consumeJustHydratedFromHub(), false);
  markJustHydratedFromHub();
  assert.equal(consumeJustHydratedFromHub(), true);
  assert.equal(consumeJustHydratedFromHub(), false);
});
