/** Shared furniture layout lock for secondary-angle renders (FAL + Gemini). */

/** Full layout lock — Quick Room finalview and Gemini final-view prompts. */
export const SECONDARY_LAYOUT_LOCK = `
LAYOUT LOCK (strict — same room, different camera only):
- Every piece of furniture stays on its SAME PHYSICAL COMPASS WALL as in the hero/reference design. The bed headboard wall does NOT change. The wardrobe wall does NOT change.
- Do NOT mirror, flip, or swap furniture positions between walls. Do NOT move the bed to the opposite wall because the camera faces the other way.
- Use the SAME products as the hero — same wardrobe shape/size, same desk, same chair (not a substitute). Do NOT introduce different furniture or remove listed pieces.
- Match flooring, wall finishes, rug, curtains, and decor from the hero; only the camera angle changes.`;

/** Compact layout lock — staging prompts with length clamps. */
export const SECONDARY_LAYOUT_LOCK_COMPACT =
  "Furniture layout lock: same compass wall per piece as hero (bed headboard wall, wardrobe wall unchanged). " +
  "No mirroring or swapping walls. Same products — identical wardrobe, desk, and chair as hero, not substitutes.";

/** Append layout lock to a secondary prompt if not already present. */
export function appendSecondaryLayoutLock(prompt: string, compact = false): string {
  const lock = compact ? SECONDARY_LAYOUT_LOCK_COMPACT : SECONDARY_LAYOUT_LOCK;
  if (prompt.includes("LAYOUT LOCK") || prompt.includes("Furniture layout lock:")) {
    return prompt;
  }
  return `${prompt.trim()}\n\n${lock}`.trim();
}
