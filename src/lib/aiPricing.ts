/** Static provider price table for dev spend tracking (USD). */

export interface TokenPricing {
  inputPer1M: number;
  outputPer1M: number;
}

export interface ImagePricing {
  perImage: number;
}

const OPENAI_TOKEN_PRICING: Record<string, TokenPricing> = {
  "gpt-5.5": { inputPer1M: 5, outputPer1M: 15 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1": { inputPer1M: 2, outputPer1M: 8 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "o3": { inputPer1M: 10, outputPer1M: 40 },
};

const ANTHROPIC_TOKEN_PRICING: Record<string, TokenPricing> = {
  "claude-opus-4-6": { inputPer1M: 15, outputPer1M: 75 },
  "claude-opus-4-20250514": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-sonnet-20241022": { inputPer1M: 3, outputPer1M: 15 },
  "claude-3-5-haiku-20241022": { inputPer1M: 0.8, outputPer1M: 4 },
};

const GEMINI_TOKEN_PRICING: Record<string, TokenPricing> = {
  "gemini-2.5-flash": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-2.5-flash-image": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5 },
};

/** Per-image estimates when token usage is unavailable. */
const GEMINI_IMAGE_PRICING: Record<string, number> = {
  "gemini-2.5-flash-image": 0.039,
  "gemini-2.0-flash-preview-image-generation": 0.039,
};

const FAL_ENDPOINT_PRICING: Record<string, number> = {
  "fal-ai/flux-pro/kontext": 0.04,
  "fal-ai/flux-pro/kontext/multi": 0.05,
  "fal-ai/flux-pro/v1.1": 0.04,
  "fal-ai/flux-general/image-to-image": 0.035,
  "fal-ai/flux-general/inpainting": 0.04,
  "fal-ai/flux-2-lora-gallery/apartment-staging": 0.042,
  "fal-ai/nano-banana-pro/edit": 0.045,
};

const DEFAULT_TOKEN: TokenPricing = { inputPer1M: 3, outputPer1M: 12 };
const DEFAULT_FAL_IMAGE = 0.04;
const OPENAI_IMAGE_EDIT = 0.08;

function matchPricing<T>(table: Record<string, T>, model: string, fallback: T): T {
  const key = model.trim().toLowerCase();
  if (table[key]) return table[key]!;
  for (const [k, v] of Object.entries(table)) {
    if (key.startsWith(k) || k.startsWith(key)) return v;
  }
  return fallback;
}

export function estimateOpenAiTokenUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = matchPricing(OPENAI_TOKEN_PRICING, model, DEFAULT_TOKEN);
  const usd =
    (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
  return roundUsd(usd);
}

export function estimateAnthropicTokenUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens = 0,
  cacheReadTokens = 0,
): number {
  const p = matchPricing(ANTHROPIC_TOKEN_PRICING, model, DEFAULT_TOKEN);
  const billableInput = inputTokens + cacheCreationTokens * 1.25 + cacheReadTokens * 0.1;
  const usd =
    (billableInput / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
  return roundUsd(usd);
}

export function estimateGeminiTokenUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = matchPricing(GEMINI_TOKEN_PRICING, model, DEFAULT_TOKEN);
  const usd =
    (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
  return roundUsd(usd);
}

export function estimateGeminiImageUsd(model: string): number {
  const key = model.trim().toLowerCase();
  return GEMINI_IMAGE_PRICING[key] ?? 0.039;
}

export function estimateFalEndpointUsd(endpoint: string, megapixels?: number): number {
  const key = endpoint.trim();
  const flat = FAL_ENDPOINT_PRICING[key];
  if (flat != null) return roundUsd(flat);
  if (megapixels != null && megapixels > 0) {
    return roundUsd(megapixels * 0.025);
  }
  return roundUsd(DEFAULT_FAL_IMAGE);
}

export function estimateOpenAiImageEditUsd(): number {
  return OPENAI_IMAGE_EDIT;
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
