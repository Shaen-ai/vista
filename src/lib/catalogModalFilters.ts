import type { MarketplaceProduct } from "@/app/store";

export type CatalogModalFilter =
  | "all"
  | "sofa"
  | "table"
  | "chair"
  | "armchair"
  | "flooring"
  | "decor"
  | "lighting"
  | "other";

export const CATALOG_MODAL_FILTERS: CatalogModalFilter[] = [
  "all",
  "sofa",
  "table",
  "chair",
  "armchair",
  "flooring",
  "decor",
  "lighting",
  "other",
];

export const MODAL_FILTER_I18N: Record<CatalogModalFilter, string> = {
  all: "page.catalogFilterAll",
  sofa: "page.catalogFilterSofas",
  table: "page.catalogFilterTables",
  chair: "page.catalogFilterChairs",
  armchair: "page.catalogFilterArmchairs",
  flooring: "page.catalogFilterFlooring",
  decor: "page.catalogFilterDecor",
  lighting: "page.catalogFilterLighting",
  other: "page.catalogFilterOther",
};

export interface ModalFilterApiParams {
  product_family?: string;
  product_subtype?: string;
  product_subtypes?: string;
  q?: string;
}

export const MODAL_FILTER_TO_API: Record<CatalogModalFilter, ModalFilterApiParams | null> = {
  all: null,
  sofa: { product_family: "furniture", product_subtype: "sofa" },
  table: { product_family: "furniture", product_subtypes: "coffee_table,dining_table,desk" },
  chair: { product_family: "furniture", product_subtype: "chair" },
  armchair: { product_family: "furniture", q: "armchair" },
  flooring: { product_family: "flooring" },
  decor: { product_family: "home_accessories" },
  lighting: { product_family: "lighting" },
  other: { product_family: "home_appliances" },
};

const ARMCHAIR_RE = /\b(armchair|recliner|accent chair|rocking chair|кресло|кресл)/i;

function productHaystack(p: MarketplaceProduct): string {
  return `${p.category ?? ""} ${p.category_en ?? ""} ${p.name} ${p.name_en ?? ""} ${p.brand ?? ""}`;
}

/**
 * Client-side post-filter for categories that can't be perfectly distinguished server-side.
 * Currently only needed for chair vs armchair split (backend taxonomy collapses both to `chair`).
 */
export function postFilterModalProducts(
  products: MarketplaceProduct[],
  filter: CatalogModalFilter,
): MarketplaceProduct[] {
  if (filter === "chair") {
    return products.filter((p) => !ARMCHAIR_RE.test(productHaystack(p)));
  }
  return products;
}
