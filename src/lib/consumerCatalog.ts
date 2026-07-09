import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import {
  normalizeInteriorDesignCoverage,
  type InteriorDesignCatalogCoverage,
  estimateInteriorFurniturePieceBudget,
} from "@/lib/interiorDesignCatalog";
import { getServerMarketplaceApiBaseUrl } from "@/lib/publicEnv";
import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";

export interface CatalogItemSummary {
  id: string;
  name: string;
  category: string;
  product_family?: string | null;
  product_subtype?: string | null;
  descriptionSnippet?: string;
  width_cm: number;
  depth_cm: number;
  height_cm: number;
  price: number;
  currency: string;
  primaryImageUrl?: string | null;
  /** Cutout or clean (no-background) image preferred for AI collage references. */
  cleanImageUrl?: string | null;
  /** Up to 4 gallery image URLs for multi-view sofa collages. */
  galleryUrls?: string[];
  externalUrl?: string | null;
}

const GEMINI_MERCHANT_LINES_MAX_CHARS = 1800;
export const MAX_REFERENCE_PRODUCT_FETCH = 20;
const MAX_VISION_REFERENCE_PRODUCT_FETCH = 16;
export const SOFA_GALLERY_MAX = 4;

export function isCatalogSofa(row: CatalogItemSummary): boolean {
  if (row.product_subtype?.toLowerCase() === "sofa") return true;
  const hay = `${row.category} ${row.name}`.toLowerCase();
  return /\b(sofa|sectional|divan)\b/.test(hay);
}

const MULTI_VIEW_SUBTYPES = new Set([
  "sofa", "sectional", "wardrobe", "closet", "cabinet", "dresser", "storage",
  "bed", "chair", "table", "desk", "coffee_table", "dining_table", "tv_stand", "bench",
]);
const MULTI_VIEW_HAY_RE = /\b(sofa|sectional|divan|wardrobe|closet|cabinet|dresser|chest of drawers|cupboard|bed|chair|armchair|stool|table|desk|dining table|coffee table|tv stand|bench|nightstand)\b/;

/**
 * Major furniture (beds, sofas, tables, chairs, wardrobes, storage…) whose exact
 * shape/proportions/structure matter — these get multiple reference views sent to Gemini
 * so it reproduces the precise Qdrant-chosen product rather than inventing a look-alike.
 */
export function isMultiViewFurniture(row: CatalogItemSummary): boolean {
  const subtype = row.product_subtype?.toLowerCase() ?? "";
  if (MULTI_VIEW_SUBTYPES.has(subtype)) return true;
  const hay = `${row.category} ${row.name}`.toLowerCase();
  return MULTI_VIEW_HAY_RE.test(hay);
}

/**
 * Flooring material (laminate/parquet/tile/vinyl) — excludes rugs/carpets, which are
 * handled in the furniture phase. Used to send a multi-photo collage for texture fidelity.
 */
export function isFlooringMaterial(row: CatalogItemSummary): boolean {
  const family = row.product_family?.toLowerCase() ?? "";
  const subtype = row.product_subtype?.toLowerCase() ?? "";
  if (subtype === "rug" || subtype === "carpet") return false;
  if (family === "flooring") return true;
  const hay = `${row.category} ${row.name}`.toLowerCase();
  if (/\b(rug|carpet)\b/.test(hay)) return false;
  return /\b(laminate|parquet|tile|vinyl|flooring|floorboard|hardwood)\b/.test(hay);
}

export function resolveGalleryUrls(item: Record<string, unknown>): string[] {
  const images = Array.isArray(item.images) ? item.images : [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== "string" || !raw.trim() || !/^https?:\/\//i.test(raw)) return;
    const u = raw.trim();
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const img of images) push(img);
  if (out.length === 0) {
    push(item.main_image_url);
    push(item.cutout_image_url);
  }
  return out.slice(0, SOFA_GALLERY_MAX);
}

function truncateOneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function dedupePreserveOrder(ids: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const k = String(id).trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export function catalogSummaryToPromptText(items: CatalogItemSummary[]): string {
  if (!items.length) return "";
  return items
    .map((i) => {
      let line = `- [${i.id}] "${i.name}" (${i.category}) ${i.width_cm}×${i.depth_cm}×${i.height_cm} cm, ${i.price} ${i.currency}`;
      if (i.descriptionSnippet) line += ` — ${truncateOneLine(i.descriptionSnippet, 220)}`;
      return line;
    })
    .join("\n");
}

export function buildGeminiMerchantFurnitureCatalogBlock(
  selectedIds: string[],
  byId: Map<string, CatalogItemSummary>,
  coverage?: InteriorDesignCatalogCoverage | null,
  options?: {
    armeniaLocalExclusive?: boolean;
    /** Catalog id → collage cell ref (e.g. "Sheet2-B3"). Anchors text SKUs to their visual reference. */
    cellRefByCatalogId?: Map<string, string>;
  },
): string {
  const ids = dedupePreserveOrder(selectedIds).slice(0, 48);
  if (!ids.length) return "";

  const cellRefs = options?.cellRefByCatalogId;
  const applianceClause = " This includes appliances (refrigerator, AC units), parquet/tile SKU panels, sanitary ware, luminaires, and every major freestanding piece — NOTHING may appear visibly unless listed.";

  const visualNote = cellRefs && cellRefs.size > 0
    ? `\nEach SKU line below points to its reference image in the product collage (→ Sheet#-Cell). Match the collage image exactly for shape, color, and finish.\n`
    : "";

  const header = `\nMERCHANT CATALOG — STRICT MODE (100% inventory):\nEVERY visible product-shaped object MUST be one of these catalog SKUs.${applianceClause} Do NOT add ANY furniture, appliance, decorative lighting fixture, or large decor object not listed. If needed but missing, LEAVE EMPTY. The room contains ONLY finishes (walls/floor generic treatment as prompted), textiles, rugs, curtains, wall art without brand, small tabletop props, PLUS listed SKUs ONLY.${visualNote}`;

  let body = header;
  let total = body.length;

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const cellRef = cellRefs?.get(id);
    const cellTag = cellRef ? ` → collage ${cellRef}` : " → text-only (no visual reference)";
    const line = `- "${row.name}" [${row.id}] (${row.category}, ~${row.width_cm}×${row.depth_cm}×${row.height_cm} cm)${cellTag}${row.descriptionSnippet ? ` — ${row.descriptionSnippet}` : ""}`;
    const nextLen = total + line.length + 1;
    if (nextLen > GEMINI_MERCHANT_LINES_MAX_CHARS + 600) break;
    body += `${line}\n`;
    total = nextLen;
  }

  body += `\nREPEAT: No furniture beyond this list. A beautifully designed but sparsely furnished room is BETTER than a room with non-catalog furniture.\n`;

  return `${body}`;
}

export async function fetchCatalogImageInline(url: string): Promise<{ mimeType: string; data: string } | null> {
  const buf = await fetchCatalogImageBuffer(url);
  if (!buf) return null;
  return { mimeType: "image/jpeg", data: buf.toString("base64") };
}

export async function fetchCatalogImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8500);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok || res.status >= 400) return null;

    const arr = await res.arrayBuffer();
    if (arr.byteLength === 0) return null;

    const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(arr));
    return optimized.buffer;
  } catch {
    return null;
  }
}

export interface CatalogProductImageBuffer {
  catalogId: string;
  name: string;
  sizeCm: string;
  buffer: Buffer;
}

export async function fetchCatalogProductImageBuffers(
  ids: string[],
  byId: Map<string, CatalogItemSummary>,
): Promise<CatalogProductImageBuffer[]> {
  const out: CatalogProductImageBuffer[] = [];
  for (const id of dedupePreserveOrder(ids).slice(0, MAX_REFERENCE_PRODUCT_FETCH)) {
    const row = byId.get(id);
    const url = row?.cleanImageUrl || row?.primaryImageUrl;
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const buffer = await fetchCatalogImageBuffer(url);
    if (!buffer) continue;
    out.push({
      catalogId: id,
      name: row.name,
      sizeCm: `${row.width_cm}x${row.depth_cm}x${row.height_cm}`,
      buffer,
    });
    if (out.length >= MAX_REFERENCE_PRODUCT_FETCH) break;
  }
  return out;
}

