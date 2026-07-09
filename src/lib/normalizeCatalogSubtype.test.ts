import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCatalogSubtype } from "./normalizeCatalogSubtype";

describe("normalizeCatalogSubtype", () => {
  it("maps armchair to chair", () => {
    assert.equal(normalizeCatalogSubtype("furniture", "armchair"), "chair");
  });

  it("maps coffee table variants to coffee_table", () => {
    assert.equal(normalizeCatalogSubtype("furniture", "coffee table"), "coffee_table");
    assert.equal(normalizeCatalogSubtype("furniture", "side table"), "coffee_table");
  });

  it("maps area rug to rug", () => {
    assert.equal(normalizeCatalogSubtype("flooring", "area rug"), "rug");
  });

  it("maps lighting free-form strings", () => {
    assert.equal(normalizeCatalogSubtype("lighting", "pendant ceiling light"), "pendant");
    assert.equal(normalizeCatalogSubtype("lighting", "arc floor lamp"), "floor");
  });
});
