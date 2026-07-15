import "server-only";

import sharp from "sharp";
import { fal, ValidationError } from "@fal-ai/client";
import { withRetry } from "@/lib/aiRetry";
import { uploadPublicImage, ensureFalConfigured } from "@/lib/falStorage";
import { pipelineLog } from "@/lib/pipelineLog";
import { logFalCostEstimate } from "./projectStagingCost";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
  workspaceFileExists,
} from "./projectRoomWorkspace";
import { readStagingCacheMeta } from "./stagingCacheFingerprint";
import { applyFalMaskPolarity } from "@/lib/applyFalMaskPolarity";
import { hasOpeningBoxes } from "@/lib/openingFreezeRegions";
import { isRemovalMaskEffectivelyEmpty } from "@/lib/maskWhiteCoverage";
import { prepareRemovalMaskForPrep } from "@/lib/prepareRemovalMaskForPrep";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";

const FAL_INPAINT_ENDPOINT = "fal-ai/flux-general/inpainting";
const PREP_PROMPT =
  "Remove furniture and decor from masked area, keep walls floor ceiling windows doors unchanged, photorealistic empty room";

function prepWorkspaceFilename(photoId: string): string {
  return `prep-${photoId}.jpg`;
}

async function skipPrepWithOriginalPhoto(opts: {
  projectId: string;
  roomId: string;
  photoId: string;
  photoBuf: Buffer;
  photoBase64: string;
  photoMime: string;
  reason: string;
  extra?: Record<string, unknown>;
}): Promise<{ prepBase64: string; prepMime: string; skipped: boolean }> {
  const prepFile = prepWorkspaceFilename(opts.photoId);
  await writeWorkspaceFile(opts.projectId, opts.roomId, prepFile, opts.photoBuf);
  pipelineLog("FAL_PIPELINE", opts.reason, {
    projectId: opts.projectId,
    roomId: opts.roomId,
    photoId: opts.photoId,
    ...opts.extra,
  });
  return {
    prepBase64: opts.photoBase64,
    prepMime: opts.photoMime,
    skipped: true,
  };
}

