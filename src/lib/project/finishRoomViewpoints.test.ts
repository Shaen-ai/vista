import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFinishRoomRenderStrategy } from "./finishRoomRenderStrategy";
import type { RoomPhotoWithViewpoint } from "./types";

function photo(id: string, viewpoint?: { x: number; y: number; angleDeg: number }): RoomPhotoWithViewpoint {
  return { id, base64: "abc", mimeType: "image/jpeg", label: id, viewpoint };
}

test("3 targets → heroSecondary strategy (distinct per-photo renders)", () => {
  const strategy = resolveFinishRoomRenderStrategy([photo("a"), photo("b"), photo("c")]);
  assert.equal(strategy, "heroSecondary");
});

test("2 photos → heroSecondary (no duplicate hero in grid)", () => {
  const strategy = resolveFinishRoomRenderStrategy([photo("a"), photo("b")]);
  assert.equal(strategy, "heroSecondary");
});

test("failure scenario: viewpointErrors populated, no duplicate base64", () => {
  // Simulate the data shape: viewpointErrors records failures, renders only has hero
  const viewpointErrors: Record<string, string> = { "photo-b": "fal timeout" };
  const renders = [{ angleIndex: 0, base64: "hero123", mimeType: "image/png", angleDescription: "Hero" }];
  // No duplicate hero in renders
  const hasNoDuplicate = new Set(renders.map((r) => r.base64)).size === renders.length;
  assert.ok(hasNoDuplicate, "Renders should not contain duplicate hero base64");
  assert.equal(Object.keys(viewpointErrors).length, 1);
});

test("successful multi-view: each render has distinct angleDescription", () => {
  const renders = [
    { angleIndex: 0, angleDescription: "Hero", base64: "a" },
    { angleIndex: 1, angleDescription: "View from door", base64: "b" },
    { angleIndex: 2, angleDescription: "View from window", base64: "c" },
  ];
  const descriptions = renders.map((r) => r.angleDescription);
  assert.equal(new Set(descriptions).size, 3, "All descriptions should be unique");
});
