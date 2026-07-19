import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatStyleInspirationProse,
  parseStyleInspirationExtractFromText,
} from "./extractStyleInspirationBriefFormat";

test("formatStyleInspirationProse prefers styleSummary", () => {
  const prose = formatStyleInspirationProse({
    styleSummary: "Warm minimal living room with oak, linen, and soft daylight.",
    palette: "ignored when summary present",
  });
  assert.match(prose, /^STYLE FROM INSPIRATION: Warm minimal living room/);
});

test("formatStyleInspirationProse joins fields when no summary", () => {
  const prose = formatStyleInspirationProse({
    palette: "warm neutrals and sage green accents",
    materials: "light oak, linen, matte ceramic",
    lightingMood: "soft natural daylight",
    furnitureCharacter: "Scandinavian minimal",
    decorDensity: "balanced",
  });
  assert.match(prose, /warm neutrals/);
  assert.match(prose, /light oak/);
  assert.match(prose, /Scandinavian minimal/);
});

test("formatStyleInspirationProse returns empty for blank extract", () => {
  assert.equal(formatStyleInspirationProse({}), "");
});

test("parseStyleInspirationExtractFromText parses JSON object", () => {
  const parsed = parseStyleInspirationExtractFromText(
    'Here is the result:\n{"palette":"cool greys","styleSummary":"Modern grey loft mood."}',
  );
  assert.equal(parsed?.palette, "cool greys");
  assert.equal(parsed?.styleSummary, "Modern grey loft mood.");
});

test("parseStyleInspirationExtractFromText returns null on invalid JSON", () => {
  assert.equal(parseStyleInspirationExtractFromText("not json"), null);
});
