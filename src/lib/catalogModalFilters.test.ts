import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MarketplaceProduct } from "@/app/store";
import {
  MODAL_FILTER_TO_API,
  postFilterModalProducts,
} from "./catalogModalFilters";

function product(
  id: number,
  name: string,
  opts?: Partial<MarketplaceProduct>,
): MarketplaceProduct {
  return {
    id,
    source_marketplace: opts?.source_marketplace ?? "vega",
    external_url: `https://example.com/${id}`,
    name,
    name_en: opts?.name_en ?? name,
    price: opts?.price ?? 1000,
    currency: opts?.currency ?? "AMD",
    main_image_url: null,
    images: null,
    width_cm: null,
    depth_cm: null,
    height_cm: null,
    has_dimensions: false,
    category: opts?.category ?? null,
    category_en: opts?.category_en ?? null,
    brand: opts?.brand ?? null,
    priority: opts?.priority ?? null,
    ...opts,
  };
}

describe("MODAL_FILTER_TO_API", () => {
  it("table filter includes coffee_table, dining_table, and desk subtypes", () => {
    const tableFilter = MODAL_FILTER_TO_API.table;
    assert.ok(tableFilter);
    assert.strictEqual(tableFilter.product_family, "furniture");
    assert.ok(tableFilter.product_subtypes);
    assert.ok(tableFilter.product_subtypes.includes("coffee_table"));
    assert.ok(tableFilter.product_subtypes.includes("dining_table"));
    assert.ok(tableFilter.product_subtypes.includes("desk"));
  });

  it("armchair filter uses q=armchair instead of product_subtype", () => {
    const armchairFilter = MODAL_FILTER_TO_API.armchair;
    assert.ok(armchairFilter);
    assert.strictEqual(armchairFilter.q, "armchair");
    assert.strictEqual(armchairFilter.product_family, "furniture");
    assert.strictEqual(armchairFilter.product_subtype, undefined);
  });

  it("sofa filter uses product_subtype=sofa", () => {
    const sofaFilter = MODAL_FILTER_TO_API.sofa;
    assert.ok(sofaFilter);
    assert.strictEqual(sofaFilter.product_subtype, "sofa");
    assert.strictEqual(sofaFilter.product_family, "furniture");
  });
});

describe("postFilterModalProducts", () => {
  it("chair filter excludes armchairs", () => {
    const products = [
      product(1, "Dining Chair Oak"),
      product(2, "Armchair Velvet"),
      product(3, "Bar Stool"),
      product(4, "Recliner Leather"),
    ];
    const result = postFilterModalProducts(products, "chair");
    assert.strictEqual(result.length, 2);
    assert.ok(result.some((p) => p.name === "Dining Chair Oak"));
    assert.ok(result.some((p) => p.name === "Bar Stool"));
  });

  it("chair filter excludes armchairs detected by category_en", () => {
    const products = [
      product(1, "HOBEL XY", { category_en: "Armchair" }),
      product(2, "Regular Chair"),
    ];
    const result = postFilterModalProducts(products, "chair");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, "Regular Chair");
  });

  it("armchair filter does not further filter (server handles via q)", () => {
    const products = [
      product(1, "Armchair Velvet"),
      product(2, "Recliner Leather"),
      product(3, "Some Chair"),
    ];
    const result = postFilterModalProducts(products, "armchair");
    assert.strictEqual(result.length, 3);
  });

  it("other filters pass through unchanged", () => {
    const products = [
      product(1, "Sofa A"),
      product(2, "Table B"),
    ];
    assert.strictEqual(postFilterModalProducts(products, "all").length, 2);
    assert.strictEqual(postFilterModalProducts(products, "sofa").length, 2);
    assert.strictEqual(postFilterModalProducts(products, "table").length, 2);
  });
});
