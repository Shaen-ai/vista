import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  excludeSlotsCoveredByUploads,
  getMadeModeRoomSlots,
  getRoomSlotTemplate,
  mergeRoomSlots,
} from "./roomSlotTemplates";
import { filterSlotsForRoomType } from "./resolveCatalogSlots";

describe("getRoomSlotTemplate", () => {
  it("returns living room kit with sofa and coffee table", () => {
    const slots = getRoomSlotTemplate("Living Room");
    const subtypes = slots.map((s) => s.subtype).filter(Boolean);
    assert.ok(subtypes.includes("sofa"));
    assert.ok(subtypes.includes("coffee_table"));
    assert.ok(subtypes.includes("tv_stand"));
    assert.equal(slots.length, 8);
  });

  it("living room flooring slot has no hardcoded subtype", () => {
    const slots = getRoomSlotTemplate("Living Room");
    const flooring = slots.find((s) => s.family === "flooring");
    assert.ok(flooring);
    assert.equal(flooring!.subtype, undefined);
  });

  it("normalizes free-form room type", () => {
    const slots = getRoomSlotTemplate("master bedroom");
    assert.ok(slots.some((s) => s.subtype === "bed"));
    assert.ok(slots.some((s) => s.subtype === "wardrobe"));
  });
});

describe("getMadeModeRoomSlots", () => {
  const ROOM_TYPES = [
    "living room", "bedroom", "kitchen", "bathroom", "dining room",
    "home office", "children's room", "hallway", "outdoor patio", "studio apartment",
  ];

  it("every room type: flooring always first and at most 4 slots", () => {
    for (const room of ROOM_TYPES) {
      const slots = getMadeModeRoomSlots(room, 2);
      assert.ok(slots.length >= 1 && slots.length <= 4, `${room} should have 1-4 slots`);
      assert.equal(slots[0]?.family, "flooring", `${room} first slot must be flooring`);
      // Exactly one flooring slot (flooring is the always-present anchor).
      assert.equal(slots.filter((s) => s.family === "flooring").length, 1, `${room} one flooring slot`);
    }
  });

  it("never emits lighting or home_accessories slots (no lampshades / picture frames)", () => {
    for (const room of ROOM_TYPES) {
      const slots = getMadeModeRoomSlots(room, 2);
      assert.ok(!slots.some((s) => s.family === "lighting"), `${room} has no lighting slot`);
      assert.ok(!slots.some((s) => s.family === "home_accessories"), `${room} has no accessory slot`);
    }
  });

  it("living room includes flooring, sofa, coffee_table, and curtain when windows present", () => {
    const slots = getMadeModeRoomSlots("living room", 2);
    const families = slots.map((s) => `${s.family}/${s.subtype ?? ""}`);
    assert.deepEqual(families, [
      "flooring/",
      "furniture/sofa",
      "furniture/coffee_table",
      "window_treatments/curtain",
    ]);
  });

  it("studio apartment uses living-like kit", () => {
    const slots = getMadeModeRoomSlots("studio apartment", 1);
    assert.ok(slots.some((s) => s.subtype === "sofa"));
    assert.ok(slots.some((s) => s.subtype === "coffee_table"));
  });

  it("bedroom includes real bed and wardrobe", () => {
    const slots = getMadeModeRoomSlots("bedroom", 2);
    const families = slots.map((s) => `${s.family}/${s.subtype ?? ""}`);
    assert.deepEqual(families, [
      "flooring/",
      "furniture/bed",
      "furniture/wardrobe",
      "window_treatments/curtain",
    ]);
  });

  it("children's room includes bed and wardrobe", () => {
    const slots = getMadeModeRoomSlots("children's room", 2);
    assert.ok(slots.some((s) => s.subtype === "bed"));
    assert.ok(slots.some((s) => s.subtype === "wardrobe"));
  });

  it("dining room includes a dining table and chair", () => {
    const slots = getMadeModeRoomSlots("dining room", 2);
    assert.ok(slots.some((s) => s.subtype === "dining_table"));
    assert.ok(slots.some((s) => s.subtype === "chair"));
  });

  it("kitchen uses tile flooring plus table and chair", () => {
    const slots = getMadeModeRoomSlots("kitchen", 2);
    const flooring = slots.find((s) => s.family === "flooring");
    assert.equal(flooring?.subtype, "tile");
    assert.ok(slots.some((s) => s.subtype === "table"));
    assert.ok(slots.some((s) => s.subtype === "chair"));
  });

  it("home office includes a desk and chair", () => {
    const slots = getMadeModeRoomSlots("home office", 2);
    assert.ok(slots.some((s) => s.subtype === "desk"));
    assert.ok(slots.some((s) => s.subtype === "chair"));
  });

  it("hallway and bathroom are flooring only", () => {
    for (const room of ["hallway", "bathroom"]) {
      const slots = getMadeModeRoomSlots(room, 2);
      assert.equal(slots.length, 1);
      assert.equal(slots[0]?.family, "flooring");
    }
    assert.equal(getMadeModeRoomSlots("bathroom", 2)[0]?.subtype, "tile");
  });

  it("omits curtain when window count is zero", () => {
    const slots = getMadeModeRoomSlots("living room", 0);
    assert.ok(!slots.some((s) => s.family === "window_treatments"));
    assert.equal(slots.length, 3);
  });
});

