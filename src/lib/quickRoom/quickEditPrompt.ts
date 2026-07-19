import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import type { QuickRoomPlacementMode } from "@/lib/quickRoom/placementMode";
import type { CreativeMode, PreserveMode } from "@/lib/quickRoom/shapeCreativity";

/**
 * Short prompt assembly for Quick Room staging-shell → nano-banana furnish.
 * Style inspiration is text-only (Claude extract); products stay image refs.
 */

/** Hard cap for nano-banana-pro — attention degrades beyond ~1k chars. */
export const PROMPT_CHAR_CAP = 1200;
const SUBJECT_SLICE = 220;
const ARRANGEMENT_SLICE = 180;
const EDIT_CONTEXT_SLICE = 160;
const STYLE_INSPIRATION_SLICE = 380;

const PRESERVE_VERY_STRONG =
  "PRESERVE: Keep the exact room shape from the FIRST image — all walls, ceiling, floor, doors, windows, columns, and camera angle unchanged. Do not alter room geometry, openings, or perspective. Change only interior: furniture, finishes, lighting, and decor.";

const PRESERVE_STRONG =
  "PRESERVE: Keep the exact room shape from the FIRST image — all walls, ceiling, floor, doors, windows, columns, and camera angle unchanged. Change only interior: furniture, finishes, lighting, and decor.";

const PRESERVE_SOFT =
  "PRESERVE: Keep the room shape, walls, openings, ceiling, floor, and camera angle from the FIRST image. Change only furniture, finishes, lighting, and decor.";

export function buildPreserveBlock(mode: PreserveMode): string {
  switch (mode) {
    case "veryStrong":
      return PRESERVE_VERY_STRONG;
    case "soft":
      return PRESERVE_SOFT;
    default:
      return PRESERVE_STRONG;
  }
}

export interface QuickRoomImageRolesInput {
  collageSheetCount: number;
  /** When false, first image is the original room photo (levels 9–10). */
  runShell?: boolean;
}

export function buildQuickRoomImageRoles(opts: QuickRoomImageRolesInput): string {
  const firstImageRole = opts.runShell === false
    ? "The FIRST image is the original room photo — sole authority for walls, openings, ceiling, floor, and camera."
    : "The FIRST image is the staged empty room — sole authority for walls, openings, ceiling, floor, and camera.";
  const parts: string[] = [`IMAGE ROLES: ${firstImageRole}`];
  if (opts.collageSheetCount > 0) {
    const last = 1 + opts.collageSheetCount;
    const range =
      opts.collageSheetCount === 1
        ? `Image 2 is a PRODUCT REFERENCE SHEET`
        : `Images 2-${last} are PRODUCT REFERENCE SHEETS`;
    parts.push(
      `${range} — place these exact products inside the room. Never render a collage grid or sheet in the output.`,
    );
  }
  return parts.join(" ");
}

/** Human-readable role per image_urls index for the banana furnish pass. */
export function buildQuickRoomBananaImageRoles(opts: {
  collageSheetCount: number;
  runShell?: boolean;
}): string[] {
  const firstRole = opts.runShell === false
    ? "0: original room photo — geometry authority"
    : "0: staged shell — geometry authority (apartment-staging output)";
  const roles = [firstRole];
  for (let i = 0; i < opts.collageSheetCount; i++) {
    roles.push(`${i + 1}: product reference sheet ${i + 1}`);
  }
  return roles;
}

export function buildStyleInspirationPromptBlock(styleInspirationText: string): string {
  const body = styleInspirationText.trim().slice(0, STYLE_INSPIRATION_SLICE);
  if (!body) return "";
  return (
    `STYLE INSPIRATION (text only — do NOT copy any room geometry from this): ${body} ` +
    "Apply palette, materials, and mood to the FIRST image's room only."
  );
}

export interface QuickRoomEditInstructionInput {
  brief: Pick<DesignBrief, "subject" | "arrangement">;
  designStyleLabel: string;
  imageRoles: string;
  productIntroText?: string;
  productCloseText?: string;
  editContext?: string;
  placementMode?: QuickRoomPlacementMode;
  preserveMode?: PreserveMode;
  creativeMode?: CreativeMode;
  /** Claude-extracted style prose — never sent as FAL image input. */
  styleInspirationText?: string | null;
}

const PLACE_ONLY_CHANGE =
  "CHANGE: Place only the user-provided product(s). Keep walls, floor, ceiling, camera, and existing furniture unchanged except where a product replaces a similar item.";

function buildRedesignChange(
  designStyleLabel: string,
  creativeMode: CreativeMode,
): string {
  const style = designStyleLabel.trim() || "modern";
  switch (creativeMode) {
    case "moreCreative":
      return `CHANGE: Create a bold, imaginative ${style} interior with distinctive furniture, finishes, and decor while honoring the room structure.`;
    case "creative":
      return `CHANGE: Design a fresh, expressive ${style} interior with creative furniture choices, finishes, and decor.`;
    default:
      return `CHANGE: Furnish this room as a photorealistic ${style} interior.`;
  }
}

export function buildQuickRoomEditInstruction(input: QuickRoomEditInstructionInput): string {
  const placeOnly = input.placementMode === "placeOnly";
  const preserveMode = input.preserveMode ?? "strong";
  const creativeMode = input.creativeMode ?? "none";
  const styleBlock = input.styleInspirationText
    ? buildStyleInspirationPromptBlock(input.styleInspirationText)
    : "";

  const changeParts = [
    placeOnly
      ? PLACE_ONLY_CHANGE
      : buildRedesignChange(input.designStyleLabel, creativeMode),
    input.brief.subject?.trim()
      ? `Focus: ${input.brief.subject.trim().slice(0, SUBJECT_SLICE)}`
      : "",
    input.brief.arrangement?.trim()
      ? `Layout: ${input.brief.arrangement.trim().slice(0, ARRANGEMENT_SLICE)}`
      : "",
    input.editContext?.trim()
      ? `Adjustments: ${input.editContext.trim().slice(0, EDIT_CONTEXT_SLICE)}`
      : "",
  ].filter(Boolean);

  const productIntro = input.productIntroText?.trim() ?? "";
  const productClose = input.productCloseText?.trim() ?? "";

  const core = [
    input.imageRoles,
    buildPreserveBlock(preserveMode),
    styleBlock,
    ...changeParts,
  ].filter(Boolean).join(" ");

  let prompt = core;
  for (const block of [productIntro, productClose]) {
    if (!block) continue;
    const sep = prompt.length > 0 ? "\n\n" : "";
    if (prompt.length + sep.length + block.length > PROMPT_CHAR_CAP) continue;
    prompt = `${prompt}${sep}${block}`;
  }

  if (prompt.length > PROMPT_CHAR_CAP) {
    prompt = prompt.slice(0, PROMPT_CHAR_CAP - 1).trimEnd() + "…";
  }
  return prompt;
}
