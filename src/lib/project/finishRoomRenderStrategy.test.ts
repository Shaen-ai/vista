import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFinishRoomRenderStrategy } from "./finishRoomRenderStrategy";
import type { RoomPhotoWithViewpoint } from "./types";

function photo(id: string, viewpoint?: { x: number; y: number; angleDeg: number }): RoomPhotoWithViewpoint {
  return {
    id,
    base64: "abc",
    mimeType: "image/jpeg",
    label: id,
    viewpoint,
  };
}

test("resolveFinishRoomRenderStrategy uses heroSecondary for 2+ photos with viewpoints", () => {
  const strategy = resolveFinishRoomRenderStrategy([
    photo("a", { x: 1000, y: 2000, angleDeg: 90 }),
    photo("b"),
  ]);
  assert.equal(strategy, "heroSecondary");
});

test("resolveFinishRoomRenderStrategy uses heroSecondary for 2+ photos without viewpoints", () => {
  const strategy = resolveFinishRoomRenderStrategy([photo("a"), photo("b")]);
  assert.equal(strategy, "heroSecondary");
});

test("resolveFinishRoomRenderStrategy never uses angleVariations when 2+ photos exist", () => {
  const strategy = resolveFinishRoomRenderStrategy([photo("a"), photo("b"), photo("c")]);
  assert.equal(strategy, "heroSecondary");
});

test("resolveFinishRoomRenderStrategy uses viewpoint for single photo with viewpoint", () => {
  const strategy = resolveFinishRoomRenderStrategy([
    photo("a", { x: 1000, y: 2000, angleDeg: 90 }),
  ]);
  assert.equal(strategy, "viewpoint");
});

test("resolveFinishRoomRenderStrategy uses photo reference for a single photo without viewpoint", () => {
  const strategy = resolveFinishRoomRenderStrategy([photo("a")]);
  assert.equal(strategy, "photoReference");
});

test("resolveFinishRoomRenderStrategy falls back to angle variations when no photos assigned", () => {
  const strategy = resolveFinishRoomRenderStrategy([]);
  assert.equal(strategy, "angleVariations");
});
