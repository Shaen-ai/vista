import type { RoomAnalysis, RoomType } from "@/lib/interiorDesignPrompts";
import { normalizeRoomTypeValue } from "@/lib/interiorDesignPrompts";

/** Minimal analysis for catalog/brief when the user picks room type manually. */
export function buildSyntheticQuickRoomAnalysis(roomType: string): RoomAnalysis {
  const normalized = normalizeRoomTypeValue(roomType);
  return {
    room_type: normalized,
    room_shape: "rectangular",
    estimated_dimensions: { width: 4, depth: 4, height: 2.7 },
    existing_furniture: [],
    architectural_features: [],
    lighting_sources: [],
    current_style: "",
    color_palette: [],
    suggestions: [],
    window_count: 0,
    door_count: 0,
    window_positions: [],
    door_positions: [],
    camera_angle: "",
    ceiling_type: "flat",
    structural_elements: [],
    has_staircase: false,
    staircase_description: null,
    has_floor_opening: false,
    floor_opening_description: null,
    confidence: {
      room_type: "high",
      dimensions: "low",
      style: "low",
      window_count: "low",
      door_count: "low",
    },
  };
}

export function resolveQuickRoomType(
  formRoomType: string | null | undefined,
  roomAnalysis: RoomAnalysis | null | undefined,
): RoomType {
  const fromForm = formRoomType?.trim();
  if (fromForm) return normalizeRoomTypeValue(fromForm);
  if (roomAnalysis?.room_type?.trim()) return normalizeRoomTypeValue(roomAnalysis.room_type);
  return "living room";
}
