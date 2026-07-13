export type AiIncidentCategory = "provider_auth" | "unexpected";
export type AiProvider = "fal" | "openai" | "anthropic" | "gemini" | "unknown";

export interface AiIncidentClassification {
  category: AiIncidentCategory;
  provider: AiProvider;
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    if (o.error && typeof o.error === "object") {
      const nested = o.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
      if (typeof nested.type === "string") return nested.type;
    }
  }
  return String(err ?? "Unknown error");
}

function inferProvider(text: string, status?: number): AiProvider {
  const t = text.toLowerCase();
  if (/fal\.?ai|fal_key|fal render|fal storage|rendering service is temporarily unavailable|fal nano-banana|fal validation failed/.test(t)) {
    return "fal";
  }
  if (/openai|gpt-|images\/edits|dall-e|chat\.completions/.test(t)) return "openai";
  if (/anthropic|claude|messages\.create/.test(t)) return "anthropic";
  if (/gemini|google.?ai|generativelanguage|google_ai_api_key/.test(t)) return "gemini";
  if (status === 403 && /forbidden|rendering service/.test(t)) return "fal";
  return "unknown";
}

function isFalValidationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const o = err as { name?: string; status?: number };
  return o.name === "ValidationError" || o.status === 422;
}

const PROVIDER_AUTH_PATTERNS: RegExp[] = [
  /\b401\b/,
  /\b403\b/,
  /\binvalid[_\s-]?api[_\s-]?key\b/i,
  /\bauthentication[_\s-]?error\b/i,
  /\bincorrect[_\s-]?api[_\s-]?key\b/i,
  /\binsufficient[_\s-]?quota\b/i,
  /\bquota[_\s-]?exceeded\b/i,
  /\bbilling[_\s-]?hard[_\s-]?limit\b/i,
  /\bcredit[_\s-]?balance\b/i,
  /\bexhausted[_\s-]?balance\b/i,
  /\baccount[_\s-]?blocked\b/i,
  /\bpermission[_\s-]?denied\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bis not set\b/i,
  /\bis not configured\b/i,
  /\bkeys are missing\b/i,
  /\bapi key (expired|revoked|invalid)\b/i,
  /\btoken (expired|invalid|revoked)\b/i,
  /\bno api key\b/i,
  /\bprovider returned 401\b/i,
  /\bprovider returned 403\b/i,
];

export function classifyAiError(err: unknown): AiIncidentClassification {
  const message = errorText(err);
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  const errorType =
    err && typeof err === "object" && "error" in err
      ? (err as { error?: { type?: string } }).error?.type
      : undefined;

  const provider = isFalValidationError(err)
    ? "fal"
    : inferProvider(message, Number.isFinite(status) ? status : undefined);

  const isAuthByStatus = status === 401 || status === 403;
  const isAuthByType =
    typeof errorType === "string" &&
    /authentication_error|invalid_api_key|insufficient_quota|permission_error|billing/i.test(errorType);
  const isAuthByMessage = PROVIDER_AUTH_PATTERNS.some((re) => re.test(message));

  if (isAuthByStatus || isAuthByType || isAuthByMessage) {
    return { category: "provider_auth", provider };
  }

  return { category: "unexpected", provider };
}

export function isOverloadedAiError(err: unknown): boolean {
  const e = err as { status?: number; error?: { type?: string }; message?: string };
  return (
    e?.status === 529 ||
    e?.error?.type === "overloaded_error" ||
    (typeof e?.message === "string" && /overloaded/i.test(e.message))
  );
}

export function sanitizeIncidentMessage(message: string, maxLen = 500): string {
  return message.replace(/\s+/g, " ").trim().slice(0, maxLen);
}
