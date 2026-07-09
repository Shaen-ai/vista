import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedCatalogSlot } from "./resolveCatalogSlots";
import { vectorConfirmedCatalogIds } from "./resolveCatalogSlots";

function slot(productIds: number[], topScore: number): ResolvedCatalogSlot {
  return {
    slot: "furniture/sofa",
    family: "furniture",
    subtype: "sofa",
    quantity: 1,
    product_ids: productIds,
    scores: productIds.map(() => topScore),
    fallback_stage: null,
    top_score: topScore,
  };
}

describe("vectorConfirmedCatalogIds", () => {
  it("includes only slots that passed rerank", () => {
    const ids = vectorConfirmedCatalogIds({
      pinnedProductIds: [],
      slots: [
        slot([101], 0.56),
        { ...slot([999], 0), product_ids: [], top_score: 0 },
      ],
    });
    assert.deepEqual(ids, [101]);
  });

  it("merges pins with confirmed slot ids", () => {
    const ids = vectorConfirmedCatalogIds({
      pinnedProductIds: [42],
      slots: [slot([101], 0.5)],
    });
    assert.deepEqual(ids, [42, 101]);
  });
});
