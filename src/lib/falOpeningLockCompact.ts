import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import { buildOpeningStructuralLock } from "@/lib/openingStructuralLock";

export const FAL_OPENING_LOCK_MAX = 2000;
export const FAL_OPENING_LOCK_RETRY_MAX = 1400;

export function compactOpeningLock(fullLock: string, maxChars: number): string {
  if (!fullLock.trim()) return "";
  const kept: string[] = [];
  let inCurtainBlock = false;
  for (const line of fullLock.split("\n")) {
    if (line.startsWith("CURTAIN POLICY")) {
      inCurtainBlock = true;
      continue;
    }
    if (inCurtainBlock) {
      if (
        line.startsWith("SOLID WALL")
        || line.startsWith("WINDOWS:")
        || line.startsWith("DOORS")
        || line.startsWith("ROOM PROPORTIONS:")
        || line.startsWith("The floor plan shows")
      ) {
        inCurtainBlock = false;
      } else if (line.startsWith("  ") || line.startsWith("-") || line.trim() === "") {
        continue;
      } else {
        inCurtainBlock = false;
      }
    }
    if (line.includes("Sill sits") || line.includes("Head stops below")) continue;
    if (line.includes("clearly elongated") && line.includes("NOT square")) {
      kept.push(
        line.replace(
          /do NOT widen, square off, or enlarge the room\./,
          "preserve the photo's perceived depth, ceiling height, and camera field of view — do NOT compress the space toward the camera or make it feel smaller/closer than the input photo.",
        ),
      );
      continue;
    }
    kept.push(line);
  }
  const compact = kept.join("\n");
  return compact.length > maxChars ? compact.slice(0, maxChars) : compact;
}

export function buildCompactOpeningLockForFal(fullLock: string): string {
  return compactOpeningLock(fullLock, FAL_OPENING_LOCK_MAX);
}

export function buildCompactOpeningLockForRetry(fullLock: string): string {
  return compactOpeningLock(fullLock, FAL_OPENING_LOCK_RETRY_MAX);
}

export function buildFalOpeningLockCompact(
  roomAnalysis: RoomAnalysis | null | undefined,
  roomGeometry: RoomGeometry | null | undefined,
): string {
  return buildCompactOpeningLockForFal(buildOpeningStructuralLock(roomAnalysis, roomGeometry));
}
