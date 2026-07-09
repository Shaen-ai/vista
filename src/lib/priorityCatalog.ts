import type { MarketplaceProduct } from "@/app/store";

/** Marketplaces surfaced after DB-priority products (local Armenian retailers). */
export const PRIORITY_MARKETPLACES = ["vega", "domus", "jysk"] as const;

/** Max products shown in the left sidebar (scrollable grid). */
export const CATALOG_SIDEBAR_MAX = 56;

/** Per-category caps for sidebar sections. */
export const SIDEBAR_CATEGORY_LIMITS: Record<string, number> = {
  sofa: 10,
  table: 5,
  armchair: 8,
  chair: 8,
  laminateFlooring: 6,
  tileFlooring: 6,
};

export type SidebarProductKind =
  | "sofa"
  | "armchair"
  | "table"
  | "chair"
  | "laminateFlooring"
  | "tileFlooring";

export type SidebarPreviewSection = {
  kind: SidebarProductKind | "more";
  products: MarketplaceProduct[];
};

const SOFA_RE =
  /\b(sofa|sectional|loveseat|chesterfield|canapé|divan|диван|дивան|բազմոց)/i;
const ARMCHAIR_RE =
  /\b(armchair|recliner|accent chair|rocking chair|кресло|кресл)/i;
const TABLE_RE =
  /\b(table|desk|coffee table|dining table|side table|console table|стол|սեղան)/i;
const CHAIR_RE = /\b(chair|stool|ottoman|seat|стул|աթոռ|աթող)/i;
const LAMINATE_RE = /\b(laminate|ламинат|ламinate)/i;
const TILE_FLOORING_RE =
  /\b(floor tile|flooring tile|tile flooring|ceramic tile|porcelain tile|керамогранит|напольн.*плитк|плитк.*пол|floor.*tile|tile.*floor)/i;
const TILE_RE = /\b(tile|ceramic|porcelain|кafel|плитк)/i;
const STORAGE_RE =
  /\b(bookcase|bookshelf|book shelf|shelf|shelv|wardrobe|cabinet|storage|шкаф|стеллаж|полк)/i;
const FIREPLACE_RE = /\b(fireplace|portal|камин|бурар|բուրար)/i;

const TABLE_LINEN_RE =
  /\b(tablecloth|table cloth|tablecloths|table runner|table linen|table cover|скатерт|սdelays|textile|linen set)\b/i;

const TABLE_SET_RE =
  /\b(dining set|table set|kitchen set|table.*chair.*set|set.*table)\b/i;

const SIDEBAR_CATEGORY_BAND = {
  sofa: 10,
  armchair: 20,
  table: 30,
  chair: 40,
  laminateFlooring: 50,
  tileFlooring: 60,
  otherFurniture: 70,
  storage: 80,
  fireplace: 90,
  other: 100,
} as const;

/** Furniture categories shown in the left sidebar. */
const SIDEBAR_FURNITURE_KINDS: SidebarProductKind[] = [
  "sofa",
  "armchair",
  "table",
  "chair",
];

/** Flooring categories shown in the left sidebar after furniture (own pool, not furniture-filtered). */
const SIDEBAR_FLOORING_KINDS: SidebarProductKind[] = [
  "laminateFlooring",
  "tileFlooring",
];

const SIDEBAR_SECTION_ORDER: SidebarProductKind[] = [
  ...SIDEBAR_FURNITURE_KINDS,
  ...SIDEBAR_FLOORING_KINDS,
];

const NON_FURNITURE_RE =
  /\b(bowl|plate|cup|mug|vase|candle|pillow|cushion|blanket|bedding|towel|kitchenware|tableware|cutlery|utensil|pot|pan|tray|basket|bin|hook|hanger|clock|frame|artwork|ornament|figurine|statue|planter|pot\b|decor|decoration|accessory|lighting|lamp|chandelier|sconce|pendant|rug|carpet|mat\b|curtain|blind|drape|wallpaper|paint\b|mirror\b|soap|dispenser|organizer|storage box|box set|gift set|tablecloth|table cloth|table runner|table linen|table cover|скатерт|հավաքածու|тарелк|миск|чаш|ваз|свеч|подушк|декор|люстр|светильник|штор|ковр|чаш|тарелк)/i;

function productSearchHaystack(p: MarketplaceProduct): string {
  return `${p.category ?? ""} ${p.category_en ?? ""} ${p.name} ${p.name_en ?? ""} ${p.brand ?? ""}`;
}

