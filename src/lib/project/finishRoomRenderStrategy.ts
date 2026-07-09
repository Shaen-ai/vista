import type { RoomPhotoWithViewpoint } from "./types";

export type FinishRoomRenderStrategy = "heroSecondary" | "viewpoint" | "photoReference" | "angleVariations";

/**
 * Decide how finishRoom should produce extra camera views for a room.
 * When 2+ real photos are assigned, always use hero-secondary (IP-Adapter from
 * the hero + Canny on each secondary photo). Never fake angle variations when
 * real photos exist.
 */
export function resolveFinishRoomRenderStrategy(
  roomPhotos: RoomPhotoWithViewpoint[],
): FinishRoomRenderStrategy {
  if (roomPhotos.length >= 2) return "heroSecondary";
  const withViewpoint = roomPhotos.filter((p) => p.viewpoint);
  if (withViewpoint.length > 0) return "viewpoint";
  if (roomPhotos.length === 1) return "photoReference";
  return "angleVariations";
}
