import assert from "node:assert/strict";
import test from "node:test";
import { useConsumerDesignStore } from "@/app/store";
import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";

const sampleAnalysis: RoomAnalysis = {
  room_type: "living room",
  room_shape: "rectangular",
  estimated_dimensions: { width: 5, depth: 4, height: 2.7 },
  existing_furniture: [],
  architectural_features: [],
  lighting_sources: [],
  current_style: "modern",
  color_palette: [],
  suggestions: [],
  window_count: 1,
  door_count: 1,
  window_positions: ["left wall"],
  door_positions: ["right wall"],
  plan_door_count: 1,
  plan_door_positions: [],
  camera_angle: "",
  ceiling_type: "",
  structural_elements: [],
  has_staircase: false,
  staircase_description: null,
  has_floor_opening: false,
  floor_opening_description: null,
  confidence: {
    room_type: "high",
    dimensions: "high",
    style: "high",
    window_count: "high",
    door_count: "high",
  },
};

const sampleGeometry: RoomGeometry = {
  polygon_edges: [
    { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
    { start: { x: 5, y: 0 }, end: { x: 5, y: 4 } },
    { start: { x: 5, y: 4 }, end: { x: 0, y: 4 } },
    { start: { x: 0, y: 4 }, end: { x: 0, y: 0 } },
  ],
  openings: [],
  ceiling_height_m: 2.7,
};

test("hydrateRoomImage preserves restored analysis and geometry", () => {
  useConsumerDesignStore.getState().reset();

  const store = useConsumerDesignStore.getState();
  store.setQuickRoomAnalysis(sampleAnalysis);
  store.setLastRoomGeometry(sampleGeometry, false);

  store.hydrateRoomImage("abc123", "image/jpeg");

  const after = useConsumerDesignStore.getState();
  assert.equal(after.roomImageBase64, "abc123");
  assert.equal(after.roomImageMimeType, "image/jpeg");
  assert.deepEqual(after.quickRoomAnalysis, sampleAnalysis);
  assert.deepEqual(after.lastRoomGeometry, sampleGeometry);
  assert.equal(after.lastGeometryExtractionFailed, false);
});

test("setRoomImage clears analysis and geometry for new uploads", () => {
  useConsumerDesignStore.getState().reset();

  const store = useConsumerDesignStore.getState();
  store.setQuickRoomAnalysis(sampleAnalysis);
  store.setLastRoomGeometry(sampleGeometry, false);

  store.setRoomImage("newPhoto", "image/png");

  const after = useConsumerDesignStore.getState();
  assert.equal(after.roomImageBase64, "newPhoto");
  assert.equal(after.roomImageMimeType, "image/png");
  assert.equal(after.quickRoomAnalysis, null);
  assert.equal(after.lastRoomGeometry, null);
  assert.equal(after.quickRoomAnalyzing, false);
  assert.equal(after.quickRoomAnalyzeError, null);
});
