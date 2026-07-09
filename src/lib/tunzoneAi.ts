/** User-facing copy for planner AI chat — never mention underlying model vendors. */

export const TUNZONE_CHAT_IDENTITY_MESSAGE =
  "I'm Tunzone's chat — your assistant for designing furniture in this editor. What would you like to create or change?";

/** Detect identity / vendor-probing questions so we answer deterministically as Tunzone's chat. */
export function isIdentityOrMetaQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  const checks: RegExp[] = [
    /\bwho\s+are\s+you\b/,
    /\bwhat\s+are\s+you\b/,
    /\bwhat\s+model\b/,
    /\bwhich\s+(ai|llm|model)\b/,
    /\bwho\s+(made|built|created|owns)\s+you\b/,
    /\bare\s+you\s+(chatgpt|gpt|openai|claude|anthropic|gemini|google\s*ai|copilot)\b/,
    /\bare\s+you\s+an?\s+(ai|chatbot|language\s+model|lm)\b/,
    /\bwho\s+do\s+you\s+work\s+for\b/,
    /\bwhat\s+company\b.*\byou\b/,
    /\btell\s+me\s+about\s+yourself\b/,
    /\bwhat\s+is\s+your\s+name\b/,
  ];
  return checks.some((re) => re.test(t));
}

export const PUBLIC_AI_UNAVAILABLE =
  "The assistant isn't available right now. Please try again later.";

export const PUBLIC_AI_GENERIC_ERROR =
  "Something went wrong. Please try again in a moment.";

/** JSON `code` returned when provider keys/tokens are invalid or expired. */
export const AI_SERVICE_CONFIG_ERROR_CODE = "ai_service_unavailable";

export const PUBLIC_AI_SERVICE_UNAVAILABLE =
  "Our design service needs a quick fix. Our team has been notified — please contact us and we'll help you right away.";
