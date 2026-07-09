import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import { traceCatalogPipeline } from "@/lib/catalogTrace";
import { debugIngest } from "@/lib/debugIngest";
import { catalogCategorySortKey } from "@/lib/productDisplayOrder";
import type { RequiredSlot } from "@/lib/resolveCatalogSlots";

export function normalizeMpKey(raw: string): string | null {
  const s = String(raw).trim();
  const m = /^mp-(\d+)$/i.exec(s);
  if (m) return `mp-${m[1]}`;
  if (/^\d+$/.test(s)) return `mp-${s}`;
  return null;
}

function dedupeMpKeys(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const k = normalizeMpKey(raw);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** Material finishes applied room-wide — trust render plan, not vision. */
const AUTO_INCLUDE_RENDER_FAMILIES = new Set(["flooring", "walls"]);

function renderPlanMaterialFinishIds(
  selectedForGemini: string[],
  catalogById: Map<string, CatalogItemSummary>,
): string[] {
  return selectedForGemini.filter((k) => {
    const row = catalogById.get(k);
    return Boolean(row?.product_family && AUTO_INCLUDE_RENDER_FAMILIES.has(row.product_family));
  });
}
export function buildVisionCandidateMpKeys(opts: {
  briefSelectedIds: string[];
  pinnedMpKeys: string[];
  allowedCatalogKeys: Set<string>;
}): string[] {
  const merged = dedupeMpKeys([...opts.pinnedMpKeys, ...opts.briefSelectedIds]);
  return merged.filter((k) => opts.allowedCatalogKeys.has(k));
}

const DEFAULT_IDENTIFY_CANDIDATE_CAP = 16;

/**
 * Candidate pool for post-render vision — only SKUs in the render plan (sent to Gemini),
 * not the full marketplace allowlist (which causes false-positive matches).
 */
export function buildProductIdentifyCandidateMpKeys(opts: {
  selectedForGemini: string[];
  pinnedMpKeys: string[];
  collageIncludedIds?: string[];
  allowedCatalogKeys: Set<string>;
  maxCandidates?: number;
}): string[] {
  const cap = opts.maxCandidates ?? DEFAULT_IDENTIFY_CANDIDATE_CAP;
  return dedupeMpKeys([
    ...opts.pinnedMpKeys,
    ...opts.collageIncludedIds ?? [],
    ...opts.selectedForGemini,
  ])
    .filter((k) => opts.allowedCatalogKeys.has(k))
    .slice(0, cap);
}

/** Merge vision hits with pins (pins included when in allowed set). */
export function mergeVerifiedProductIds(
  visionIds: string[],
  pinnedMpKeys: string[],
  allowedCatalogKeys: Set<string>,
): string[] {
  return dedupeMpKeys([...visionIds, ...pinnedMpKeys]).filter((k) => allowedCatalogKeys.has(k));
}

/**
 * Build the catalog id list for "Products in this render" after vision.
 * When vision under-detects vs collage refs sent to Gemini, include collage SKUs
 * (we supplied reference images for those cells). Text-only manifest SKUs are added
 * when vision found some hits but still fewer than the full render plan.
 */
export function mergeVisionWithGeminiCatalogRefs(opts: {
  visionIds: string[];
  collageIncludedIds: string[];
  textOnlyCatalogIds?: string[];
  selectedForGemini: string[];
  pinnedMpKeys: string[];
  allowedCatalogKeys: Set<string>;
  catalogById: Map<string, CatalogItemSummary>;
}): string[] {
  const vision = dedupeMpKeys(opts.visionIds).filter((k) => opts.allowedCatalogKeys.has(k));
  const collage = dedupeMpKeys(opts.collageIncludedIds).filter((k) => opts.allowedCatalogKeys.has(k));
  const textOnly = dedupeMpKeys(opts.textOnlyCatalogIds ?? []).filter((k) =>
    opts.allowedCatalogKeys.has(k),
  );
  const pinned = dedupeMpKeys(opts.pinnedMpKeys).filter((k) => opts.allowedCatalogKeys.has(k));
  const selected = dedupeMpKeys(opts.selectedForGemini).filter((k) => opts.allowedCatalogKeys.has(k));

  const renderPlan = dedupeMpKeys([...selected, ...collage, ...textOnly]);
  const renderPlanSet = new Set(renderPlan);

  let mergeBranch = "vision_only";
  if (vision.length === 0) {
    mergeBranch = "vision_empty_pins_only";
    const out = dedupeMpKeys([...pinned]);
    debugIngest(
      "placementPlan.ts:mergeVisionWithGeminiCatalogRefs",
      "merge_branch",
      { mergeBranch, visionCount: 0, collageCount: collage.length, mergedCount: out.length, merged: out },
      "B",
    );
    return out;
  }

  let merged = vision.filter((k) => renderPlanSet.has(k));
  if (merged.length === 0) {
    mergeBranch = "vision_no_overlap_pins_only";
    merged = dedupeMpKeys([...pinned]);
  } else {
    mergeBranch = "vision_confirmed_only_plus_pins";
    merged = mergeVerifiedProductIds(merged, pinned, opts.allowedCatalogKeys);
  }

  const materialFinishes = renderPlanMaterialFinishIds(selected, opts.catalogById).filter(
    (k) => renderPlanSet.has(k) && opts.allowedCatalogKeys.has(k),
  );
  if (materialFinishes.length > 0) {
    merged = dedupeMpKeys([...merged, ...materialFinishes]);
    if (mergeBranch === "vision_confirmed_only_plus_pins") {
      mergeBranch = "vision_confirmed_plus_material_finishes";
    }
  }

  debugIngest(
    "placementPlan.ts:mergeVisionWithGeminiCatalogRefs",
    "merge_branch",
    {
      mergeBranch,
      visionCount: vision.length,
      collageCount: collage.length,
      textOnlyCount: textOnly.length,
      renderPlanCount: renderPlan.length,
      mergedCount: merged.length,
      addedBeyondVision: merged.filter((k) => !vision.includes(k)),
    },
    "B",
  );

  return merged;
}

/** SKUs sent to Gemini — authoritative list for "Products in this render" (no post-render vision). */
export function geminiPlanCatalogIds(opts: {
  selectedForGemini: string[];
  pinnedMpKeys: string[];
  allowedCatalogKeys: Set<string>;
}): string[] {
  return dedupeMpKeys([...opts.pinnedMpKeys, ...opts.selectedForGemini]).filter((k) =>
    opts.allowedCatalogKeys.has(k),
  );
}

/** SKUs sent to Gemini (collage + render plan) — authoritative for "Products in this render". */
export function buildRenderPlanProductIds(opts: {
  selectedForGemini: string[];
  pinnedMpKeys: string[];
  collageIncludedIds?: string[];
  allowedCatalogKeys: Set<string>;
  catalogById: Map<string, CatalogItemSummary>;
  fullPrompt: string;
  slots?: RequiredSlot[];
}): string[] {
  const collage = (opts.collageIncludedIds ?? []).filter((k) => opts.allowedCatalogKeys.has(k));
  const planKeys =
    collage.length > 0
      ? [...new Set([...opts.pinnedMpKeys, ...collage, ...opts.selectedForGemini])]
      : [...new Set([...opts.pinnedMpKeys, ...opts.selectedForGemini])];

  const filtered = planKeys.filter((k) => opts.allowedCatalogKeys.has(k));
  return dedupeSingletonCatalogIds(
    filtered,
    opts.catalogById,
    opts.fullPrompt,
    opts.slots,
    new Set(opts.pinnedMpKeys),
  );
}

/** Subtypes whose absence in the vision result we patch from selectedForGemini.
 *  Furniture categories the user expects to see a purchase URL for. Decor (vase,
 *  pillow, art, mirror, plant) is omitted — vision is good at those, and a
 *  fallback there would clutter the list. */
const SUBTYPES_FOR_FALLBACK = new Set([
  "sofa",
  "coffee_table",
  "dining_table",
  "side_table",
  "bed",
  "desk",
  "tv_stand",
  "wardrobe",
  "chair",
  "armchair",
  "table",
]);

/**
 * Post-vision safety net: for each furniture subtype that was sent to Gemini
 * but is completely absent from the vision result, add the highest-`briefMatchScore`
 * candidate so the user still sees a product name + URL for that category.
 *
 * Vision wins when it matched at least one SKU in that subtype; the fallback
 * only fires for categories vision missed entirely.
 */
export function augmentMissingSubtypes(opts: {
  merged: string[];
  selectedForGemini: string[];
  catalogById: Map<string, CatalogItemSummary>;
  fullPrompt: string;
  tracePhase?: string;
}): string[] {
  const mergedSet = new Set(opts.merged);
  const subtypesAlreadyCovered = new Set<string>();
  for (const id of opts.merged) {
    const row = opts.catalogById.get(id);
    if (row) subtypesAlreadyCovered.add(inferSubtype(row));
  }

  const candidatesBySubtype = new Map<string, string[]>();
  for (const id of opts.selectedForGemini) {
    if (mergedSet.has(id)) continue;
    const row = opts.catalogById.get(id);
    if (!row) continue;
    const subtype = inferSubtype(row);
    if (!SUBTYPES_FOR_FALLBACK.has(subtype)) continue;
    if (subtypesAlreadyCovered.has(subtype)) continue;
    const group = candidatesBySubtype.get(subtype) ?? [];
    group.push(id);
    candidatesBySubtype.set(subtype, group);
  }

  if (candidatesBySubtype.size === 0) return opts.merged;

  const added: Array<{ subtype: string; addedSkuId: string }> = [];
  const out = [...opts.merged];
  for (const [subtype, ids] of candidatesBySubtype) {
    const best = [...ids].sort((a, b) => {
      const nameA = opts.catalogById.get(a)?.name ?? "";
      const nameB = opts.catalogById.get(b)?.name ?? "";
      return briefMatchScore(nameB, opts.fullPrompt) - briefMatchScore(nameA, opts.fullPrompt);
    })[0];
    if (best && !mergedSet.has(best)) {
      out.push(best);
      mergedSet.add(best);
      added.push({ subtype, addedSkuId: best });
    }
  }

  if (added.length > 0) {
    traceCatalogPipeline("subtype_fallback", {
      phase: opts.tracePhase ?? "unknown",
      added,
      inCount: opts.merged.length,
      outCount: out.length,
    });
  }

  return out;
}

/** Vision + collage/text refs → deduped singleton list for purchase links. */
export function finalizeRenderProductCatalogIds(opts: {
  visionIds: string[];
  collageIncludedIds?: string[];
  textOnlyCatalogIds?: string[];
  selectedForGemini: string[];
  pinnedMpKeys: string[];
  allowedCatalogKeys: Set<string>;
  catalogById: Map<string, CatalogItemSummary>;
  fullPrompt: string;
  slots?: RequiredSlot[];
  tracePhase?: string;
}): string[] {
  const merged = mergeVisionWithGeminiCatalogRefs({
    visionIds: opts.visionIds,
    collageIncludedIds: opts.collageIncludedIds ?? [],
    textOnlyCatalogIds: opts.textOnlyCatalogIds,
    selectedForGemini: opts.selectedForGemini,
    pinnedMpKeys: opts.pinnedMpKeys,
    allowedCatalogKeys: opts.allowedCatalogKeys,
    catalogById: opts.catalogById,
  });

  const pinSet = new Set(opts.pinnedMpKeys);
  const selectedAllowed = opts.selectedForGemini.filter((k) => opts.allowedCatalogKeys.has(k));

  const baseMerged = merged.length > 0
    ? merged
    : dedupeMpKeys(opts.pinnedMpKeys).filter((k) => opts.allowedCatalogKeys.has(k));

  const seed = baseMerged.length > 0 ? baseMerged : selectedAllowed;
  if (seed.length === 0) return [];

  const augmented = augmentMissingSubtypes({
    merged: seed,
    selectedForGemini: selectedAllowed,
    catalogById: opts.catalogById,
    fullPrompt: opts.fullPrompt,
    tracePhase: opts.tracePhase,
  });
  return dedupeSingletonCatalogIds(augmented, opts.catalogById, opts.fullPrompt, opts.slots, pinSet);
}

/** Subtypes where at most one SKU should appear in a render unless brief/slots request more. */
export const SINGLETON_SUBTYPES = new Set([
  "sofa",
  "coffee_table",
  "dining_table",
  "bed",
  "desk",
  "tv_stand",
  "wardrobe",
  "curtain",
  "blind",
  "sheer",
  "rug",
  "carpet",
  "laminate",
  "tile",
  "wallpaper",
  "ceiling",
  "pendant",
  "table",
]);

/** Subtypes that may appear multiple times (decor, seating sets, etc.). */
export const MULTI_ALLOWED_SUBTYPES = new Set([
  "vase",
  "decor",
  "pillow",
  "plant",
  "art",
  "mirror",
  "chair",
  "armchair",
  "side_table",
  "bar_stool",
  "lamp",
  "floor",
  "wall",
]);

const VARIANT_STRIP_RE =
  /\b(laf|raf|corner|left|right|modular|sectional|ext|extension|cm|mm|\d+x\d+)\b/gi;

const SUBTYPE_FROM_NAME: Array<{ re: RegExp; subtype: string }> = [
  { re: /\b(sofa|sectional|divan|диван|բազմոց)\b/i, subtype: "sofa" },
  { re: /\b(coffee table|coffee_table)\b/i, subtype: "coffee_table" },
  { re: /\b(dining table|dining_table)\b/i, subtype: "dining_table" },
  { re: /\b(side table|end table|console table)\b/i, subtype: "side_table" },
  { re: /\b(tv stand|tv_stand|media unit)\b/i, subtype: "tv_stand" },
  { re: /\b(curtain|drape|panel)\b/i, subtype: "curtain" },
  { re: /\b(vase|planter pot)\b/i, subtype: "vase" },
  { re: /\b(rug|carpet)\b/i, subtype: "rug" },
  { re: /\b(bed\b|mattress)\b/i, subtype: "bed" },
  { re: /\b(desk\b)\b/i, subtype: "desk" },
  { re: /\b(wardrobe|closet)\b/i, subtype: "wardrobe" },
  { re: /\b(armchair|recliner)\b/i, subtype: "armchair" },
  { re: /\b(chair|stool)\b/i, subtype: "chair" },
];

export function inferSubtype(row: CatalogItemSummary): string {
  if (row.product_subtype) return row.product_subtype.toLowerCase();
  const hay = `${row.category} ${row.name}`;
  for (const { re, subtype } of SUBTYPE_FROM_NAME) {
    if (re.test(hay)) return subtype;
  }
  return "other";
}

function normalizeProductLineKey(name: string, subtype: string): string {
  const base = name
    .toLowerCase()
    .replace(VARIANT_STRIP_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${subtype}:${base.slice(0, 80)}`;
}

export function briefMatchScore(name: string, fullPrompt: string): number {
  const hay = fullPrompt.toLowerCase();
  let score = 0;
  for (const token of name.toLowerCase().split(/\s+/).filter((w) => w.length >= 4)) {
    if (hay.includes(token)) score += token.length;
  }
  return score;
}

function maxAllowedForSubtype(
  subtype: string,
  fullPrompt: string,
  slots?: RequiredSlot[],
): number {
  if (MULTI_ALLOWED_SUBTYPES.has(subtype)) {
    if (subtype === "chair") {
      const slotQty = slots
        ?.filter((s) => s.subtype === "chair" || s.family === "furniture")
        .reduce((max, s) => Math.max(max, s.quantity ?? 1), 1);
      return Math.max(1, slotQty ?? 1);
    }
    return 8;
  }

  if (!SINGLETON_SUBTYPES.has(subtype)) return 8;

  const multiHints: Record<string, RegExp> = {
    sofa: /\b(two|2|pair|dual|երկու|два)\b.*\b(sofas?|divan|sectional|диван)\b/i,
    coffee_table: /\b(two|2|pair)\b.*\b(coffee tables?|side tables?)\b/i,
    dining_table: /\b(two|2|pair)\b.*\b(dining tables?)\b/i,
    bed: /\b(two|2|pair|twin|bunk)\b.*\b(beds?)\b/i,
    curtain: /\b(two|2|pair)\b.*\b(curtains?|drapes?)\b/i,
  };
  if (multiHints[subtype]?.test(fullPrompt)) return 2;

  const slotQty = slots
    ?.filter((s) => s.subtype === subtype)
    .reduce((sum, s) => sum + (s.quantity ?? 1), 0);
  if (slotQty && slotQty > 1) return slotQty;

  return 1;
}

function pickBestIds(
  groupKeys: string[],
  catalogById: Map<string, CatalogItemSummary>,
  fullPrompt: string,
  limit: number,
): Set<string> {
  const ranked = [...groupKeys].sort((a, b) => {
    const nameA = catalogById.get(a)?.name ?? "";
    const nameB = catalogById.get(b)?.name ?? "";
    return briefMatchScore(nameB, fullPrompt) - briefMatchScore(nameA, fullPrompt);
  });
  return new Set(ranked.slice(0, limit));
}

/**
 * Collapse duplicate singleton furniture/finish SKUs (e.g. two HOBEL sofa variants → one).
 * Keeps multiples for decor types (vase, pillow) unless brief implies otherwise.
 *
 * Pinned ids are always kept and do not count against subtype limits — the user
 * explicitly chose them, so they survive even when their name doesn't appear in
 * `fullPrompt` (e.g. vector-catalog mode where Claude never saw the catalog).
 */
export function dedupeSingletonCatalogIds(
  ids: string[],
  catalogById: Map<string, CatalogItemSummary>,
  fullPrompt: string,
  slots?: RequiredSlot[],
  pinnedSet?: Set<string>,
): string[] {
  const bySubtype = new Map<string, string[]>();
  const byLineKey = new Map<string, string[]>();
  const passthrough: string[] = [];
  const pins = pinnedSet ?? new Set<string>();

  for (const id of ids) {
    const row = catalogById.get(id);
    if (!row) {
      passthrough.push(id);
      continue;
    }
    const subtype = inferSubtype(row);
    if (!SINGLETON_SUBTYPES.has(subtype) && !MULTI_ALLOWED_SUBTYPES.has(subtype)) {
      passthrough.push(id);
      continue;
    }

    const lineKey = normalizeProductLineKey(row.name, subtype);
    const lineGroup = byLineKey.get(lineKey) ?? [];
    lineGroup.push(id);
    byLineKey.set(lineKey, lineGroup);

    const subGroup = bySubtype.get(subtype) ?? [];
    subGroup.push(id);
    bySubtype.set(subtype, subGroup);
  }

  const keep = new Set<string>(passthrough);
  for (const id of ids) {
    if (pins.has(id)) keep.add(id);
  }

  for (const [subtype, allKeys] of bySubtype) {
    const groupKeys = allKeys.filter((k) => !pins.has(k));
    if (groupKeys.length === 0) continue;
    const limit = maxAllowedForSubtype(subtype, fullPrompt, slots);
    if (limit >= groupKeys.length) {
      for (const k of groupKeys) keep.add(k);
      continue;
    }

    const lineGroups = new Map<string, string[]>();
    for (const key of groupKeys) {
      const row = catalogById.get(key)!;
      const lineKey = normalizeProductLineKey(row.name, subtype);
      const lg = lineGroups.get(lineKey) ?? [];
      lg.push(key);
      lineGroups.set(lineKey, lg);
    }

    const lineRepresentatives: string[] = [];
    for (const [, lineKeys] of lineGroups) {
      const best = pickBestIds(lineKeys, catalogById, fullPrompt, 1);
      lineRepresentatives.push(...best);
    }

    const winners = pickBestIds(lineRepresentatives, catalogById, fullPrompt, limit);
    for (const k of winners) keep.add(k);
  }

  const result = ids.filter((id) => keep.has(id));
  traceCatalogPipeline("dedupe_singleton", {
    inCount: ids.length,
    outCount: result.length,
    pinKept: ids.filter((id) => pins.has(id)),
    dropped: ids.filter((id) => !keep.has(id)),
    passthrough,
    groups: [...bySubtype.entries()].map(([subtype, keys]) => ({
      subtype,
      count: keys.length,
      ids: keys,
      pinned: keys.filter((k) => pins.has(k)),
      limit: maxAllowedForSubtype(subtype, fullPrompt, slots),
    })),
  });

  return result;
}

/** Finishes/lighting before furniture for Gemini text + image fetch order. */
export function orderIdsForGemini(opts: {
  pinnedMpKeys: string[];
  briefSelectedIds: string[];
  catalogById: Map<string, CatalogItemSummary>;
}): string[] {
  const merged = dedupeMpKeys([...opts.pinnedMpKeys, ...opts.briefSelectedIds]);
  return [...merged].sort((a, b) => {
    const rowA = opts.catalogById.get(a);
    const rowB = opts.catalogById.get(b);
    const bandA = catalogCategorySortKey(rowA?.category ?? "", rowA?.name ?? "");
    const bandB = catalogCategorySortKey(rowB?.category ?? "", rowB?.name ?? "");
    if (bandA !== bandB) return bandA - bandB;
    const pinA = opts.pinnedMpKeys.includes(a) ? 0 : 1;
    const pinB = opts.pinnedMpKeys.includes(b) ? 0 : 1;
    if (pinA !== pinB) return pinA - pinB;
    return (rowA?.name ?? "").localeCompare(rowB?.name ?? "", undefined, { sensitivity: "base" });
  });
}
