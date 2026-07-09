import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGas } from "./approvedRoomPlanBuilder";
import { renderPlanToSvg } from "./technicalDrawings";
import type { FurniturePlacement, TechnicalPlanData, UtilityEntryPoint } from "./types";

const kitchenPolygon: [number, number][] = [
  [0, 0],
  [3000, 0],
  [3000, 3000],
  [0, 3000],
];

const kitchenLayout = {
  roomId: "r1",
  label: "Kitchen",
  roomType: "kitchen" as const,
  polygon: kitchenPolygon,
  center: [1500, 1500] as [number, number],
  floorMaterial: "tile",
  furnitureList: ["cooktop", "fridge"],
};

function makeInlet(x = 100, y = 100): UtilityEntryPoint {
  return { id: "u1", type: "gas_inlet", x, y, label: "Gas inlet" };
}

function makeCooktop(x = 2000, y = 1500): FurniturePlacement {
  return { type: "cooktop", label: "Cooktop", x, y, width: 600, depth: 600, rotation: 0 };
}

test("buildGas returns empty when no gas_inlet", () => {
  const result = buildGas([], [kitchenLayout], [makeCooktop()]);
  assert.equal(result.fixtures.length, 0);
  assert.equal(result.pipes.length, 0);
});

test("buildGas routes pipe from inlet to cooktop", () => {
  const result = buildGas([makeInlet()], [kitchenLayout], [makeCooktop()]);
  assert.equal(result.fixtures.length, 2);
  assert.equal(result.fixtures[0]!.type, "gas_meter");
  assert.equal(result.fixtures[1]!.type, "gas_appliance");
  assert.equal(result.pipes.length, 1);
  assert.equal(result.pipes[0]!.type, "gas");
  assert.equal(result.pipes[0]!.points.length, 3);
});

test("buildGas falls back to kitchen center when no appliance furniture", () => {
  const result = buildGas([makeInlet()], [kitchenLayout], []);
  assert.equal(result.fixtures.length, 2);
  assert.equal(result.pipes.length, 1);
  assert.deepEqual(result.pipes[0]!.points[2], [1500, 1500]);
});

test("gas SVG renders pipes with yellow stroke", () => {
  const gas = buildGas([makeInlet()], [kitchenLayout], [makeCooktop()]);
  const plan: TechnicalPlanData = {
    planType: "gas",
    title: "GAS PLAN",
    walls: [{ x1: 0, y1: 0, x2: 3000, y2: 0, thickness: 200, lengthMm: 3000 }],
    pipes: gas.pipes,
    plumbingFixtures: gas.fixtures,
  };
  const svg = renderPlanToSvg(plan, null);
  assert.match(svg, /stroke="#eab308"/, "gas pipe should use yellow stroke");
  assert.match(svg, /stroke-dasharray="18,8"/, "gas pipe should use dashed stroke");
});
