/**
 * Quick Room shape ↔ creativity slider (0 = keep room shape, 10 = creativity).
 * Always runs nano-banana for products/inspiration; varies shell LoRA + PRESERVE strength.
 * Level 5 is the tuned default sweet spot; lower = tighter lock, higher = freer design.
 */

export const DEFAULT_SHAPE_CREATIVITY = 5;

export type PreserveMode = "veryStrong" | "strong" | "soft";
export type CreativeMode = "none" | "creative" | "moreCreative";

export interface ShapeCreativityConfig {
  level: number;
  runShell: boolean;
  /** Set when runShell is true (apartment-staging). */
  loraScale?: number;
  preserveMode: PreserveMode;
  creativeMode: CreativeMode;
}

const TABLE: ReadonlyArray<Omit<ShapeCreativityConfig, "level">> = [
  { runShell: true, loraScale: 1.5, preserveMode: "veryStrong", creativeMode: "none" },
  { runShell: true, loraScale: 1.42, preserveMode: "veryStrong", creativeMode: "none" },
  { runShell: true, loraScale: 1.35, preserveMode: "veryStrong", creativeMode: "none" },
  { runShell: true, loraScale: 1.28, preserveMode: "veryStrong", creativeMode: "none" },
  { runShell: true, loraScale: 1.24, preserveMode: "veryStrong", creativeMode: "none" },
  { runShell: true, loraScale: 1.2, preserveMode: "veryStrong", creativeMode: "none" },
  { runShell: true, loraScale: 1.12, preserveMode: "veryStrong", creativeMode: "none" },
  { runShell: true, loraScale: 1.02, preserveMode: "strong", creativeMode: "none" },
  { runShell: true, loraScale: 0.85, preserveMode: "soft", creativeMode: "none" },
  { runShell: false, preserveMode: "strong", creativeMode: "creative" },
  { runShell: false, preserveMode: "strong", creativeMode: "moreCreative" },
];

export function clampShapeCreativity(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SHAPE_CREATIVITY;
  return Math.max(0, Math.min(10, Math.round(n)));
}

export function resolveShapeCreativity(level: number): ShapeCreativityConfig {
  const clamped = clampShapeCreativity(level);
  const row = TABLE[clamped]!;
  return { level: clamped, ...row };
}

/** Parse form / query value; missing → default 5. */
export function parseShapeCreativityParam(raw: FormDataEntryValue | string | null | undefined): number {
  if (raw == null || raw === "") return DEFAULT_SHAPE_CREATIVITY;
  return clampShapeCreativity(typeof raw === "string" ? raw.trim() : raw);
}
