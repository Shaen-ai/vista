/** Shared types for room geometry JSON (safe to import from client code). */

export type RoomShape = "rectangle" | "L-shape" | "U-shape" | "irregular";
export type CardDirection = "north" | "south" | "east" | "west";
export type GeometryConfidence = "high" | "medium" | "low";
export type FixedElementType =
  | "column"
  | "beam"
  | "radiator"
  | "fireplace"
  | "staircase"
  /** Stairwell / services hole in the slab — must not be infilled by generated flooring or rugs */
  | "floor_opening";

export interface RoomWall {
  id: string;
  position: CardDirection;
  approx_length_m: number;
}

export interface RoomDoor {
  wall_id: string;
  approx_offset_from_left_m: number;
  width_m: number;
}

export interface RoomWindow {
  wall_id: string;
  approx_offset_from_left_m: number;
  width_m: number;
  height_m: number;
}

export interface FixedElement {
  type: FixedElementType;
  description: string;
}

/** Per-edge floor-plan dimension for non-rectangular rooms (labels like A-B, B-C). */
export interface RoomPolygonEdge {
  label: string;
  length_m: number;
}

export interface RoomGeometry {
  room_shape: RoomShape;
  approximate_dimensions: {
    longest_wall_m: number;
    shortest_wall_m: number;
  } | null;
  walls: RoomWall[];
  doors: RoomDoor[];
  windows: RoomWindow[];
  fixed_elements: FixedElement[];
  ceiling_height_m: number | null;
  confidence: GeometryConfidence;
  /** Per-edge lengths for L-shape / U-shape rooms (clockwise from corner A). */
  polygon_edges?: RoomPolygonEdge[];
}
