import { test } from "node:test";
import assert from "node:assert/strict";
import { appendSecondaryLayoutLock } from "./secondaryLayoutLock";
import { buildSecondaryViewpointPromptParts } from "./project/secondaryViewpointPromptParts";
import {
  crossViewRetryScore,
  parseCrossViewValidationJson,
  skippedCrossViewResult,
} from "./crossViewValidationParse";

test("appendSecondaryLayoutLock adds full lock once", () => {
  const base = "Same room, different camera angle.";
  const out = appendSecondaryLayoutLock(base);
  assert.match(out, /LAYOUT LOCK/);
  assert.match(out, /Same room, different camera angle/);
  assert.equal(appendSecondaryLayoutLock(out), out);
});

test("appendSecondaryLayoutLock compact form", () => {
  const out = appendSecondaryLayoutLock("Render secondary view.", true);
  assert.match(out, /Furniture layout lock:/);
  assert.doesNotMatch(out, /LAYOUT LOCK \(strict/);
});

test("buildSecondaryViewpointPromptParts includes compact layout lock", () => {
  const prompt = buildSecondaryViewpointPromptParts({
    framingNote: "From doorway",
    openingLock: "Keep window on far wall.",
    designPrompt: "Modern bedroom with oak wardrobe.",
  });
  assert.match(prompt, /CAMERA VIEW/);
  assert.match(prompt, /Furniture layout lock:/);
  assert.match(prompt, /Modern bedroom with oak wardrobe/);
});

test("parseCrossViewValidationJson parses match and mismatches", () => {
  const result = parseCrossViewValidationJson(
    {
      match: false,
      mismatches: ["Wardrobe on wrong wall", "Different desk chair"],
      correctiveFeedback: "Move wardrobe to window wall; use cream chair from hero.",
    },
    ["wardrobe", "desk", "chair"],
  );
  assert.equal(result.match, false);
  assert.equal(result.mismatches.length, 2);
  assert.match(result.correctiveFeedback, /Move wardrobe/);
  assert.equal(result.skipped, false);
});

test("parseCrossViewValidationJson tolerates malformed fields", () => {
  const result = parseCrossViewValidationJson({ match: true }, ["bed"]);
  assert.equal(result.match, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.correctiveFeedback, "");
});

test("crossViewRetryScore prefers match over mismatches", () => {
  assert.ok(crossViewRetryScore({ match: true, mismatches: [], correctiveFeedback: "", skipped: false }) >
    crossViewRetryScore({
      match: false,
      mismatches: ["a", "b"],
      correctiveFeedback: "fix",
      skipped: false,
    }));
  assert.equal(crossViewRetryScore(skippedCrossViewResult("skip")), 0);
});

test("skippedCrossViewResult is treated as pass-through", () => {
  const skipped = skippedCrossViewResult("validation skipped");
  assert.equal(skipped.match, true);
  assert.equal(skipped.skipped, true);
});
