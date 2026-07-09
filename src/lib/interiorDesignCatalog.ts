import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";

export type InteriorDesignCatalogCoverageMode = "percent" | "count";

export interface InteriorDesignCatalogCoverage {
  mode: InteriorDesignCatalogCoverageMode;
  value: number;
}

/** Default when API omits or legacy tenants. */
export const DEFAULT_INTERIOR_DESIGN_COVERAGE: InteriorDesignCatalogCoverage = {
  mode: "percent",
  value: 50,
};

const ROOM_DEFAULT_FURNITURE_PIECES: Record<string, number> = {
  "living room": 14,
  bedroom: 12,
  kitchen: 16,
  bathroom: 7,
  "dining room": 11,
  "home office": 11,
  "children's room": 11,
  hallway: 5,
  "outdoor patio": 9,
  "studio apartment": 14,
};

export function normalizeInteriorDesignCoverage(input: unknown): InteriorDesignCatalogCoverage {
  const o =
    typeof input === "object" &&
    input !== null &&
    "mode" in input &&
    "value" in input
      ? (input as { mode?: string; value?: unknown })
      : null;
  const mode: InteriorDesignCatalogCoverageMode =
    o?.mode === "count" ? "count" : "percent";
  const value = typeof o?.value === "number" && Number.isFinite(o.value) ? Math.floor(o.value) : DEFAULT_INTERIOR_DESIGN_COVERAGE.value;
  const clampedValue =
    mode === "percent" ? Math.min(100, Math.max(1, value)) : Math.min(120, Math.max(1, value));
  return { mode, value: clampedValue };
}

export function estimateInteriorFurniturePieceBudget(
  roomAnalysis?: RoomAnalysis | null,
): number {
  let base =
    ROOM_DEFAULT_FURNITURE_PIECES[(roomAnalysis?.room_type ?? "").toLowerCase().trim()];
  if (!Number.isFinite(base) || base < 6) base = 12;
  const existing = Math.max(
    roomAnalysis?.existing_furniture?.length ?? 0,
    8,
    Math.min(base, 20),
  );
  return Math.min(22, Math.max(8, Math.round((base + existing) / 2)));
}

/**
 * Fraction of placements that must use catalog-derived furniture (reuse of same SKU allowed).
 */
export function targetCatalogAnchoredPieces(
  coverage: InteriorDesignCatalogCoverage,
  estimatedPieces: number,
): number {
  const F = Math.max(4, estimatedPieces);
  if (coverage.mode === "count") {
    /** Count mode: placements must reuse only merchant-picked SKU set — anchor every slot. */
    return F;
  }
  return coverage.value >= 100 ? F : Math.max(3, Math.ceil((F * coverage.value) / 100));
}

/** Minimum distinct SKU ids listed in structured output — Claude may reuse them across placements. */
export function targetDistinctCatalogSkusForPrompt(
  coverage: InteriorDesignCatalogCoverage,
  estimatedPieces: number,
  eligibleCatalogSize: number,
): number {
  const pool = Math.max(1, eligibleCatalogSize);
  if (coverage.mode === "count") {
    return Math.min(pool, Math.max(1, coverage.value));
  }
  if (coverage.value >= 100) {
    /** Variety upper bound capped by plausible unique slots; repetitions encouraged when catalog is shallow. */
    return Math.min(pool, Math.min(estimatedPieces, pool));
  }
  return Math.min(
    pool,
    Math.max(1, Math.ceil((estimatedPieces * coverage.value) / 100)),
  );
}

export function buildCoverageInstructionParagraph(
  coverage: InteriorDesignCatalogCoverage,
  distinctRequired: number,
  anchoredPieces: number,
  estimatedPieces: number,
  eligibleCatalogSize: number,
): string {
  if (eligibleCatalogSize <= 0) {
    return "CATALOG POLICY (no merchant items available): Invent plausible generic furnishings only (no SKU mapping).";
  }
  const common = `\nEligible catalog SKU count visible to you: ${eligibleCatalogSize}.
Estimated visible furniture placements in scene: roughly ${estimatedPieces}.`;

  if (coverage.mode === "count") {
    return `
CATALOG COVERAGE (merchant setting — COUNT MODE):
Pick EXACTLY min(${distinctRequired}, |catalog|)=${distinctRequired} DISTINCT catalog SKU ids in "selected_catalog_ids" (merchant asked for ${coverage.value}; capped by catalog).
Every larger furniture placement in this room MUST visibly match ONE of those products (verbatim names in prose). Repeat the same SKU in multiple placements if space requires it.${common}
If merchant's catalog lists fewer SKU than requested, USE ALL AVAILABLE SKUs and repeat only those — NO other unrecognized furniture.` + (distinctRequired <= 2 ? " With only those SKUs allowed, omit generic filler furniture entirely." : "");
  }

  if (coverage.value >= 100) {
    return `
CATALOG COVERAGE (merchant setting — STRICT 100% from catalog):
ABSOLUTE RULE: EVERY piece of furniture (sofa, chair, table, bed, storage, console, desk, shelf, lighting fixture visible as furniture) in the room MUST be a product from the merchant catalog listed below. There are NO exceptions.
- Do NOT invent, imagine, or add ANY furniture that is not in the catalog list.
- If a furniture type is needed for the design but NO catalog product matches, OMIT that furniture entirely — leave that area empty with only the designed walls, floor, and ceiling visible.
- A beautifully designed room with fewer furniture pieces (all from catalog) is ALWAYS better than a fully furnished room with non-catalog items.
- Reuse the same SKU IDs across multiple placements freely (e.g., two of the same chair).
- selected_catalog_ids must list every SKU that appears at least once (usually ${distinctRequired}–${eligibleCatalogSize} ids depending on repeats).
- Verbatim product NAMES must appear in the fullPrompt.
- Focus extra design attention on wall finishes, floor treatments, ceiling design, curtains, rugs, plants, art, and small decor to make the room feel complete even with fewer furniture pieces.${common}`;
  }

  return `
CATALOG COVERAGE (merchant setting — PERCENT MODE ${coverage.value}%):
At least roughly ${anchoredPieces} of ${estimatedPieces} furniture-placement slots must visibly match Merchant catalog SKU(s).
selected_catalog_ids should include at MINIMUM ${distinctRequired} DISTINCT catalog SKU ids referenced in the prose (more is fine).
Remaining slots may use plausible generic furnishing language while staying stylistically cohesive.${common}`;
}
