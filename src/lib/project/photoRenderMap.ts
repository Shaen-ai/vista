import type { RoomResult } from "./types";

/** Viewpoint-marked photos first — matches getRoomPhotos / generation hero order. */
export function sortRoomPhotoIds(
  photoIds: Array<{ id: string; viewpoint?: unknown }>,
): string[] {
  return [...photoIds]
    .sort((a, b) => (b.viewpoint ? 1 : 0) - (a.viewpoint ? 1 : 0))
    .map((p) => p.id);
}

/**
 * Resolve which uploaded photo produced a render gallery slot.
 * Uses photoRenderMap first, then primaryPhotoId for index 0, then room photo order.
 */
export function resolvePhotoIdForRenderIndex(
  room: Pick<RoomResult, "photoRenderMap" | "primaryPhotoId">,
  renderIndex: number,
  roomPhotoIds?: string[],
): string | undefined {
  const fromMap = Object.entries(room.photoRenderMap ?? {}).find(
    ([, idx]) => idx === renderIndex,
  )?.[0];
  if (fromMap) return fromMap;
  if (renderIndex === 0 && room.primaryPhotoId) return room.primaryPhotoId;
  return roomPhotoIds?.[renderIndex];
}

export function canRedoIndividualView(room: Pick<RoomResult, "renders" | "viewpointTargetCount">): boolean {
  const targetCount = room.viewpointTargetCount ?? 1;
  return targetCount > 1 || room.renders.length > 1;
}