function classifySidebarKindFromHaystack(hay: string): SidebarProductKind | null {
  if (TABLE_LINEN_RE.test(hay)) return null;
  if (isStorageProduct(hay) || isFireplaceProduct(hay)) return null;
  if (SOFA_RE.test(hay)) return "sofa";
  if (ARMCHAIR_RE.test(hay)) return "armchair";
  if (TABLE_RE.test(hay)) return "table";
  if (CHAIR_RE.test(hay)) return "chair";
  if (LAMINATE_RE.test(hay)) return "laminateFlooring";
  if (TILE_FLOORING_RE.test(hay)) return "tileFlooring";
  if (TILE_RE.test(hay) && /\b(floor|flooring|напольн|пол)\b/i.test(hay)) {
    return "tileFlooring";
  }
  return null;
}

function classifyProductSidebarKind(p: MarketplaceProduct): SidebarProductKind | null {
  if (p.product_family === "home_accessories") return null;
  if (p.product_subtype === "sofa") return "sofa";
  if (["coffee_table", "dining_table", "desk", "table"].includes(p.product_subtype ?? "")) return "table";
  if (p.product_subtype === "chair") return "chair";

  const hay = productSearchHaystack(p);
  const fromText = classifySidebarKindFromHaystack(hay);
  if (fromText) return fromText;

  const categoryHay = `${p.category ?? ""} ${p.category_en ?? ""}`.toLowerCase();
  if (!categoryHay.trim()) return null;

  if (/\b(բազմոց|sofa|sectional|диван|canapé|divan)\b/i.test(categoryHay)) return "sofa";
  if (/\b(armchair|кресло|accent chair|мягк.*кресл)\b/i.test(categoryHay)) return "armchair";
  if (/\b(table|desk|սեղան|стол|coffee table|dining table)\b/i.test(categoryHay)) return "table";
  if (/\b(chair|stool|seat|աթոռ|стул|taburet)\b/i.test(categoryHay)) return "chair";
  if (/\b(laminate|ламинат|laminate flooring)\b/i.test(categoryHay)) return "laminateFlooring";
  if (/\b(tile|плитк|ceramic|porcelain|floor tile)\b/i.test(categoryHay)) return "tileFlooring";

  return null;
}

function isStorageProduct(hay: string): boolean {
  return STORAGE_RE.test(hay);
}

function isFireplaceProduct(hay: string): boolean {
  return FIREPLACE_RE.test(hay);
}

function sidebarCategorySortKey(category: string, name: string): number {
  const hay = `${category} ${name}`;
  const kind = classifySidebarKindFromHaystack(hay);
  if (kind) return SIDEBAR_CATEGORY_BAND[kind];
  if (isStorageProduct(hay)) return SIDEBAR_CATEGORY_BAND.storage;
  if (isFireplaceProduct(hay)) return SIDEBAR_CATEGORY_BAND.fireplace;
  if (/\b(furniture|мебель|кресл|диван|стол|стул)\b/i.test(hay)) {
    return SIDEBAR_CATEGORY_BAND.otherFurniture;
  }
  return SIDEBAR_CATEGORY_BAND.other;
}

function classifySidebarKind(hay: string): SidebarProductKind | null {
  return classifySidebarKindFromHaystack(hay);
}

export function sidebarFurnitureKind(p: MarketplaceProduct): SidebarProductKind | null {
  return classifyProductSidebarKind(p);
}

/** True when the product belongs in the sidebar furniture grid (excludes bowls, decor, flooring, etc.). */
export function isSidebarFurnitureProduct(p: MarketplaceProduct): boolean {
  if (p.product_family === "home_accessories") return false;
  const hay = productSearchHaystack(p);
  if (NON_FURNITURE_RE.test(hay)) return false;
  const kind = sidebarFurnitureKind(p);
  return kind != null && SIDEBAR_FURNITURE_KINDS.includes(kind);
}

/** True when the product is a sidebar flooring kind (laminate or tile flooring). */
export function isSidebarFlooringProduct(p: MarketplaceProduct): boolean {
  const kind = classifyProductSidebarKind(p);
  return kind != null && SIDEBAR_FLOORING_KINDS.includes(kind);
}

/** True when a product is table linen / textile (tablecloth, table runner, etc.). */
export function isTableLinenProduct(p: MarketplaceProduct): boolean {
  const hay = productSearchHaystack(p);
  return TABLE_LINEN_RE.test(hay);
}

function normalizeShopKey(p: MarketplaceProduct): string {
  return p.source_marketplace.trim().toLowerCase();
}

