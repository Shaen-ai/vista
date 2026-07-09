import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeJustHydratedFromHub,
  markJustHydratedFromHub,
} from "./projectHydrationSkip";

test("projectHydrationSkip one-shot flag", () => {
  assert.equal(consumeJustHydratedFromHub(), false);
  markJustHydratedFromHub();
  assert.equal(consumeJustHydratedFromHub(), true);
  assert.equal(consumeJustHydratedFromHub(), false);
});
