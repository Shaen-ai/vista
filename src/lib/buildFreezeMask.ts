import { applyFalMaskPolarity } from "@/lib/applyFalMaskPolarity";
import {
  buildOpeningFreezeRegionsCanonical,
  hasOpeningBoxes,
  type OpeningFreezeRegionsInput,
} from "@/lib/openingFreezeRegions";

export type { OpeningFreezeRegionsInput as FreezeMaskInput };

/**
 * Build an inpainting mask for fal-ai/flux-general/inpainting from opening boxes.
 * Returns FAL-ready polarity (canonical + optional VISTA_FAL_MASK_INVERT).
 */
export async function buildFreezeMask(input: OpeningFreezeRegionsInput): Promise<Buffer | null> {
  if (!hasOpeningBoxes(input.windowBoxes, input.doorBoxes, input.structuralBoxes)) {
    return null;
  }
  const canonical = await buildOpeningFreezeRegionsCanonical(input);
  if (!canonical) return null;
  return applyFalMaskPolarity(canonical);
}