/** Round-robin across shops; first pass guarantees one pick per shop when available. */
function pickDiverseSidebarProducts(
  candidates: MarketplaceProduct[],
  _kind: SidebarProductKind,
  max: number,
): MarketplaceProduct[] {
  if (candidates.length <= max) return candidates;

  const byShop = new Map<string, MarketplaceProduct[]>();
  for (const product of candidates) {
    const shop = normalizeShopKey(product);
    const list = byShop.get(shop) ?? [];
    list.push(product);
    byShop.set(shop, list);
  }

  const shopOrder = [...PRIORITY_MARKETPLACES.filter((shop) => byShop.has(shop)), ...[...byShop.keys()].filter(
    (shop) => !PRIORITY_MARKETPLACES.includes(shop as (typeof PRIORITY_MARKETPLACES)[number]),
  )];

  const picked: MarketplaceProduct[] = [];
  const pickedIds = new Set<number>();

  const takeFromShop = (shop: string): boolean => {
    if (picked.length >= max) return false;
    const next = byShop.get(shop)?.find((product) => !pickedIds.has(product.id));
    if (!next) return false;
    picked.push(next);
    pickedIds.add(next.id);
    return true;
  };

  for (const shop of shopOrder) {
    takeFromShop(shop);
  }

  while (picked.length < max) {
    let progress = false;
    for (const shop of shopOrder) {
      if (picked.length >= max) break;
      if (takeFromShop(shop)) progress = true;
    }
    if (!progress) break;
  }

  return picked;
}

function marketplacePriority(source: string): number {
  const s = source.toLowerCase();
  const idx = PRIORITY_MARKETPLACES.findIndex((m) => s.includes(m));
  return idx >= 0 ? idx : PRIORITY_MARKETPLACES.length;
}

function compareCatalogPriority(a: MarketplaceProduct, b: MarketplaceProduct): number {
  const aPriority = a.priority;
  const bPriority = b.priority;
  const aHas = aPriority != null;
  const bHas = bPriority != null;

  if (aHas && bHas && aPriority !== bPriority) {
    return aPriority - bPriority;
  }
  if (aHas !== bHas) {
    return aHas ? -1 : 1;
  }

  const shopA = marketplacePriority(a.source_marketplace);
  const shopB = marketplacePriority(b.source_marketplace);
  if (shopA !== shopB) return shopA - shopB;

  const bandA = sidebarCategorySortKey(a.category ?? "", a.name_en || a.name);
  const bandB = sidebarCategorySortKey(b.category ?? "", b.name_en || b.name);
  if (bandA !== bandB) return bandA - bandB;

  return (a.name_en || a.name).localeCompare(b.name_en || b.name, undefined, { sensitivity: "base" });
}

/** Rank scraped catalog rows: DB priority → shop → sidebar category → name. */
export function rankCatalogProducts(products: MarketplaceProduct[]): MarketplaceProduct[] {
  return [...products].sort(compareCatalogPriority);
}

/** Curated sidebar pool — capped at {@link CATALOG_SIDEBAR_MAX}. */
export function selectSidebarPool(products: MarketplaceProduct[]): MarketplaceProduct[] {
  return selectSidebarPreviewSections(products).flatMap((section) => section.products);
}

/** Sidebar sections: shop-diverse furniture picks per category; non-furniture stays in the modal only. */
export function selectSidebarPreviewSections(products: MarketplaceProduct[]): SidebarPreviewSection[] {
  const sorted = rankCatalogProducts(products.filter(isSidebarFurnitureProduct));
  const sections: SidebarPreviewSection[] = [];

  for (const kind of SIDEBAR_FURNITURE_KINDS) {
    const limit = SIDEBAR_CATEGORY_LIMITS[kind] ?? 8;
    let candidates = sorted.filter((p) => sidebarFurnitureKind(p) === kind);

    if (kind === "table") {
      const sets = candidates.filter((p) => {
        const hay = productSearchHaystack(p);
        return TABLE_SET_RE.test(hay);
      });
      if (sets.length >= limit) {
        candidates = sets;
      } else {
        const nonSetRest = candidates.filter((p) => !sets.some((s) => s.id === p.id));
        candidates = [...sets, ...nonSetRest];
      }
    }

    const picked = pickDiverseSidebarProducts(candidates, kind, limit);
    if (picked.length > 0) {
      sections.push({ kind, products: picked });
    }
  }

  const flooringSorted = rankCatalogProducts(products.filter(isSidebarFlooringProduct));
  for (const kind of SIDEBAR_FLOORING_KINDS) {
    const limit = SIDEBAR_CATEGORY_LIMITS[kind] ?? 6;
    const candidates = flooringSorted.filter((p) => classifyProductSidebarKind(p) === kind);
    const picked = pickDiverseSidebarProducts(candidates, kind, limit);
    if (picked.length > 0) {
      sections.push({ kind, products: picked });
    }
  }

  return sections;
}

/** Flat list of all products shown in the sidebar (max {@link CATALOG_SIDEBAR_MAX}). */
export function selectSidebarPreview(products: MarketplaceProduct[]): MarketplaceProduct[] {
  return selectSidebarPreviewSections(products).flatMap((s) => s.products);
}
