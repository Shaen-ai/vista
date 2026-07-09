import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import type { RequiredSlot } from "@/lib/resolveCatalogSlots";

export type DesignPhase = "base" | "furniture" | "decor";

const PHASE_BASE_FAMILIES = new Set(["flooring", "lighting", "window_treatments", "walls"]);

const PHASE_FURNITURE_SUBTYPES = new Set([
  "sofa", "bed", "desk", "chair", "table",
  "coffee_table", "dining_table", "tv_stand",
  "wardrobe", "storage",
]);

const PHASE_FURNITURE_FLOORING_SUBTYPES = new Set(["rug", "carpet"]);

const PHASE_DECOR_SUBTYPES = new Set([
  "vase", "plant_stand", "decorative_plant",
  "blanket", "plaid", "throw", "pillow", "cushion",
]);

const DECOR_NAME_OVERRIDE_RE = /\b(plaid|blanket|throw|cushion|pillow)\b/i;
const CHRISTMAS_HAY_RE = /christmas|seasonal|holiday|xmas|new year|festive/i;
const TEXTILE_HAY_RE = /textile|blanket|plaid|throw|bedding|duvet|comforter|linen|bed sheet/i;
const DECOR_LIGHTING_HAY_RE = /\b(curtain light|christmas light|string light|fairy light|garland|led string)\b/i;
const MISFLOORING_TEXTILE_RE = /\b(blanket|plaid|throw|duvet|bedding|mattress|comforter|pillow)\b/i;

/** Styles where decor phase is optional by default (user may skip). */
export const DECOR_SKIPPABLE_STYLES = new Set(["minimalist", "japandi", "scandinavian"]);

export function isDecorPhaseSkippableForStyle(styleId: string): boolean {
  return DECOR_SKIPPABLE_STYLES.has(styleId.trim().toLowerCase());
}

export function slotDisplayLabel(slot: RequiredSlot): string {
  const family = slot.family.toLowerCase();
  const subtype = (slot.subtype ?? "").toLowerCase();

  if (family === "flooring") {
    if (subtype === "tile") return "flooring (tile)";
    if (subtype === "rug" || subtype === "carpet") return "area rug";
    return "flooring";
  }
  if (family === "window_treatments") {
    if (subtype === "curtain") return "curtains";
    return "window treatments";
  }
  if (family === "lighting") {
    if (subtype === "ceiling") return "ceiling lighting";
    return "lighting";
  }
  if (subtype) return subtype.replace(/_/g, " ");
  return family.replace(/_/g, " ");
}

export function classifyProductPhase(item: CatalogItemSummary): DesignPhase {
  const family = (item.product_family ?? "").toLowerCase();
  const subtype = (item.product_subtype ?? "").toLowerCase();
  const category = (item.category ?? "").toLowerCase();
  const name = (item.name ?? "").toLowerCase();
  const hay = `${category} ${name}`;

  if (DECOR_NAME_OVERRIDE_RE.test(item.name ?? "")) {
    return "decor";
  }

  if (CHRISTMAS_HAY_RE.test(hay)) {
    return "decor";
  }

  if (TEXTILE_HAY_RE.test(hay) && family !== "window_treatments") {
    return "decor";
  }

  if (DECOR_LIGHTING_HAY_RE.test(hay)) {
    return "decor";
  }

  if (family === "flooring" && MISFLOORING_TEXTILE_RE.test(hay)) {
    return "decor";
  }

  if (family === "flooring" && PHASE_FURNITURE_FLOORING_SUBTYPES.has(subtype)) {
    return "furniture";
  }

  if (PHASE_BASE_FAMILIES.has(family)) {
    return "base";
  }

  if (family === "furniture") {
    if (PHASE_DECOR_SUBTYPES.has(subtype)) return "decor";
    if (PHASE_FURNITURE_SUBTYPES.has(subtype)) return "furniture";
    return "furniture";
  }

  if (family === "home_accessories" || family === "decor") {
    return "decor";
  }

  if (/\b(lamp|light|chandelier|pendant|luminaire|lampshade)\b/.test(hay)) {
    if (DECOR_LIGHTING_HAY_RE.test(hay) || CHRISTMAS_HAY_RE.test(hay)) return "decor";
    return "base";
  }
  if (/\b(curtain|drape|blind|sheer)\b/.test(hay)) {
    if (DECOR_LIGHTING_HAY_RE.test(hay)) return "decor";
    return "base";
  }
  if (/\b(laminate|parquet|tile|vinyl|flooring)\b/.test(hay)) return "base";
  if (/\b(sofa|sectional|divan|bed|desk|chair|table|wardrobe|cabinet)\b/.test(hay)) return "furniture";
  if (/\b(rug|carpet)\b/.test(hay)) return "furniture";
  if (/\b(vase|planter|decor|candle|art|mirror|pillow|cushion|plaid|throw|blanket)\b/.test(hay)) return "decor";

  return "furniture";
}

export function classifyPinnedProductPhase(product: {
  name: string;
  category?: string | null;
  product_family?: string | null;
  product_subtype?: string | null;
}): DesignPhase {
  return classifyProductPhase({
    id: "mp-0",
    name: product.name,
    category: product.category ?? "",
    product_family: product.product_family,
    product_subtype: product.product_subtype,
    width_cm: 0,
    depth_cm: 0,
    height_cm: 0,
    price: 0,
    currency: "AMD",
  });
}

export function partitionByPhase(
  ids: string[],
  catalogById: Map<string, CatalogItemSummary>,
): Record<DesignPhase, string[]> {
  const result: Record<DesignPhase, string[]> = { base: [], furniture: [], decor: [] };
  for (const id of ids) {
    const item = catalogById.get(id);
    if (!item) continue;
    result[classifyProductPhase(item)].push(id);
  }
  return result;
}

export function filterSlotsForPhase(slots: RequiredSlot[], phase: DesignPhase): RequiredSlot[] {
  return slots.filter((slot) => {
    const family = slot.family.toLowerCase();
    const subtype = (slot.subtype ?? "").toLowerCase();

    switch (phase) {
      case "base":
        if (PHASE_BASE_FAMILIES.has(family)) {
          if (family === "flooring" && PHASE_FURNITURE_FLOORING_SUBTYPES.has(subtype)) {
            return false;
          }
          return true;
        }
        return false;

      case "furniture":
        if (family === "furniture") {
          if (PHASE_DECOR_SUBTYPES.has(subtype)) return false;
          return true;
        }
        if (family === "flooring" && PHASE_FURNITURE_FLOORING_SUBTYPES.has(subtype)) {
          return true;
        }
        return false;

      case "decor":
        if (family === "furniture" && PHASE_DECOR_SUBTYPES.has(subtype)) return true;
        if (family === "home_accessories" || family === "decor") return true;
        return false;
    }
  });
}

export const PHASE_PRODUCT_LIMITS: Record<DesignPhase, number> = {
  base: 4,
  furniture: 5,
  decor: 4,
};
