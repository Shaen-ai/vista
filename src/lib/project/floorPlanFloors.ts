import type { DetectedRoom } from "./types";

export function roomFloorLevel(room: DetectedRoom): 1 | 2 {
  return room.floorLevel === 2 ? 2 : 1;
}

export function analysisHasMultipleFloors(rooms: DetectedRoom[]): boolean {
  return rooms.some((r) => r.floorLevel === 2);
}

export function groupRoomsByFloor(rooms: DetectedRoom[]): { floorLevel: 1 | 2; rooms: DetectedRoom[] }[] {
  const f1 = rooms.filter((r) => roomFloorLevel(r) === 1);
  const f2 = rooms.filter((r) => roomFloorLevel(r) === 2);
  const out: { floorLevel: 1 | 2; rooms: DetectedRoom[] }[] = [];
  if (f1.length) out.push({ floorLevel: 1, rooms: f1 });
  if (f2.length) out.push({ floorLevel: 2, rooms: f2 });
  return out.length ? out : [{ floorLevel: 1, rooms }];
}

export function floorLevelShortLabel(level: 1 | 2): string {
  return level === 2 ? "Floor 2 (ADU #2)" : "Floor 1 (ADU #1)";
}
