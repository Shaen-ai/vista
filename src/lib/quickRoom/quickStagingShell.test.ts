import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuickStagingShellPrompt } from "./quickStagingShellPrompt";

test("staging shell prompt locks structure and forbids furniture", () => {
  const prompt = buildQuickStagingShellPrompt("Scandinavian");
  assert.match(prompt, /Keep walls, doors, windows, ceiling, floor, and camera exactly/);
  assert.match(prompt, /Apply Scandinavian wall, floor, and ceiling finishes/);
  assert.match(prompt, /Empty room\. No furniture\. No decor/);
  assert.ok(prompt.length < 300);
});
