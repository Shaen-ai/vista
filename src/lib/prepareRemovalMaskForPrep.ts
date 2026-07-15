import { normalizeObjectRemovalMask } from "@/lib/normalizeObjectRemovalMask";
import { mergeRemovalWithOpeningFreeze } from "@/lib/mergeRemovalWithOpeningFreeze";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";

/**
 * Normalize a user-drawn removal mask, align it to photo dimensions, and merge
 * opening-freeze regions when present.
 */
export async function prepareRemovalMaskForPrep(opts: {
  maskBase64: string;
  photoBase64: string;
  photoWidth: number;
  photoHeight: number;
  openingAnalysis?: {
    window_boxes?: OpeningBox[];
    door_boxes?: OpeningBox[];
  } | null;
}): Promise<Buffer> {
  const normalizedRemoval = await normalizeObjectRemovalMask({
    maskBase64: opts.maskBase64,
    originalPhotoBase64: opts.photoBase64,
  });
  const maskBuf = Buffer.from(normalizedRemoval.base64, "base64");
  return mergeRemovalWithOpeningFreeze({
    removalMaskPng: maskBuf,
    photoWidth: opts.photoWidth,
    photoHeight: opts.photoHeight,
    windowBoxes: opts.openingAnalysis?.window_boxes,
    doorBoxes: opts.openingAnalysis?.door_boxes,
  });
}
