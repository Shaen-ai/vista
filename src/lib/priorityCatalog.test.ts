import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MarketplaceProduct } from "@/app/store";
import {
  isSidebarFurnitureProduct,
  isTableLinenProduct,
  sidebarFurnitureKind,
  selectSidebarPreviewSections,
  SIDEBAR_CATEGORY_LIMITS,
} from "./priorityCatalog";

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
    product_family: opts?.product_family ?? undefined,
    product_subtype: opts?.product_subtype ?? undefined,
    ...opts,
  };
}

describe("priorityCatalog", () => {
  describe("tablecloth exclusion", () => {
    it("excludes tablecloth from sidebar furniture", () => {
      const p = product(1, "Tablecloth VETEXUS NTF 3087 TC 140X180");
      assert.equal(isSidebarFurnitureProduct(p), false);
    });

    it("excludes table runner from sidebar furniture", () => {
      const p = product(2, "Table runner LINEN 40X150");
      assert.equal(isSidebarFurnitureProduct(p), false);
    });

    it("identifies tablecloth via isTableLinenProduct", () => {
      const p = product(3, "Tablecloth Cotton 120x160");
      assert.equal(isTableLinenProduct(p), true);
    });

    it("does not flag dining table as table linen", () => {
      const p = product(4, "Dining table OAK 160x90");
      assert.equal(isTableLinenProduct(p), false);
    });
  });

  describe("DB taxonomy preference", () => {
    it("excludes home_accessories via product_family", () => {
      const p = product(10, "Some weird product", {
        product_family: "home_accessories",
      });
      assert.equal(isSidebarFurnitureProduct(p), false);
      assert.equal(sidebarFurnitureKind(p), null);
    });

    it("classifies sofa via product_subtype even without keyword", () => {
      const p = product(11, "HOBEL LAF 220", {
        product_subtype: "sofa",
        product_family: "furniture",
      });
      assert.equal(sidebarFurnitureKind(p), "sofa");
    });

    it("classifies dining_table via product_subtype as table", () => {
      const p = product(12, "HOBEL DT-180", {
        product_subtype: "dining_table",
        product_family: "furniture",
      });
      assert.equal(sidebarFurnitureKind(p), "table");
    });

    it("classifies chair via product_subtype", () => {
      const p = product(13, "WMX-CH-81", {
        product_subtype: "chair",
        product_family: "furniture",
      });
      assert.equal(sidebarFurnitureKind(p), "chair");
    });
  });

  describe("per-category limits", () => {
    it("sofa section is capped at 10", () => {
      const sofas = Array.from({ length: 15 }, (_, i) =>
        product(100 + i, `Sofa Model ${i}`, { source_marketplace: "vega" }),
      );
      const sections = selectSidebarPreviewSections(sofas);
      const sofaSection = sections.find((s) => s.kind === "sofa");
      assert.ok(sofaSection, "sofa section should exist");
      assert.ok(
        sofaSection.products.length <= (SIDEBAR_CATEGORY_LIMITS["sofa"] ?? 10),
        `sofa section should have at most ${SIDEBAR_CATEGORY_LIMITS["sofa"]} products, got ${sofaSection.products.length}`,
      );
    });

    it("table section is capped at 5", () => {
      const tables = Array.from({ length: 12 }, (_, i) =>
        product(200 + i, `Coffee table Model ${i}`, { source_marketplace: "domus" }),
      );
      const sections = selectSidebarPreviewSections(tables);
      const tableSection = sections.find((s) => s.kind === "table");
      assert.ok(tableSection, "table section should exist");
      assert.ok(
        tableSection.products.length <= (SIDEBAR_CATEGORY_LIMITS["table"] ?? 5),
        `table section should have at most ${SIDEBAR_CATEGORY_LIMITS["table"]} products, got ${tableSection.products.length}`,
      );
    });
  });

  describe("table-set preference", () => {
    it("prefers table sets over plain tables", () => {
      const items = [
        product(300, "Dining set OAK 6-piece", { source_marketplace: "vega" }),
        product(301, "Table set BIRCH 4-piece", { source_marketplace: "domus" }),
        product(302, "Coffee table WALNUT", { source_marketplace: "vega" }),
        product(303, "Side table PINE", { source_marketplace: "domus" }),
        product(304, "Dining table MAHOGANY 200x100", { source_marketplace: "jysk" }),
        product(305, "Kitchen set TABLE+4CHAIRS", { source_marketplace: "vega" }),
      ];
      const sections = selectSidebarPreviewSections(items);
      const tableSection = sections.find((s) => s.kind === "table");
      assert.ok(tableSection, "table section should exist");
      const names = tableSection.products.map((p) => p.name);
      assert.ok(
        names.some((n) => /set/i.test(n)),
        "table section should include at least one set product",
      );
    });
  });

  describe("removed furniture fallback", () => {
    it("does not classify generic furniture category as table", () => {
      const p = product(400, "Generic item", {
        category: "Мебель",
        category_en: "Furniture",
      });
      assert.notEqual(sidebarFurnitureKind(p), "table");
    });
  });
});
