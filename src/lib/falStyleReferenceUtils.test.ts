import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImageRolesBlock } from "./falStyleReferenceUtils";

test("buildImageRolesBlock heroDesignRef forbids copying hero camera and openings", () => {
  const block = buildImageRolesBlock({
    styleRefCount: 1,
    heroDesignRef: true,
  });

  assert.match(block, /approved design of this SAME room from another angle/);
  assert.match(block, /never reproduce the hero's camera angle/);
  assert.match(block, /Walls and openings not visible in image_urls\[0\]/);
});
