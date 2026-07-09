import { traceCatalogPipeline } from "@/lib/catalogTrace";
import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import { normalizeCatalogSubtype } from "@/lib/normalizeCatalogSubtype";
import { getServerMarketplaceApiBaseUrl } from "@/lib/publicEnv";

export interface RequiredSlot {
  family: string;
  subtype?: string;
  quantity?: number;
  placement?: string;
}

export interface DesignConstraints {
  materials?: string[];
  colors?: string[];
  style_keywords?: string[];
  max_price?: number;
}

export interface ResolvedCatalogSlot {
  slot: string;
  family: string;
  subtype?: string | null;
  quantity: number;
  product_ids: number[];
  scores: number[];
  fallback_stage: number | null;
  top_score: number;
  qdrant_candidates?: number;
  rerank_drop_rate?: number;
}

export interface ResolveCatalogSlotsResult {
  ids: number[];
  mpKeys: string[];
  slots: ResolvedCatalogSlot[];
  metrics?: {
    slot_success_rate?: number;
    fallback_usage?: number;
    rerank_drop_rate?: number;
  };
}

export function deriveDefaultRequiredSlots(options?: {
  roomType?: string;
  textPrompt?: string;
}): RequiredSlot[] {
  const hay = `${options?.roomType ?? ""} ${options?.textPrompt ?? ""}`.toLowerCase();

  if (/bedroom|bed room|նննարան|спальн/.test(hay)) {
    return [
      { family: "flooring", quantity: 1 },
      { family: "window_treatments", subtype: "curtain", quantity: 1 },
      { family: "lighting", quantity: 1 },
      { family: "furniture", subtype: "bed", quantity: 1 },
    ];
  }

  if (/kitchen|kitchenette|խոհանոց|кухн/.test(hay)) {
    return [
      { family: "flooring", subtype: "tile", quantity: 1 },
      { family: "lighting", quantity: 1 },
      { family: "furniture", subtype: "table", quantity: 1 },
      { family: "furniture", subtype: "chair", quantity: 2 },
    ];
  }

  if (/bathroom|toilet|ванн|լոգար/.test(hay)) {
    return [
      { family: "flooring", subtype: "tile", quantity: 1 },
      { family: "lighting", quantity: 1 },
    ];
  }

  return [
    { family: "flooring", quantity: 1 },
    { family: "window_treatments", subtype: "curtain", quantity: 1 },
    { family: "lighting", subtype: "ceiling", quantity: 1 },
    { family: "furniture", subtype: "sofa", quantity: 1 },
    { family: "furniture", subtype: "coffee_table", quantity: 1 },
  ];
}

const BEDROOM_SUBTYPES = new Set([
  "bed",
  "wardrobe",
  "mattress",
  "crib",
  "bunk_bed",
  "bedroom_set",
  "duvet",
  "bedding",
  "pillow",
  "bed_linens",
  "comforter",
  "mattress_topper",
  "bed_sheet",
  "blanket",
]);

const APPLIANCE_SUBTYPES = new Set([
  "washing_machine",
  "dishwasher",
  "dryer",
  "oven",
  "hob",
  "hood",
  "freezer",
  "microwave",
  "cooker",
  "refrigerator",
]);

const KITCHEN_APPLIANCE_DENY = new Set(["washing_machine", "dryer"]);

const BATHROOM_APPLIANCE_DENY = new Set([
  "refrigerator",
  "oven",
  "hob",
  "hood",
  "freezer",
  "microwave",
  "cooker",
]);

function mergeSubtypeSets(...sets: Array<Set<string>>): Set<string> {
  return new Set(sets.flatMap((set) => [...set]));
}

const LIVING_DENY = mergeSubtypeSets(BEDROOM_SUBTYPES, APPLIANCE_SUBTYPES);

const ROOM_SUBTYPE_DENYLIST: Record<string, Set<string>> = {
  living_room: LIVING_DENY,
  living: LIVING_DENY,
  dining_room: LIVING_DENY,
  home_office: LIVING_DENY,
  hallway: LIVING_DENY,
  outdoor_patio: LIVING_DENY,
  bedroom: mergeSubtypeSets(
    new Set(["dining_table", "bar_stool", "bar_table", "kitchen_table", "kitchen_cabinet"]),
    APPLIANCE_SUBTYPES,
  ),
  kitchen: mergeSubtypeSets(
    new Set(["bed", "wardrobe", "mattress", "sofa", "coffee_table", "tv_stand", "crib", "bedroom_set", "duvet", "bedding"]),
    KITCHEN_APPLIANCE_DENY,
  ),
  bathroom: mergeSubtypeSets(
    new Set(["bed", "sofa", "wardrobe", "dining_table", "coffee_table", "tv_stand", "crib", "bedroom_set", "duvet", "bedding"]),
    BATHROOM_APPLIANCE_DENY,
  ),
};

