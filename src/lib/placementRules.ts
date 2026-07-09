import type { OpeningBox } from "@/lib/interiorDesignPrompts";

export type PlacementViolationType =
  | "blocked_door"
  | "object_overlap"
  | "wall_clip"
  | "floating_object";

export type PlacementFurnitureCategory =
  | "wardrobe"
  | "bed"
  | "sofa"
  | "table"
  | "desk"
  | "chair"
  | "mirror"
  | "rug"
  | "lighting"
  | "decor"
  | "other";

export interface PlacementFurnitureBox {
  label: string;
  box: OpeningBox;
  floorContact: boolean;
  category: PlacementFurnitureCategory;
}

export interface PlacementViolation {
  type: PlacementViolationType;
  label: string;
  detail: string;
  otherLabel?: string;
}

export interface PlacementRuleResult {
  pass: boolean;
  violations: PlacementViolation[];
  correctiveFeedback: string;
}

const FLOOR_STANDING = new Set<PlacementFurnitureCategory>([
  "wardrobe",
  "bed",
  "sofa",
  "table",
  "desk",
  "chair",
  "mirror",
]);

const SOLID_FOR_OVERLAP = new Set<PlacementFurnitureCategory>([
  "wardrobe",
  "bed",
  "sofa",
  "table",
  "desk",
  "chair",
  "mirror",
]);

/** Normalized intersection-over-union for two boxes (top-left origin). */
export function boxIoU(a: OpeningBox, b: OpeningBox): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Horizontal overlap fraction relative to the door width. */
export function doorOverlapFraction(furniture: OpeningBox, door: OpeningBox): number {
  const fx2 = furniture.x + furniture.w;
  const dx2 = door.x + door.w;
  const overlapW = Math.max(0, Math.min(fx2, dx2) - Math.max(furniture.x, door.x));
  return door.w > 0 ? overlapW / door.w : 0;
}

export function evaluatePlacementRules(opts: {
  items: PlacementFurnitureBox[];
  doorBoxes?: OpeningBox[];
  windowBoxes?: OpeningBox[];
  doorOverlapThreshold?: number;
  objectOverlapThreshold?: number;
  windowOverlapThreshold?: number;
}): PlacementRuleResult {
  const doorThreshold = opts.doorOverlapThreshold ?? 0.25;
  const overlapThreshold = opts.objectOverlapThreshold ?? 0.25;
  const windowThreshold = opts.windowOverlapThreshold ?? 0.35;
  const doors = opts.doorBoxes ?? [];
  const windows = opts.windowBoxes ?? [];
  const violations: PlacementViolation[] = [];

  for (const item of opts.items) {
    if (!SOLID_FOR_OVERLAP.has(item.category)) continue;
    for (const door of doors) {
      const frac = doorOverlapFraction(item.box, door);
      if (frac >= doorThreshold) {
        violations.push({
          type: "blocked_door",
          label: item.label,
          detail: `${item.label} overlaps the door opening (${Math.round(frac * 100)}% of door width).`,
        });
      }
    }
    for (const window of windows) {
      const iou = boxIoU(item.box, window);
      if (iou >= windowThreshold) {
        violations.push({
          type: "wall_clip",
          label: item.label,
          detail: `${item.label} overlaps a window opening — move it away from the window.`,
        });
      }
    }
  }

  const solidItems = opts.items.filter((i) => SOLID_FOR_OVERLAP.has(i.category));
  for (let i = 0; i < solidItems.length; i++) {
    for (let j = i + 1; j < solidItems.length; j++) {
      const a = solidItems[i]!;
      const b = solidItems[j]!;
      const iou = boxIoU(a.box, b.box);
      if (iou >= overlapThreshold) {
        violations.push({
          type: "object_overlap",
          label: a.label,
          otherLabel: b.label,
          detail: `${a.label} and ${b.label} physically overlap — separate them with clear circulation space.`,
        });
      }
    }
  }

  for (const item of opts.items) {
    if (!FLOOR_STANDING.has(item.category)) continue;
    if (!item.floorContact) {
      violations.push({
        type: "floating_object",
        label: item.label,
        detail: `${item.label} is not resting on the floor — ground it with proper contact and shadow.`,
      });
    }
  }

  const correctiveFeedback = buildCorrectiveFeedback(violations);
  return {
    pass: violations.length === 0,
    violations,
    correctiveFeedback,
  };
}

function buildCorrectiveFeedback(violations: PlacementViolation[]): string {
  if (violations.length === 0) return "";
  const lines = violations.map((v) => {
    switch (v.type) {
      case "blocked_door":
        return `Move ${v.label} away from the door — keep the doorway fully clear for opening.`;
      case "object_overlap":
        return v.otherLabel
          ? `Separate ${v.label} and ${v.otherLabel}; they must not intersect.`
          : `Fix overlap involving ${v.label}.`;
      case "wall_clip":
        return `Move ${v.label} away from the window/wall opening.`;
      case "floating_object":
        return `Ground ${v.label} on the floor with realistic contact — no floating or leaning without support.`;
      default:
        return v.detail;
    }
  });
  return `PLACEMENT FIX: ${lines.join(" ")}`;
}

export function countViolations(result: PlacementRuleResult): number {
  return result.violations.length;
}

export function mergePlacementIntoValidation(
  existing: { pass: boolean; reason: string; failureTypes: string[]; correctiveFeedback?: string },
  placement: PlacementRuleResult,
): { pass: boolean; reason: string; failureTypes: string[]; correctiveFeedback?: string } {
  if (placement.pass) return existing;
  const failureTypes = [...existing.failureTypes];
  for (const v of placement.violations) {
    if (!failureTypes.includes(v.type)) failureTypes.push(v.type);
  }
  const reason = existing.pass
    ? placement.violations.map((v) => v.detail).join(" ")
    : `${existing.reason} ${placement.violations.map((v) => v.detail).join(" ")}`.trim();
  const correctiveFeedback = [existing.correctiveFeedback, placement.correctiveFeedback]
    .filter(Boolean)
    .join(" ");
  return {
    pass: false,
    reason,
    failureTypes,
    correctiveFeedback: correctiveFeedback || undefined,
  };
}
