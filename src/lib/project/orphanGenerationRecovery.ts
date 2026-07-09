import { isRoomRenderInFlight } from "./roomOrder";
import type { RoomResult } from "./types";

export const ORPHAN_GENERATION_ERROR =
  "Generation was interrupted — please try again.";

/** Pure helper — mark a room orphaned when Redis says generating but no in-memory lock. */
export function normalizeOrphanedGeneratingRoom(
  room: RoomResult,
  isRunning: boolean,
): { room: RoomResult; orphan: boolean } {
  if (!isRoomRenderInFlight(room)) return { room, orphan: false };
  if (isRunning) return { room, orphan: false };

  const hasWork = (room.renders?.length ?? 0) > 0;
  return {
    room: {
      ...room,
      generationError: ORPHAN_GENERATION_ERROR,
      generationFailedAt: new Date().toISOString(),
      status: hasWork ? "review" : "pending",
      generationStep: "idle",
    },
    orphan: true,
  };
}

export function recoverOrphanedRoomsInState(
  rooms: RoomResult[],
  isRunning: (roomId: string) => boolean,
): { rooms: RoomResult[]; recovered: boolean } {
  let recovered = false;
  const next = rooms.map((room) => {
    const { room: normalized, orphan } = normalizeOrphanedGeneratingRoom(
      room,
      isRunning(room.roomId),
    );
    if (orphan) recovered = true;
    return normalized;
  });
  return { rooms: next, recovered };
}
