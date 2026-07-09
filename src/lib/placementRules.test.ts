import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boxIoU,
  doorOverlapFraction,
  evaluatePlacementRules,
  type PlacementFurnitureBox,
} from "./placementRules";

function item(
  label: string,
  box: { x: number; y: number; w: number; h: number },
  category: PlacementFurnitureBox["category"],
  floorContact = true,
): PlacementFurnitureBox {
  return { label, box, category, floorContact };
}

describe("boxIoU", () => {
  it("returns 0 for non-overlapping boxes", () => {
    assert.equal(boxIoU({ x: 0, y: 0, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }), 0);
  });

  it("returns positive overlap for intersecting boxes", () => {
    const iou = boxIoU({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
    assert.ok(iou > 0.1);
  });
});

describe("doorOverlapFraction", () => {
  it("detects wardrobe blocking half the door width", () => {
    const frac = doorOverlapFraction(
      { x: 0.05, y: 0.2, w: 0.25, h: 0.6 },
      { x: 0, y: 0.15, w: 0.2, h: 0.5 },
    );
    assert.ok(frac >= 0.5);
  });
});

describe("evaluatePlacementRules", () => {
  it("flags wardrobe blocking a door", () => {
    const result = evaluatePlacementRules({
      items: [item("wardrobe", { x: 0.02, y: 0.25, w: 0.22, h: 0.55 }, "wardrobe")],
      doorBoxes: [{ x: 0, y: 0.2, w: 0.18, h: 0.45 }],
    });
    assert.equal(result.pass, false);
    assert.ok(result.violations.some((v) => v.type === "blocked_door"));
    assert.match(result.correctiveFeedback, /wardrobe/i);
  });

  it("flags overlapping table and chair", () => {
    const result = evaluatePlacementRules({
      items: [
        item("desk", { x: 0.4, y: 0.5, w: 0.25, h: 0.2 }, "desk"),
        item("chair", { x: 0.42, y: 0.52, w: 0.2, h: 0.18 }, "chair"),
      ],
    });
    assert.equal(result.pass, false);
    assert.ok(result.violations.some((v) => v.type === "object_overlap"));
  });

  it("flags floating mirror", () => {
    const result = evaluatePlacementRules({
      items: [item("mirror", { x: 0.7, y: 0.15, w: 0.08, h: 0.35 }, "mirror", false)],
    });
    assert.equal(result.pass, false);
    assert.ok(result.violations.some((v) => v.type === "floating_object"));
  });

  it("flags desk clipped into window", () => {
    const result = evaluatePlacementRules({
      items: [item("desk", { x: 0.58, y: 0.12, w: 0.28, h: 0.28 }, "desk")],
      windowBoxes: [{ x: 0.6, y: 0.1, w: 0.25, h: 0.35 }],
    });
    assert.equal(result.pass, false);
    assert.ok(result.violations.some((v) => v.type === "wall_clip"));
  });

  it("passes well-separated layout", () => {
    const result = evaluatePlacementRules({
      items: [
        item("bed", { x: 0.55, y: 0.35, w: 0.35, h: 0.4 }, "bed"),
        item("wardrobe", { x: 0.15, y: 0.2, w: 0.18, h: 0.55 }, "wardrobe"),
        item("desk", { x: 0.25, y: 0.55, w: 0.2, h: 0.15 }, "desk"),
      ],
      doorBoxes: [{ x: 0, y: 0.2, w: 0.08, h: 0.45 }],
      windowBoxes: [{ x: 0.75, y: 0.05, w: 0.18, h: 0.25 }],
    });
    assert.equal(result.pass, true);
    assert.equal(result.violations.length, 0);
  });
});