export async function fetchSofaGalleryBuffers(
  catalogId: string,
  byId: Map<string, CatalogItemSummary>,
): Promise<CatalogProductImageBuffer[]> {
  const row = byId.get(catalogId);
  if (!row) return [];
  const urls = row.galleryUrls?.length
    ? row.galleryUrls
    : [row.cleanImageUrl, row.primaryImageUrl].filter(Boolean) as string[];
  const validUrls = urls.slice(0, SOFA_GALLERY_MAX).filter(
    (url): url is string => Boolean(url) && /^https?:\/\//i.test(url),
  );
  const results = await Promise.all(
    validUrls.map((url) => fetchCatalogImageBuffer(url)),
  );
  const out: CatalogProductImageBuffer[] = [];
  for (const buffer of results) {
    if (!buffer) continue;
    out.push({
      catalogId,
      name: row.name,
      sizeCm: `${row.width_cm}x${row.depth_cm}x${row.height_cm}`,
      buffer,
    });
  }
  return out;
}

export async function fetchProductImagePartsForGemini(
  ids: string[],
  byId: Map<string, CatalogItemSummary>,
): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
  const parts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const id of dedupePreserveOrder(ids).slice(0, MAX_REFERENCE_PRODUCT_FETCH)) {
    const row = byId.get(id);
    const url = row?.primaryImageUrl;
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const got = await fetchCatalogImageInline(url);
    if (got) parts.push({ inlineData: got });
    if (parts.length >= MAX_REFERENCE_PRODUCT_FETCH) break;
  }
  return parts;
}

/** Reference thumbnails for Claude vision identify — each part carries its catalog ID. */
export async function fetchProductImagePartsForVision(
  ids: string[],
  byId: Map<string, CatalogItemSummary>,
): Promise<Array<{ id: string; inlineData: { mimeType: string; data: string } }>> {
  const parts: Array<{ id: string; inlineData: { mimeType: string; data: string } }> = [];
  for (const id of dedupePreserveOrder(ids).slice(0, MAX_VISION_REFERENCE_PRODUCT_FETCH)) {
    const row = byId.get(id);
    const url = row?.primaryImageUrl;
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const got = await fetchCatalogImageInline(url);
    if (got) parts.push({ id, inlineData: got });
    if (parts.length >= MAX_VISION_REFERENCE_PRODUCT_FETCH) break;
  }
  return parts;
}

const BY_IDS_CHUNK = 50;

export async function fetchMarketplaceProductsAsCatalog(productIds: number[]): Promise<CatalogItemSummary[]> {
  const unique = Array.from(
    new Set(productIds.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n))),
  );
  if (!unique.length) return [];

  const rows: CatalogItemSummary[] = [];
  try {
    const chunks: number[][] = [];
    for (let i = 0; i < unique.length; i += BY_IDS_CHUNK) {
      chunks.push(unique.slice(i, i + BY_IDS_CHUNK));
    }
    const chunkResults = await Promise.all(
      chunks.map(async (chunk) => {
        const idsParam = chunk.join(",");
        const res = await fetch(
          `${getServerMarketplaceApiBaseUrl()}/products/by-ids?ids=${idsParam}`,
          { cache: "no-store", headers: { Accept: "application/json" } },
        );
        if (!res.ok) return [] as CatalogItemSummary[];
        const json = (await res.json()) as { data?: unknown[] };
        const items = Array.isArray(json.data) ? json.data : [];
        const part: CatalogItemSummary[] = [];
        for (const item of items) {
          if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
          part.push(rowFromScrapedRecord(item as Record<string, unknown>));
        }
        return part;
      }),
    );
    for (const part of chunkResults) {
      rows.push(...part);
    }
  } catch {
    return [];
  }
  return dedupeSummariesPreserveOrder(rows);
}

