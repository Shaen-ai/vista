import { test } from "node:test";
import assert from "node:assert/strict";
import { flipY } from "./floorPlanGeometry";
import { renderPlanToSvg } from "./technicalDrawings";
import type { FloorPlanAnalysis, TechnicalPlanData } from "./types";

function rectPlan(): TechnicalPlanData {
  return {
    planType: "measurement",
    title: "MEASUREMENT PLAN",
    walls: [
      { x1: 0, y1: 0, x2: 4000, y2: 0, thickness: 200, lengthMm: 4000 },
      { x1: 4000, y1: 0, x2: 4000, y2: 3000, thickness: 200, lengthMm: 3000 },
    ],
    dimensions: [{ start: [0, 0], end: [4000, 0], value: "4000", offset: 200 }],
    fixtures: [{ type: "socket", x: 2000, y: 0, symbol: "⊡" }],
  };
}

const analysis: FloorPlanAnalysis = {
  rooms: [
    {
      id: "r1",
      name: "Living",
      type: "living",
      estimatedArea: 12,
      dimensions: { width: 4000, depth: 3000, height: 2700 },
      windows: [],
      doors: [],
      features: [],
      polygon: [
        [0, 0],
        [4000, 0],
        [4000, 3000],
        [0, 3000],
      ],
    },
  ],
  wallSegments: [
    { x1: 0, y1: 0, x2: 4000, y2: 0, thickness: 200, lengthMm: 4000 },
    { x1: 4000, y1: 0, x2: 4000, y2: 3000, thickness: 200, lengthMm: 3000 },
  ],
  overallShape: "rect",
  notes: "",
  ceilingHeight: 2700,
  totalArea: 12,
};

test("renderPlanToSvg flips Y-up plan coordinates to SVG Y-down space", () => {
  const bounds = { minX: 0, minY: 0, maxX: 4000, maxY: 3000 };
  const planYBottom = 0;
  const planYTop = 3000;
  const svgYBottom = flipY(planYBottom, bounds);
  const svgYTop = flipY(planYTop, bounds);
  assert.equal(svgYBottom, 3000);
  assert.equal(svgYTop, 0);

  const svg = renderPlanToSvg(rectPlan(), analysis);
  assert.match(svg, /y1="3000"/, "bottom plan edge should map to larger SVG y");
  assert.match(svg, /y2="0"/, "top plan edge should map to smaller SVG y");
  assert.match(svg, /cy="3000"/, "fixture on plan bottom should appear at svg bottom");
});

test("renderPlanToSvg includes room labels from analysis when roomZones absent", () => {
  const svg = renderPlanToSvg(rectPlan(), analysis);
  assert.match(svg, />Living</);
});

test("renderPlanToSvg formats dimension labels in metres", () => {
  const svg = renderPlanToSvg(rectPlan(), analysis);
  assert.match(svg, />4\.00 m</);
});
