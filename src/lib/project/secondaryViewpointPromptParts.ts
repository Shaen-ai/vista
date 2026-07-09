/** Pure secondary-view prompt wrapper — no server-only imports. */
import { SECONDARY_LAYOUT_LOCK_COMPACT } from "@/lib/secondaryLayoutLock";

export function buildSecondaryViewpointPromptParts(opts: {
  framingNote?: string;
  openingLock: string;
  designPrompt: string;
}): string {
  const { framingNote, openingLock, designPrompt } = opts;
  const cameraBlock = [
    "CAMERA VIEW (strict — secondary viewpoint):",
    "Output MUST match image_urls[0]'s exact camera angle, wall layout, and visible openings.",
    framingNote ? `Camera position: ${framingNote}.` : undefined,
    openingLock,
    SECONDARY_LAYOUT_LOCK_COMPACT,
    "Do NOT reproduce walls, openings, or composition from the hero/style reference — only furniture, finishes, palette, and identical decor items (rug, cushions, wall art, curtains, plants).",
    "Openings and walls NOT visible in image_urls[0] must NOT appear in the output.",
  ]
    .filter(Boolean)
    .join("\n");

  return `${cameraBlock}\n\n${designPrompt}`;
}
