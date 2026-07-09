import { pipelineLog } from "@/lib/pipelineLog";
import { getStylePresetOrDefault } from "@/lib/project/stylePresets";
import { buildFalRoomIntentText } from "@/lib/project/roomIntentText";
import type {
  BudgetTier,
  DetectedRoom,
  RoomDesignBrief,
  RoomRenderPlan,
  RoomType,
  UserPreferences,
} from "@/lib/project/types";
import type { VisibleOpeningExpectation } from "@/lib/project/viewpointFraming";

export const FAL_DESIGN_OVERLAY_MAX = 1100;
export const FAL_DESIGN_OVERLAY_MAX_COMPLEX = 1400;

export function resolveOverlayCap(detectedRoom?: DetectedRoom): number {
  return (detectedRoom?.polygon?.length ?? 0) > 4
    ? FAL_DESIGN_OVERLAY_MAX_COMPLEX
    : FAL_DESIGN_OVERLAY_MAX;
}

/** Major furniture — pinned during overlay trim and retry eligibility. */
export const MAJOR_FURNITURE_RE =
  /\b(bunk|bed|sofa|sectional|wardrobe|dresser|desk|table|chair|cabinet|vanity|crib)\b/i;

/** Surface-only items — excluded from furnish-retry gate count. */
export const SURFACE_ONLY_RE =
  /\b(rug|carpet|curtains?|drapes|blinds?|wallpaper|window\s+ledge|molding|trim)\b/i;

const DOOR_LIKE = /\b(door|doorway|archway|passage|opening)\b/i;
const WINDOW_LIKE = /\b(window|glazing|skylight)\b/i;

const FURNISH_HEADER = "Furnish this empty room completely — photoreal Architectural Digest interior.";
const KONTEXT_EDIT_HEADER =
  "Redesign this room in place — change materials, lighting, and furniture only.";
const FURNISH_MANDATE =
  "Every listed furniture piece MUST appear visibly in frame; do not leave an empty room.";

const COMPACT_REALISM =
  "Furniture rests flat at realistic scale with clear walkways. Photoreal interior photography, natural daylight balanced with warm architectural lighting.";

export interface FalDesignOverlayInput {
  brief: RoomDesignBrief;
  plan?: RoomRenderPlan;
  preferences: UserPreferences;
  detectedRoom?: DetectedRoom;
  visibleOpenings?: VisibleOpeningExpectation;
  conceptProse?: string;
  /** Kontext img-edit: in-place header instead of "empty room" furnish header. */
  kontextMode?: boolean;
}

export interface FalDesignOverlayResult {
  overlay: string;
  furnitureCount: number;
  preview: string;
  overlayTrimmedSections?: string[];
  overlayCapExceeded?: boolean;
}

export type Phase2Trigger = "candidate" | "manual_review" | "none";

export function isSurfaceOnlyFurnitureItem(item: string): boolean {
  const t = item.trim();
  if (!t) return true;
  if (MAJOR_FURNITURE_RE.test(t)) return false;
  return SURFACE_ONLY_RE.test(t);
}

export function countRetryEligibleFurnitureItems(items: string[]): number {
  return items.filter((i) => !isSurfaceOnlyFurnitureItem(i)).length;
}

export function filterOpeningLikeFurnitureItems(
  items: string[],
  visibleOpenings?: VisibleOpeningExpectation,
): string[] {
  if (!visibleOpenings) return items;
  return items.filter((item) => {
    if (visibleOpenings.doorCount === 0 && DOOR_LIKE.test(item)) return false;
    if (visibleOpenings.windowCount === 0 && WINDOW_LIKE.test(item)) return false;
    return true;
  });
}

export function formatBudgetTierLine(tier: BudgetTier): string {
  switch (tier) {
    case "economy":
      return "Budget: economy — practical materials, clean simple finishes.";
    case "premium":
      return "Budget: premium — richer finishes, quality upholstery, refined detailing.";
    case "luxury":
      return "Budget: luxury — high-end materials, bespoke detailing, luxurious finishes.";
    default:
      return "Budget: mid-range — quality materials and well-crafted finishes.";
  }
}

