import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CatalogItemSummary } from "./consumerCatalog";
import {
  buildRenderPlanProductIds,
  dedupeSingletonCatalogIds,
  geminiPlanCatalogIds,
  mergeVisionWithGeminiCatalogRefs,
} from "./placementPlan";

function row(
  id: string,
  name: string,
  opts?: Partial<CatalogItemSummary>,
): CatalogItemSummary {
  return {
    id,
    name,
    category: opts?.category ?? "Furniture",
    product_subtype: opts?.product_subtype ?? null,
    product_family: opts?.product_family ?? "furniture",
    width_cm: 100,
    depth_cm: 80,
    height_cm: 75,
    price: 1000,
    currency: "AMD",
    ...opts,
  };
}

describe("dedupeSingletonCatalogIds", () => {
  it("keeps one of two HOBEL sofa variants", () => {
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-1", row("mp-1", "Sofa HOBEL LAF corner", { product_subtype: "sofa" })],
      ["mp-2", row("mp-2", "Sofa HOBEL RAF corner", { product_subtype: "sofa" })],
      ["mp-3", row("mp-3", "Vase KOOPMAN", { product_subtype: "vase", category: "Decor" })],
    ]);
    const out = dedupeSingletonCatalogIds(
      ["mp-1", "mp-2", "mp-3"],
      catalog,
      "modern living room with HOBEL sofa",
    );
    const sofas = out.filter((id) => catalog.get(id)?.product_subtype === "sofa");
    assert.equal(sofas.length, 1);
    assert.ok(out.includes("mp-3"));
  });

  it("keeps one coffee table when two are present", () => {
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-10", row("mp-10", "Coffee table OAK A", { product_subtype: "coffee_table" })],
      ["mp-11", row("mp-11", "Coffee table OAK B", { product_subtype: "coffee_table" })],
    ]);
    const out = dedupeSingletonCatalogIds(["mp-10", "mp-11"], catalog, "living room");
    assert.equal(out.length, 1);
  });

  it("keeps both vases", () => {
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-20", row("mp-20", "Vase KOOPMAN A", { product_subtype: "vase", category: "Decor" })],
      ["mp-21", row("mp-21", "Vase KOOPMAN B", { product_subtype: "vase", category: "Decor" })],
    ]);
    const out = dedupeSingletonCatalogIds(["mp-20", "mp-21"], catalog, "decor accents");
    assert.equal(out.length, 2);
  });

  it("keeps two sofas when brief mentions two sofas", () => {
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-30", row("mp-30", "Sofa ALPHA", { product_subtype: "sofa" })],
      ["mp-31", row("mp-31", "Sofa BETA", { product_subtype: "sofa" })],
    ]);
    const out = dedupeSingletonCatalogIds(
      ["mp-30", "mp-31"],
      catalog,
      "two sofas facing each other in the room",
    );
    assert.equal(out.length, 2);
  });
});

