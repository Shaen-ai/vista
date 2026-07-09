/**
 * Server-side AI credentials — single place for env parsing and alternate names.
 */

function trimmedEnv(name: string): string | undefined {
  const v = process.env[name];
  const t = typeof v === "string" ? v.trim() : "";
  return t || undefined;
}

/** Claude / Anthropic Messages API */
export function getAnthropicApiKey(): string | undefined {
  return trimmedEnv("ANTHROPIC_API_KEY");
}

/** OpenAI API */
export function getOpenAiApiKey(): string | undefined {
  return trimmedEnv("OPENAI_API_KEY");
}

/** fal.ai (flux render engine + fal storage uploads) */
export function getFalKey(): string | undefined {
  return trimmedEnv("FAL_KEY") ?? trimmedEnv("FAL_AI_KEY");
}

const GOOGLE_GEN_AI_ENV_NAMES = [
  "GOOGLE_AI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

/** Google Gen AI / Gemini (same key from AI Studio / GCP) */
export function getGoogleGenerativeAiApiKey(): string | undefined {
  for (const name of GOOGLE_GEN_AI_ENV_NAMES) {
    const k = trimmedEnv(name);
    if (k) return k;
  }
  return undefined;
}
