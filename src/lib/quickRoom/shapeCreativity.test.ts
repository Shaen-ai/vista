import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHAPE_CREATIVITY,
  clampShapeCreativity,
  parseShapeCreativityParam,
  resolveShapeCreativity,
} from "./shapeCreativity";

test("clampShapeCreativity rounds and clamps to 0..10", () => {
  assert.equal(clampShapeCreativity(5.4), 5);
  assert.equal(clampShapeCreativity(-1), 0);
  assert.equal(clampShapeCreativity(99), 10);
  assert.equal(clampShapeCreativity("3"), 3);
  assert.equal(clampShapeCreativity("nope"), DEFAULT_SHAPE_CREATIVITY);
});

test("parseShapeCreativityParam defaults to 5 when missing", () => {
  assert.equal(parseShapeCreativityParam(null), 5);
  assert.equal(parseShapeCreativityParam(""), 5);
  assert.equal(parseShapeCreativityParam("7"), 7);
});

test("resolveShapeCreativity level 0 — shell 1.5 veryStrong", () => {
  const cfg = resolveShapeCreativity(0);
  assert.equal(cfg.level, 0);
  assert.equal(cfg.runShell, true);
  assert.equal(cfg.loraScale, 1.5);
  assert.equal(cfg.preserveMode, "veryStrong");
  assert.equal(cfg.creativeMode, "none");
});

test("resolveShapeCreativity level 5 — shell 1.0 strong", () => {
  const cfg = resolveShapeCreativity(5);
  assert.equal(cfg.loraScale, 1.0);
  assert.equal(cfg.preserveMode, "strong");
  assert.equal(cfg.creativeMode, "none");
});

test("resolveShapeCreativity level 8 — shell 0.7 soft", () => {
  const cfg = resolveShapeCreativity(8);
  assert.equal(cfg.loraScale, 0.7);
  assert.equal(cfg.preserveMode, "soft");
});

test("resolveShapeCreativity level 9 — no shell creative", () => {
  const cfg = resolveShapeCreativity(9);
  assert.equal(cfg.runShell, false);
  assert.equal(cfg.loraScale, undefined);
  assert.equal(cfg.preserveMode, "strong");
  assert.equal(cfg.creativeMode, "creative");
});

test("resolveShapeCreativity level 10 — no shell moreCreative", () => {
  const cfg = resolveShapeCreativity(10);
  assert.equal(cfg.runShell, false);
  assert.equal(cfg.creativeMode, "moreCreative");
});
