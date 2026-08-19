/**
 * apartment3d — pure conversion from Vista's floor-plan geometry
 * (`FloorPlanAnalysis`, mm / Y-up) into 3D-ready apartment data
 * (meters, XZ plane, CCW-normalized outlines) for the Three.js viewer.
 *
 * This module has NO `three` import so it stays unit-testable via `tsx --test`.
 * The 3D renderer (Phase 2 `RoomMesh3D` / ported `polygonWallCsg`) consumes the
 * `Apartment3D` produced here and must treat the outline winding produced here
 * (positive XZ signed area) as CCW-outward.
 *
 * Coordinate mapping: plan is mm, Y-up, bottom-left origin. We map
 *   x_m = x_mm / 1000,   z_m = -y_mm / 1000
 * so the plan's "up/north" runs into -Z (away from a default top-down camera),
 * matching the Y-flip convention the 2D SVG hub already uses.
 */

import type { DetectedRoom, FloorPlanAnalysis, RoomType } from "./types";
import { isValidEdgeIndex, sanitizePolygon, type Point } from "./floorPlanGeometry";

/** A point in the 3D floor plane: meters, XZ. */
export interface Vec2 {
  x: number;
  z: number;
}

export interface Opening3D {
  id: string;
  type: "door" | "window";
  /** Index into `Room3D.outline` AFTER winding normalization. */
  edgeIndex: number;
  /** Along-edge position in [-1, 1] about the edge midpoint (= 2t - 1). */
  position: number;
  /** meters */
  width: number;
  /** meters */
  height: number;
  hinge?: "left" | "right";
  swing?: "in" | "out";
}

export interface Room3D {
  id: string;
  name: string;
  type: RoomType;
  /** meters, XZ, guaranteed CCW (positive signed area) so outward normals are correct. */
  outline: Vec2[];
  /** ceiling height, meters */
  height: number;
  openings: Opening3D[];
  /**
   * Edges (indices into `outline`) whose wall a neighboring room already renders.
   * The renderer must skip these so each boundary produces exactly one wall.
   */
  suppressedWallEdges: number[];
  /**
   * Interior corner angle (degrees, 0..180) at each outline vertex `i` — the angle
   * between edges (i-1) and (i). Lets the wall builder pick corner-extension vs
   * miter at acute (non-orthogonal) joints. `cornerAnglesDeg[i]` is the angle at
   * vertex `i`, which is the START of edge `i`.
   */
  cornerAnglesDeg: number[];
  /** meters, XZ — camera focus / label / furniture anchor. */
  centroid: Vec2;
}

export interface Column3D {
  id: string;
  /** meters, XZ */
  x: number;
  z: number;
  /** meters */
  width: number;
  depth: number;
  height: number;
}

export interface Apartment3D {
  rooms: Room3D[];
  columns: Column3D[];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** meters */
  wallThickness: number;
}

export interface FloorPlanTo3DOptions {
  defaultWallThicknessMm?: number;
  defaultDoorHeightM?: number;
  defaultWindowHeightM?: number;
}

const DEFAULTS = {
  wallThicknessMm: 120,
  doorHeightM: 2.1,
  windowHeightM: 1.2,
  ceilingHeightM: 2.7,
  /** rooms smaller than this (m²) are treated as degenerate and dropped */
  minRoomAreaM2: 0.25,
} as const;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** Signed area of an XZ ring (positive = our canonical CCW-outward orientation). */
function signedAreaXZ(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/**
 * Direction-independent key for a wall edge, rounded to whole mm — identical
 * scheme to `deriveWallSegments`' private `edgeKey`, so shared edges dedupe the
 * same way the 2D wall derivation does.
 */
function mmEdgeKey(a: Point, b: Point): string {
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
  return `${Math.round(p[0])},${Math.round(p[1])}|${Math.round(q[0])},${Math.round(q[1])}`;
}

/** Drop consecutive-duplicate vertices and a trailing vertex equal to the first. */
function cleanRing(poly: Point[], epsMm = 1): Point[] {
  const out: Point[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) <= epsMm && Math.abs(last[1] - p[1]) <= epsMm) continue;
    out.push([p[0], p[1]]);
  }
  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(first[0] - last[0]) <= epsMm && Math.abs(first[1] - last[1]) <= epsMm) out.pop();
  }
  return out;
}

