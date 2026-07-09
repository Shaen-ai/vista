import assert from "node:assert/strict";
import test from "node:test";
import { resolveProjectTokenAction } from "./projectTokenAction";

test("resolveProjectTokenAction maps billable actions", () => {
  assert.equal(resolveProjectTokenAction("generate"), "generate");
  assert.equal(resolveProjectTokenAction("regenerate"), "regenerate");
  assert.equal(resolveProjectTokenAction("edit"), "edit");
  assert.equal(resolveProjectTokenAction("sync-gallery"), "edit");
  assert.equal(resolveProjectTokenAction("next-viewpoint"), "generate");
  assert.equal(resolveProjectTokenAction("next-viewpoint", { redo: true }), "regenerate");
});

test("resolveProjectTokenAction returns null for free actions", () => {
  for (const action of [
    "approve",
    "approve-room",
    "approve-viewpoint",
    "select",
    "finish",
    "remove-render",
  ]) {
    assert.equal(resolveProjectTokenAction(action), null);
  }
});
