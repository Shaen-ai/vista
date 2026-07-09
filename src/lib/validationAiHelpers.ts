import "server-only";

/** Hard wall-clock deadline for advisory render validation OpenAI calls. */
export const VALIDATION_DEADLINE_MS = 90_000;

/** Validation is advisory — one retry is enough. */
export const VALIDATION_MAX_RETRIES = 1;

export function validationAbortSignal(): AbortSignal {
  return AbortSignal.timeout(VALIDATION_DEADLINE_MS);
}

export function mergeAbortSignals(
  primary: AbortSignal | undefined,
  deadline: AbortSignal,
): AbortSignal {
  if (!primary) return deadline;
  if (primary.aborted) return primary;
  if (deadline.aborted) return deadline;
  const controller = new AbortController();
  const abort = () => controller.abort();
  primary.addEventListener("abort", abort, { once: true });
  deadline.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export function isValidationTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  const cause = (err as { cause?: { code?: string; name?: string } }).cause;
  return (
    cause?.code === "UND_ERR_HEADERS_TIMEOUT" ||
    cause?.code === "UND_ERR_BODY_TIMEOUT" ||
    cause?.name === "TimeoutError"
  );
}
