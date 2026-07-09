import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import { buildCompactOpeningLockForFal, buildCompactOpeningLockForRetry } from "@/lib/falOpeningLockCompact";
import { buildOpeningStructuralLock } from "@/lib/openingStructuralLock";

const PRIMARY_STRUCTURAL_TAIL =
  "\n\nFurnish completely — every listed piece must appear visibly. " +
  "Keep every window and door exactly as in the input image; do not add, move, or remove openings.";

const RETRY_KEEP_VISIBLE_FURNITURE =
  "Keep furniture already visible in the input image; add any missing listed pieces.\n\n";

const RETRY_FURNISH_STRUCTURAL_TAIL =
  "\n\nFurnish completely per the design above — every listed piece must appear visibly. " +
  "Keep every window and door exactly at its position, size, and wall; do not add, move, or remove openings.";

function prefixStructuralBlock(prefix: string | undefined, body: string): string {
  const block = prefix?.trim();
  if (!block) return body;
  return `${block}\n\n${body}`;
}

export { buildImageRolesBlock } from "@/lib/falStyleReferenceUtils";

export function buildKontextStage2Prompt(opts: {
  designOverlay: string;
  mode: "primary" | "retry";
  retryOpeningLock?: string;
  /** When true, retry uses primary Kontext output as image input — prepends keep-visible line only. */
  retryUsesPrimaryOutput?: boolean;
  /** @deprecated Use retryUsesPrimaryOutput — kept for call-site compat during rename. */
  preserveExistingFurniture?: boolean;
  structuralPreservePrefix?: string;
}): string {
  if (opts.mode === "primary") {
    return prefixStructuralBlock(
      opts.structuralPreservePrefix,
      opts.designOverlay + PRIMARY_STRUCTURAL_TAIL,
    );
  }

  const lockBlock = opts.retryOpeningLock?.trim() ? `${opts.retryOpeningLock.trim()}\n\n` : "";
  const reusePrimary =
    opts.retryUsesPrimaryOutput === true || opts.preserveExistingFurniture === true;
  const reuseLine = reusePrimary ? RETRY_KEEP_VISIBLE_FURNITURE : "";
  return prefixStructuralBlock(
    opts.structuralPreservePrefix,
    `${lockBlock}${reuseLine}${opts.designOverlay}${RETRY_FURNISH_STRUCTURAL_TAIL}`,
  );
}

/** Stage 2b after inpaint fallback — compact opening lock + full furnish overlay. */
export function buildStage2bKontextPrompt(opts: {
  designOverlay: string;
  lockAnalysis?: RoomAnalysis | null;
  structuralPreservePrefix?: string;
}): string {
  const compactLock = buildCompactOpeningLockForFal(
    buildOpeningStructuralLock(opts.lockAnalysis ?? null, null),
  );
  const lockBlock = compactLock.trim() ? `${compactLock.trim()}\n\n` : "";
  return prefixStructuralBlock(
    opts.structuralPreservePrefix,
    `${lockBlock}${opts.designOverlay}${PRIMARY_STRUCTURAL_TAIL}`,
  );
}

/** Post-final furniture spec retry — missing pieces + compact opening lock. */
export function buildFurnishRetryPrompt(opts: {
  designOverlay: string;
  missingItems: string[];
  lockAnalysis?: RoomAnalysis | null;
  structuralPreservePrefix?: string;
}): string {
  const compactLock = buildCompactOpeningLockForRetry(
    buildOpeningStructuralLock(opts.lockAnalysis ?? null, null),
  );
  const lockBlock = compactLock.trim() ? `${compactLock.trim()}\n\n` : "";
  const missingBlock =
    opts.missingItems.length > 0
      ? `\n\nMISSING (must add visibly): ${opts.missingItems.join("; ")}.`
      : "";
  return prefixStructuralBlock(
    opts.structuralPreservePrefix,
    `${lockBlock}${opts.designOverlay}${missingBlock}${PRIMARY_STRUCTURAL_TAIL}`,
  );
}
