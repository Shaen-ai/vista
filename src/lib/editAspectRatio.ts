/**
 * Pure aspect-ratio helpers for the nano-banana-pro edit pipeline. Kept free
 * of server-only imports so node:test specs can exercise them directly.
 */

/** Supported nano-banana-pro `aspect_ratio` values (besides the default "auto"). */
const EDIT_ASPECT_RATIOS = [
  { ratio: "21:9", value: 21 / 9 },
  { ratio: "16:9", value: 16 / 9 },
  { ratio: "3:2", value: 3 / 2 },
  { ratio: "4:3", value: 4 / 3 },
  { ratio: "5:4", value: 5 / 4 },
  { ratio: "1:1", value: 1 },
  { ratio: "4:5", value: 4 / 5 },
  { ratio: "3:4", value: 3 / 4 },
  { ratio: "2:3", value: 2 / 3 },
  { ratio: "9:16", value: 9 / 16 },
] as const;

export type EditAspectRatio = (typeof EDIT_ASPECT_RATIOS)[number]["ratio"];

/**
 * Nearest supported nano-banana aspect_ratio for a source image. Left to
 * "auto", the model sometimes reframes a landscape room photo into a portrait
 * canvas and re-invents the geometry to fill it (widened room, moved/added
 * openings) — so the edit target's own ratio is always passed explicitly.
 */
export function nearestEditAspectRatio(
  width: number,
  height: number,
): EditAspectRatio | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const ar = width / height;
  let best: (typeof EDIT_ASPECT_RATIOS)[number] = EDIT_ASPECT_RATIOS[0]!;
  let bestDiff = Math.abs(ar - best.value);
  for (const candidate of EDIT_ASPECT_RATIOS) {
    const diff = Math.abs(ar - candidate.value);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best.ratio;
}

/**
 * True when one image is landscape and the other portrait (a reframed canvas,
 * not an edit of the source). Near-square images (within 5%) never flag.
 */
export function isOrientationFlip(
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
): boolean {
  if (srcWidth <= 0 || srcHeight <= 0 || outWidth <= 0 || outHeight <= 0) return false;
  const orient = (w: number, h: number): "landscape" | "portrait" | "square" => {
    const ar = w / h;
    if (ar > 1.05) return "landscape";
    if (ar < 0.95) return "portrait";
    return "square";
  };
  const src = orient(srcWidth, srcHeight);
  const out = orient(outWidth, outHeight);
  if (src === "square" || out === "square") return false;
  return src !== out;
}
