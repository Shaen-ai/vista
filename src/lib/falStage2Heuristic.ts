import sharp from "sharp";

/** Mean pixel diff below this → Stage 2 still matches empty Stage 1 shell. */
const SPARSE_DIFF_THRESHOLD = 8;

const SAMPLE_SIZE = 64;

export type FurnitureVisibleInStage2Input = boolean | "unknown";

/**
 * Best-effort: true when primary Stage 2 differs enough from Stage 1 empty shell.
 */
export async function estimateFurnitureVisibleInStage2Input(
  stage1Base64: string | undefined,
  primaryStage2Base64: string | undefined,
): Promise<FurnitureVisibleInStage2Input> {
  if (!stage1Base64?.trim() || !primaryStage2Base64?.trim()) return "unknown";

  try {
    const [a, b] = await Promise.all([
      downsampleRgb(stage1Base64),
      downsampleRgb(primaryStage2Base64),
    ]);
    if (!a || !b || a.length !== b.length) return "unknown";

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.abs(a[i]! - b[i]!);
    }
    const meanDiff = sum / a.length;
    return meanDiff >= SPARSE_DIFF_THRESHOLD;
  } catch {
    return "unknown";
  }
}

async function downsampleRgb(base64: string): Promise<Uint8Array | null> {
  const buf = Buffer.from(base64, "base64");
  const { data, info } = await sharp(buf)
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels < 3) return null;
  const out = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j++) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    out[j] = Math.round((r + g + b) / 3);
  }
  return out;
}