describe("mergeVisionWithGeminiCatalogRefs", () => {
  const allowed = new Set(["mp-1", "mp-2", "mp-3", "mp-4", "mp-5", "mp-6", "mp-99"]);

  const catalog = new Map<string, CatalogItemSummary>([
    ["mp-1", row("mp-1", "Lamp A", { product_family: "lighting", product_subtype: "ceiling" })],
    ["mp-2", row("mp-2", "Sofa B")],
    ["mp-3", row("mp-3", "Table C", { product_subtype: "coffee_table" })],
    ["mp-4", row("mp-4", "Rug D", { product_family: "flooring", product_subtype: "rug" })],
    ["mp-5", row("mp-5", "Curtain E", { product_family: "window_treatments", product_subtype: "curtain" })],
    ["mp-6", row("mp-6", "Laminate OAK", { product_family: "flooring", product_subtype: "laminate", category: "Flooring" })],
    ["mp-99", row("mp-99", "Pinned")],
  ]);

  it("does not add collage SKUs that vision did not confirm", () => {
    const out = mergeVisionWithGeminiCatalogRefs({
      visionIds: ["mp-1", "mp-2"],
      collageIncludedIds: ["mp-1", "mp-2", "mp-3", "mp-4", "mp-5"],
      selectedForGemini: ["mp-1", "mp-2", "mp-3", "mp-4", "mp-5"],
      pinnedMpKeys: [],
      allowedCatalogKeys: allowed,
      catalogById: catalog,
    });
    assert.deepEqual(out, ["mp-1", "mp-2", "mp-4"]);
  });

  it("drops vision ids outside the render plan", () => {
    const out = mergeVisionWithGeminiCatalogRefs({
      visionIds: ["mp-99", "mp-1"],
      collageIncludedIds: ["mp-1", "mp-2"],
      selectedForGemini: ["mp-1", "mp-2"],
      pinnedMpKeys: [],
      allowedCatalogKeys: allowed,
      catalogById: catalog,
    });
    assert.deepEqual(out, ["mp-1"]);
  });

  it("returns pins only when vision is empty (not full render plan)", () => {
    const out = mergeVisionWithGeminiCatalogRefs({
      visionIds: [],
      collageIncludedIds: ["mp-1", "mp-2", "mp-3"],
      selectedForGemini: ["mp-1", "mp-2", "mp-3"],
      pinnedMpKeys: ["mp-99"],
      allowedCatalogKeys: allowed,
      catalogById: catalog,
    });
    assert.deepEqual(out, ["mp-99"]);
  });

  it("does not add extra collage ids when vision matched full collage", () => {
    const collage = ["mp-1", "mp-2", "mp-3"];
    const out = mergeVisionWithGeminiCatalogRefs({
      visionIds: collage,
      collageIncludedIds: collage,
      selectedForGemini: collage,
      pinnedMpKeys: [],
      allowedCatalogKeys: allowed,
      catalogById: catalog,
    });
    assert.deepEqual(out, collage);
  });

  it("auto-includes flooring from render plan when vision missed it", () => {
    const out = mergeVisionWithGeminiCatalogRefs({
      visionIds: ["mp-1"],
      collageIncludedIds: ["mp-1"],
      selectedForGemini: ["mp-1", "mp-6"],
      pinnedMpKeys: [],
      allowedCatalogKeys: allowed,
      catalogById: catalog,
    });
    assert.ok(out.includes("mp-1"));
    assert.ok(out.includes("mp-6"));
  });

  it("does not auto-include furniture from render plan when vision missed it", () => {
    const out = mergeVisionWithGeminiCatalogRefs({
      visionIds: ["mp-1"],
      collageIncludedIds: ["mp-1"],
      selectedForGemini: ["mp-1", "mp-2"],
      pinnedMpKeys: [],
      allowedCatalogKeys: allowed,
      catalogById: catalog,
    });
    assert.deepEqual(out, ["mp-1"]);
  });
});

describe("geminiPlanCatalogIds", () => {
  it("returns pins plus selectedForGemini in order", () => {
    const allowed = new Set(["mp-1", "mp-2", "mp-99"]);
    const out = geminiPlanCatalogIds({
      selectedForGemini: ["mp-1", "mp-2"],
      pinnedMpKeys: ["mp-99"],
      allowedCatalogKeys: allowed,
    });
    assert.deepEqual(out, ["mp-99", "mp-1", "mp-2"]);
  });
});

describe("buildRenderPlanProductIds", () => {
  it("lists collage + selected SKUs for product panel", () => {
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-1", row("mp-1", "Lamp A")],
      ["mp-2", row("mp-2", "Rug B")],
      ["mp-3", row("mp-3", "Sofa C")],
    ]);
    const out = buildRenderPlanProductIds({
      selectedForGemini: ["mp-1", "mp-2", "mp-3"],
      pinnedMpKeys: [],
      collageIncludedIds: ["mp-1", "mp-2"],
      allowedCatalogKeys: new Set(catalog.keys()),
      catalogById: catalog,
      fullPrompt: "living room",
    });
    assert.equal(out.length, 3);
    assert.ok(out.includes("mp-3"));
  });
});

describe("buildProductIdentifyCandidateMpKeys", () => {
  it("uses render plan only, not allowlist extras", async () => {
    const { buildProductIdentifyCandidateMpKeys } = await import("./placementPlan");
    const allowed = new Set(["mp-1", "mp-2", "mp-3", "mp-99"]);
    const out = buildProductIdentifyCandidateMpKeys({
      selectedForGemini: ["mp-1", "mp-2"],
      pinnedMpKeys: [],
      collageIncludedIds: ["mp-3"],
      allowedCatalogKeys: allowed,
    });
    assert.equal(out.length, 3);
    assert.ok(out.includes("mp-1"));
    assert.ok(out.includes("mp-2"));
    assert.ok(out.includes("mp-3"));
    assert.ok(!out.includes("mp-99"));
  });
});

