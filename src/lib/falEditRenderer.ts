import "server-only";

import sharp from "sharp";
import { fal } from "@fal-ai/client";
import { withRetry } from "@/lib/aiRetry";
import { nearestEditAspectRatio, type EditAspectRatio } from "@/lib/editAspectRatio";
import { uploadPublicImage, ensureFalConfigured } from "@/lib/falStorage";
import { pipelineLog, pipelineTimed } from "@/lib/pipelineLog";
import { logPipelineStage } from "@/lib/project/pipelineStageLog";

const FAL_NANO_BANANA_EDIT_ENDPOINT = "fal-ai/nano-banana-pro/edit";

export type EditResolution = "1K" | "2K" | "4K";

export interface EditStagingInput {
  imageBase64List: string[];
  imageMimeList?: string[];
  prompt: string;
  resolution?: EditResolution;
  /** Override the output ratio; defaults to the first input image's ratio. */
  aspectRatio?: EditAspectRatio;
  projectId?: string;
  roomId?: string;
  photoId?: string;
  stage?: "master" | "secondary";
  sessionId?: string;
  label?: string;
}

export interface EditStagingResult {
  base64: string;
  mimeType: string;
  width?: number;
  height?: number;
}

function resolveEditResolution(): EditResolution {
  const raw = (process.env.VISTA_EDIT_RESOLUTION || "2K").trim().toUpperCase();
  if (raw === "1K" || raw === "4K") return raw;
  return "2K";
}

export async function renderEditStaging(input: EditStagingInput): Promise<EditStagingResult> {
  ensureFalConfigured();
  const label = input.label ?? "edit-staging";
  const resolution = input.resolution ?? resolveEditResolution();
  const stage = input.stage ?? "master";
  const start = Date.now();

  const uploadTasks: Array<{ index: number; buf: Buffer; mime: string }> = [];
  let firstImageBuf: Buffer | null = null;
  for (let i = 0; i < input.imageBase64List.length; i++) {
    const b64 = input.imageBase64List[i]?.trim();
    if (!b64) continue;
    const buf = Buffer.from(b64, "base64");
    if (!firstImageBuf) firstImageBuf = buf;
    uploadTasks.push({ index: i, buf, mime: input.imageMimeList?.[i] || "image/jpeg" });
  }

  const uploaded = await Promise.all(
    uploadTasks.map(async ({ index, buf, mime }) => ({
      index,
      url: await uploadPublicImage(buf, mime, {
        sessionId: input.sessionId,
        type: "original",
        label: `${label}-input-${index}`,
      }),
    })),
  );
  uploaded.sort((a, b) => a.index - b.index);
  const imageUrls = uploaded.map((u) => u.url);

  if (imageUrls.length === 0 || !firstImageBuf) {
    throw new Error("renderEditStaging: no input images");
  }

  // Anchor the output frame to the edit target (the FIRST image) so the model
  // never adopts another reference image's — or its own — portrait canvas.
  let aspectRatio = input.aspectRatio;
  if (!aspectRatio) {
    try {
      const srcMeta = await sharp(firstImageBuf).metadata();
      aspectRatio = nearestEditAspectRatio(srcMeta.width ?? 0, srcMeta.height ?? 0);
    } catch (err) {
      pipelineLog(
        "FAL_RENDER",
        "edit aspect ratio probe failed — sending without aspect_ratio",
        { label, error: String(err).slice(0, 200) },
        "warn",
      );
    }
  }

  pipelineLog("FAL_RENDER", "nano-banana-pro edit request", {
    projectId: input.projectId,
    roomId: input.roomId,
    photoId: input.photoId,
    label,
    stage,
    endpoint: FAL_NANO_BANANA_EDIT_ENDPOINT,
    imageCount: imageUrls.length,
    resolution,
    aspectRatio: aspectRatio ?? "auto",
    promptChars: input.prompt.length,
    promptPreview: input.prompt.slice(0, 200),
  });

  const result = await withRetry(
    () =>
      pipelineTimed(
        "FAL_RENDER",
        "nano-banana edit subscribe",
        () =>
          fal.subscribe(FAL_NANO_BANANA_EDIT_ENDPOINT, {
            input: {
              prompt: input.prompt,
              image_urls: imageUrls,
              resolution,
              ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
              num_images: 1,
              output_format: "jpeg",
            },
            logs: false,
          }),
        {
          meta: {
            projectId: input.projectId,
            roomId: input.roomId,
            photoId: input.photoId,
            label,
            endpoint: FAL_NANO_BANANA_EDIT_ENDPOINT,
          },
        },
      ),
    "nano-banana-pro edit",
  );

  const images = (result.data as { images?: Array<{ url?: string }> })?.images ?? [];
  const { recordFalUsage } = await import("@/lib/aiSpend");
  recordFalUsage({ endpoint: FAL_NANO_BANANA_EDIT_ENDPOINT, label });
  const url = images[0]?.url;
  if (!url) throw new Error("nano-banana-pro edit returned no image");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch edit result: HTTP ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  let mimeType = res.headers.get("content-type") || "image/jpeg";
  if (!mimeType.includes("jpeg") && !mimeType.includes("jpg")) {
    buf = Buffer.from(await sharp(buf).jpeg({ quality: 90 }).toBuffer());
    mimeType = "image/jpeg";
  }

  const meta = await sharp(buf).metadata();
  const ms = Date.now() - start;

  logPipelineStage({
    projectId: input.projectId ?? input.sessionId ?? "unknown",
    roomId: input.roomId ?? "unknown",
    photoId: input.photoId,
    stage,
    ok: true,
    ms,
    endpoint: FAL_NANO_BANANA_EDIT_ENDPOINT,
  });

  pipelineLog("FAL_RENDER", "nano-banana-pro edit response", {
    projectId: input.projectId,
    roomId: input.roomId,
    photoId: input.photoId,
    label,
    width: meta.width,
    height: meta.height,
    bytes: buf.length,
    durationMs: ms,
  });

  return { base64: buf.toString("base64"), mimeType, width: meta.width, height: meta.height };
}
