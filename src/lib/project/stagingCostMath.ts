/** Shared FAL cost math — safe for client and server. */

export const STAGING_USD_PER_MP = 0.021;
export const INPAINT_USD_PER_MP = 0.025;
export const DEFAULT_MP_PER_PHOTO = 2;

export function estimateMegapixels(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return DEFAULT_MP_PER_PHOTO;
  return (width * height) / 1_000_000;
}

export function estimateStagingUsd(megapixels: number, endpoint: "staging" | "inpaint"): number {
  const rate = endpoint === "staging" ? STAGING_USD_PER_MP : INPAINT_USD_PER_MP;
  return Math.round(megapixels * rate * 1000) / 1000;
}

export function estimateRoomGenerationUsd(opts: {
  photoCount: number;
  needsPrep: boolean;
  megapixelsPerPhoto?: number;
  /** When true: shell + furnish passes (2× staging per photo). */
  layeredStaging?: boolean;
}): number {
  const mp = opts.megapixelsPerPhoto ?? DEFAULT_MP_PER_PHOTO;
  const stagingPasses = opts.layeredStaging ? 2 : 1;
  let total = opts.photoCount * stagingPasses * estimateStagingUsd(mp, "staging");
  if (opts.needsPrep) total += estimateStagingUsd(mp, "inpaint");
  return Math.round(total * 100) / 100;
}

/** Rough full-project API cost after concept (staging + optional prep per room). */
export function estimateProjectStagingUsd(opts: {
  roomCount: number;
  photoCount: number;
  prepRoomCount: number;
  megapixelsPerPhoto?: number;
  layeredStaging?: boolean;
}): number {
  const mp = opts.megapixelsPerPhoto ?? DEFAULT_MP_PER_PHOTO;
  const stagingPasses = opts.layeredStaging ? 2 : 1;
  const staging = opts.photoCount * stagingPasses * estimateStagingUsd(mp, "staging");
  const prep = opts.prepRoomCount * estimateStagingUsd(mp, "inpaint");
  return Math.round((staging + prep) * 100) / 100;
}

/** Client + server — mirrors isLayeredStagingEnabled() for cost UI. */
export function isLayeredStagingCostEstimateEnabled(): boolean {
  const raw = (
    process.env.VISTA_STAGING_LAYERED ?? process.env.NEXT_PUBLIC_VISTA_STAGING_LAYERED
  )
    ?.trim()
    .toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  const model = (
    process.env.VISTA_PROJECT_RENDER_MODEL ?? process.env.NEXT_PUBLIC_VISTA_PROJECT_RENDER_MODEL
  )
    ?.trim()
    .toLowerCase();
  if (model === "apartment-staging" || model === "staging") return true;
  return false;
}

export const SOFT_REDO_WARN_AT = 3;
