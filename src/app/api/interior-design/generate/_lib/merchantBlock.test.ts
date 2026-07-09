import { test } from "node:test";
import assert from "node:assert/strict";

import { orderMerchantBlockIds } from "./merchantBlock";

test("orderMerchantBlockIds: collage ids first, then pins, order preserved", () => {
  assert.deepEqual(
    orderMerchantBlockIds(["mp-1", "mp-2"], ["mp-9"]),
    ["mp-1", "mp-2", "mp-9"],
  );
});

test("orderMerchantBlockIds: de-dupes a pin already included in the collage", () => {
  assert.deepEqual(
    orderMerchantBlockIds(["mp-1", "mp-2"], ["mp-2", "mp-3"]),
    ["mp-1", "mp-2", "mp-3"],
  );
});

test("orderMerchantBlockIds: de-dupes repeats within the collage list itself", () => {
  assert.deepEqual(
    orderMerchantBlockIds(["mp-5", "mp-5", "mp-6"], []),
    ["mp-5", "mp-6"],
  );
});

test("orderMerchantBlockIds: empty inputs yield empty output", () => {
  assert.deepEqual(orderMerchantBlockIds([], []), []);
});

test("orderMerchantBlockIds: pins-only when no collage ids", () => {
  assert.deepEqual(orderMerchantBlockIds([], ["mp-7", "mp-8"]), ["mp-7", "mp-8"]);
});
