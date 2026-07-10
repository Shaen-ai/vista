import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import { buildPreserveScaffold } from "@/lib/project/editPromptAssembly";

/**
 * Prompt assembly for the Quick Room nano-banana-pro edit pipeline. Mirrors
 * the Full Project scaffold (editPromptAssembly.ts) but the CHANGE block
 * comes from the Quick design brief, and the image roles cover product
 * reference sheets — Quick Room's core feature that Full Project lacks.
 */

/** Total prompt char budget for nano-banana-pro (attention degrades beyond this). */
const PROMPT_CHAR_CAP = 7000;
const BRIEF_FULL_PROMPT_SLICE = 2000;
export const MERCHANT_APPENDIX_CAP = 3800;

export interface QuickRoomImageRolesInput {
  collageSheetCount: number;
  hasStyleInspiration: boolean;
  hasStructuralMarkup: boolean;
}

export function buildQuickRoomImageRoles(opts: QuickRoomImageRolesInput): string {
  const parts: string[] = [
    "IMAGE ROLES: The FIRST image is the real photo of this room — it is the ONLY authority for geometry: walls, ceiling, floor, door and window openings, camera angle, and composition.",
  ];
  let nextIndex = 2;
  if (opts.collageSheetCount > 0) {
    const last = nextIndex + opts.collageSheetCount - 1;
    const range =
      opts.collageSheetCount === 1
        ? `Image ${nextIndex} is a PRODUCT REFERENCE SHEET`
        : `Images ${nextIndex}-${last} are PRODUCT REFERENCE SHEETS`;
    parts.push(
      `${range} — collages of real store products the user wants placed in the design. Place these exact products (their true shape, color, material, and proportions) as furniture inside the room. NEVER render a collage sheet itself, its grid, labels, or backgrounds; each cell is only a reference for one product.`,
    );
    nextIndex = last + 1;
  }
  if (opts.hasStyleInspiration) {
    parts.push(
      `Image ${nextIndex} is the user's STYLE INSPIRATION photo — copy its color palette, materials, decor density, textures, and lighting mood. Do NOT copy its room shape, layout, openings, or camera; do NOT copy specific furniture from it.`,
    );
    nextIndex += 1;
  }
  if (opts.hasStructuralMarkup) {
    parts.push(
      `The LAST image is the same room photo with GOLD LINES tracing immovable structural boundaries the user marked (floor-wall edges, wall-ceiling edges, columns, corners). Those boundaries are frozen — keep every marked edge exactly where it is. Never draw gold lines in the output.`,
    );
  }
  parts.push("Geometry comes exclusively from the first image.");
  return parts.join(" ");
}

export interface QuickRoomEditInstructionInput {
  brief: Pick<DesignBrief, "subject" | "arrangement" | "fullPrompt" | "doorDesign">;
  designStyleLabel: string;
  openingBoxCounts?: { windows: number; doors: number };
  imageRoles: string;
  productIntroText?: string;
  productCloseText?: string;
  merchantAppendix?: string;
  editContext?: string;
}

export function buildQuickRoomEditInstruction(input: QuickRoomEditInstructionInput): string {
  const preserve = buildPreserveScaffold(input.openingBoxCounts);

  const doorDesign = typeof input.brief.doorDesign === "string" ? input.brief.doorDesign.trim() : "";
  const changeParts = [
    `CHANGE: Redesign this room as a photorealistic ${input.designStyleLabel} interior.`,
    input.brief.subject?.trim() ? `Design: ${input.brief.subject.trim()}` : "",
    input.brief.arrangement?.trim() ? `Furniture arrangement: ${input.brief.arrangement.trim()}` : "",
    doorDesign ? `Door styling: ${doorDesign}` : "",
    input.editContext?.trim() ? `User adjustments: ${input.editContext.trim()}` : "",
  ].filter(Boolean);

  const productIntro = input.productIntroText?.trim() ?? "";
  const productClose = input.productCloseText?.trim() ?? "";
  const appendix = input.merchantAppendix?.trim().slice(0, MERCHANT_APPENDIX_CAP) ?? "";
  const designDirection = input.brief.fullPrompt?.trim()
    ? `Design direction: ${input.brief.fullPrompt.trim().slice(0, BRIEF_FULL_PROMPT_SLICE)}`
    : "";

  // Geometry lock, product placement mandates, and the core CHANGE lines are
  // never trimmed. Under budget pressure the long free-form brief text and the
  // merchant appendix go first (in that priority order below).
  const required = [
    [input.imageRoles, preserve, ...changeParts].filter(Boolean).join(" "),
    productIntro,
    productClose,
  ]
    .filter(Boolean)
    .join("\n\n");

  let prompt = required;
  for (const block of [designDirection, appendix]) {
    if (!block) continue;
    if (prompt.length + block.length + 2 > PROMPT_CHAR_CAP) continue;
    prompt = `${prompt}\n\n${block}`;
  }
  return prompt;
}