/** Unsigned polygon area (mm²) of an mm ring. */
function ringAreaMm2(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Interior corner angle (deg, 0..180) at vertex `i` of an XZ ring. */
function cornerAngleDeg(ring: Vec2[], i: number): number {
  const n = ring.length;
  const prev = ring[(i - 1 + n) % n];
  const curr = ring[i];
  const next = ring[(i + 1) % n];
  const ux = prev.x - curr.x;
  const uz = prev.z - curr.z;
  const wx = next.x - curr.x;
  const wz = next.z - curr.z;
  const dot = ux * wx + uz * wz;
  const cross = ux * wz - uz * wx;
  const ang = Math.atan2(Math.abs(cross), dot) * (180 / Math.PI);
  return Number.isFinite(ang) ? ang : 180;
}

interface OpeningInput {
  type: "door" | "window";
  width: number;
  height?: number;
  edgeIndex?: number;
  t?: number;
  hinge?: "left" | "right";
  swing?: "in" | "out";
}

function collectRoomOpenings(room: DetectedRoom): OpeningInput[] {
  const windows: OpeningInput[] = (room.windows ?? []).map((w) => ({
    type: "window",
    width: w.width,
    height: w.height,
    edgeIndex: w.edgeIndex,
    t: w.t,
  }));
  const doors: OpeningInput[] = (room.doors ?? []).map((d) => ({
    type: "door",
    width: d.width,
    height: d.height,
    edgeIndex: d.edgeIndex,
    t: d.t,
    hinge: d.hinge,
    swing: d.swing,
  }));
  return [...windows, ...doors];
}

/**
 * Convert a locked `FloorPlanAnalysis` into `Apartment3D`.
 *
 * Handles: mm→m + Y-up→XZ mapping, winding normalization (force CCW, remap
 * openings `edgeIndex → (n-2-i) mod n`, `t → 1-t`), `t→position` conversion,
 * cross-room shared-wall dedupe (one wall per boundary), per-vertex corner
 * angles for miter handling, and the `PlanColumn` unit trap (x,y are mm but
 * width/depth are already meters).
 */
export function floorPlanTo3D(
  analysis: FloorPlanAnalysis,
  opts: FloorPlanTo3DOptions = {},
): Apartment3D {
  const wallThickness = (opts.defaultWallThicknessMm ?? DEFAULTS.wallThicknessMm) / 1000;
  const doorHeightM = opts.defaultDoorHeightM ?? DEFAULTS.doorHeightM;
  const windowHeightM = opts.defaultWindowHeightM ?? DEFAULTS.windowHeightM;
  const ceilingHeight =
    Number.isFinite(analysis.ceilingHeight) && analysis.ceilingHeight > 0
      ? analysis.ceilingHeight
      : DEFAULTS.ceilingHeightM;

  // Shared-wall dedupe operates in mm space across ALL rooms, in room order.
  const claimedEdgeKeys = new Set<string>();
  const rooms: Room3D[] = [];

  for (const room of analysis.rooms) {
    const clean = cleanRing(sanitizePolygon(room.polygon));
    if (clean.length < 3) continue; // degenerate — skip
    if (ringAreaMm2(clean) < DEFAULTS.minRoomAreaM2 * 1e6) continue;

    // Map mm/Y-up → meters/XZ, keeping the mm ring in lockstep so edge indices
    // line up for the mm edge-key dedupe.
    let mmRing = clean;
    let outline: Vec2[] = clean.map(([x, y]) => ({ x: x / 1000, z: -y / 1000 }));

    let openings = collectRoomOpenings(room);

    // Winding normalization: force positive (canonical CCW-outward) signed area.
    if (signedAreaXZ(outline) < 0) {
      const n = mmRing.length;
      mmRing = [...mmRing].reverse();
      outline = [...outline].reverse();
      openings = openings.map((o) => {
        if (o.edgeIndex == null || !isValidEdgeIndex(clean, o.edgeIndex)) return o;
        const newEdge = ((n - 2 - o.edgeIndex) % n + n) % n;
        const newT = o.t == null ? o.t : 1 - clamp01(o.t);
        return { ...o, edgeIndex: newEdge, t: newT };
      });
    }

    // Build 3D openings (t→position, mm→m, defaults) against the final ring.
    const openings3d: Opening3D[] = [];
    let idx = 0;
    for (const o of openings) {
      if (o.edgeIndex == null || !isValidEdgeIndex(mmRing, o.edgeIndex)) continue;
      const widthM = Number.isFinite(o.width) && o.width > 0 ? o.width / 1000 : 0;
      if (widthM <= 0) continue;
      const rawH = o.height;
      const heightM =
        Number.isFinite(rawH) && (rawH as number) > 0
          ? (rawH as number) / 1000
          : o.type === "door"
            ? doorHeightM
            : windowHeightM;
      openings3d.push({
        id: `${room.id}-${o.type}-${idx++}`,
        type: o.type,
        edgeIndex: Math.floor(o.edgeIndex),
        position: 2 * clamp01(o.t ?? 0.5) - 1,
        width: widthM,
        height: heightM,
        hinge: o.hinge,
        swing: o.swing,
      });
    }

    // Shared-wall dedupe: the second room to claim a boundary suppresses it.
    const suppressedWallEdges: number[] = [];
    for (let i = 0; i < mmRing.length; i++) {
      const key = mmEdgeKey(mmRing[i], mmRing[(i + 1) % mmRing.length]);
      if (claimedEdgeKeys.has(key)) suppressedWallEdges.push(i);
      else claimedEdgeKeys.add(key);
    }

    const cornerAnglesDeg = outline.map((_, i) => cornerAngleDeg(outline, i));
    const centroid: Vec2 = {
      x: outline.reduce((s, p) => s + p.x, 0) / outline.length,
      z: outline.reduce((s, p) => s + p.z, 0) / outline.length,
    };
    const height =
      Number.isFinite(room.dimensions?.height) && room.dimensions.height > 0
        ? room.dimensions.height
        : ceilingHeight;

    rooms.push({
      id: room.id,
      name: room.name,
      type: room.type,
      outline,
      height,
      openings: openings3d,
      suppressedWallEdges,
      cornerAnglesDeg,
      centroid,
    });
  }

  // Columns: convert only x,y (mm→m). width/depth are ALREADY meters.
  const columns: Column3D[] = (analysis.columns ?? [])
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y))
    .map((c) => ({
      id: c.id,
      x: c.x / 1000,
      z: -c.y / 1000,
      width: Number.isFinite(c.width) && c.width > 0 ? c.width : 0.3,
      depth: Number.isFinite(c.depth) && c.depth > 0 ? c.depth : 0.3,
      height: ceilingHeight,
    }));

  // Bounds (meters) from all room outlines for camera framing.
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of rooms) {
    for (const p of r.outline) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minZ = 0;
    maxX = 10;
    maxZ = 8;
  }

  return { rooms, columns, bounds: { minX, minZ, maxX, maxZ }, wallThickness };
}
