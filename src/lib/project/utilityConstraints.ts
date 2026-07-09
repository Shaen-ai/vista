/**
 * Turns user-placed utility entry points into prompt text so the master concept
 * and per-room renders place plumbing/gas/electrical-dependent furniture against
 * the real, immovable connections. Server-safe (no client/icon imports).
 */
import type { DetectedRoom, UtilityEntryPoint, UtilityPointType } from "./types";
import { assignUtilitiesToRooms, describeUtilityPosition } from "./floorPlanGeometry";

const UTILITY_LABEL: Record<UtilityPointType, string> = {
  water_inlet: "water supply inlet",
  water_drain_stack: "drain / waste stack",
  electrical_panel: "electrical panel",
  gas_inlet: "gas inlet",
};

const UTILITY_GUIDANCE: Record<UtilityPointType, string> = {
  water_inlet: "place the sink, dishwasher and other plumbed fixtures near here",
  water_drain_stack: "anchor the WC, shower/bath and floor drains to this stack",
  electrical_panel: "keep this panel accessible; route major appliances and outlets from here",
  gas_inlet: "place the cooktop/range or gas boiler near here",
};

/** One bullet per utility, e.g. "- water supply inlet at the back-left corner — place the sink...". */
function describeRoomUtilities(room: DetectedRoom, utilities: UtilityEntryPoint[]): string[] {
  return utilities.map(
    (u) => `- ${UTILITY_LABEL[u.type]} at the ${describeUtilityPosition(u, room)} — ${UTILITY_GUIDANCE[u.type]}`,
  );
}

/** Per-room block for a single render prompt. Empty string when the room has no utilities. */
export function buildRoomUtilityConstraints(
  room: DetectedRoom | undefined,
  utilities: UtilityEntryPoint[],
): string {
  if (!room || utilities.length === 0) return "";
  return `\nUTILITY CONSTRAINTS (fixed — these connections cannot be moved):\n${describeRoomUtilities(room, utilities).join("\n")}\n`;
}

/** Whole-home block for the master concept prompt. Empty string when nothing is placed. */
export function buildConceptUtilityConstraints(
  rooms: DetectedRoom[],
  utilities: UtilityEntryPoint[],
): string {
  const byRoom = assignUtilitiesToRooms(rooms, utilities);
  if (byRoom.size === 0) return "";
  const blocks: string[] = [];
  for (const room of rooms) {
    const list = byRoom.get(room.id);
    if (!list?.length) continue;
    blocks.push(`${room.name} (${room.type}):\n${describeRoomUtilities(room, list).join("\n")}`);
  }
  if (blocks.length === 0) return "";
  return `\nFIXED UTILITY ENTRY POINTS (plumbing/gas/electrical cannot be relocated — design each room's furniture layout around these):\n${blocks.join("\n\n")}\n`;
}
