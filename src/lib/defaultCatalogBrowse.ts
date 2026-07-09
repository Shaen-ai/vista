import type { MarketplaceProduct } from "@/app/store";
import { PRIORITY_MARKETPLACES } from "@/lib/priorityCatalog";

/** Max rows per marketplace browse page (Laravel caps at 50). */
export const CATALOG_BROWSE_PER_PAGE = 50;


export type CatalogBrowsePageResult = {
  products: MarketplaceProduct[];
  currentPage: number;
  lastPage: number;
  total: number;
};

export type CatalogStats = {
  totalAll: number;
  byMarketplace: Record<string, { total: number; with_dimensions: number; in_stock: number }>;
};

type PaginatedResponse = {
  data?: MarketplaceProduct[];
  current_page?: number;
  last_page?: number;
  total?: number;
};

function parsePaginatedResponse(json: unknown): CatalogBrowsePageResult {
  if (!json || typeof json !== "object") {
    return { products: [], currentPage: 1, lastPage: 1, total: 0 };
  }
  const payload = json as PaginatedResponse;
  const products = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(json)
      ? (json as MarketplaceProduct[])
      : [];
  const currentPage = Number(payload.current_page);
  const lastPage = Number(payload.last_page);
  const total = Number(payload.total);
  return {
    products,
    currentPage: Number.isFinite(currentPage) && currentPage > 0 ? currentPage : 1,
    lastPage: Number.isFinite(lastPage) && lastPage > 0 ? lastPage : 1,
    total: Number.isFinite(total) && total >= 0 ? total : products.length,
  };
}

export type CatalogBrowseOptions = {
  marketplace?: string;
  q?: string;
  page?: number;
  perPage?: number;
  product_family?: string;
  product_subtype?: string;
  product_subtypes?: string;
};

/** Single paginated browse page — q is optional. */
export async function fetchCatalogBrowsePage(
  apiBase: string,
  options?: CatalogBrowseOptions,
): Promise<CatalogBrowsePageResult> {
  const params = new URLSearchParams({
    per_page: String(options?.perPage ?? CATALOG_BROWSE_PER_PAGE),
    page: String(options?.page ?? 1),
    in_stock: "1",
  });

  const q = options?.q?.trim();
  if (q && q.length >= 2) {
    params.set("q", q);
  }
  if (options?.marketplace) {
    params.set("marketplace", options.marketplace);
  }
  if (options?.product_family) {
    params.set("product_family", options.product_family);
  }
  if (options?.product_subtypes) {
    params.set("product_subtypes", options.product_subtypes);
  } else if (options?.product_subtype) {
    params.set("product_subtype", options.product_subtype);
  }

  try {
    const res = await fetch(`${apiBase}/products/browse?${params.toString()}`);
    if (!res.ok) {
      return { products: [], currentPage: 1, lastPage: 1, total: 0 };
    }
    return parsePaginatedResponse(await res.json());
  } catch {
    return { products: [], currentPage: 1, lastPage: 1, total: 0 };
  }
}

/** Paginate through all browse pages (use sparingly — prefer modal infinite scroll). */
export async function fetchCatalogBrowseAllPages(
  apiBase: string,
  options?: Omit<CatalogBrowseOptions, "page">,
): Promise<MarketplaceProduct[]> {
  const first = await fetchCatalogBrowsePage(apiBase, { ...options, page: 1 });
  const rows = [...first.products];

  if (first.lastPage <= 1) return rows;

  const rest = await Promise.all(
    Array.from({ length: first.lastPage - 1 }, (_, index) =>
      fetchCatalogBrowsePage(apiBase, { ...options, page: index + 2 }).then(
        (response) => response.products,
      ),
    ),
  );

  for (const pageRows of rest) {
    rows.push(...pageRows);
  }
  return rows;
}

function mergeCatalogProducts(
  target: MarketplaceProduct[],
  seen: Set<number>,
  rows: MarketplaceProduct[],
): void {
  for (const product of rows) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    target.push(product);
  }
}

/** First page only from /products/search — lightweight fetch for sidebar category pools. */
export async function fetchCatalogSearchFirstPage(
  apiBase: string,
  q: string,
  options?: { marketplace?: string; perPage?: number; product_family?: string; product_subtype?: string },
): Promise<MarketplaceProduct[]> {
  const term = q.trim();
  if (term.length < 2) return [];

  const params = new URLSearchParams({
    q: term,
    in_stock: "0",
    per_page: String(options?.perPage ?? 12),
    page: "1",
  });
  if (options?.marketplace) params.set("marketplace", options.marketplace);
  if (options?.product_family) params.set("product_family", options.product_family);
  if (options?.product_subtype) params.set("product_subtype", options.product_subtype);

  try {
    const res = await fetch(`${apiBase}/products/search?${params.toString()}`);
    if (!res.ok) return [];
    return parsePaginatedResponse(await res.json()).products;
  } catch {
    return [];
  }
}

