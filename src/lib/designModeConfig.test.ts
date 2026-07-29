import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isMadeDesignModeAvailable,
  resolveDesignMode,
  resolveDesignModeForRequest,
} from "./designModeConfig";

test("isMadeDesignModeAvailable is true for Armenia local catalog", () => {
  assert.equal(isMadeDesignModeAvailable("AM", "local"), true);
  assert.equal(isMadeDesignModeAvailable("am", "տեղական"), true);
});

test("isMadeDesignModeAvailable is false outside local scraped catalog", () => {
  assert.equal(isMadeDesignModeAvailable("US", "local"), false);
  assert.equal(isMadeDesignModeAvailable("AM", "global"), false);
  assert.equal(isMadeDesignModeAvailable("", "local"), false);
});

test("resolveDesignMode keeps made for Armenia local", () => {
  assert.equal(resolveDesignMode("made", { countryCode: "AM", searchMode: "local" }), "made");
});

test("resolveDesignMode coerces made to custom outside catalog", () => {
  assert.equal(resolveDesignMode("made", { countryCode: "US", searchMode: "local" }), "custom");
  assert.equal(resolveDesignMode("made", { countryCode: "AM", searchMode: "global" }), "custom");
});

test("resolveDesignMode keeps custom everywhere", () => {
  assert.equal(resolveDesignMode("custom", { countryCode: "US", searchMode: "local" }), "custom");
});

test("resolveDesignModeForRequest coerces made when catalog unavailable", () => {
  assert.equal(resolveDesignModeForRequest("made", "US", "local"), "custom");
  assert.equal(resolveDesignModeForRequest("made", "AM", "local"), "made");
});
