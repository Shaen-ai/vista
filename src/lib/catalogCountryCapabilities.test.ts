import assert from "node:assert/strict";
import { test } from "node:test";
import { hasLocalProductCatalog } from "./catalogCountryCapabilities";

test("hasLocalProductCatalog is true for Armenia local mode", () => {
  assert.equal(hasLocalProductCatalog("AM", "local"), true);
  assert.equal(hasLocalProductCatalog("am", "տեղական"), true);
});

test("hasLocalProductCatalog is false outside local scraped countries", () => {
  assert.equal(hasLocalProductCatalog("US", "local"), false);
  assert.equal(hasLocalProductCatalog("AM", "global"), false);
  assert.equal(hasLocalProductCatalog("DE", "local"), false);
});
