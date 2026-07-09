import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import { getServerMarketplaceApiBaseUrl } from "@/lib/publicEnv";

/** Subtypes that get a live URL check before Gemini render. */
const LIVE_CHECK_SUBTYPES = new Set([
  // furniture
  "sofa",
  "chair",
  "coffee_table",
  "dining_table",
  "table",
  "tv_stand",
  "desk",
  "wardrobe",
  // flooring
  "laminate",
  "tile",
  // walls
  "wallpaper",
]);

const HEAD_TIMEOUT_MS = 3000;

function numericIdFromCatalogId(catalogId: string): number | null {
  const m = /^mp-(\d+)$/.exec(catalogId.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function shouldLiveCheck(item: CatalogItemSummary): boolean {
  const subtype = item.product_subtype?.toLowerCase().trim();
  if (!subtype) return false;
  return LIVE_CHECK_SUBTYPES.has(subtype);
}

function isRedirectToNonProduct(originalUrl: string, finalUrl: string): boolean {
  try {
    const finalPath = new URL(finalUrl).pathname;

    const stripped = finalPath.replace(/\/+$/, "") || "/";
    if (
      stripped === "/" ||
      stripped === "/en" ||
      stripped === "/am" ||
      stripped === "/ru" ||
      stripped === "/hy"
    ) {
      return true;
    }

    if (/^\/[a-z]{2}\/?(category|catalog|products|search)?$/i.test(stripped)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

async function headCheckUrl(url: string): Promise<"alive" | "dead"> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);

  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
      cache: "no-store",
    });

    // Some retailers don't support HEAD — fall back to GET with no body read on success path
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        cache: "no-store",
        headers: { Range: "bytes=0-0" },
      });
    }

    if (res.status === 404 || res.status === 410) {
      return "dead";
    }

    if (res.status >= 400) {
      return "alive";
    }

    const finalUrl = res.url || url;
    if (finalUrl !== url && isRedirectToNonProduct(url, finalUrl)) {
      return "dead";
    }

    return "alive";
  } catch {
    return "alive";
  } finally {
    clearTimeout(timer);
  }
}

function deactivateProductsInBackground(ids: number[]): void {
  if (!ids.length) return;

  const base = getServerMarketplaceApiBaseUrl();
  void fetch(`${base}/products/deactivate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ids }),
    cache: "no-store",
  }).catch((err) => {
    console.warn("catalog.deactivate_failed", err);
  });
}

export interface VerifyProductAvailabilityResult {
  /** Numeric scraped_product ids that failed the live URL check. */
  deadIds: number[];
  /** Number of products that were live-checked. */
  checkedCount: number;
}

/**
 * Live-check external URLs for key product subtypes before Gemini render.
 * Dead products are returned for removal; deactivation is fire-and-forget.
 */
export async function verifyProductAvailability(
  items: CatalogItemSummary[],
): Promise<VerifyProductAvailabilityResult> {
  const toCheck = items.filter(
    (item) => shouldLiveCheck(item) && item.externalUrl && /^https?:\/\//i.test(item.externalUrl),
  );

  if (!toCheck.length) {
    return { deadIds: [], checkedCount: 0 };
  }

  const results = await Promise.all(
    toCheck.map(async (item) => {
      const id = numericIdFromCatalogId(item.id);
      if (!id) return { id: null as number | null, status: "alive" as const };
      const status = await headCheckUrl(item.externalUrl!);
      return { id, status };
    }),
  );

  const deadIds = results
    .filter((r): r is { id: number; status: "dead" } => r.id !== null && r.status === "dead")
    .map((r) => r.id);

  if (deadIds.length > 0) {
    deactivateProductsInBackground(deadIds);
  }

  return { deadIds, checkedCount: toCheck.length };
}
