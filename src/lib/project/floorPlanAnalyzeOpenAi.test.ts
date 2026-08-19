import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  FLOOR_PLAN_VISION_MAX_RETRIES,
  isFloorPlanGeometryRetryEnabled,
} from "./floorPlanAnalyzer";

const analyzerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "floorPlanAnalyzer.ts");
const analyzerSource = readFileSync(analyzerPath, "utf8");

describe("analyzeFloorPlan auto-detect OpenAI billing", () => {
  it("does not call extractFloorPlanOcrLabels on the hot path", () => {
    assert.ok(!analyzerSource.includes("extractFloorPlanOcrLabels"));
    assert.ok(analyzerSource.includes("ocrLabelsFromParsedRaw"));
    assert.ok(analyzerSource.includes("printedLabels"));
  });

  it("uses zero retries and disables timeout retry on floor-plan vision", () => {
    assert.equal(FLOOR_PLAN_VISION_MAX_RETRIES, 0);
    assert.ok(analyzerSource.includes("retryOnTimeout: false"));
    assert.ok(analyzerSource.includes("openAiVisionCalls"));
  });

  it("geometry retry is env-gated only", () => {
    const prev = process.env.FLOOR_PLAN_GEOMETRY_RETRY;
    delete process.env.FLOOR_PLAN_GEOMETRY_RETRY;
    assert.equal(isFloorPlanGeometryRetryEnabled(), false);
    assert.ok(analyzerSource.includes("isFloorPlanGeometryRetryEnabled()"));
    if (prev === undefined) delete process.env.FLOOR_PLAN_GEOMETRY_RETRY;
    else process.env.FLOOR_PLAN_GEOMETRY_RETRY = prev;
  });
});