describe("mergeRoomSlots", () => {
  it("keeps template slots when extras duplicate family+subtype", () => {
    const template = getRoomSlotTemplate("living room");
    const merged = mergeRoomSlots({
      template,
      extras: [{ family: "furniture", subtype: "sofa", quantity: 2 }],
    });
    const sofa = merged.find((s) => s.subtype === "sofa");
    assert.equal(sofa?.quantity, 1);
  });

  it("adds extras not in template with normalized subtype", () => {
    const template = getRoomSlotTemplate("living room");
    const merged = mergeRoomSlots({
      template,
      extras: [{ family: "furniture", subtype: "armchair", quantity: 1 }],
    });
    assert.ok(merged.some((s) => s.subtype === "chair"));
    assert.ok(merged.some((s) => s.subtype === "sofa"));
  });

  it("dedupes coffee table alias with coffee_table template slot", () => {
    const template = getRoomSlotTemplate("living room");
    const merged = mergeRoomSlots({
      template,
      extras: [{ family: "furniture", subtype: "coffee table", quantity: 1 }],
    });
    const coffeeTables = merged.filter((s) => s.subtype === "coffee_table");
    assert.equal(coffeeTables.length, 1);
  });

  it("extras flooring replaces template flooring (one slot only)", () => {
    const template = getRoomSlotTemplate("living room");
    const merged = mergeRoomSlots({
      template,
      extras: [{ family: "flooring", subtype: "parquet", quantity: 1 }],
    });
    const floorings = merged.filter((s) => s.family === "flooring");
    assert.equal(floorings.length, 1);
    assert.equal(floorings[0]!.subtype, "parquet");
  });

  it("extras flooring without subtype replaces template flooring", () => {
    const template = getRoomSlotTemplate("kitchen");
    const merged = mergeRoomSlots({
      template,
      extras: [{ family: "flooring", quantity: 1 }],
    });
    const floorings = merged.filter((s) => s.family === "flooring");
    assert.equal(floorings.length, 1);
    assert.equal(floorings[0]!.subtype, undefined);
  });
});

describe("excludeSlotsCoveredByUploads", () => {
  it("returns slots unchanged when there are no uploads", () => {
    const template = getRoomSlotTemplate("living room");
    assert.deepEqual(excludeSlotsCoveredByUploads(template, []), template);
  });

  it("drops the slot matching an uploaded product's family+subtype", () => {
    const template = getRoomSlotTemplate("living room");
    const filtered = excludeSlotsCoveredByUploads(template, [
      { family: "furniture", subtype: "sofa", quantity: 1 },
    ]);
    assert.ok(!filtered.some((s) => s.subtype === "sofa"));
    assert.ok(filtered.some((s) => s.subtype === "coffee_table"));
  });

  it("normalizes upload subtype aliases before matching", () => {
    const template = getRoomSlotTemplate("living room");
    const filtered = excludeSlotsCoveredByUploads(template, [
      { family: "furniture", subtype: "coffee table", quantity: 1 },
    ]);
    assert.ok(!filtered.some((s) => s.subtype === "coffee_table"));
  });

  it("a flooring upload clears every flooring slot", () => {
    const template = getRoomSlotTemplate("kitchen");
    const filtered = excludeSlotsCoveredByUploads(template, [
      { family: "flooring", subtype: "parquet", quantity: 1 },
    ]);
    assert.ok(!filtered.some((s) => s.family === "flooring"));
  });

  it("a subtyped upload covers a generic slot of the same family", () => {
    const template = getRoomSlotTemplate("bedroom");
    const filtered = excludeSlotsCoveredByUploads(template, [
      { family: "lighting", subtype: "chandelier", quantity: 1 },
    ]);
    assert.ok(!filtered.some((s) => s.family === "lighting"));
  });

  it("does not wipe subtyped slots on a subtype-less upload of the same family", () => {
    const template = getRoomSlotTemplate("living room");
    const filtered = excludeSlotsCoveredByUploads(template, [
      { family: "furniture", quantity: 1 },
    ]);
    assert.ok(filtered.some((s) => s.subtype === "sofa"));
    assert.ok(filtered.some((s) => s.subtype === "coffee_table"));
  });
});

describe("filterSlotsForRoomType", () => {
  it("drops bedroom subtypes for living room", () => {
    const slots = [
      { family: "furniture", subtype: "sofa", quantity: 1 },
      { family: "furniture", subtype: "duvet", quantity: 1 },
      { family: "furniture", subtype: "bedroom_set", quantity: 1 },
    ];
    const filtered = filterSlotsForRoomType(slots, "living room");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.subtype, "sofa");
  });
});
