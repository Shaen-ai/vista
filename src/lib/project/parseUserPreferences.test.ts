import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUserPreferences } from "./types";

test("parseUserPreferences preserves custom designMode", () => {
  const prefs = parseUserPreferences({ designMode: "custom", style: "modern" });
  assert.equal(prefs.designMode, "custom");
});

test("parseUserPreferences defaults invalid designMode to custom", () => {
  const prefs = parseUserPreferences({ designMode: "other" });
  assert.equal(prefs.designMode, "custom");
});

test("parseUserPreferences preserves made designMode when made mode is enabled", () => {
  const prefs = parseUserPreferences({
    designMode: "made",
    style: "modern",
    countryCode: "AM",
    searchMode: "local",
  });
  assert.equal(prefs.designMode, "made");
});

test("parseUserPreferences coerces made to custom outside local catalog", () => {
  const prefs = parseUserPreferences({
    designMode: "made",
    style: "modern",
    countryCode: "US",
    searchMode: "local",
  });
  assert.equal(prefs.designMode, "custom");
});
