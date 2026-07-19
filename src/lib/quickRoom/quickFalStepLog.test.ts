import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuickRoomBananaImageRoles } from "./quickEditPrompt";

test("banana image roles: shell first, then product sheets only", () => {
  const roles = buildQuickRoomBananaImageRoles({
    collageSheetCount: 2,
  });
  assert.equal(roles[0], "0: staged shell — geometry authority (apartment-staging output)");
  assert.equal(roles[1], "1: product reference sheet 1");
  assert.equal(roles[2], "2: product reference sheet 2");
  assert.equal(roles.length, 3);
});

test("banana image roles: shell only when no refs", () => {
  const roles = buildQuickRoomBananaImageRoles({
    collageSheetCount: 0,
  });
  assert.deepEqual(roles, ["0: staged shell — geometry authority (apartment-staging output)"]);
});
