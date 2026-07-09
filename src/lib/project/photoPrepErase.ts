import "server-only";

import sharp from "sharp";
import { fal } from "@fal-ai/client";
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
import { normalizeObjectRemovalMask } from "@/lib/normalizeObjectRemovalMask";
import { hasOpeningBoxes } from "@/lib/openingFreezeRegions";
import { mergeRemovalWithOpeningFreeze } from "@/lib/mergeRemovalWithOpeningFreeze";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";

const FAL_ERASE_ENDPOINT = "fal-ai/flux-pro/v1/erase";

function prepWorkspaceFilename(photoId: string): string {
  return `prep-${photoId}.jpg`;
}

function eraseDilatePixels(): number {
  const v = Number(process.env.VISTA_FAL_ERASE_DILATE_PIXELS);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : 12;
}

export async function applyPhotoPrepErase(opts: {
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
  prepFingerprint?: string;
}): Promise<{ prepBase64: string; prepMime: string; skipped: boolean }> {
  const prepFile = prepWorkspaceFilename(opts.photoId);
  const photoBuf = Buffer.from(opts.photoBase64, "base64");
  const meta = await sharp(photoBuf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (!opts.maskBase64?.trim()) {
    await writeWorkspaceFile(opts.projectId, opts.roomId, prepFile, photoBuf);
    pipelineLog("FAL_PIPELINE", "prep skipped — no removal mask", {
      projectId: opts.projectId,
      roomId: opts.roomId,
      photoId: opts.photoId,
    });
    return { prepBase64: opts.photoBase64, prepMime: opts.photoMime, skipped: true };
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
        }, "warn");
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

  const normalizedRemoval = await normalizeObjectRemovalMask({
    maskBase64: opts.maskBase64,
    originalPhotoBase64: opts.photoBase64,
  });
  let maskBuf = Buffer.from(normalizedRemoval.base64, "base64");

  const windowBoxes = opts.openingAnalysis?.window_boxes;
  const doorBoxes = opts.openingAnalysis?.door_boxes;
  if (hasOpeningBoxes(windowBoxes, doorBoxes)) {
    maskBuf = Buffer.from(
      await mergeRemovalWithOpeningFreeze({
        removalMaskPng: maskBuf,
        photoWidth: width,
        photoHeight: height,
        windowBoxes,
        doorBoxes,
      }),
    );
    pipelineLog("FAL_PIPELINE", "prep mask merged with opening protection", {
      projectId: opts.projectId,
      roomId: opts.roomId,
      photoId: opts.photoId,
      windowBoxes: windowBoxes?.length ?? 0,
      doorBoxes: doorBoxes?.length ?? 0,
    });
  }

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

  logFalCostEstimate("inpaint", width, height, FAL_ERASE_ENDPOINT, {
    projectId: opts.projectId,
    roomId: opts.roomId,
    photoId: opts.photoId,
  });

  const dilatePixels = eraseDilatePixels();
  pipelineLog("FAL_PIPELINE", "photo prep erase start", {
    projectId: opts.projectId,
    roomId: opts.roomId,
    photoId: opts.photoId,
    width,
    height,
    dilatePixels,
    hasOpeningProtection: hasOpeningBoxes(windowBoxes, doorBoxes),
  });

  const result = await withRetry(
    () =>
      fal.subscribe(FAL_ERASE_ENDPOINT, {
        input: {
          image_url: photoUrl,
          mask_url: maskUrl,
          dilate_pixels: dilatePixels,
          output_format: "jpeg",
        },
        logs: false,
      }),
    "photo prep erase",
  );

  const images = (result.data as { images?: Array<{ url?: string }> })?.images ?? [];
  const { recordFalUsage } = await import("@/lib/aiSpend");
  recordFalUsage({ endpoint: FAL_ERASE_ENDPOINT, label: "photo-prep-erase" });
  const url = images[0]?.url;
  if (!url) throw new Error("Erase prep returned no image");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch erase result: HTTP ${res.status}`);
  const prepBuf = Buffer.from(await res.arrayBuffer());
  await writeWorkspaceFile(opts.projectId, opts.roomId, prepFile, prepBuf);

  pipelineLog("FAL_PIPELINE", "photo prep erase complete", {
    projectId: opts.projectId,
    roomId: opts.roomId,
    photoId: opts.photoId,
    bytes: prepBuf.length,
  });

  return { prepBase64: prepBuf.toString("base64"), prepMime: "image/jpeg", skipped: false };
}
