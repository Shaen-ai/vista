import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuickRoomBananaImageRoles } from "./quickEditPrompt";

test("banana image roles: shell first, then sheets, then style", () => {
  const roles = buildQuickRoomBananaImageRoles({
    collageSheetCount: 2,
    hasStyleInspiration: true,
  });
  assert.equal(roles[0], "0: staged shell — geometry authority (apartment-staging output)");
  assert.equal(roles[1], "1: product reference sheet 1");
  assert.equal(roles[2], "2: product reference sheet 2");
  assert.equal(roles[3], "3: style inspiration (palette/mood only)");
});

test("banana image roles: shell only when no refs", () => {
  const roles = buildQuickRoomBananaImageRoles({
    collageSheetCount: 0,
    hasStyleInspiration: false,
  });
  assert.deepEqual(roles, ["0: staged shell — geometry authority (apartment-staging output)"]);
});
