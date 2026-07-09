/**
 * Adapt a floor-plan `DetectedRoom` (and optional photo-derived structural facts)
 * into the `RoomAnalysis` shape consumed by `buildOpeningStructuralLock`.
 *
 * This is what lets the Full Project phased generator emit the SAME hardened
 * opening lock that Quick Room gets — previously the orchestrator passed
 * `roomAnalysis: null`, so the lock never fired even for photo+viewpoint rooms.
 */

import type { OpeningBox, RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { CompassWallMap } from "@/lib/windowWallPlacement";
import { isPlanSpeculativeColumnFeature } from "@/lib/structuralGeometryLock";
import type { DetectedRoom, PlanColumn } from "./types";

const WALL_LABEL: Record<"back" | "left" | "right" | "front", string> = {
  back: "back wall",
  left: "left wall",
  right: "right wall",
  front: "front wall",
};

/**
 * Rewrite a compass-named opening label ("south wall left") into a camera-relative
 * one ("right wall, south wall left") when the camera is known, so the downstream
 * wall-placement lock (which only understands back/left/right/front) can parse it.
 * Without a map the original is returned unchanged — Part B visual markers carry
 * placement in that case rather than asserting a possibly-wrong wall.
 */
function toCameraRelativeLabel(position: string, map: CompassWallMap | undefined): string {
  if (!map) return position;
  const compass = position.toLowerCase().match(/\b(north|south|east|west)\b/)?.[1] as
    | keyof CompassWallMap
    | undefined;
  const camera = compass ? map[compass] : undefined;
  if (!camera) return position;
  return `${WALL_LABEL[camera]}, ${position}`;
}

const FLOOR_OPENING_RE = /floor[ -]?opening|stairwell|slab (?:void|cutout)|hole in (?:the )?floor|void/i;
const STAIRCASE_RE = /stair/i;

export interface DetectedRoomLockOptions {
  /** Camera description from the marked viewpoint (e.g. framing.note). */
  cameraAngle?: string;
  /**
   * Overrides for opening data that came from a real photo analysis. When set
   * these take precedence (photo is ground truth for counts/positions); the
   * floor-plan room still supplies shape/dimensions/features.
   */
  photoWindowCount?: number;
  photoWindowPositions?: string[];
  photoDoorCount?: number;
  photoDoorPositions?: string[];
  /**
   * Normalized photo bounding boxes per confirmed window (top-left origin, 0–1).
   * A 2D floor plan cannot encode sill/head height; these photo boxes are the ONLY
   * source of a window's true vertical placement + visible width, and drive the
   * sill/size directive in `buildOpeningStructuralLock`.
   */
  photoWindowBoxes?: OpeningBox[];
  /** Confidence to assert for the opening counts (defaults derived from authoring). */
  windowConfidence?: "high" | "medium" | "low";
  doorConfidence?: "high" | "medium" | "low";
  /**
   * Full floor-plan door inventory (may exceed visible `photoDoorCount` when the
   * door is behind the camera). Used for anti-hallucination messaging, not to
   * force a door into frame.
   */
  planDoorCount?: number;
  planDoorPositions?: string[];
  /**
   * Compass → camera-relative wall map (from the marked viewpoint). When set, the
   * plan-sourced opening labels are rewritten to camera-relative walls so the
   * downstream placement lock can parse them. Ignored when `photo*Positions` are
   * supplied (those are already camera-relative).
   */
  compassToCameraWall?: CompassWallMap;
  /**
   * Measured length (meters) of each camera-relative wall, from the resolved
   * viewpoint framing. Surfaced in the opening lock so Gemini renders the narrow
   * faced wall narrow.
   */
  wallLengthsM?: Partial<Record<"back" | "left" | "right", number>>;
  /** Structured columns from floor-plan analysis for this room. */
  planColumns?: PlanColumn[];
}

function columnDescription(col: PlanColumn): string {
  const size =
    col.width === col.depth
      ? `${col.width}m square`
      : `${col.width}m × ${col.depth}m`;
  return `load-bearing column (${size}) on floor plan`;
}

function planColumnsForRoom(roomId: string, columns?: PlanColumn[]): PlanColumn[] {
  if (!columns?.length) return [];
  return columns.filter((c) => !c.roomId || c.roomId === roomId);
}

function roomShapeToken(room: DetectedRoom): string {
  return room.polygon && room.polygon.length > 4 ? "irregular" : "rectangle";
}

/**
 * True when every opening has been reviewed (`confirmed` set by an editor edit
 * or the room-confirm sweep) → authoritative. Note: AI detections are now
 * wall-anchored (edgeIndex set) for editability, so anchoring alone no longer
 * implies review — `confirmed` is the authority signal.
 */
function allConfirmed(openings: Array<{ confirmed?: boolean }>): boolean {
  return openings.length > 0 && openings.every((o) => o.confirmed === true);
}

/** Floor-plan door inventory for the opening lock (independent of camera-visible count). */
export function planDoorInventoryForLock(
  room: DetectedRoom | undefined,
  compassMap?: CompassWallMap,
): { planDoorCount: number; planDoorPositions: string[] } {
  if (!room || room.doors.length === 0) return { planDoorCount: 0, planDoorPositions: [] };
  return {
    planDoorCount: room.doors.length,
    planDoorPositions: room.doors.map(
      (d) =>
        `${toCameraRelativeLabel(d.position, compassMap)} (${d.width}m wide, connects to ${d.connectsTo})`,
    ),
  };
}

/**
 * Build a `RoomAnalysis` from a floor-plan `DetectedRoom`. Opening counts come
 * from the photo when provided (ground truth), otherwise from the plan. Window/
 * door confidence defaults to "high" only once the openings are confirmed (the
 * user reviewed them, or approved the plan) so raw AI detections stay "medium"
 * → `at least N`, not a hard `EXACTLY N` that could pin a misread count.
 */
export function detectedRoomToRoomAnalysis(
  room: DetectedRoom | undefined,
  opts: DetectedRoomLockOptions = {},
): RoomAnalysis | null {
  if (!room) return null;

  const windowCount = opts.photoWindowCount ?? room.windows.length;
  const doorCount = opts.photoDoorCount ?? room.doors.length;

  const windowPositions =
    opts.photoWindowPositions ??
    room.windows.map(
      (w) => `${toCameraRelativeLabel(w.position, opts.compassToCameraWall)} (${w.width}m × ${w.height}m)`,
    );
  const doorPositions =
    opts.photoDoorPositions ??
    room.doors.map(
      (d) =>
        `${toCameraRelativeLabel(d.position, opts.compassToCameraWall)} (${d.width}m wide, connects to ${d.connectsTo})`,
    );

  const windowConfidence =
    opts.windowConfidence ?? (allConfirmed(room.windows) ? "high" : "medium");
  const doorConfidence = opts.doorConfidence ?? (allConfirmed(room.doors) ? "high" : "medium");

  const features = room.features ?? [];
  const hasStaircase = features.some((f) => STAIRCASE_RE.test(f));
  const hasFloorOpening = features.some((f) => FLOOR_OPENING_RE.test(f));

  const roomColumns = planColumnsForRoom(room.id, opts.planColumns);
  const columnElements = roomColumns.map(columnDescription);
  const structuralElements = [
    ...features.filter((f) => !isPlanSpeculativeColumnFeature(f)),
    ...columnElements,
  ];

  return {
    room_type: room.type,
    room_shape: roomShapeToken(room),
    estimated_dimensions: room.dimensions,
    ...(room.polygon && room.polygon.length > 4
      ? { polygon_corner_count: room.polygon.length }
      : {}),
    existing_furniture: [],
    architectural_features: features,
    lighting_sources: [],
    current_style: "",
    color_palette: [],
    suggestions: [],
    window_count: windowCount,
    door_count: doorCount,
    window_positions: windowPositions,
    door_positions: doorPositions,
    ...(opts.wallLengthsM && Object.keys(opts.wallLengthsM).length
      ? { wall_lengths_m: opts.wallLengthsM }
      : {}),
    ...(opts.photoWindowBoxes?.length ? { window_boxes: opts.photoWindowBoxes } : {}),
    ...(opts.planDoorCount !== undefined && opts.planDoorCount > 0
      ? {
          plan_door_count: opts.planDoorCount,
          plan_door_positions: opts.planDoorPositions ?? [],
        }
      : {}),
    camera_angle: opts.cameraAngle?.trim() || "unknown",
    ceiling_type: "",
    structural_elements: structuralElements,
    has_staircase: hasStaircase,
    staircase_description: null,
    has_floor_opening: hasFloorOpening,
    floor_opening_description: null,
    confidence: {
      room_type: "high",
      dimensions: "medium",
      style: "low",
      window_count: windowConfidence,
      door_count: doorConfidence,
    },
  };
}