function dedupeSummariesPreserveOrder(rows: CatalogItemSummary[]): CatalogItemSummary[] {
  const seen = new Set<string>();
  const out: CatalogItemSummary[] = [];
  for (const r of rows) {
    if (!r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function resolveCleanImageUrl(item: Record<string, unknown>): string | null {
  if (typeof item.cutout_image_url === "string" && item.cutout_image_url.trim()) {
    return item.cutout_image_url.trim();
  }
  const images = Array.isArray(item.images) ? item.images : [];
  if (images.length >= 2 && typeof images[1] === "string" && images[1].trim()) {
    return images[1].trim();
  }
  if (typeof item.main_image_url === "string" && item.main_image_url.trim()) {
    return item.main_image_url.trim();
  }
  if (images.length >= 1 && typeof images[0] === "string" && images[0].trim()) {
    return images[0].trim();
  }
  return null;
}

function rowFromScrapedRecord(item: Record<string, unknown>): CatalogItemSummary {
  return {
    id: `mp-${item.id ?? ""}`,
    name:
      typeof item.name_en === "string" && item.name_en.trim()
        ? item.name_en
        : typeof item.name === "string"
          ? item.name
          : "Product",
    category:
      typeof item.category_en === "string" && item.category_en.trim()
        ? item.category_en
        : typeof item.category === "string"
          ? item.category || ""
          : "",
    product_family:
      typeof item.product_family === "string" && item.product_family.trim()
        ? item.product_family.trim()
        : null,
    product_subtype:
      typeof item.product_subtype === "string" && item.product_subtype.trim()
        ? item.product_subtype.trim()
        : null,
    descriptionSnippet: typeof item.source_marketplace === "string" ? `From ${item.source_marketplace}` : undefined,
    width_cm: Math.round(Number(item.width_cm) || 0),
    depth_cm: Math.round(Number(item.depth_cm) || 0),
    height_cm: Math.round(Number(item.height_cm) || 0),
    price: Number(item.price) || 0,
    currency: typeof item.currency === "string" ? item.currency : "AMD",
    primaryImageUrl:
      typeof item.cutout_image_url === "string" && item.cutout_image_url.trim()
        ? item.cutout_image_url
        : typeof item.main_image_url === "string"
          ? item.main_image_url
          : null,
    cleanImageUrl: resolveCleanImageUrl(item),
    galleryUrls: resolveGalleryUrls(item),
    externalUrl:
      typeof item.external_url === "string" && item.external_url.trim()
        ? item.external_url.trim()
        : null,
  };
}

const ARMENIA_LOCAL_SCRAPED_EXCLUSIVE_INSTRUCTIONS =
  `══════════════════════════════════════════════════════════════
ARMENIA · LOCAL — SCRAPED_PRODUCTS INVENTORY LOCK (ABSOLUTE)
══════════════════════════════════════════════════════════════
The shopper uses Armenia + Local. Every product-shaped object in this design (furniture, visible lighting fixtures, appliances, tile/parquet/flooring sold as SKUs, storage, etc.) MUST be chosen ONLY from the scraped_products-backed rows listed in AVAILABLE PRODUCT CATALOG below (marketplace API — no live-store scraping, no invented SKUs).

NON-NEGOTIABLE:
1) Use ONLY verbatim product NAMES from the list in subject, arrangement, and fullPrompt for those objects. Never substitute a “similar” item.
2) "selected_catalog_ids" MUST list ONLY "mp-<number>" ids from that list for products you ACTUALLY place in the scene (never pad to meet coverage — vision verification drops unused ids).
3) If the user needs an object class (e.g. chair) and NO suitable row exists in the list, DO NOT add a chair: leave the space empty or use only non-product finishes (paint, plain plaster, generic recessed wash lighting without naming a fixture SKU).
4) USER INSPIRATION IMAGES: treat as reference ONLY when they align with listed SKUs; never introduce furniture/lighting/appliances/TV models from inspiration that are not in the AVAILABLE list — the list ALWAYS wins.

COVERAGE:`;

export interface ConsumerInteriorCatalogContext {
  coverage: InteriorDesignCatalogCoverage;
  estimatedPieces: number;
  anchoredPieces: number;
  distinctRequired: number;
  summariesForDirector: CatalogItemSummary[];
  catalogTextForClaude: string;
  coverageInstructions: string;
  summaryById: Map<string, CatalogItemSummary>;
}

export async function buildConsumerDesignCatalogContext(options: {
  marketplaceProductIds: number[];
  textPrompt: string;
  roomAnalysis?: RoomAnalysis | null;
  scrapedInventoryExclusive?: boolean;
  /** Cap rows embedded in Claude prompt (quick design / edge timeout budget). */
  maxRowsForPrompt?: number;
  /** User design-board pin count — lowers padding pressure in exclusive mode. */
  pinnedProductCount?: number;
}): Promise<ConsumerInteriorCatalogContext> {
  const { marketplaceProductIds, roomAnalysis, scrapedInventoryExclusive, maxRowsForPrompt, pinnedProductCount } =
    options;

  const coverage = normalizeInteriorDesignCoverage({ mode: "percent", value: 100 });
  let allRows = await fetchMarketplaceProductsAsCatalog(marketplaceProductIds);
  if (maxRowsForPrompt != null && maxRowsForPrompt > 0 && allRows.length > maxRowsForPrompt) {
    allRows = allRows.slice(0, maxRowsForPrompt);
  }

  const estimatedPieces = estimateInteriorFurniturePieceBudget(roomAnalysis);
  const pinCount = Math.max(0, pinnedProductCount ?? 0);
  const distinctRequired = scrapedInventoryExclusive
    ? Math.min(allRows.length, Math.max(pinCount, pinCount > 0 ? pinCount : 1))
    : Math.min(allRows.length, estimatedPieces);
  const anchoredPieces = Math.min(allRows.length, estimatedPieces);

  let coverageInstructions = "";
  if (allRows.length > 0) {
    coverageInstructions =
      scrapedInventoryExclusive
        ? `${ARMENIA_LOCAL_SCRAPED_EXCLUSIVE_INSTRUCTIONS}
List ONLY "mp-<id>" values for SKUs you will ACTUALLY place visibly (${allRows.length} rows in pool). Do NOT pad to a minimum count — post-render vision drops unused ids. Prefer every user-pinned SKU when plausible. Layer order in fullPrompt: flooring/walls → curtains → lighting → furniture. Also populate "product_intents" for slots you need from the catalog (family, subtype, query) when not yet pinned.`
        : `══════════════════════════════════════════════════════════════
CATALOG COVERAGE — STRICT (100% from catalog)
══════════════════════════════════════════════════════════════
ABSOLUTE RULE: EVERY piece of furniture, appliance, visible lighting fixture, and major decor object in the room MUST be a product from the AVAILABLE PRODUCT CATALOG below. There are NO exceptions.

NON-NEGOTIABLE:
1) Use ONLY verbatim product NAMES from the catalog list in subject, arrangement, and fullPrompt. Never invent, imagine, or substitute furniture not in the list.
2) "selected_catalog_ids" MUST list ONLY "mp-<number>" ids from the catalog for products you ACTUALLY place in the scene.
3) If a furniture type is needed for the design but NO suitable catalog product exists, OMIT that furniture — leave the space empty or use only generic finishes (wall paint, plain ceiling wash, rugs, curtains, art without brand, small tabletop props, plants).
4) A beautifully designed room with fewer furniture pieces (all from catalog) is ALWAYS better than a fully furnished room with non-catalog items.
5) USER INSPIRATION IMAGES: treat as style reference ONLY — never introduce furniture/lighting/appliances from inspiration that are not in the AVAILABLE PRODUCT CATALOG.

The catalog contains ${allRows.length} products. Include as many as possible while keeping the design cohesive.
List ONLY "mp-<id>" values for SKUs you will ACTUALLY place visibly. Do NOT pad to a minimum count — post-render vision drops unused ids. Also populate "product_intents" for slots you need from the catalog (family, subtype, query) when not yet pinned.`;
  }

  const catalogTextForClaude = allRows.length === 0
    ? ""
    : `\nAVAILABLE PRODUCT CATALOG — authoritative inventory (${allRows.length} SKUs). ONLY these products may appear as furniture/fixtures in the design:\n${catalogSummaryToPromptText(allRows)}`;

  return {
    coverage,
    estimatedPieces,
    anchoredPieces,
    distinctRequired,
    summariesForDirector: allRows,
    catalogTextForClaude,
    coverageInstructions,
    summaryById: new Map(allRows.map((x) => [x.id, x])),
  };
}
