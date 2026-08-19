import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNormalizedOverlay,
  normalizeFloorPlanDetections,
  parseRoboflowDetectResponse,
} from "./floorPlanDetections";
import fixturePayload from "./fixtures/cubicasa5k-sample.detections.json";

describe("floorPlanDetections normalization", () => {
  it("uses API image.width/height, not prediction extent", () => {
    const predictions = [
      { x: 100, y: 100, width: 40, height: 40, confidence: 0.9, class: "door" as const },
    ];
    const imageW = 1000;
    const imageH = 2000;
    const normalized = normalizeFloorPlanDetections(predictions, imageW, imageH);
    assert.ok(Math.abs(normalized[0]!.left - 0.08) < 0.001);

    const wrongExtent = normalizeFloorPlanDetections(predictions, 200, 200);
    assert.notEqual(normalized[0]!.left, wrongExtent[0]!.left);
  });

  it("buildNormalizedOverlay matches fixture image size", () => {
    const overlay = buildNormalizedOverlay(
      parseRoboflowDetectResponse(fixturePayload)!,
    );
    assert.equal(overlay.length, 31);
  });
});
