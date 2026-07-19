import { roomSummaryText } from "./roomFloorPlanContext";
import type { ProjectState, RoomType } from "./types";

const PLAN_VIEW_DIRECTIVE = `OUTPUT FORMAT — FURNISHED FLOOR PLAN (mandatory):
- Produce a single top-down / plan-view furnished interior layout based on the uploaded floor plan.
- Keep every wall, door, window, room boundary, and overall apartment shape EXACTLY as in the PRIMARY floor plan image.
- Do NOT generate perspective room photographs, 3D renders, or isometric room views.
- Add furniture and rugs as plan-view symbols appropriate to each labeled room type.
- Use the design style, palette, and materials from the concept below consistently across all rooms.
- No text labels, captions, or watermarks in the output image.`;

export function furnitureHintForRoomType(type: RoomType): string {
  switch (type) {
    case "bedroom":
    case "children":
      return "bed, nightstands, wardrobe or dresser";
    case "living":
      return "sofa, coffee table, TV unit or media console, accent chairs";
    case "dining":
      return "dining table with chairs";
    case "kitchen":
      return "counter run, sink, cooktop, fridge footprint, optional island";
    case "bathroom":
    case "toilet":
      return "vanity, toilet, shower or tub footprint";
    case "office":
      return "desk, office chair, shelving";
    case "hallway":
      return "slim console, runner rug — keep circulation clear";
    case "wardrobe":
      return "wardrobe modules along walls";
    case "laundry":
      return "washer/dryer footprint, utility counter";
    case "balcony":
      return "small outdoor table and chairs";
    case "storage":
      return "shelving units only";
    default:
      return "appropriate furniture for the room size";
  }
}

export function buildFurnishedFloorPlanPrompt(state: ProjectState): string {
  if (!state.analysis || !state.concept) {
    throw new Error("Floor plan analysis and design concept are required.");
  }

  const concept = state.concept;
  const cp = concept.colorPalette;
  const mp = concept.materialPalette;

  const roomFurnitureLines = state.analysis.rooms.map((room) => {
    const brief = concept.rooms.find((b) => b.roomId === room.id);
    const furniture =
      brief?.furnitureList?.length
        ? brief.furnitureList.join(", ")
        : furnitureHintForRoomType(room.type);
    return `- ${room.name} (${room.type}): ${furniture}`;
  });

  return [
    PLAN_VIEW_DIRECTIVE,
    "",
    "MASTER DESIGN CONCEPT:",
    `- Style: ${concept.overallStyle}`,
    `- Walls: ${cp.primary.name} (${cp.primary.hex})`,
    `- Accent: ${cp.accent.name} (${cp.accent.hex})`,
    `- Flooring: ${mp.woodType}; textiles: ${mp.textilePrimary}`,
    "",
    "FURNITURE PER ROOM:",
    roomFurnitureLines.join("\n"),
    "",
    "FLOOR PLAN ROOM DATA (authoritative geometry — do not alter walls or openings):",
    roomSummaryText(state.analysis),
    "",
    state.preferences.wishes?.trim()
      ? `USER WISHES: ${state.preferences.wishes.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
