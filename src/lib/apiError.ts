import { sanitizeUserFacingMessage } from "@/lib/userFacingMessages";

/** Coerce API `error` / `message` fields to a user-visible string (avoids `new Error(true)` → "true"). */
export function formatApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return sanitizeUserFacingMessage(error.trim());
  }
  if (typeof error === "number" && Number.isFinite(error)) return String(error);
  return fallback;
}
