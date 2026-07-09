import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeUserFacingMessage } from "./userFacingMessages.ts";

test("sanitizeUserFacingMessage maps known FAL errors", () => {
  assert.equal(sanitizeUserFacingMessage("FAL render failed"), "Render failed");
  assert.equal(sanitizeUserFacingMessage("All FAL renders failed"), "All renders failed");
});

test("sanitizeUserFacingMessage strips provider names from progress text", () => {
  assert.equal(
    sanitizeUserFacingMessage("Claude is reading the floor plan for all rooms..."),
    "Reading floor plan for all rooms…",
  );
  assert.equal(sanitizeUserFacingMessage("Rendering with FAL…"), "Rendering design…");
  assert.equal(sanitizeUserFacingMessage("Applying edits with FAL…"), "Applying your edits…");
});

test("sanitizeUserFacingMessage strips dev config leaks", () => {
  const raw =
    "AI keys are missing. Add ANTHROPIC_API_KEY to vista/.env.local — see .env.example.";
  const out = sanitizeUserFacingMessage(raw);
  assert.doesNotMatch(out, /ANTHROPIC|\.env\.local|AI keys/i);
});

test("sanitizeUserFacingMessage strips API cost phrasing", () => {
  assert.doesNotMatch(
    sanitizeUserFacingMessage("Estimated API cost ~$1.20 for 3 rooms"),
    /API cost|~\$/i,
  );
});

test("sanitizeUserFacingMessage returns fallback for empty result", () => {
  assert.match(sanitizeUserFacingMessage("FAL"), /Something went wrong/i);
});
