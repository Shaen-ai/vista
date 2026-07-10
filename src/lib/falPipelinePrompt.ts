import { DESIGN_STYLES, type RoomAnalysis } from "@/lib/interiorDesignPrompts";
import { FAL_OBJECT_REMOVAL_TAIL } from "@/lib/buildObjectRemovalDirective";
import {
  buildDoorDesignPromptBlock,
  DOOR_CLEARANCE_DIRECTIVE,
} from "@/lib/doorRenderPrompt";
import { buildFalOpeningLockCompact } from "@/lib/falOpeningLockCompact";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";

export interface FalRedesignPromptInput {
  /** Pre-built design prompt (brief.fullPrompt, project prompt, etc.) */
  designPrompt?: string;
  styleId?: string;
  styleLabel?: string;
  roomAnalysis?: RoomAnalysis | null;
  roomGeometry?: RoomGeometry | null;
  /** Claude door styling concept — finished door leaves, not bare openings. */
  doorDesign?: string | null;
  /** User drew structural boundary lines — add ControlNet guidance tail. */
  hasStructuralLines?: boolean;
  /** User marked objects to remove before redesign. */
  hasObjectRemovalMask?: boolean;
}

const GEOMETRY_LOCK =
  "Keep all room geometry, camera angle, perspective, windows, doors, columns, and structural openings exactly as in the photo.";

/** Exported for Kontext bookend prompts. */
export const FAL_GEOMETRY_LOCK = GEOMETRY_LOCK;

/** Require finished surfaces and full furnishing — appended to Full Project FAL prompts. */
export const FINISH_MANDATE =
  "Replace raw/unfinished concrete or bare surfaces with finished materials from the brief. Paint all walls. Fully furnish — magazine-quality Architectural Digest interior. Do not leave empty or construction-state rooms.";

/** Finish + furnish without moving structural elements — Kontext View 1 path. */
export const FINISH_MANDATE_GEOMETRY_SAFE =
  "Replace unfinished surfaces with brief materials and fully furnish. Do not move, add, or remove walls, corners, columns, windows, or doors.";

const CONTROLNET_STRUCTURAL_TAIL =
  "Follow the provided line map for floor-wall, wall-ceiling, and corner junctions. Change finishes and furniture only.";

export const FAL_CONTROLNET_STRUCTURAL_TAIL = CONTROLNET_STRUCTURAL_TAIL;

function appendFalPromptTails(
  base: string,
  input: Pick<FalRedesignPromptInput, "hasStructuralLines" | "hasObjectRemovalMask">,
): string {
  let out = base;
  if (input.hasStructuralLines) out += `\n\n${CONTROLNET_STRUCTURAL_TAIL}`;
  if (input.hasObjectRemovalMask) out += `\n\n${FAL_OBJECT_REMOVAL_TAIL}`;
  return out;
}

function appendFalStructuralBlocks(
  base: string,
  input: Pick<FalRedesignPromptInput, "roomAnalysis" | "roomGeometry" | "doorDesign">,
): string {
  const openingLock = buildFalOpeningLockCompact(input.roomAnalysis ?? null, input.roomGeometry ?? null);
  const blocks = [
    base,
    openingLock.trim() || null,
    buildDoorDesignPromptBlock(input.doorDesign),
    DOOR_CLEARANCE_DIRECTIVE,
  ].filter(Boolean);
  return blocks.join("\n\n");
}

/** Auto-build FAL redesign prompt from style + room analysis + optional materials. */
export function buildFalRedesignPrompt(input: FalRedesignPromptInput): string {
  if (input.designPrompt?.trim() && !input.styleId && !input.roomAnalysis) {
    const base = sanitizeDesignPromptForViewpoint(input.designPrompt.trim(), input.roomAnalysis);
    const withStructure = appendFalStructuralBlocks(base, input);
    return `${appendFalPromptTails(withStructure, input)}\n\n${GEOMETRY_LOCK}`;
  }

  const styleEntry = input.styleId
    ? DESIGN_STYLES.find((s) => s.id === input.styleId)
    : undefined;
  const styleLabel = input.styleLabel ?? styleEntry?.label ?? "modern";
  const styleKeywords = styleEntry?.keywords ?? "";
  const roomType = input.roomAnalysis?.room_type ?? "room";
  const currentStyle = input.roomAnalysis?.current_style?.trim();

  const parts: string[] = [
    `Redesign this ${roomType} in ${styleLabel} style.`,
  ];
  if (styleKeywords) parts.push(styleKeywords);
  if (currentStyle) parts.push(`Current room style: ${currentStyle}.`);

  if (input.roomAnalysis?.structural_elements.length) {
    parts.push(
      `Structural elements to preserve: ${input.roomAnalysis.structural_elements.join("; ")}.`,
    );
  }

  if (input.designPrompt?.trim()) {
    parts.push(input.designPrompt.trim());
  }

  const withStructure = appendFalStructuralBlocks(parts.join(" "), input);
  return `${appendFalPromptTails(withStructure, input)}\n\n${GEOMETRY_LOCK}`;
}

/** Replace floor-plan door/window lines when photo-verified counts differ. */
export function sanitizeDesignPromptForViewpoint(
  designPrompt: string,
  lockAnalysis: RoomAnalysis | null | undefined,
): string {
  if (!lockAnalysis) return designPrompt;

  let out = designPrompt;
  if ((lockAnalysis.door_count ?? 0) === 0) {
    out = out.replace(
      /^- Existing Wall Openings — Doors:.*$/m,
      "- Existing Wall Openings — Doors: none on this viewpoint",
    );
  }
  if ((lockAnalysis.window_count ?? 0) === 0) {
    out = out.replace(
      /^- Existing Wall Openings — Windows:.*$/m,
      "- Existing Wall Openings — Windows: none on this viewpoint",
    );
  }
  return out;
}