export function extractDesignProseFromConcept(concept: string | undefined): string {
  if (!concept?.trim()) return "";
  let out = concept;
  out = out.replace(/### CRITICAL STRUCTURAL[\s\S]*?(?=### DESIGN OVERLAY|$)/i, "");
  out = out.replace(/### DESIGN OVERLAY\s*/i, "");
  out = out.replace(/^#{1,3}\s+/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out.length > 20 ? out : "";
}

export function selectRoomTypeDefaults(
  roomType: RoomType,
  dimensions?: { width: number; depth: number; height: number },
): { items: string[]; scaleNote?: string } {
  const width = dimensions?.width ?? 0;
  const depth = dimensions?.depth ?? 0;
  const minSpan = width && depth ? Math.min(width, depth) : 0;
  const area = width && depth ? width * depth : 0;
  const isNarrow = minSpan > 0 && (minSpan < 3.0 || Math.max(width, depth) / minSpan > 2.2);
  const isSmall = area > 0 && area < 12;

  const narrowNote =
    isNarrow || isSmall
      ? `Room is narrow (${width}m × ${depth}m) — scale furniture down; keep 70cm walkways clear.`
      : undefined;

  switch (roomType) {
    case "bedroom":
    case "children":
      return {
        items: isNarrow || isSmall
          ? [
              "Queen bed centered on long wall",
              "Two compact nightstands",
              "Slim wardrobe along long wall",
              "Medium area rug under bed",
              "Floor-to-ceiling curtains",
              "Wall art above bed",
            ]
          : [
              "Queen bed with upholstered headboard",
              "Two matching nightstands",
              "Wardrobe or dresser",
              "Large area rug",
              "Floor-to-ceiling curtains",
              "Wall art",
            ],
        scaleNote: narrowNote,
      };
    case "living":
    case "dining":
      return {
        items: isNarrow || isSmall
          ? ["Compact sofa", "Coffee table", "Media console", "Area rug", "Table lamp", "Curtains"]
          : ["Sectional or sofa", "Coffee table", "Media unit", "Area rug", "Floor lamp", "Curtains", "Wall art"],
        scaleNote: narrowNote,
      };
    case "office":
      return {
        items: isNarrow || isSmall
          ? ["Compact desk", "Ergonomic chair", "Wall shelving", "Desk lamp", "Small rug"]
          : ["Desk with storage", "Ergonomic chair", "Bookshelf", "Desk lamp", "Area rug"],
        scaleNote: narrowNote,
      };
    case "kitchen":
      return {
        items: ["Dining table with chairs", "Bar stools if island", "Pendant lighting", "Rug in dining zone"],
        scaleNote: narrowNote,
      };
    default:
      return {
        items: ["Primary seating", "Surface table", "Storage unit", "Area rug", "Lighting fixture", "Curtains or blinds"],
        scaleNote: narrowNote,
      };
  }
}

export function computePhase2Trigger(
  retryEligibleCount: number,
  furnitureVisibleInStage2Input: boolean | "unknown",
): Phase2Trigger {
  if (retryEligibleCount < 3) return "none";
  if (furnitureVisibleInStage2Input === false) return "candidate";
  if (furnitureVisibleInStage2Input === "unknown") return "manual_review";
  return "none";
}

function isFurnitureBlock(part: string): boolean {
  const firstLine = part.split("\n")[0]?.trim() ?? "";
  return /^FURNITURE \(\d+ pieces\)/.test(firstLine) || firstLine.startsWith("DEFAULT FURNITURE:");
}

export function buildFurnitureBlockPart(items: string[]): string | undefined {
  if (items.length === 0) return undefined;
  return `FURNITURE (${items.length} pieces):\n${items.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`;
}

function parseFurnitureItemsFromBlock(block: string): string[] {
  const lines = block.split("\n").slice(1);
  return lines
    .map((line) => line.replace(/^\s+\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function countFurnitureInOverlay(overlay: string, fallback: number): number {
  const furnitureBlock = overlay
    .split("\n\n")
    .find((p) => isFurnitureBlock(p));
  if (!furnitureBlock) return fallback;
  return parseFurnitureItemsFromBlock(furnitureBlock).length || fallback;
}

function rebuildFurnitureBlock(block: string, items: string[]): string {
  const header = block.split("\n")[0] ?? "FURNITURE:";
  if (header.startsWith("DEFAULT FURNITURE:")) {
    return `DEFAULT FURNITURE:\n${items.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`;
  }
  const countMatch = header.match(/FURNITURE \((\d+) pieces\)/);
  const count = countMatch ? items.length : items.length;
  return `FURNITURE (${count} pieces):\n${items.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`;
}

/** Pin major items first, then fill to minKeep from original order. */
export function trimFurnitureListLastResort(items: string[], minKeep = 3): string[] {
  const pinned: string[] = [];
  const rest: string[] = [];
  for (const item of items) {
    if (MAJOR_FURNITURE_RE.test(item) && !pinned.includes(item)) pinned.push(item);
    else rest.push(item);
  }
  const out = [...pinned];
  for (const item of rest) {
    if (out.length >= minKeep) break;
    if (!out.includes(item)) out.push(item);
  }
  return out.slice(0, Math.max(minKeep, pinned.length));
}

function softTrimConceptTail(prose: string, maxLen: number): string {
  if (prose.length <= maxLen) return prose;
  let trimmed = prose.slice(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.7) trimmed = trimmed.slice(0, lastSpace);
  return trimmed.trimEnd() + "…";
}

function trimOverlayToCap(
  parts: string[],
  cap: number,
  opts: {
    conceptProse?: string;
    furnitureBlock?: string;
    trimmedSections: string[];
    minFurnitureItems?: number;
  },
): string {
  const protectedParts = new Set<string>(
    [FURNISH_HEADER, FURNISH_MANDATE, opts.furnitureBlock, opts.conceptProse].filter(
      Boolean,
    ) as string[],
  );
  let kept = [...parts];
  const trimmed = opts.trimmedSections;

  const joinedLength = () => kept.join("\n\n").length;
  const dropIfOver = (predicate: (p: string) => boolean, label: string) => {
    if (joinedLength() <= cap) return;
    const before = kept.length;
    kept = kept.filter((p) => protectedParts.has(p) || !predicate(p));
    if (kept.length < before) trimmed.push(label);
  };

  dropIfOver((p) => p === COMPACT_REALISM, "COMPACT_REALISM");
  if (joinedLength() <= cap) return kept.join("\n\n");

  dropIfOver((p) => p.startsWith("Budget:"), "Budget");
  if (joinedLength() <= cap) return kept.join("\n\n");

  dropIfOver((p) => p.startsWith("STYLE:"), "STYLE");
  if (joinedLength() <= cap) return kept.join("\n\n");

  dropIfOver((p) => /scale furniture down|narrow/i.test(p), "scaleNote");
  if (joinedLength() <= cap) return kept.join("\n\n");

  // Soft-trim concept tail (preserve head — geometry lock lives there).
  if (opts.conceptProse) {
    const proseIdx = kept.indexOf(opts.conceptProse);
    if (proseIdx >= 0 && joinedLength() > cap) {
      const othersLen = kept
        .filter((_, i) => i !== proseIdx)
        .join("\n\n").length;
      const budgetForProse = cap - othersLen - 2;
      if (budgetForProse > 0 && opts.conceptProse.length > budgetForProse) {
        kept[proseIdx] = softTrimConceptTail(opts.conceptProse, budgetForProse);
        trimmed.push("conceptProseTail");
      } else if (budgetForProse <= 0) {
        kept = kept.filter((_, i) => i !== proseIdx);
        trimmed.push("conceptProseDropped");
      }
    }
  }
  if (joinedLength() <= cap) return kept.join("\n\n");

  // Last resort: trim furniture list lines — never below minFurnitureItems.
  const minKeep = Math.max(1, opts.minFurnitureItems ?? 1);
  const furnitureIdx = kept.findIndex((p) => isFurnitureBlock(p));
  if (furnitureIdx >= 0 && joinedLength() > cap) {
    const items = parseFurnitureItemsFromBlock(kept[furnitureIdx]!);
    let reduced = items;
    while (reduced.length > minKeep && joinedLength() > cap) {
      const next = trimFurnitureListLastResort(reduced, Math.max(minKeep, reduced.length - 1));
      if (next.length >= reduced.length) break;
      reduced = next;
      kept[furnitureIdx] = rebuildFurnitureBlock(kept[furnitureIdx]!, reduced);
    }
    trimmed.push("furnitureListLines");
  }
  if (joinedLength() <= cap) return kept.join("\n\n");

  if (joinedLength() > cap) {
    pipelineLog(
      "ASSEMBLE_PROMPT",
      "overlay cap exceeded after trim — furniture block may be incomplete",
      { cap, length: joinedLength(), trimmedSections: trimmed, minFurnitureItems: minKeep },
      "error",
    );
  }

  return kept.join("\n\n");
}

export function buildFalDesignOverlayPrompt(input: FalDesignOverlayInput): FalDesignOverlayResult {
  const { brief, plan, preferences, detectedRoom, visibleOpenings, conceptProse, kontextMode } = input;
  const style = getStylePresetOrDefault(preferences.style);
  const parts: string[] = [];

  parts.push(kontextMode ? KONTEXT_EDIT_HEADER : FURNISH_HEADER);

  parts.push(
    `STYLE: ${style.label}. ${style.keywords}. Textiles: ${style.textileNotes}. Lighting: ${style.lightingStyle}. Materials: ${style.defaultMaterials.woodType}, ${style.defaultMaterials.metalFinish}, ${style.defaultMaterials.textilePrimary}.`,
  );

  const filteredBriefList = filterOpeningLikeFurnitureItems(brief.furnitureList, visibleOpenings);
  const filteredPlanList = filterOpeningLikeFurnitureItems(plan?.furnitureList ?? [], visibleOpenings);
  const mergedBrief: RoomDesignBrief = {
    ...brief,
    furnitureList: filteredBriefList.length ? filteredBriefList : filteredPlanList,
  };

  const intent = buildFalRoomIntentText(mergedBrief, detectedRoom, plan);
  if (intent.trim()) parts.push(intent);

  let sourceFurnitureItems: string[] = mergedBrief.furnitureList.length
    ? mergedBrief.furnitureList
    : [];

  if (sourceFurnitureItems.length === 0) {
    const defaults = selectRoomTypeDefaults(brief.roomType, detectedRoom?.dimensions);
    sourceFurnitureItems = filterOpeningLikeFurnitureItems(defaults.items, visibleOpenings);
    if (sourceFurnitureItems.length) {
      parts.push(
        `DEFAULT FURNITURE:\n${sourceFurnitureItems.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`,
      );
    }
    if (defaults.scaleNote) parts.push(defaults.scaleNote);
  } else {
    const furnitureBlock = buildFurnitureBlockPart(sourceFurnitureItems);
    if (furnitureBlock) parts.push(furnitureBlock);
  }

  parts.push(formatBudgetTierLine(preferences.budgetTier));

  const prose = conceptProse?.trim();
  if (prose) parts.push(prose);

  parts.push(COMPACT_REALISM);
  parts.push(FURNISH_MANDATE);

  const furnitureBlock = parts.find((p) => isFurnitureBlock(p));
  const trimmedSections: string[] = [];
  const overlayCap = resolveOverlayCap(detectedRoom);
  const minFurnitureItems = countRetryEligibleFurnitureItems(sourceFurnitureItems);

  let overlay = parts.join("\n\n");
  let overlayCapExceeded = false;

  if (overlay.length > overlayCap) {
    overlay = trimOverlayToCap(parts, overlayCap, {
      conceptProse: prose,
      furnitureBlock,
      trimmedSections,
      minFurnitureItems: Math.max(1, minFurnitureItems),
    });
    overlayCapExceeded = overlay.length >= overlayCap && trimmedSections.length > 0;
    if (furnitureBlock && !overlay.includes("FURNITURE (") && !overlay.includes("DEFAULT FURNITURE:")) {
      pipelineLog(
        "ASSEMBLE_PROMPT",
        "overlay trim dropped entire furniture block",
        { trimmedSections, overlayCapExceeded: true },
        "error",
      );
      overlayCapExceeded = true;
    }
  }

  const furnitureCount = countFurnitureInOverlay(overlay, sourceFurnitureItems.length);

  return {
    overlay,
    furnitureCount,
    preview: overlay.slice(0, 200),
    overlayTrimmedSections: trimmedSections.length ? trimmedSections : undefined,
    overlayCapExceeded: overlayCapExceeded || undefined,
  };
}
