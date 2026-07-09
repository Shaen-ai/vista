import type { RenderValidationResult } from "./renderValidation";

export const STRUCTURAL_FAILURE_TYPES = new Set([
  "geometry_drift",
  "added_opening",
  "hero_copy",
  "removal_failed",
  "ceiling_remodeled",
  "wall_remodeled",
  "door_unfinished",
  "blocked_door",
]);

const PLACEMENT_FAILURE_TYPES = new Set([
  "object_overlap",
  "floating_object",
  "wall_clip",
]);

export const STRUCTURAL_RETRY_ESCALATION_TYPES = new Set([
  "geometry_drift",
  "added_opening",
  "hero_copy",
]);

export function hasStructuralFailure(failureTypes: string[]): boolean {
  return failureTypes.some((t) => STRUCTURAL_FAILURE_TYPES.has(t));
}

function validationFailureScore(failureTypes: string[]): number {
  let score = 0;
  for (const t of failureTypes) {
    if (STRUCTURAL_FAILURE_TYPES.has(t)) score += 100;
    else if (PLACEMENT_FAILURE_TYPES.has(t)) score += 10;
    else score += 1;
  }
  return score;
}

export type EditAttemptRecord = {
  attempt: number;
  rendered: { base64: string; mimeType: string };
  validation: RenderValidationResult;
  validationPassed: boolean;
};

export function pickBestEditAttempt(records: EditAttemptRecord[]): EditAttemptRecord {
  return records.reduce((best, current) => {
    if (current.validationPassed && !best.validationPassed) return current;
    if (!current.validationPassed && best.validationPassed) return best;
    const currentScore = validationFailureScore(current.validation.failureTypes);
    const bestScore = validationFailureScore(best.validation.failureTypes);
    if (currentScore !== bestScore) return currentScore < bestScore ? current : best;
    return current.attempt < best.attempt ? current : best;
  });
}

export function resolveEditRetryLimit(failureTypes: string[]): number {
  return hasStructuralFailure(failureTypes) ? 3 : 2;
}
