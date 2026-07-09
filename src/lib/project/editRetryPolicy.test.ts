import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STRUCTURAL_RETRY_ESCALATION_TYPES,
  hasStructuralFailure,
  pickBestEditAttempt,
  resolveEditRetryLimit,
  type EditAttemptRecord,
} from "./editRetryPolicy";

function record(
  attempt: number,
  failureTypes: string[],
  validationPassed = failureTypes.length === 0,
): EditAttemptRecord {
  return {
    attempt,
    rendered: { base64: `img-${attempt}`, mimeType: "image/png" },
    validation: { pass: validationPassed, reason: "r", failureTypes },
    validationPassed,
  };
}

test("structural failures get 3 retries, others 2", () => {
  assert.equal(resolveEditRetryLimit(["geometry_drift"]), 3);
  assert.equal(resolveEditRetryLimit(["hero_copy"]), 3);
  assert.equal(resolveEditRetryLimit(["decor_inconsistent"]), 2);
  assert.equal(resolveEditRetryLimit([]), 2);
});

test("hasStructuralFailure recognizes the structural set only", () => {
  assert.equal(hasStructuralFailure(["added_opening"]), true);
  assert.equal(hasStructuralFailure(["object_overlap"]), false);
  assert.equal(hasStructuralFailure([]), false);
});

test("escalation types are the geometry/copy subset", () => {
  assert.deepEqual(
    [...STRUCTURAL_RETRY_ESCALATION_TYPES].sort(),
    ["added_opening", "geometry_drift", "hero_copy"],
  );
});

test("pickBestEditAttempt prefers a passing attempt", () => {
  const best = pickBestEditAttempt([
    record(1, ["geometry_drift"]),
    record(2, []),
    record(3, ["object_overlap"]),
  ]);
  assert.equal(best.attempt, 2);
});

test("pickBestEditAttempt prefers placement failure over structural failure", () => {
  const best = pickBestEditAttempt([
    record(1, ["geometry_drift"]),
    record(2, ["object_overlap"]),
  ]);
  assert.equal(best.attempt, 2);
});

test("pickBestEditAttempt breaks score ties on the earlier attempt", () => {
  const best = pickBestEditAttempt([
    record(2, ["wall_clip"]),
    record(1, ["floating_object"]),
  ]);
  assert.equal(best.attempt, 1);
});
