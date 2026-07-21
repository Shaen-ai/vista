/**
 * Armenia + Local shop: every product-like item in generations must map to
 * `scraped_products` (Laravel marketplace API). Shared by quick design + project flows.
 */

import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { MasterDesignConcept, UserPreferences } from "@/lib/project/types";
import { getServerMarketplaceApiBaseUrl } from "@/lib/publicEnv";
import {
  hasLocalProductCatalog,
  normalizeCountryCode,
  normalizeSearchMode,
} from "@/lib/catalogCountryCapabilities";

export { normalizeCountryCode, normalizeSearchMode };

/** Max scraped rows for full-project flows. */
export const SCRAPED_ALLOWLIST_CAP = 88;

/** Smaller cap for quick design — keeps Claude/Gemini payloads under Cloudflare ~100s budget. */
export const QUICK_DESIGN_ALLOWLIST_CAP = 40;

/** Extra marketplace search queries derived from user text for allowlist expansion. */
const MAX_EXPANSION_QUERIES = 8;
const MAX_QUICK_EXPANSION_QUERIES = 4;
const SEARCH_PER_QUERY = 14;
const SEARCH_CONCURRENCY = 6;

/** Breadth-first queries merged into expansion so Armenia+Local can build an allowlist without room analysis. */
const ALLOWLIST_FALLBACK_QUERY_SEED = [
  "furniture",
  "sofa",
  "chair",
  "table",
  "cabinet",
  "lighting",
  "laminate flooring",
  "parquet",
  "wallpaper",
  "porcelain tile",
  "curtain",
];

const FLOORING_ALLOWLIST_BUDGET = 8;
const FLOORING_ALLOWLIST_QUERIES = ["laminate flooring", "parquet", "porcelain tile", "vinyl flooring"];

const FINISH_KEYWORD_QUERIES: Array<{ pattern: RegExp; queries: string[] }> = [
  { pattern: /\blaminate\b/i, queries: ["laminate flooring", "laminate"] },
  { pattern: /\bparquet\b/i, queries: ["parquet", "engineered wood flooring"] },
  { pattern: /\bwallpaper\b/i, queries: ["wallpaper", "wall panels"] },
  { pattern: /\b(tile|tiling|porcelain)\b/i, queries: ["porcelain tile", "floor tile"] },
  { pattern: /\b(curtain|drape|blind)\b/i, queries: ["curtain", "drapes"] },
  { pattern: /\b(chandelier|pendant|sconce|luminaire)\b/i, queries: ["chandelier", "pendant light"] },
  { pattern: /\b(rug|carpet)\b/i, queries: ["area rug", "carpet"] },
  { pattern: /\b(floor|flooring|hardwood)\b/i, queries: ["engineered wood flooring", "laminate"] },
];

export function marketplaceSearchRowsFromJson(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  if (Array.isArray(o.data)) {
    return o.data.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  }
  return [];
}

/**
 * Local scraped catalog mode: generations must use scraped_products from our DB only.
 */
export function isArmeniaLocalScrapedExclusive(countryCode: string, searchMode: string): boolean {
  return hasLocalProductCatalog(countryCode, searchMode);
}

/** Stable API error code when Local mode has no marketplace rows to allowlist. */
export const LOCAL_SCRAPED_CATALOG_EMPTY_CODE = "LOCAL_CATALOG_EMPTY";

export function assertLocalScrapedCatalogReady(
  countryCode: string,
  searchMode: string,
  allowlistProductIds: number[],
): void {
  if (!isArmeniaLocalScrapedExclusive(countryCode, searchMode)) return;
  const count = allowlistProductIds.filter((n) => Number.isFinite(n) && n > 0).length;
  if (count === 0) {
    throw new Error(LOCAL_SCRAPED_CATALOG_EMPTY_CODE);
  }
}

function dedupePositiveIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of ids) {
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function tokenizeForSearch(corpus: string): string[] {
  const tokens = corpus
    .toLowerCase()
    .split(/[^a-z0-9\u0400-\u04FF%+]+/)
    .filter((w) => w.length >= 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Build short marketplace search queries from prompt + optional room analysis.
 */
export function expansionQueriesFromPrompt(
  textPrompt: string,
  roomAnalysis?: RoomAnalysis | null,
): string[] {
  const parts: string[] = [textPrompt];
  if (roomAnalysis?.room_type) parts.push(roomAnalysis.room_type);
  if (roomAnalysis?.suggestions?.length) parts.push(roomAnalysis.suggestions.join(" "));
  if (roomAnalysis?.current_style) parts.push(roomAnalysis.current_style);
  const corpus = parts.join(" ");
  const words = tokenizeForSearch(corpus);
  const queries: string[] = [];

  const room = (roomAnalysis?.room_type || "").toLowerCase();
  if (room.includes("kitchen")) {
    queries.push("kitchen furniture", "refrigerator", "dining table", "kitchen tile");
  }
  if (room.includes("bathroom") || room.includes("toilet")) {
    queries.push("bathroom tile", "sanitary", "porcelain tile");
  }
  if (room.includes("bedroom")) queries.push("bed", "wardrobe", "mattress", "laminate flooring");
  if (room.includes("living")) queries.push("sofa", "coffee table", "tv stand", "curtain");
  if (room.includes("office")) queries.push("office chair", "desk");

  const corpusLower = corpus.toLowerCase();
  for (const { pattern, queries: finishQs } of FINISH_KEYWORD_QUERIES) {
    if (!pattern.test(corpusLower)) continue;
    for (const q of finishQs) {
      if (queries.length >= MAX_EXPANSION_QUERIES) break;
      queries.push(q);
    }
  }

  // 3+ chars — short English words like "rug", "bed" still help match inventory.
  for (const w of words) {
    if (queries.length >= MAX_EXPANSION_QUERIES) break;
    if (w.length >= 3) queries.push(w);
  }

  const seen = new Set<string>();
  const normalized = [...queries, ...ALLOWLIST_FALLBACK_QUERY_SEED]
    .map((q) => q.trim())
    .filter((q) => q.length >= 2)
    .filter((q) => {
      const k = q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return normalized.slice(0, MAX_EXPANSION_QUERIES);
}

/**
 * One marketplace search; returns numeric product ids from first page.
 *
 * Uses `in_stock=1` so allowlist discovery only includes in-stock catalog rows.
 */
export async function searchMarketplaceProductIds(
  query: string,
  perPage: number = SEARCH_PER_QUERY,
): Promise<number[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const stockParam = "in_stock=1";
    const url = `${getServerMarketplaceApiBaseUrl()}/products/search?q=${encodeURIComponent(q)}&${stockParam}&per_page=${Math.min(50, Math.max(1, perPage))}`;
    const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const rows = marketplaceSearchRowsFromJson(json);
    const ids: number[] = [];
    for (const row of rows) {
      const id = Number(row.id);
      if (Number.isFinite(id) && id > 0) ids.push(id);
    }
    console.info("catalog.allowlist_search", { query: q, resultCount: ids.length });
    return ids;
  } catch {
    return [];
  }
}

/** Run marketplace searches in parallel batches (avoids 8–20 sequential round-trips). */
export async function searchMarketplaceProductIdsParallel(
  queries: string[],
  perPage: number = SEARCH_PER_QUERY,
): Promise<number[]> {
  const uniqueQueries = [...new Set(queries.map((q) => q.trim()).filter((q) => q.length >= 2))];
  if (!uniqueQueries.length) return [];

  const merged: number[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < uniqueQueries.length; i += SEARCH_CONCURRENCY) {
    const batch = uniqueQueries.slice(i, i + SEARCH_CONCURRENCY);
    const batches = await Promise.all(batch.map((q) => searchMarketplaceProductIds(q, perPage)));
    for (const found of batches) {
      for (const id of found) {
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
      }
    }
  }

  return merged;
}

function mergeIdsIntoAllowlist(
  out: number[],
  seen: Set<number>,
  found: number[],
  maxTotal: number,
): void {
  for (const id of found) {
    if (out.length >= maxTotal) return;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
}

/**
 * Pinned design-board ids first, then unique ids from expansion searches, capped.
 */
export async function buildQuickDesignScrapedAllowlistIds(options: {
  pinnedProductIds: number[];
  textPrompt: string;
  roomAnalysis?: RoomAnalysis | null;
  maxTotal?: number;
  /** Pre-seeded ids from the client catalog UI — skips slow expansion when enough rows. */
  clientCatalogIds?: number[];
}): Promise<number[]> {
  const {
    pinnedProductIds,
    textPrompt,
    roomAnalysis,
    maxTotal = QUICK_DESIGN_ALLOWLIST_CAP,
    clientCatalogIds = [],
  } = options;

  const pinned = dedupePositiveIds(pinnedProductIds);
  const seeded = dedupePositiveIds(clientCatalogIds);
  const out: number[] = dedupePositiveIds([...pinned, ...seeded]);
  const seen = new Set(out);

  // Reserve flooring budget: ensures multiple flooring SKUs reach Qdrant regardless of
  // general expansion results. Shuffle so the same SKU isn't always first.
  const flooringFound = await searchMarketplaceProductIdsParallel(FLOORING_ALLOWLIST_QUERIES, SEARCH_PER_QUERY);
  const shuffled = flooringFound.slice().sort(() => Math.random() - 0.5);
  const flooringBefore = out.length;
  mergeIdsIntoAllowlist(out, seen, shuffled, out.length + FLOORING_ALLOWLIST_BUDGET);
  const flooringIdsMerged = out.length - flooringBefore;

  // Always run targeted expansion queries (fewer queries when client already seeded the pool).
  // This ensures the allowlist has design-relevant products even when the UI sidebar contains
  // only generic browse results.
  const alreadySeeded = out.length >= 8;
  const queryCount = alreadySeeded
    ? Math.min(2, pinned.length > 0 ? 2 : MAX_QUICK_EXPANSION_QUERIES)
    : (pinned.length > 0 ? 2 : MAX_QUICK_EXPANSION_QUERIES);
  const queries = expansionQueriesFromPrompt(textPrompt, roomAnalysis).slice(0, queryCount);
  if (queries.length > 0) {
    const found = await searchMarketplaceProductIdsParallel(queries, SEARCH_PER_QUERY);
    mergeIdsIntoAllowlist(out, seen, found, maxTotal);
  }

  if (out.length === 0) {
    const emergencySeeds = ["furniture", "sofa", "chair", "table"];
    const emergency = await searchMarketplaceProductIdsParallel(emergencySeeds, 40);
    mergeIdsIntoAllowlist(out, seen, emergency, maxTotal);
  }

  const result = out.slice(0, maxTotal);
  console.info("catalog.allowlist_build", {
    queries,
    pinnedCount: pinned.length,
    seededCount: seeded.length,
    flooringIdsMerged,
    totalIds: result.length,
  });

  return result;
}

export type ProjectRoomSearchSeed = {
  roomId: string;
  queries: string[];
};

/**
 * Derive search seeds from a room design brief (furniture, floor, wet-room tile, lighting).
 */
export function projectRoomQueriesFromBrief(
  furnitureList: string[],
  floorMaterial: string,
  lightingConcept: string,
  roomType: string,
  includeTile: boolean,
): string[] {
  const queries: string[] = [];
  const push = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t.length >= 2 && t.length <= 120) queries.push(t);
  };

  for (const line of furnitureList) {
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (trimmed.length >= 3) {
      const short = trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
      push(short);
    }
  }

  push(floorMaterial);
  if (includeTile) {
    push(`${floorMaterial} tile`);
    push("porcelain tile");
  }
  push(lightingConcept);

  const rt = roomType.toLowerCase();
  if (rt === "kitchen") {
    push("refrigerator");
    push("kitchen appliance");
  }
  if (rt === "bathroom" || rt === "toilet" || rt === "laundry") {
    push("bathroom furniture");
  }

  const seen = new Set<string>();
  return queries
    .map((q) => q.trim())
    .filter((q) => q.length >= 2)
    .filter((q) => {
      const k = q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 16);
}

/**
 * Build per-room allowlists for full project (AM + Local).
 */
export async function buildProjectRoomScrapedAllowlistIds(options: {
  seeds: ProjectRoomSearchSeed[];
  maxPerRoom?: number;
}): Promise<Map<string, number[]>> {
  const { seeds, maxPerRoom = 72 } = options;
  const map = new Map<string, number[]>();

  await Promise.all(
    seeds.map(async ({ roomId, queries }) => {
      const seen = new Set<number>();
      const ids: number[] = [];
      const found = await searchMarketplaceProductIdsParallel(
        queries.slice(0, MAX_EXPANSION_QUERIES),
        SEARCH_PER_QUERY,
      );
      mergeIdsIntoAllowlist(ids, seen, found, maxPerRoom);
      if (ids.length === 0) {
        const flooring = await searchMarketplaceProductIdsParallel(
          FLOORING_ALLOWLIST_QUERIES,
          SEARCH_PER_QUERY,
        );
        mergeIdsIntoAllowlist(ids, seen, flooring, maxPerRoom);
      }
      if (ids.length === 0) {
        const emergency = await searchMarketplaceProductIdsParallel(
          ALLOWLIST_FALLBACK_QUERY_SEED,
          SEARCH_PER_QUERY,
        );
        mergeIdsIntoAllowlist(ids, seen, emergency, maxPerRoom);
      }
      if (ids.length === 0) {
        console.warn("catalog.allowlist_room_empty", { roomId, queryCount: queries.length });
      }
      map.set(roomId, ids);
    }),
  );

  return map;
}

/**
 * Map each room id → scraped_product ids for strict DB-only generation.
 */
export async function buildProjectConceptAllowlists(
  concept: MasterDesignConcept,
  _prefs: Pick<UserPreferences, "countryCode" | "searchMode">,
): Promise<Map<string, number[]> | null> {
  const seeds = concept.rooms.map((r) => ({
    roomId: r.roomId,
    queries: projectRoomQueriesFromBrief(
      r.furnitureList,
      r.floorMaterial,
      r.lightingConcept,
      r.roomType,
      r.roomType === "bathroom" || r.roomType === "toilet" || r.roomType === "kitchen" || r.roomType === "laundry",
    ),
  }));
  return buildProjectRoomScrapedAllowlistIds({ seeds });
}