describe("augmentMissingSubtypes", () => {
  it("adds a sofa from selectedForGemini when vision missed all sofas", async () => {
    const { augmentMissingSubtypes } = await import("./placementPlan");
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-sofa-1", row("mp-sofa-1", "Modern Lounge sofa", { product_subtype: "sofa" })],
      ["mp-sofa-2", row("mp-sofa-2", "Generic sofa", { product_subtype: "sofa" })],
      ["mp-vase", row("mp-vase", "Vase KOOPMAN", { product_subtype: "vase", category: "Decor" })],
    ]);
    const out = augmentMissingSubtypes({
      merged: ["mp-vase"],
      selectedForGemini: ["mp-sofa-1", "mp-sofa-2", "mp-vase"],
      catalogById: catalog,
      fullPrompt: "modern lounge living room",
    });
    const sofas = out.filter((id) => catalog.get(id)?.product_subtype === "sofa");
    assert.equal(sofas.length, 1, "should add exactly one sofa");
    assert.equal(sofas[0], "mp-sofa-1", "should pick the higher brief-match sofa");
    assert.ok(out.includes("mp-vase"), "should preserve original merged items");
  });

  it("does not add a sofa when vision already matched one", async () => {
    const { augmentMissingSubtypes } = await import("./placementPlan");
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-sofa-1", row("mp-sofa-1", "Sofa A", { product_subtype: "sofa" })],
      ["mp-sofa-2", row("mp-sofa-2", "Sofa B", { product_subtype: "sofa" })],
    ]);
    const out = augmentMissingSubtypes({
      merged: ["mp-sofa-1"],
      selectedForGemini: ["mp-sofa-1", "mp-sofa-2"],
      catalogById: catalog,
      fullPrompt: "living room",
    });
    assert.deepEqual(out, ["mp-sofa-1"], "should leave the list unchanged");
  });

  it("does not augment decor subtypes like vase or pillow", async () => {
    const { augmentMissingSubtypes } = await import("./placementPlan");
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-vase", row("mp-vase", "Vase KOOPMAN", { product_subtype: "vase", category: "Decor" })],
    ]);
    const out = augmentMissingSubtypes({
      merged: [],
      selectedForGemini: ["mp-vase"],
      catalogById: catalog,
      fullPrompt: "living room",
    });
    assert.deepEqual(out, [], "decor subtypes should not be auto-added");
  });

  it("augments an armchair inferred by name when product_subtype is null", async () => {
    const { augmentMissingSubtypes, inferSubtype } = await import("./placementPlan");
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-arm-1", row("mp-arm-1", "Armchair MILANO velvet", { product_subtype: null })],
      ["mp-sofa", row("mp-sofa", "Sofa HOBEL", { product_subtype: "sofa" })],
    ]);
    // Confirm inferSubtype now resolves the unmarked armchair correctly:
    assert.equal(inferSubtype(catalog.get("mp-arm-1")!), "armchair");

    const out = augmentMissingSubtypes({
      merged: ["mp-sofa"],
      selectedForGemini: ["mp-sofa", "mp-arm-1"],
      catalogById: catalog,
      fullPrompt: "modern living room with armchair",
    });
    assert.ok(out.includes("mp-arm-1"), "armchair should be added by the fallback");
  });

  it("augments multiple missing subtypes in one pass", async () => {
    const { augmentMissingSubtypes } = await import("./placementPlan");
    const catalog = new Map<string, CatalogItemSummary>([
      ["mp-sofa", row("mp-sofa", "Sofa A", { product_subtype: "sofa" })],
      ["mp-ct", row("mp-ct", "Coffee table OAK", { product_subtype: "coffee_table" })],
      ["mp-vase", row("mp-vase", "Vase KOOPMAN", { product_subtype: "vase", category: "Decor" })],
    ]);
    const out = augmentMissingSubtypes({
      merged: ["mp-vase"],
      selectedForGemini: ["mp-sofa", "mp-ct", "mp-vase"],
      catalogById: catalog,
      fullPrompt: "living room",
    });
    assert.ok(out.includes("mp-sofa"));
    assert.ok(out.includes("mp-ct"));
    assert.ok(out.includes("mp-vase"));
    assert.equal(out.length, 3);
  });
});
