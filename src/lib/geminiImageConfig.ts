/** Friendly aliases → Gemini API model id (Nano Banana Pro = gemini-3-pro-image). */
const GEMINI_IMAGE_MODEL_ALIASES: Record<string, string> = {
  "google/nano-banana-pro": "gemini-3-pro-image",
  "nano-banana-pro": "gemini-3-pro-image",
  "fal-ai/nano-banana-pro": "gemini-3-pro-image",
};

/** Label shown in logs; defaults to the user-facing Nano Banana Pro slug. */
export const GEMINI_IMAGE_MODEL_LABEL =
  process.env.GEMINI_IMAGE_MODEL?.trim() || "google/nano-banana-pro";

/** Resolved Gemini API model id for every image render call. */
export const GEMINI_IMAGE_MODEL: string = (() => {
  const raw = GEMINI_IMAGE_MODEL_LABEL;
  return GEMINI_IMAGE_MODEL_ALIASES[raw] ?? raw;
})();

/**
 * Shared generation config for Gemini image renders.
 *
 * `temperature` controls sampling variance. For Vista's project mode the render
 * must preserve the EXACT room structure (walls, corners, window/door count and
 * placement) carried by the floor-plan JSON + reference photos — so we want the
 * model to be faithful, not inventive, about geometry. A low temperature reduces
 * run-to-run drift and hallucinated openings while still leaving enough latitude
 * for styling/finish variety (which is driven by the prompt + product images).
 *
 * Override per-environment with `GEMINI_IMAGE_TEMPERATURE` (0..2). Defaults to
 * 0.15 — strict structural alignment with enough latitude for finish variety.
 */
export const GEMINI_IMAGE_TEMPERATURE: number = (() => {
  const raw = Number(process.env.GEMINI_IMAGE_TEMPERATURE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 2 ? raw : 0.15;
})();

/**
 * generationConfig for every Gemini image render call. The SDK types don't yet
 * include `responseModalities`, so call sites still cast `as any`.
 */
export const RENDER_GENERATION_CONFIG = {
  responseModalities: ["TEXT", "IMAGE"],
  temperature: GEMINI_IMAGE_TEMPERATURE,
};

/**
 * Anti-hallucination structure lock injected next to RENDER_QUALITY_DIRECTIVE in
 * every project-mode Gemini render prompt. References the A-B-C-D wall edges that
 * the floor-plan schematic now labels, so the model can tie the rule to what it
 * sees. Surfaces (paint, flooring, finishes) and furniture remain free to change.
 */
export const STRUCTURE_LOCK_DIRECTIVE = `STRUCTURE LOCK (non-negotiable): The room's walls, corners, proportions, and the count + position of every window and door are FIXED by the floor plan. Do NOT invent, move, merge, remove, split, or resize any wall, corner, window, or door. Match the labeled wall edges (A-B, B-C, C-D, …) and the openings on them EXACTLY as given in the floor-plan schematic and text. Only surfaces (paint, flooring, finishes), furniture, and decor may change.`;
