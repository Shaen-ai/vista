import "server-only";

import {
  optimizeImageBufferForAi,
  type OptimizeImageOptions,
} from "@/lib/optimizeImageForAi";

/** Vision validation payloads — smaller than FAL 4K renders to cut token cost. */
export const VALIDATION_IMAGE_OPTIONS: OptimizeImageOptions = {
  maxEdge: 1280,
  quality: 80,
  maxBytes: 400_000,
};

export interface ValidationImagePayload {
  base64: string;
  mime: string;
}

export async function optimizeBase64ForValidation(
  base64: string,
  mime = "image/jpeg",
  options: OptimizeImageOptions = VALIDATION_IMAGE_OPTIONS,
): Promise<ValidationImagePayload> {
  const trimmed = base64.trim();
  if (!trimmed) {
    return { base64: trimmed, mime };
  }
  try {
    const optimized = await optimizeImageBufferForAi(Buffer.from(trimmed, "base64"), options);
    return { base64: optimized.base64, mime: optimized.mimeType };
  } catch {
    return { base64: trimmed, mime };
  }
}

export async function prepareValidationImages(input: {
  originalBase64: string;
  originalMime: string;
  renderedBase64: string;
  renderedMime: string;
  heroBase64?: string;
  heroMime?: string;
}): Promise<{
  original: ValidationImagePayload;
  rendered: ValidationImagePayload;
  hero?: ValidationImagePayload;
}> {
  const [original, rendered, hero] = await Promise.all([
    optimizeBase64ForValidation(input.originalBase64, input.originalMime),
    optimizeBase64ForValidation(input.renderedBase64, input.renderedMime),
    input.heroBase64?.trim()
      ? optimizeBase64ForValidation(input.heroBase64, input.heroMime || "image/png")
      : Promise.resolve(undefined),
  ]);
  return { original, rendered, hero };
}

/** Cheaper vision model for pass/fail judges; floor-plan analysis keeps FLOOR_PLAN_ANALYSIS_MODEL. */
export function getValidateModel(): string {
  const dedicated = process.env.VISTA_VALIDATE_MODEL?.trim();
  if (dedicated) return dedicated;
  return "gpt-4o-mini";
}
