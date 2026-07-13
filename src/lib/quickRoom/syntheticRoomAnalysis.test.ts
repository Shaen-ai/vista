import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSyntheticQuickRoomAnalysis,
  resolveQuickRoomType,
} from "./syntheticRoomAnalysis";

test("resolveQuickRoomType prefers form value", () => {
  assert.equal(resolveQuickRoomType("kitchen", null), "kitchen");
});

test("resolveQuickRoomType falls back to analysis then living room", () => {
  const analysis = buildSyntheticQuickRoomAnalysis("bedroom");
  assert.equal(resolveQuickRoomType("", analysis), "bedroom");
  assert.equal(resolveQuickRoomType(null, null), "living room");
});

test("synthetic analysis carries room type only", () => {
  const analysis = buildSyntheticQuickRoomAnalysis("dining room");
  assert.equal(analysis.room_type, "dining room");
  assert.equal(analysis.window_count, 0);
});
