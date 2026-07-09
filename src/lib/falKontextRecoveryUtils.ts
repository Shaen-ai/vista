import { isSurfaceOnlyFurnitureItem } from "@/lib/falDesignPrompt";

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function maxFalRecoveryCalls(): number {
  return Math.round(num("VISTA_FAL_MAX_RECOVERY_CALLS", 4));
}

export function fallbackInpaintUseCanny(): boolean {
  return (process.env.VISTA_FAL_INPAINT_USE_CANNY || "1").trim() !== "0";
}

/** Skip full inpaint when opening-drift path already produced a validated inpaint base. */
export function shouldUseStage2bOnlyInpaintRecovery(
  validatedInpaintFallback: { base64: string; mimeType: string } | undefined,
): boolean {
  return !!validatedInpaintFallback?.base64?.trim();
}

/** Skip furnish-retry when current image already has enough major furniture. */
export function shouldSkipFurnishRetry(opts: {
  match: boolean;
  confirmedCount: number;
  missing: string[];
  retryEligibleCount: number;
}): boolean {
  if (opts.match) return true;
  if (opts.confirmedCount >= opts.retryEligibleCount - 1) return true;
  if (
    opts.confirmedCount > 0 &&
    opts.missing.length > 0 &&
    opts.missing.every(isSurfaceOnlyFurnitureItem)
  ) {
    return true;
  }
  return false;
}

export function isFalRecoveryBudgetExceeded(
  totalCalls: number,
  max = maxFalRecoveryCalls(),
): boolean {
  return totalCalls >= max;
}
