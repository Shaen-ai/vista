import sharp from "sharp";

const THUMB = 48;
const STYLE_COPY_MARGIN = 0.08;
const STYLE_COPY_MIN_CORR = 0.55;

async function grayscaleThumb(base64: string): Promise<Float32Array> {
  const buf = Buffer.from(base64, "base64");
  const { data } = await sharp(buf)
    .resize(THUMB, THUMB, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! / 255;
  return out;
}

function pearson(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sumA = 0;
  let sumB = 0;
  let sumAB = 0;
  let sumA2 = 0;
  let sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]!;
    sumB += b[i]!;
    sumAB += a[i]! * b[i]!;
    sumA2 += a[i]! * a[i]!;
    sumB2 += b[i]! * b[i]!;
  }
  const denom = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  if (denom < 1e-6) return 0;
  return (n * sumAB - sumA * sumB) / denom;
}

export async function detectStyleReferenceCopy(opts: {
  outputBase64: string;
  heroBase64: string;
  styleRefBase64: string;
}): Promise<{ detected: boolean; heroCorrelation: number; styleRefCorrelation: number }> {
  const [out, hero, style] = await Promise.all([
    grayscaleThumb(opts.outputBase64),
    grayscaleThumb(opts.heroBase64),
    grayscaleThumb(opts.styleRefBase64),
  ]);
  const heroCorrelation = pearson(out, hero);
  const styleRefCorrelation = pearson(out, style);
  const detected =
    styleRefCorrelation > heroCorrelation + STYLE_COPY_MARGIN &&
    styleRefCorrelation > STYLE_COPY_MIN_CORR;

  return { detected, heroCorrelation, styleRefCorrelation };
}

export function isStyleCopyGuardEnabled(): boolean {
  return (process.env.VISTA_FAL_STYLE_COPY_GUARD || "1").trim() !== "0";
}

const HERO_COPY_MARGIN = 0.15;
const HERO_COPY_MIN_CORR = 0.75;

/**
 * Detect a secondary-view render that reproduced the hero/master design
 * reference instead of editing the secondary photo. A correct secondary render
 * shares the edit-target photo's camera and composition, so it correlates with
 * the photo more than with the hero; a copy correlates ~0.9+ with the hero and
 * near-zero with the photo.
 */
export async function detectHeroCopy(opts: {
  outputBase64: string;
  heroBase64: string;
  editTargetBase64: string;
}): Promise<{ detected: boolean; heroCorrelation: number; editTargetCorrelation: number }> {
  const [out, hero, target] = await Promise.all([
    grayscaleThumb(opts.outputBase64),
    grayscaleThumb(opts.heroBase64),
    grayscaleThumb(opts.editTargetBase64),
  ]);
  const heroCorrelation = pearson(out, hero);
  const editTargetCorrelation = pearson(out, target);
  const detected =
    heroCorrelation > HERO_COPY_MIN_CORR &&
    heroCorrelation > editTargetCorrelation + HERO_COPY_MARGIN;

  return { detected, heroCorrelation, editTargetCorrelation };
}

export function isHeroCopyGuardEnabled(): boolean {
  return (process.env.VISTA_HERO_COPY_GUARD || "1").trim() !== "0";
}

export async function fetchImageBase64FromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    return null;
  }
}
