import "server-only";

import { fal } from "@fal-ai/client";
import { ensureFalConfigured } from "@/lib/falStorage";
import { withRetry } from "@/lib/aiRetry";
import { pipelineLog, pipelineTimed } from "@/lib/pipelineLog";

const DEFAULT_TXT2IMG_ENDPOINT = "fal-ai/flux-pro/v1.1";

export interface FalTextToImageInput {
  prompt: string;
  seed?: number;
  sessionId?: string;
  label?: string;
}

export interface FalTextToImageResult {
  base64: string;
  mimeType: string;
  seed?: number;
}

function resolveTxt2ImgEndpoint(): string {
  return (process.env.VISTA_FAL_TXT2IMG_ENDPOINT || "").trim() || DEFAULT_TXT2IMG_ENDPOINT;
}

function parseFalSeed(data: unknown): number | undefined {
  const seed = (data as { seed?: unknown })?.seed;
  return typeof seed === "number" && Number.isFinite(seed) ? seed : undefined;
}

async function fetchFalImageUrls(
  images: Array<{ url?: string }>,
  label: string,
): Promise<FalTextToImageResult | null> {
  for (const img of images) {
    if (!img.url) continue;
    try {
      const item = await pipelineTimed(
        "FAL_RENDER",
        "fetch txt2img result",
        async () => {
          const res = await fetch(img.url!);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const mimeType = res.headers.get("content-type") || "image/png";
          const buf = Buffer.from(await res.arrayBuffer());
          return { base64: buf.toString("base64"), mimeType };
        },
        { meta: { label } },
      );
      return item;
    } catch (err) {
      pipelineLog(
        "FAL_RENDER",
        "fetch txt2img result — skipped",
        { label, error: String(err).slice(0, 120) },
        "warn",
      );
    }
  }
  return null;
}

export async function renderFalTextToImage(input: FalTextToImageInput): Promise<FalTextToImageResult> {
  ensureFalConfigured();
  const endpoint = resolveTxt2ImgEndpoint();
  const label = input.label ?? "fal-txt2img";

  pipelineLog("FAL_RENDER", "txt2img request", {
    label,
    endpoint,
    promptChars: input.prompt.length,
    seed: input.seed,
  });

  const result = await withRetry(
    () =>
      pipelineTimed(
        "FAL_RENDER",
        "txt2img subscribe",
        () =>
          fal.subscribe(endpoint, {
            input: {
              prompt: input.prompt,
              ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
            },
            logs: false,
          }),
        { meta: { label, endpoint } },
      ),
    label,
  );

  const responseSeed = parseFalSeed(result.data);
  const images = (result.data as { images?: Array<{ url?: string }> })?.images ?? [];
  const fetched = await fetchFalImageUrls(images, label);
  if (!fetched) {
    throw new Error("FAL text-to-image returned no usable image.");
  }

  const { recordFalUsage } = await import("@/lib/aiSpend");
  recordFalUsage({ endpoint, label });

  pipelineLog("FAL_RENDER", "txt2img response", {
    label,
    endpoint,
    seed: responseSeed,
    bytes: fetched.base64.length,
  });

  return { ...fetched, seed: responseSeed };
}
