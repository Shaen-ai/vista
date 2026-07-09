import "server-only";

import { LIGHTING_REALISM_DIRECTIVE, DESIGN_REALISM_GUARDRAILS } from "@/lib/renderQualityDirective";

/**
 * Short, creative hero prompt for the primary fal render.
 * Kept concise — flux T5 prompt is ~512 tokens. Quality directives are trimmed
 * to fit while preserving the strongest architectural instructions.
 */
export function buildHeroRenderPrompt(opts: {
  roomType: string;
  designStyle: string;
  /** Optional one-line user intent (e.g. "warm minimalist bedroom with wood accents"). */
  intentSummary?: string;
}): string {
  const intent = opts.intentSummary?.trim()
    ? `\n${opts.intentSummary.trim()}`
    : "";
  return `A stunning photorealistic interior design photograph of a ${opts.designStyle} ${opts.roomType}. Architectural Digest quality, masterful lighting, luxurious finishes, perfectly composed.${intent}

${LIGHTING_REALISM_DIRECTIVE}

${DESIGN_REALISM_GUARDRAILS}`.slice(0, 3800);
}

/**
 * Generic secondary-viewpoint prompt for fal renders anchored via IP-Adapter.
 * The IP-Adapter does the heavy lifting; this prompt just confirms the task.
 */
export function buildViewpointSecondaryPrompt(opts: {
  roomType: string;
  designStyle: string;
}): string {
  return `A beautiful photorealistic interior design photograph of the same ${opts.designStyle} ${opts.roomType}, maintaining the exact same style, finishes, materials, colors, lighting fixtures, and furniture. Same room, different camera angle. Architectural Digest quality.`;
}