export function filterSlotsForRoomType(
  slots: RequiredSlot[],
  roomType: string | undefined | null,
): RequiredSlot[] {
  if (!roomType) return slots;
  const key = roomType.toLowerCase().replace(/[\s-]+/g, "_");
  const deny = ROOM_SUBTYPE_DENYLIST[key];
  if (!deny) return slots;

  return slots.filter((s) => {
    if (!s.subtype) return true;
    const sub = s.subtype.toLowerCase();
    if (deny.has(sub)) {
      console.info(`filterSlotsForRoomType: dropped slot subtype="${sub}" for roomType="${roomType}"`);
      return false;
    }
    return true;
  });
}

/**
 * Backend vector recall + rerank + fallback per slot.
 */
export async function resolveCatalogSlots(opts: {
  designIntent: string;
  slots: RequiredSlot[];
  pinnedProductIds: number[];
  allowlistIds?: number[];
  roomAnalysis?: RoomAnalysis | null;
  constraints?: DesignConstraints;
  roomType?: string;
}): Promise<ResolveCatalogSlotsResult> {
  const base = getServerMarketplaceApiBaseUrl();
  const room = opts.roomAnalysis?.estimated_dimensions;

  let designIntent = opts.designIntent.trim();
  if (designIntent.length < 8) {
    designIntent = `${designIntent} interior design`.trim();
  }

  const slots = (
    opts.slots.length > 0 ? opts.slots : deriveDefaultRequiredSlots({ textPrompt: designIntent })
  ).map((s) => ({
    ...s,
    subtype: normalizeCatalogSubtype(s.family, s.subtype),
  }));

  const body: Record<string, unknown> = {
    design_intent: designIntent,
    slots: slots.map((s) => ({
      family: s.family,
      subtype: s.subtype,
      quantity: s.quantity ?? 1,
      placement: s.placement,
    })),
    pinnedIds: opts.pinnedProductIds,
    constraints: opts.constraints ?? {},
  };

  if (opts.allowlistIds?.length) {
    body.allowlistIds = opts.allowlistIds;
  }
  if (opts.roomType) {
    body.room_type = opts.roomType;
  }
  if (room) {
    body.room_dimensions = {
      width_m: room.width,
      depth_m: room.depth,
      height_m: room.height,
    };
  }

  const empty: ResolveCatalogSlotsResult = { ids: [], mpKeys: [], slots: [] };

  try {
    const res = await fetch(`${base}/products/resolve-slots`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("resolve-slots failed:", res.status, await res.text().catch(() => ""));
      return empty;
    }
    const json = (await res.json()) as {
      data?: {
        ids?: number[];
        mpKeys?: string[];
        slots?: ResolvedCatalogSlot[];
        metrics?: ResolveCatalogSlotsResult["metrics"];
      };
    };
    return {
      ids: Array.isArray(json.data?.ids) ? json.data!.ids! : [],
      mpKeys: Array.isArray(json.data?.mpKeys) ? json.data!.mpKeys! : [],
      slots: Array.isArray(json.data?.slots) ? json.data!.slots! : [],
      metrics: json.data?.metrics,
    };
  } catch (e) {
    console.warn("resolve-slots error:", e);
    return empty;
  }
}

export function buildDesignIntentFromBrief(parts: {
  userRequest: string;
  style: string;
  subject: string;
  arrangement: string;
  context?: string;
  styleKeywords?: string;
}): string {
  return [
    parts.userRequest.trim(),
    parts.style.trim(),
    parts.styleKeywords?.trim(),
    parts.subject.trim(),
    parts.arrangement.trim(),
    parts.context?.trim(),
  ]
    .filter(Boolean)
    .join(". ");
}

