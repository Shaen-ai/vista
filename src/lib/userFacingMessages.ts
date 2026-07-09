/** Strip internal provider names and dev leaks from user-visible copy. */

const EXACT_ERROR_MAP: Record<string, string> = {
  "FAL render failed": "Render failed",
  "All FAL renders failed": "All renders failed",
  "FAL render returned no image": "Render returned no image",
};

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Claude is reading the floor plan for all rooms\.{3}/i, "Reading floor plan for all rooms…"],
  [/Rendering with FAL\.{3}/i, "Rendering design…"],
  [/Applying edits with FAL…/i, "Applying your edits…"],
  [/Syncing views with FAL…/i, "Syncing views…"],
  [/OpenAI floor plan analysis failed/i, "Floor plan analysis failed"],
];

/** Canonical English progress strings → i18n keys under `project.*`. */
const PROGRESS_MESSAGE_KEYS: Record<string, string> = {
  "Reading floor plan for all rooms…": "project.readingFloorPlanProgress",
  "We are designing your concept...": "project.designingConceptProgress",
};

const PROVIDER_PATTERNS: RegExp[] = [
  /\bClaude\b/gi,
  /\bFAL(?:[- ]direct)?\b/gi,
  /\bfal\b/g,
  /\bGemini\b/gi,
  /\bOpenAI\b/gi,
  /\bAnthropic\b/gi,
  /\bGPT-?\d*\b/gi,
];

const DEV_LEAK_PATTERNS: RegExp[] = [
  /\bANTHROPIC_API_KEY\b/g,
  /\bGOOGLE_AI_API_KEY\b/g,
  /\bGEMINI_API_KEY\b/g,
  /\bOPENAI_API_KEY\b/g,
  /\bFAL_KEY\b/g,
  /\.env\.local\b/g,
  /\bAI keys are missing\b/gi,
  /— see \.env\.example\.?/gi,
  /Add [A-Z_]+ to vista\/\.env\.local\.?/gi,
];

const COST_PATTERNS: RegExp[] = [
  /\bAPI cost\b/gi,
  /\bEstimated ~?\$/gi,
  /\bincrease cost\b/gi,
];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function sanitizeUserFacingMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const mapped = EXACT_ERROR_MAP[trimmed];
  if (mapped) return mapped;

  let out = trimmed;
  for (const [re, replacement] of PHRASE_REPLACEMENTS) {
    out = out.replace(re, replacement);
  }
  for (const re of [...PROVIDER_PATTERNS, ...DEV_LEAK_PATTERNS, ...COST_PATTERNS]) {
    out = out.replace(re, "");
  }

  out = out
    .replace(/\bwith\s+(?=[.…]|$)/gi, "")
    .replace(/\.\.\./g, "…");

  out = collapseWhitespace(out);
  if (!out) return "Something went wrong. Please try again.";
  return out;
}

/** Map known SSE progress strings to locale-specific copy. */
export function translateProgressMessage(
  text: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const sanitized = sanitizeUserFacingMessage(text);
  const key = PROGRESS_MESSAGE_KEYS[sanitized];
  return key ? t(key) : sanitized;
}
