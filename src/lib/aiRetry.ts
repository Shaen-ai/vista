const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

/**
 * Retry an async function with exponential backoff on transient AI provider errors
 * (overloaded, rate-limited, 529, 503).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label = "AI call",
  maxRetries = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      const isRetryable =
        err?.status === 529 ||
        err?.status === 503 ||
        err?.status === 429 ||
        err?.error?.type === "overloaded_error" ||
        (typeof err?.message === "string" &&
          (/overloaded|rate.?limit|too many requests|temporarily unavailable|fetch failed|headers timeout|body timeout/i.test(
            err.message,
          ) ||
            (err?.cause &&
              typeof err.cause === "object" &&
              typeof (err.cause as { code?: string }).code === "string" &&
              /UND_ERR_(HEADERS|BODY)_TIMEOUT/.test((err.cause as { code: string }).code))));

      if (!isRetryable || attempt === maxRetries) {
        // fal.ai rejects submits with 403 when the account is blocked (e.g.
        // exhausted balance); its client surfaces the bare statusText
        // "Forbidden", which is useless to end users.
        if (err?.name === "ApiError" && err?.status === 403) {
          const detail =
            typeof err?.body?.detail === "string" ? err.body.detail : "";
          console.error(
            `[${label}] fal.ai rejected the request (403):`,
            detail || err.message,
          );
          throw new Error(
            "Rendering service is temporarily unavailable. Please try again later.",
          );
        }
        throw err;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
      console.warn(
        `[${label}] Retryable error (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(delay)}ms:`,
        err?.message || err?.error?.type || "unknown",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}
