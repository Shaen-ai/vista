/**
 * Per-country catalog capabilities for Vista UI and generation paths.
 * Add a country here when its local scraped inventory is ready — no AM hardcoding elsewhere.
 */

export type CountryCatalogCapability = {
  /** DB / Qdrant scraped_products catalog for local search mode */
  localScrapedInventory: boolean;
};

const CATALOG_BY_COUNTRY: Record<string, CountryCatalogCapability> = {
  AM: { localScrapedInventory: true },
  // GE: { localScrapedInventory: true },
};

/** UI label "տեղական" and common aliases → canonical `local` search mode. */
const LOCAL_SEARCH_MODE_ALIASES = new Set([
  "local",
  "տեղական",
  "teghakan",
  "locale",
]);

export function normalizeCountryCode(code: string): string {
  return (code || "").trim().toUpperCase();
}

export function normalizeSearchMode(mode: string): string {
  const raw = (mode || "").trim();
  const lower = raw.toLowerCase();
  if (LOCAL_SEARCH_MODE_ALIASES.has(lower) || LOCAL_SEARCH_MODE_ALIASES.has(raw)) {
    return "local";
  }
  return lower;
}

/** True when the country has a browsable local product catalog (scraped inventory). */
export function hasLocalProductCatalog(
  countryCode: string,
  searchMode: string = "local",
): boolean {
  const code = normalizeCountryCode(countryCode);
  const mode = normalizeSearchMode(searchMode);
  return !!CATALOG_BY_COUNTRY[code]?.localScrapedInventory && mode === "local";
}
