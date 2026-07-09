import type { LabeledRoomPhoto } from "@/lib/buildMultiPhotoGeminiParts";
import {
  HALLWAY_PHOTO_OPTIMIZE_OPTIONS,
  optimizeImageBufferForAi,
} from "@/lib/optimizeImageForAi";

export { buildHallwayPhotoGeminiParts } from "@/lib/hallwayPhotoEditParts";
export type { GeminiTextOrImagePart } from "@/lib/hallwayPhotoEditParts";

/** Downscale corridor photos for Gemini while preserving wall jogs and door edges. */
export async function optimizeLabeledRoomPhotosForGemini(
  photos: LabeledRoomPhoto[],
): Promise<LabeledRoomPhoto[]> {
  return Promise.all(
    photos.map(async (photo) => {
      try {
        const optimized = await optimizeImageBufferForAi(
          Buffer.from(photo.base64, "base64"),
          HALLWAY_PHOTO_OPTIMIZE_OPTIONS,
        );
        return {
          ...photo,
          base64: optimized.base64,
          mimeType: optimized.mimeType,
        };
      } catch {
        return photo;
      }
    }),
  );
}
