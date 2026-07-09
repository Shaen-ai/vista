/** Keep floor clear in front of every door — used in creative director + render prompts. */
export const DOOR_CLEARANCE_DIRECTIVE =
  "Keep the floor area in front of every door completely clear of furniture; no tall furniture touching a door frame. Maintain at least 90 cm clearance beside and in front of every door or passage.";

const DOOR_DESIGN_FALLBACK =
  "Render every doorway and passage with a finished door leaf (material, color, handle, and trim matching the room style). Each door may be open or closed as appropriate — never a bare dark empty opening.";

/** Prompt block for styled door leaves — uses Claude concept when available. */
export function buildDoorDesignPromptBlock(doorDesign?: string | null): string {
  const styling = doorDesign?.trim() || DOOR_DESIGN_FALLBACK;
  return [
    "DOOR FINISH — every doorway/passage must show a finished door:",
    styling,
    "Do not render doorways as dark empty openings. Door positions and counts are unchanged from the reference photo.",
  ].join("\n");
}