const SIDEBAR_CATEGORY_QUERIES: {
  queries: string[];
  perPage: number;
}[] = [
  { queries: ["sofa", "sectional", "բազմոց", "диван"], perPage: 12 },
  { queries: ["dining table", "coffee table", "table set", "dining set"], perPage: 8 },
  { queries: ["armchair", "кресло"], perPage: 8 },
  { queries: ["chair", "стул"], perPage: 8 },
  { queries: ["laminate flooring", "parquet"], perPage: 8 },
  { queries: ["porcelain tile", "floor tile"], perPage: 8 },
];

/** Category-targeted sidebar pool: searches per-shop per-category for better coverage. */
export async function fetchSidebarCatalogPreview(
  apiBase: string,
): Promise<MarketplaceProduct[]> {
  const seen = new Set<number>();
  const merged: MarketplaceProduct[] = [];

  const tasks: Promise<MarketplaceProduct[]>[] = [];
  for (const cat of SIDEBAR_CATEGORY_QUERIES) {
    for (const marketplace of PRIORITY_MARKETPLACES) {
      for (const q of cat.queries) {
        tasks.push(
          fetchCatalogSearchFirstPage(apiBase, q, {
            marketplace,
            perPage: cat.perPage,
          }),
        );
      }
    }
  }

  const batches = await Promise.all(tasks);
  for (const rows of batches) {
    mergeCatalogProducts(merged, seen, rows);
  }

  return merged;
}

let sidebarPreviewCache: MarketplaceProduct[] | null = null;
let inflightSidebarPreview: Promise<MarketplaceProduct[]> | null = null;

/**
 * Memoized sidebar preview — fetches the category burst once per session and
 * dedupes concurrent callers (e.g. React StrictMode's double mount in dev) by
 * returning the same in-flight promise. Mirrors the `inflightMe` pattern in
 * authApi.ts. Repeat visits resolve instantly from cache.
 */
export async function getSidebarCatalogPreview(
  apiBase: string,
): Promise<MarketplaceProduct[]> {
  if (sidebarPreviewCache) return sidebarPreviewCache;
  if (inflightSidebarPreview) return inflightSidebarPreview;
  inflightSidebarPreview = fetchSidebarCatalogPreview(apiBase)
    .then((rows) => {
      sidebarPreviewCache = rows;
      return rows;
    })
    .finally(() => {
      inflightSidebarPreview = null;
    });
  return inflightSidebarPreview;
}

/** Catalog totals from /stats — used for modal header and browse button label. */
export async function fetchCatalogStats(apiBase: string): Promise<CatalogStats> {
  const empty: CatalogStats = { totalAll: 0, byMarketplace: {} };
  try {
    const res = await fetch(`${apiBase}/stats`);
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      data?: Record<string, { total: number; with_dimensions: number; in_stock: number }>;
      total_all?: number;
    };
    const totalAll = Number(json.total_all);
    return {
      totalAll: Number.isFinite(totalAll) && totalAll >= 0 ? totalAll : 0,
      byMarketplace: json.data ?? {},
    };
  } catch {
    return empty;
  }
}

/** Legacy search helper — paginated /products/search for typed left-panel queries. */
export async function fetchCatalogSearchAllPages(
  apiBase: string,
  q: string,
  options?: {
    marketplace?: string;
    perPage?: number;
    product_family?: string;
    product_subtype?: string;
    product_subtypes?: string;
  },
): Promise<MarketplaceProduct[]> {
  const term = q.trim();
  if (term.length < 2) return [];

  const params = new URLSearchParams({
    q: term,
    in_stock: "0",
    per_page: String(options?.perPage ?? CATALOG_BROWSE_PER_PAGE),
    page: "1",
  });
  if (options?.marketplace) {
    params.set("marketplace", options.marketplace);
  }
  if (options?.product_family) {
    params.set("product_family", options.product_family);
  }
  if (options?.product_subtypes) {
    params.set("product_subtypes", options.product_subtypes);
  } else if (options?.product_subtype) {
    params.set("product_subtype", options.product_subtype);
  }

  try {
    const firstRes = await fetch(`${apiBase}/products/search?${params.toString()}`);
    if (!firstRes.ok) return [];
    const first = parsePaginatedResponse(await firstRes.json());
    const rows = [...first.products];

    if (first.lastPage <= 1) return rows;

    const rest = await Promise.all(
      Array.from({ length: first.lastPage - 1 }, (_, index) => {
        const pageParams = new URLSearchParams(params);
        pageParams.set("page", String(index + 2));
        return fetch(`${apiBase}/products/search?${pageParams.toString()}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((json) => parsePaginatedResponse(json).products);
      }),
    );

    for (const pageRows of rest) {
      rows.push(...pageRows);
    }
    return rows;
  } catch {
    return [];
  }
}
