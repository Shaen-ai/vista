/** Pure JSON parsing for cross-view consistency validator responses. */

export interface CrossViewConsistencyResult {
  match: boolean;
  mismatches: string[];
  correctiveFeedback: string;
  skipped: boolean;
}

export function parseCrossViewValidationJson(
  parsed: unknown,
  furnitureLabels: string[],
): CrossViewConsistencyResult {
  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const mismatches = Array.isArray(obj.mismatches)
    ? obj.mismatches.filter((x): x is string => typeof x === "string")
    : [];
  const correctiveFeedback =
    typeof obj.correctiveFeedback === "string" ? obj.correctiveFeedback.trim() : "";

  return {
    match: obj.match === true,
    mismatches,
    correctiveFeedback,
    skipped: false,
  };
}

export function skippedCrossViewResult(reason: string): CrossViewConsistencyResult {
  return {
    match: true,
    mismatches: [],
    correctiveFeedback: "",
    skipped: true,
  };
}

export function crossViewRetryScore(result: CrossViewConsistencyResult): number {
  if (result.skipped) return 0;
  if (result.match) return 1000;
  return Math.max(0, 100 - result.mismatches.length * 10);
}
