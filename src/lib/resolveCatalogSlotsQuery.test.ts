import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSlotIntentSearchQuery } from "./resolveCatalogSlots";

describe("buildSlotIntentSearchQuery", () => {
  it("truncates at word boundary instead of mid-word hyphen", () => {
    const designIntent =
      "This living room is conceived as a refined contemporary modern interior built on a warm neutral-toned palette with soft textures";
    const query = buildSlotIntentSearchQuery(["linear-pendant", "lighting", designIntent], 120);

    assert.ok(query.length <= 120);
    assert.ok(!query.endsWith("-"));
    assert.ok(query.includes("linear-pendant"));
    assert.ok(query.includes("lighting"));
    assert.ok(!query.includes("neutral-"));
  });

  it("returns joined parts when under max length", () => {
    assert.equal(buildSlotIntentSearchQuery(["sofa", "furniture", "modern grey"]), "sofa furniture modern grey");
  });

  it("falls back to family-only callers when empty", () => {
    assert.equal(buildSlotIntentSearchQuery([]), "");
  });
});
