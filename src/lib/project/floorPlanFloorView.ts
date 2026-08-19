import type { DetectedRoom, FloorPlanAnalysis, PlanColumn, UtilityEntryPoint } from "./types";
import type { Bounds } from "./floorPlanGeometry";
import { roomFloorLevel } from "./floorPlanFloors";

const DEFAULT_PAD_MM = 400;

export function roomsOnFloor(rooms: DetectedRoom[], floor: 1 | 2): DetectedRoom[] {
  return rooms.filter((r) => roomFloorLevel(r) === floor);
}

function expandBoundsFromPoints(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  x: number,
  y: number,
): [number, number, number, number] {
  return [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
}

function pointInBounds(x: number, y: number, b: Bounds): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/** Bounding box for one floor’s geometry (rooms + in-bounds columns/utilities), padded. */
export function computeFloorBounds(
  analysis: FloorPlanAnalysis,
  floor: 1 | 2,
  utilityPoints: UtilityEntryPoint[] = [],
  paddingMm = DEFAULT_PAD_MM,
): Bounds {
  const floorRooms = roomsOnFloor(analysis.rooms, floor);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const consider = (x: number, y: number) => {
    [minX, minY, maxX, maxY] = expandBoundsFromPoints(minX, minY, maxX, maxY, x, y);
  };

  for (const room of floorRooms) {
    for (const [x, y] of room.polygon ?? []) consider(x, y);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 10000, maxY: 8000 };
  }

  const raw: Bounds = { minX, minY, maxX, maxY };

  for (const col of analysis.columns ?? []) {
    if (pointInBounds(col.x, col.y, raw)) consider(col.x, col.y);
  }
  for (const u of utilityPoints) {
    if (pointInBounds(u.x, u.y, raw)) consider(u.x, u.y);
  }

  const pad = Math.max(paddingMm, (maxX - minX) * 0.04, (maxY - minY) * 0.04);
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

function wallMidpointInBounds(
  w: { x1: number; y1: number; x2: number; y2: number },
  b: Bounds,
): boolean {
  const mx = (w.x1 + w.x2) / 2;
  const my = (w.y1 + w.y2) / 2;
  return pointInBounds(mx, my, b);
}

export function isPointInFloorBounds(
  analysis: FloorPlanAnalysis,
  floor: 1 | 2,
  x: number,
  y: number,
): boolean {
  return pointInBounds(x, y, computeFloorBounds(analysis, floor));
}

function filterColumns(columns: PlanColumn[] | undefined, b: Bounds): PlanColumn[] {
  if (!columns?.length) return [];
  return columns.filter((c) => pointInBounds(c.x, c.y, b));
}

function filterUtilities(points: UtilityEntryPoint[], b: Bounds): UtilityEntryPoint[] {
  if (!points.length) return [];
  return points.filter((p) => pointInBounds(p.x, p.y, b));
}

/** Display slice for one floor (does not mutate stored analysis). */
export function filterAnalysisForFloorView(
  analysis: FloorPlanAnalysis,
  floor: 1 | 2,
  utilityPoints: UtilityEntryPoint[] = [],
): FloorPlanAnalysis {
  const bounds = computeFloorBounds(analysis, floor, utilityPoints);
  const rooms = roomsOnFloor(analysis.rooms, floor);
  const wallSegments = analysis.wallSegments.filter((w) => wallMidpointInBounds(w, bounds));
  const columns = filterColumns(analysis.columns, bounds);
  return {
    ...analysis,
    rooms,
    wallSegments,
    columns: columns.length ? columns : analysis.columns?.length ? [] : undefined,
    utilityPoints: filterUtilities(analysis.utilityPoints ?? [], bounds),
  };
}