/** Truncate at a word boundary and strip trailing punctuation/hyphens for FULLTEXT safety. */
export function buildSlotIntentSearchQuery(
  parts: Array<string | null | undefined>,
  maxLen = 120,
): string {
  const joined = parts
    .filter((p): p is string => Boolean(p && String(p).trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!joined) return "";
  if (joined.length <= maxLen) {
    return joined.replace(/[-]+$/g, "").trim();
  }

  const slice = joined.slice(0, maxLen);
  const boundary = slice.lastIndexOf(" ");
  const truncated =
    boundary > 0 ? slice.slice(0, boundary) : slice.replace(/-[^-\s]*$/, "").trim();

  return truncated.replace(/[-]+$/g, "").trim();
}

/** IDs from vector slots that passed rerank, plus user pins. Skips failed slots (no FULLTEXT guessing). */
export function vectorConfirmedCatalogIds(opts: {
  slots: ResolvedCatalogSlot[];
  pinnedProductIds: number[];
  apiIds?: number[];
}): number[] {
  const seen = new Set<number>();
  const out: number[] = [];

  const push = (id: number) => {
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  for (const id of opts.pinnedProductIds) {
    push(id);
  }

  let fromSlots = 0;
  for (const slot of opts.slots) {
    if (!slot.product_ids?.length || (slot.top_score ?? 0) <= 0) continue;
    for (const id of slot.product_ids) {
      push(id);
      fromSlots++;
    }
  }

  if (fromSlots === 0 && opts.apiIds?.length) {
    for (const id of opts.apiIds) {
      push(id);
    }
  }

  traceCatalogPipeline("2b_vector_confirmed_internal", {
    pinnedCount: opts.pinnedProductIds.length,
    fromSlots,
    outCount: out.length,
    numericIds: out,
    skippedSlots: opts.slots
      .filter((s) => !s.product_ids?.length || (s.top_score ?? 0) <= 0)
      .map((s) => ({ slot: s.slot, top_score: s.top_score, product_ids: s.product_ids })),
  });

  return out;
}

/**
 * @deprecated Do not FULLTEXT-fill failed slots — unverified matches pollute Gemini refs and vision.
 */
export async function supplementResolvedCatalogIds(opts: {
  resolvedNumericIds: number[];
  slots: ResolvedCatalogSlot[];
  designBoardProductIds: number[];
  designIntent: string;
  pinnedProductIds: number[];
}): Promise<number[]> {
  return vectorConfirmedCatalogIds({
    slots: opts.slots,
    pinnedProductIds: opts.pinnedProductIds,
    apiIds: opts.resolvedNumericIds,
  });
}

/**
 * Slot family → set of product_family values that are compatible.
 * A product whose product_family is NOT in this set (and is non-null) will be rejected.
 * This catches cases where Qdrant returns a product from the wrong category
 * (e.g. a bed returned for a lighting/pendant slot because "LIGHT" appeared in the name).
 */
const SLOT_FAMILY_COMPAT: Record<string, Set<string>> = {
  furniture: new Set(["furniture", "decor"]),
  lighting: new Set(["lighting"]),
  flooring: new Set(["flooring"]),
  window_treatments: new Set(["window_treatments", "textiles", "fabric"]),
  walls: new Set(["walls", "decor"]),
  decor: new Set(["decor", "furniture", "walls"]),
};

import type { CatalogItemSummary } from "@/lib/consumerCatalog";

/**
 * Remove IDs whose catalog product_family conflicts with the slot they came from.
 *
 * A row is rejected when:
 *   - its product_family is set AND incompatible with the slot family, OR
 *   - its product_family is null AND the slot has a specific family (the row's
 *     family is unknown, and the slot demands a specific one).
 *
 * Pinned ids (no slot mapping) are never rejected here.
 */
export function rejectFamilyMismatchIds(opts: {
  resolvedIds: number[];
  slots: ResolvedCatalogSlot[];
  catalogById: Map<string, CatalogItemSummary>;
}): number[] {
  const idToSlotFamily = new Map<number, string>();
  for (const slot of opts.slots) {
    for (const id of slot.product_ids ?? []) {
      if (!idToSlotFamily.has(id)) idToSlotFamily.set(id, slot.family);
    }
  }

  const rejected: Array<{ id: number; slotFamily: string; productFamily: string | null }> = [];

  const filtered = opts.resolvedIds.filter((id) => {
    const slotFamily = idToSlotFamily.get(id);
    if (!slotFamily) return true;
    const compat = SLOT_FAMILY_COMPAT[slotFamily];
    if (!compat) return true;
    const row = opts.catalogById.get(`mp-${id}`);
    const productFamily = row?.product_family?.toLowerCase() ?? null;
    if (!productFamily) {
      // Slot has a specific family expectation; an unknown-family row may well
      // be a mismatch (e.g. a lamp returned for a furniture slot). Drop it so
      // Gemini doesn't get a wrong-family visual reference.
      rejected.push({ id, slotFamily, productFamily: null });
      return false;
    }
    if (compat.has(productFamily)) return true;
    rejected.push({ id, slotFamily, productFamily });
    return false;
  });

  if (rejected.length > 0) {
    traceCatalogPipeline("family_mismatch_rejected", { rejected });
  }

  return filtered;
}

export function constraintsFromRoomAndStyle(
  roomAnalysis: RoomAnalysis | null | undefined,
  styleKeywords: string,
): DesignConstraints {
  const colors = roomAnalysis?.color_palette?.slice(0, 5) ?? [];
  const style_keywords = styleKeywords
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

  return {
    colors: colors.length ? colors : undefined,
    style_keywords: style_keywords.length ? style_keywords : undefined,
  };
}
