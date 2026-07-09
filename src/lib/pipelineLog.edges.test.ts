import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseMicroEdgeRuns,
  countMicroEdgeLabels,
  describePolygonEdgesForPrompt,
  detectWallNotchesFromPolygon,
} from "./pipelineLog";

describe("collapseMicroEdgeRuns", () => {
  it("merges consecutive sub-0.65m edges into one wall-notch label", () => {
    const out = collapseMicroEdgeRuns([
      { from: "C", to: "D", lenM: 1.32 },
      { from: "D", to: "E", lenM: 0.34 },
      { from: "E", to: "F", lenM: 0.56 },
      { from: "F", to: "G", lenM: 0.35 },
      { from: "G", to: "H", lenM: 3.9 },
    ]);
    assert.equal(out.length, 3);
    assert.match(out[1]!, /wall notch/);
    assert.match(out[1]!, /NOT a column/);
    assert.doesNotMatch(out[1]!, /0\.34m/);
  });
});

describe("detectWallNotchesFromPolygon", () => {
  it("detects SE notch on an 8-corner L-shaped room", () => {
    const poly: [number, number][] = [
      [0, 0],
      [5800, 0],
      [5800, 2650],
      [4480, 2650],
      [4480, 2310],
      [3920, 2310],
      [3920, 1980],
      [0, 1980],
    ];
    const notches = detectWallNotchesFromPolygon(poly);
    assert.ok(notches.length >= 1);
    assert.ok(notches[0]!.totalLenM >= 1);
  });
});

describe("describePolygonEdgesForPrompt", () => {
  it("collapses SE notch on an 8-corner L-shaped room", () => {
    // mm coords approximating 5.8×2.66m rect with SE notch (same topology as debug session)
    const poly: [number, number][] = [
      [0, 0],
      [5800, 0],
      [5800, 2650],
      [4480, 2650],
      [4480, 2310],
      [3920, 2310],
      [3920, 1980],
      [0, 1980],
    ];
    const edges = describePolygonEdgesForPrompt(poly);
    assert.match(edges, /wall notch/);
    assert.equal(countMicroEdgeLabels(edges), 0);
  });
});