export async function applyPhotoPrepInpaint(opts: {
  projectId: string;
  roomId: string;
  photoId: string;
  photoBase64: string;
  photoMime: string;
  maskBase64?: string;
  openingAnalysis?: {
    window_boxes?: OpeningBox[];
    door_boxes?: OpeningBox[];
  } | null;
  skipIfCached?: boolean;
  /** When set, prep cache is used only if cache-meta matches this fingerprint. */
  prepFingerprint?: string;
}): Promise<{ prepBase64: string; prepMime: string; skipped: boolean }> {
  const prepFile = prepWorkspaceFilename(opts.photoId);
  const photoBuf = Buffer.from(opts.photoBase64, "base64");
  const meta = await sharp(photoBuf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (!opts.maskBase64?.trim()) {
    return skipPrepWithOriginalPhoto({
      projectId: opts.projectId,
      roomId: opts.roomId,
      photoId: opts.photoId,
      photoBuf,
      photoBase64: opts.photoBase64,
      photoMime: opts.photoMime,
      reason: "prep skipped — no removal mask",
    });
  }

  if (
    opts.skipIfCached &&
    (await workspaceFileExists(opts.projectId, opts.roomId, prepFile))
  ) {
    if (opts.prepFingerprint) {
      const cacheMeta = await readStagingCacheMeta(opts.projectId, opts.roomId);
      const stored = cacheMeta.photos[opts.photoId]?.prepFingerprint;
      if (stored !== opts.prepFingerprint) {
        pipelineLog("FAL_PIPELINE", "prep cache stale — fingerprint mismatch", {
          projectId: opts.projectId,
          roomId: opts.roomId,
          photoId: opts.photoId,
          stored,
          current: opts.prepFingerprint,
        });
      } else {
        const cached = await readWorkspaceFile(opts.projectId, opts.roomId, prepFile);
        if (cached) {
          pipelineLog("FAL_PIPELINE", "prep cache hit", {
            projectId: opts.projectId,
            roomId: opts.roomId,
            photoId: opts.photoId,
          });
          return { prepBase64: cached.toString("base64"), prepMime: "image/jpeg", skipped: true };
        }
      }
    } else {
      const cached = await readWorkspaceFile(opts.projectId, opts.roomId, prepFile);
      if (cached) {
        pipelineLog("FAL_PIPELINE", "prep cache hit", {
          projectId: opts.projectId,
          roomId: opts.roomId,
          photoId: opts.photoId,
        });
        return { prepBase64: cached.toString("base64"), prepMime: "image/jpeg", skipped: true };
      }
    }
  }

  ensureFalConfigured();

  const windowBoxes = opts.openingAnalysis?.window_boxes;
  const doorBoxes = opts.openingAnalysis?.door_boxes;
  let maskBuf = await prepareRemovalMaskForPrep({
    maskBase64: opts.maskBase64,
    photoBase64: opts.photoBase64,
    photoWidth: width,
    photoHeight: height,
    openingAnalysis: opts.openingAnalysis,
  });

  if (hasOpeningBoxes(windowBoxes, doorBoxes)) {
    pipelineLog("FAL_PIPELINE", "prep mask merged with opening protection", {
      projectId: opts.projectId,
      roomId: opts.roomId,
      photoId: opts.photoId,
      windowBoxes: windowBoxes?.length ?? 0,
      doorBoxes: doorBoxes?.length ?? 0,
    });
  }

  if (await isRemovalMaskEffectivelyEmpty(maskBuf)) {
    return skipPrepWithOriginalPhoto({
      projectId: opts.projectId,
      roomId: opts.roomId,
      photoId: opts.photoId,
      photoBuf,
      photoBase64: opts.photoBase64,
      photoMime: opts.photoMime,
      reason: "prep skipped — removal mask has no inpaintable pixels",
    });
  }

  maskBuf = Buffer.from(await applyFalMaskPolarity(maskBuf));

  const photoUrl = await uploadPublicImage(photoBuf, opts.photoMime || "image/jpeg", {
    sessionId: opts.projectId,
    type: "original",
    label: `prep-original-${opts.photoId}`,
  });

  const maskUrl = await uploadPublicImage(maskBuf, "image/png", {
    sessionId: opts.projectId,
    type: "original",
    label: `object-removal-mask-${opts.photoId}`,
  });

  logFalCostEstimate("inpaint", width, height, FAL_INPAINT_ENDPOINT, {
    projectId: opts.projectId,
    roomId: opts.roomId,
    photoId: opts.photoId,
  });

  pipelineLog("FAL_PIPELINE", "photo prep inpaint start", {
    projectId: opts.projectId,
    roomId: opts.roomId,
    photoId: opts.photoId,
    width,
    height,
    hasOpeningProtection: hasOpeningBoxes(windowBoxes, doorBoxes),
  });

  try {
    const result = await withRetry(
      () =>
        fal.subscribe(FAL_INPAINT_ENDPOINT, {
          input: {
            image_url: photoUrl,
            mask_url: maskUrl,
            prompt: PREP_PROMPT,
            strength: 0.95,
            num_inference_steps: 28,
            guidance_scale: 3.5,
            output_format: "jpeg",
          },
          logs: false,
        }),
      "photo prep inpaint",
    );

    const images = (result.data as { images?: Array<{ url?: string }> })?.images ?? [];
    const { recordFalUsage } = await import("@/lib/aiSpend");
    recordFalUsage({ endpoint: FAL_INPAINT_ENDPOINT, label: "photo-prep-inpaint" });
    const url = images[0]?.url;
    if (!url) throw new Error("Inpaint prep returned no image");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch inpaint result: HTTP ${res.status}`);
    const prepBuf = Buffer.from(await res.arrayBuffer());
    await writeWorkspaceFile(opts.projectId, opts.roomId, prepFile, prepBuf);

    pipelineLog("FAL_PIPELINE", "photo prep inpaint complete", {
      projectId: opts.projectId,
      roomId: opts.roomId,
      photoId: opts.photoId,
      bytes: prepBuf.length,
    });

    return { prepBase64: prepBuf.toString("base64"), prepMime: "image/jpeg", skipped: false };
  } catch (err) {
    if (err instanceof ValidationError) {
      const detail = err.fieldErrors
        .map((fe) => `${fe.loc.join(".")}: ${fe.msg}`)
        .join("; ");
      pipelineLog(
        "FAL_PIPELINE",
        "photo prep inpaint validation failed — falling back to original photo",
        {
          projectId: opts.projectId,
          roomId: opts.roomId,
          photoId: opts.photoId,
          endpoint: FAL_INPAINT_ENDPOINT,
          fieldErrors: err.fieldErrors,
          detail: detail || err.message,
        },
        "warn",
      );
      return skipPrepWithOriginalPhoto({
        projectId: opts.projectId,
        roomId: opts.roomId,
        photoId: opts.photoId,
        photoBuf,
        photoBase64: opts.photoBase64,
        photoMime: opts.photoMime,
        reason: "prep skipped — inpaint provider rejected mask",
        extra: { detail: detail || err.message },
      });
    }
    throw err;
  }
}
