import "server-only";

import { pipelineLog } from "@/lib/pipelineLog";
import {
  detectStyleReferenceCopy as detectCopyCore,
  fetchImageBase64FromUrl,
  isStyleCopyGuardEnabled,
} from "@/lib/falStyleRefCopyGuard";

export { fetchImageBase64FromUrl, isStyleCopyGuardEnabled } from "@/lib/falStyleRefCopyGuard";

export async function detectStyleReferenceCopy(opts: {
  outputBase64: string;
  heroBase64: string;
  styleRefBase64: string;
}): Promise<{ detected: boolean; heroCorrelation: number; styleRefCorrelation: number }> {
  const result = await detectCopyCore(opts);
  pipelineLog("FAL_KONTEXT", "style ref copy check", {
    heroCorrelation: Number(result.heroCorrelation.toFixed(3)),
    styleRefCorrelation: Number(result.styleRefCorrelation.toFixed(3)),
    detected: result.detected,
  });
  return result;
}
