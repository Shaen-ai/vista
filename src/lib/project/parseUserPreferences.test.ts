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

test("parseUserPreferences coerces made to custom while made mode is hidden", () => {
  const prefs = parseUserPreferences({ designMode: "made", style: "modern" });
  assert.equal(prefs.designMode, "custom");
});
