import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateMegapixels,
  estimateRoomGenerationUsd,
  estimateStagingUsd,
  estimateProjectStagingUsd,
  isLayeredStagingCostEstimateEnabled,
} from "./stagingCostMath";
import { maxStagingAttemptsPerRoom } from "./projectStagingCost";

test("estimateMegapixels from width and height", () => {
  assert.ok(Math.abs(estimateMegapixels(2000, 1000) - 2) < 0.01);
});

test("estimateStagingUsd scales with megapixels", () => {
  const usd = estimateStagingUsd(2, "staging");
  assert.ok(usd > 0.03 && usd < 0.05);
});

test("estimateRoomGenerationUsd includes prep when flagged", () => {
  const withPrep = estimateRoomGenerationUsd({ photoCount: 2, needsPrep: true, megapixelsPerPhoto: 2 });
  const noPrep = estimateRoomGenerationUsd({ photoCount: 2, needsPrep: false, megapixelsPerPhoto: 2 });
  assert.ok(withPrep > noPrep);
});

test("estimateRoomGenerationUsd doubles staging when layered", () => {
  const single = estimateRoomGenerationUsd({ photoCount: 1, needsPrep: false, megapixelsPerPhoto: 2 });
  const layered = estimateRoomGenerationUsd({
    photoCount: 1,
    needsPrep: false,
    megapixelsPerPhoto: 2,
    layeredStaging: true,
  });
  assert.ok(Math.abs(layered - single * 2) < 0.01);
});

test("maxStagingAttemptsPerRoom defaults to 5", () => {
  delete process.env.VISTA_MAX_STAGING_ATTEMPTS_PER_ROOM;
  assert.equal(maxStagingAttemptsPerRoom(), 5);
});

test("estimateProjectStagingUsd sums staging and prep", () => {
  const total = estimateProjectStagingUsd({
    roomCount: 5,
    photoCount: 5,
    prepRoomCount: 2,
  });
  assert.ok(total > 0.25 && total < 0.35);
});

test("isLayeredStagingCostEstimateEnabled follows render model env", () => {
  delete process.env.VISTA_STAGING_LAYERED;
  delete process.env.NEXT_PUBLIC_VISTA_STAGING_LAYERED;
  delete process.env.VISTA_PROJECT_RENDER_MODEL;
  delete process.env.NEXT_PUBLIC_VISTA_PROJECT_RENDER_MODEL;
  assert.equal(isLayeredStagingCostEstimateEnabled(), false);

  process.env.NEXT_PUBLIC_VISTA_PROJECT_RENDER_MODEL = "apartment-staging";
  assert.equal(isLayeredStagingCostEstimateEnabled(), true);
  delete process.env.NEXT_PUBLIC_VISTA_PROJECT_RENDER_MODEL;

  process.env.VISTA_STAGING_LAYERED = "0";
  process.env.NEXT_PUBLIC_VISTA_PROJECT_RENDER_MODEL = "apartment-staging";
  assert.equal(isLayeredStagingCostEstimateEnabled(), false);
  delete process.env.VISTA_STAGING_LAYERED;
  delete process.env.NEXT_PUBLIC_VISTA_PROJECT_RENDER_MODEL;
});
