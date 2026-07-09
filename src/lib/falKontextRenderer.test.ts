import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKontextImageUrls } from "./falStyleReferenceUtils";
import {
  maxFalRecoveryCalls,
  shouldSkipFurnishRetry,
  shouldUseStage2bOnlyInpaintRecovery,
  isFalRecoveryBudgetExceeded,
  fallbackInpaintUseCanny,
} from "./falKontextRecoveryUtils";

test("buildKontextImageUrls primary order: room photo, style refs, products — no schematic", () => {
  const urls = buildKontextImageUrls({
    baseUrl: "https://fal.ai/hero-room.png",
    styleReferenceUrls: ["https://fal.ai/style1.png", "https://fal.ai/style2.png"],
    productImageUrls: ["https://fal.ai/product.png"],
  });
  assert.deepEqual(urls, [
    "https://fal.ai/hero-room.png",
    "https://fal.ai/style1.png",
    "https://fal.ai/style2.png",
    "https://fal.ai/product.png",
  ]);
  assert.equal(urls.includes("https://fal.ai/schematic.png"), false);
});

test("buildKontextImageUrls two-image furnish pass: hero + style only", () => {
  const urls = buildKontextImageUrls({
    baseUrl: "https://fal.ai/hero-room.png",
    styleReferenceUrls: ["https://fal.ai/style.png"],
  });
  assert.deepEqual(urls, [
    "https://fal.ai/hero-room.png",
    "https://fal.ai/style.png",
  ]);
});

test("buildKontextImageUrls retry uses partial output at index 0, keeps style at index 1", () => {
  const primary = buildKontextImageUrls({
    baseUrl: "https://fal.ai/hero-room.png",
    styleReferenceUrls: ["https://fal.ai/style.png"],
  });
  const retry = buildKontextImageUrls({
    baseUrl: "https://fal.ai/hero-room.png",
    styleReferenceUrls: ["https://fal.ai/style.png"],
    retryPrimaryUrl: "https://fal.ai/kontext-output.png",
  });
  assert.equal(retry[0], "https://fal.ai/kontext-output.png");
  assert.deepEqual(retry.slice(1), primary.slice(1));
  assert.equal(retry.length, primary.length);
});

test("shouldUseStage2bOnlyInpaintRecovery when cached inpaint base exists", () => {
  assert.equal(shouldUseStage2bOnlyInpaintRecovery(undefined), false);
  assert.equal(shouldUseStage2bOnlyInpaintRecovery({ base64: "", mimeType: "image/png" }), false);
  assert.equal(
    shouldUseStage2bOnlyInpaintRecovery({ base64: "abc123", mimeType: "image/png" }),
    true,
  );
});

test("shouldSkipFurnishRetry on match or near-complete major furniture", () => {
  assert.equal(
    shouldSkipFurnishRetry({
      match: true,
      confirmedCount: 3,
      missing: [],
      retryEligibleCount: 3,
    }),
    true,
  );
  assert.equal(
    shouldSkipFurnishRetry({
      match: false,
      confirmedCount: 2,
      missing: ["bunk bed"],
      retryEligibleCount: 3,
    }),
    true,
  );
  assert.equal(
    shouldSkipFurnishRetry({
      match: false,
      confirmedCount: 1,
      missing: ["velvet area rug"],
      retryEligibleCount: 3,
    }),
    true,
  );
  assert.equal(
    shouldSkipFurnishRetry({
      match: false,
      confirmedCount: 0,
      missing: ["bunk bed", "wardrobe"],
      retryEligibleCount: 3,
    }),
    false,
  );
});

test("isFalRecoveryBudgetExceeded at default max", () => {
  const max = maxFalRecoveryCalls();
  assert.equal(isFalRecoveryBudgetExceeded(max - 1, max), false);
  assert.equal(isFalRecoveryBudgetExceeded(max, max), true);
});

test("fallbackInpaintUseCanny defaults on unless VISTA_FAL_INPAINT_USE_CANNY=0", () => {
  const prev = process.env.VISTA_FAL_INPAINT_USE_CANNY;
  delete process.env.VISTA_FAL_INPAINT_USE_CANNY;
  try {
    assert.equal(fallbackInpaintUseCanny(), true);
    process.env.VISTA_FAL_INPAINT_USE_CANNY = "0";
    assert.equal(fallbackInpaintUseCanny(), false);
  } finally {
    if (prev === undefined) delete process.env.VISTA_FAL_INPAINT_USE_CANNY;
    else process.env.VISTA_FAL_INPAINT_USE_CANNY = prev;
  }
});

test("buildKontextImageUrls room-only retry uses single room url", () => {
  const urls = buildKontextImageUrls({
    baseUrl: "https://fal.ai/hero-room.png",
  });
  assert.deepEqual(urls, ["https://fal.ai/hero-room.png"]);
});
