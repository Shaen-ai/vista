import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRoboflowDetectPayload } from "./floorPlanDetections";
import { resolveRoboflowServerlessModelPath } from "./roboflowFloorPlanDetect";

describe("resolveRoboflowServerlessModelPath", () => {
  it("strips workspace prefix from workspace/project", () => {
    assert.equal(
      resolveRoboflowServerlessModelPath("floorplan-recognition/cubicasa5k-2-qpmsa", "6"),
      "cubicasa5k-2-qpmsa/6",
    );
  });

  it("uses project/version when version segment is numeric", () => {
    assert.equal(
      resolveRoboflowServerlessModelPath("cubicasa5k-2-qpmsa/6"),
      "cubicasa5k-2-qpmsa/6",
    );
  });

  it("appends version for bare project id", () => {
    assert.equal(resolveRoboflowServerlessModelPath("cubicasa5k-2-qpmsa", "3"), "cubicasa5k-2-qpmsa/3");
  });

  it("uses last two segments when workspace/project/version is passed", () => {
    assert.equal(
      resolveRoboflowServerlessModelPath("floorplan-recognition/cubicasa5k-2-qpmsa/6"),
      "cubicasa5k-2-qpmsa/6",
    );
  });

  it("defaults match CubiCasa Universe serverless path", () => {
    assert.equal(resolveRoboflowServerlessModelPath(), "cubicasa5k-2-qpmsa/6");
  });
});

describe("parseRoboflowDetectPayload serverless shapes", () => {
  it("accepts standard image + predictions", () => {
    const payload = parseRoboflowDetectPayload({
      image: { width: 100, height: 200 },
      predictions: [
        { x: 10, y: 20, width: 5, height: 8, confidence: 0.9, class: "wall" },
      ],
    });
    assert.ok(payload);
    assert.equal(payload!.predictions.length, 1);
  });
});
