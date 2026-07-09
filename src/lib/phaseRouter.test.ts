import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyProductPhase,
  classifyPinnedProductPhase,
  isDecorPhaseSkippableForStyle,
  slotDisplayLabel,
} from "./phaseRouter";
import type { CatalogItemSummary } from "./consumerCatalog";

function summary(partial: Partial<CatalogItemSummary> & Pick<CatalogItemSummary, "name">): CatalogItemSummary {
  return {
    id: partial.id ?? "mp-1",
    name: partial.name,
    category: partial.category ?? "",
    product_family: partial.product_family,
    product_subtype: partial.product_subtype,
    width_cm: partial.width_cm ?? 0,
    depth_cm: partial.depth_cm ?? 0,
    height_cm: partial.height_cm ?? 0,
    price: partial.price ?? 0,
    currency: partial.currency ?? "AMD",
  };
}

describe("phaseRouter", () => {
  it("classifies Christmas curtain lights as decor", () => {
    const phase = classifyProductPhase(
      summary({
        name: "KOOPMAN CURTAIN LIGHT 120LED WW",
        category: "LIGHTING & DECORS > Christmas decorative items",
        product_family: "window_treatments",
        product_subtype: "curtain",
      }),
    );
    assert.equal(phase, "decor");
  });

  it("classifies blankets mis-tagged as flooring tile as decor", () => {
    const phase = classifyProductPhase(
      summary({
        name: "Blanket winter RESTFUL PR19QV75V40 BW 150X210 BM LIGHT",
        category: "Furniture & Interior > Textile",
        product_family: "flooring",
        product_subtype: "tile",
      }),
    );
    assert.equal(phase, "decor");
  });

  it("keeps real ceiling lighting in base phase", () => {
    const phase = classifyProductPhase(
      summary({
        name: "Lampshade MAYTONI MOD555TL-L9CH4K",
        category: "Furniture & Interior > Lighting & decors",
        product_family: "lighting",
        product_subtype: "ceiling",
      }),
    );
    assert.equal(phase, "base");
  });

  it("classifies pinned decor products", () => {
    const phase = classifyPinnedProductPhase({
      name: "Decorative vase ceramic",
      category: "Home accessories",
      product_family: "home_accessories",
      product_subtype: "vase",
    });
    assert.equal(phase, "decor");
  });

  it("marks minimalist styles as decor-skippable", () => {
    assert.equal(isDecorPhaseSkippableForStyle("minimalist"), true);
    assert.equal(isDecorPhaseSkippableForStyle("modern"), false);
  });

  it("formats slot labels for user notices", () => {
    assert.equal(slotDisplayLabel({ family: "flooring", quantity: 1 }), "flooring");
    assert.equal(slotDisplayLabel({ family: "window_treatments", subtype: "curtain", quantity: 1 }), "curtains");
  });
});
