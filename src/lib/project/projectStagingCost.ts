import { pipelineLog } from "@/lib/pipelineLog";

import {
  estimateMegapixels,
  estimateRoomGenerationUsd,
  estimateStagingUsd,
} from "./stagingCostMath";

export {
  estimateMegapixels,
  estimateRoomGenerationUsd,
  estimateProjectStagingUsd,
  estimateStagingUsd,
  STAGING_USD_PER_MP,
  SOFT_REDO_WARN_AT,
} from "./stagingCostMath";

/** USD per megapixel — fal apartment-staging list price benchmark. */

export function logFalCostEstimate(
  endpoint: "staging" | "inpaint",
  width: number,
  height: number,
  falEndpoint: string,
  meta?: Record<string, unknown>,
): void {
  const megapixels = estimateMegapixels(width, height);
  const estimatedUsd = estimateStagingUsd(megapixels, endpoint);
  pipelineLog("COST_ESTIMATE", "FAL call estimate", {
    endpoint: falEndpoint,
    kind: endpoint,
    width,
    height,
    megapixels,
    estimatedUsd,
    ...meta,
  });
}

export function maxStagingAttemptsPerRoom(): number {
  const raw = Number(process.env.VISTA_MAX_STAGING_ATTEMPTS_PER_ROOM);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}
