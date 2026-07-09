/**
 * Shared floor-plan geometry helpers (mm-space).
 *
 * Coordinate convention: room polygons, wall segments, utility points and photo
 * viewpoints are all stored in millimetres with the plan's bottom-left at the
 * origin and the Y axis pointing UP. SVG draws with Y pointing DOWN, so rendering
 * code flips Y via `flipY`. Pointer→plan conversion (`screenToMm`) returns Y-up mm.
 *
 * Used by FloorPlanHub (display) and FloorPlanEditor (editing).
 */

import type { DetectedRoom, FloorPlanAnalysis, SharedWall, UtilityEntryPoint, WallSegment } from "./types";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Point = [number, number];

function isValidPoint(p: unknown): p is Point {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** Keep only finite `[x, y]` pairs — drops malformed AI/client vertices. */
export function sanitizePolygon(raw: unknown): Point[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidPoint).map(([x, y]) => [x, y]);
}

/** True when edge `i` has valid start/end vertices on a polygon with at least 2 points. */
export function isValidEdgeIndex(polygon: Point[], i: number): boolean {
  if (!Number.isFinite(i) || polygon.length < 2) return false;
  const ii = Math.floor(i);
  if (ii < 0 || ii >= polygon.length) return false;
  return isValidPoint(polygon[ii]) && isValidPoint(polygon[(ii + 1) % polygon.length]);
}

/** Bounding box of the whole plan (walls + room polygons + utility points), padded. */
export function computeBounds(
  analysis: FloorPlanAnalysis,
  utilityPoints: UtilityEntryPoint[] = [],
): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const consider = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const w of analysis.wallSegments) {
    consider(w.x1, w.y1);
    consider(w.x2, w.y2);
  }
  for (const room of analysis.rooms) {
    for (const [x, y] of room.polygon ?? []) consider(x, y);
  }
  for (const point of utilityPoints) consider(point.x, point.y);

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 10000, maxY: 8000 };
  }

  const pad = Math.max((maxX - minX) * 0.02, 200);
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Flip a Y-up plan coordinate into SVG (Y-down) space within the given bounds. */
export function flipY(y: number, bounds: Pick<Bounds, "minY" | "maxY">): number {
  return bounds.maxY - y + bounds.minY;
}

/** Signed-area magnitude of a polygon (mm²). */
export function polygonArea(polygon: Point[]): number {
  let a = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Translate every vertex of a polygon by (dx, dy). */
export function translatePolygon(polygon: Point[], dx: number, dy: number): Point[] {
  return polygon.map<Point>(([x, y]) => [x + dx, y + dy]);
}

/** Move both endpoints of edge `edgeIndex` (vertices i and i+1) by (dx, dy). */
export function moveEdge(polygon: Point[], edgeIndex: number, dx: number, dy: number): Point[] {
  const n = polygon.length;
  const a = edgeIndex % n;
  const b = (edgeIndex + 1) % n;
  return polygon.map<Point>(([x, y], i) =>
    i === a || i === b ? [x + dx, y + dy] : [x, y],
  );
}

/** Ray-casting point-in-polygon test (mm-space, Y-up). Edges count as inside. */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  const [px, py] = p;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Group utility points by the room that contains them. A point outside every
 * polygon is assigned to the room whose centroid is nearest, so stray points
 * (e.g. dropped on a wall) still inform the closest room's layout.
 */
export function assignUtilitiesToRooms(
  rooms: DetectedRoom[],
  utilities: UtilityEntryPoint[],
): Map<string, UtilityEntryPoint[]> {
  const byRoom = new Map<string, UtilityEntryPoint[]>();
  for (const u of utilities) {
    const p: Point = [u.x, u.y];
    let target = rooms.find((r) => pointInPolygon(p, r.polygon ?? []));
    if (!target) {
      let best = Infinity;
      for (const r of rooms) {
        if (!r.polygon?.length) continue;
        const [cx, cy] = polygonCentroid(r.polygon);
        const d = Math.hypot(cx - u.x, cy - u.y);
        if (d < best) {
          best = d;
          target = r;
        }
      }
    }
    if (!target) continue;
    const list = byRoom.get(target.id) ?? [];
    list.push(u);
    byRoom.set(target.id, list);
  }
  return byRoom;
}

/**
 * Short, human-readable position of a point within a room (for AI prompts that
 * can't reason about raw mm). Uses a 3×3 grid over the room's bounding box; Y is
 * up, so larger Y reads as the "back" (far) wall.
 */
export function describeUtilityPosition(
  point: { x: number; y: number },
  room: DetectedRoom,
): string {
  const poly = room.polygon ?? [];
  if (poly.length < 3) return "within the room";
  const bb = polygonBBox(poly);
  const w = bb.maxX - bb.minX || 1;
  const d = bb.maxY - bb.minY || 1;
  const fx = (point.x - bb.minX) / w;
  const fy = (point.y - bb.minY) / d;

  const col = fx < 1 / 3 ? "left" : fx > 2 / 3 ? "right" : "center";
  const row = fy < 1 / 3 ? "front" : fy > 2 / 3 ? "back" : "middle";

  if (col === "center" && row === "middle") return "center of the room";
  if (col !== "center" && row !== "middle") return `${row}-${col} corner`;
  if (col !== "center") return `${col} wall`;
  return `${row} wall`;
}

export function polygonCentroid(polygon: Point[]): Point {
  if (polygon.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of polygon) {
    sx += x;
    sy += y;
  }
  return [sx / polygon.length, sy / polygon.length];
}

export function polygonBBox(polygon: Point[]): Bounds {
  if (polygon.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** Approximate room dimensions (metres) from a polygon's bounding box. */
export function dimensionsFromPolygon(
  polygon: Point[],
  height = 2.7,
): { width: number; depth: number; height: number } {
  const bb = polygonBBox(polygon);
  return {
    width: Math.round(((bb.maxX - bb.minX) / 1000) * 100) / 100,
    depth: Math.round(((bb.maxY - bb.minY) / 1000) * 100) / 100,
    height,
  };
}

/** Scale a polygon along one axis so its bbox extent matches targetMm, anchored at the bbox min. */
export function resizePolygonExtent(
  polygon: Point[],
  axis: "x" | "y",
  targetMm: number,
): Point[] {
  const bb = polygonBBox(polygon);
  const min = axis === "x" ? bb.minX : bb.minY;
  const current = axis === "x" ? bb.maxX - bb.minX : bb.maxY - bb.minY;
  if (current <= 0 || targetMm <= 0) return polygon; // guard divide-by-zero / nonsense
  const factor = targetMm / current;
  return polygon.map<Point>(([x, y]) =>
    axis === "x" ? [min + (x - min) * factor, y] : [x, min + (y - min) * factor],
  );
}

/** Length (mm) of edge i (vertex i -> vertex i+1, wrapping). Returns 0 when invalid. */
export function edgeLengthMm(polygon: Point[], i: number): number {
  if (!isValidEdgeIndex(polygon, i)) return 0;
  const a = polygon[i]!;
  const b = polygon[(i + 1) % polygon.length]!;
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Set edge i to targetMm by moving its END vertex along the edge direction; START stays put. */
export function setEdgeLength(polygon: Point[], i: number, targetMm: number): Point[] {
  if (!isValidEdgeIndex(polygon, i)) return polygon;
  const n = polygon.length;
  const a = polygon[i]!;
  const b = polygon[(i + 1) % n]!;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len <= 0 || targetMm <= 0) return polygon; // no direction / nonsense -> unchanged
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  return polygon.map<Point>((p, idx) =>
    idx === (i + 1) % n ? [a[0] + ux * targetMm, a[1] + uy * targetMm] : p,
  );
}

/**
 * True when vertex `i` sits on a curved section — the angle between its two
 * adjacent edges is less than `thresholdDeg` (default 15). Used to reduce label
 * clutter on polyline-approximated arcs.
 */
export function isCurveVertex(polygon: Point[], i: number, thresholdDeg = 15): boolean {
  const n = polygon.length;
  if (n <= 4) return false;
  const prev = polygon[(i - 1 + n) % n];
  const cur = polygon[i];
  const next = polygon[(i + 1) % n];
  const ax = cur[0] - prev[0], ay = cur[1] - prev[1];
  const bx = next[0] - cur[0], by = next[1] - cur[1];
  const dot = ax * bx + ay * by;
  const cross = ax * by - ay * bx;
  return Math.abs(Math.atan2(cross, dot) * (180 / Math.PI)) < thresholdDeg;
}

/** True when the polygon reads as an axis-aligned rectangle (4 verts, each edge H or V). */
export function isRectanglePolygon(polygon: Point[], tolMm = 20): boolean {
  if (polygon.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % 4];
    const dx = Math.abs(b[0] - a[0]);
    const dy = Math.abs(b[1] - a[1]);
    if (dx > tolMm && dy > tolMm) return false; // diagonal edge -> not axis-aligned rect
  }
  return true;
}

/**
 * True when every edge is axis-aligned (horizontal or vertical) — rectangles and
 * rectilinear L/T rooms. Returns false for rooms with diagonal/angled walls, so
 * callers can fall back to free-form vertex/edge editing instead of orthogonal
 * snapping (which would flatten the angled walls).
 */
export function isRectilinearPolygon(polygon: Point[], tolMm = 20): boolean {
  if (polygon.length < 4) return false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = Math.abs(b[0] - a[0]);
    const dy = Math.abs(b[1] - a[1]);
    if (dx > tolMm && dy > tolMm) return false; // diagonal edge -> not rectilinear
  }
  return true;
}

/**
 * Move vertex `i` to `target` while keeping the room rectilinear (every wall stays
 * horizontal or vertical, so corners remain 90°/180°/270°). The two neighbours slide
 * along their far walls: whichever coordinate a neighbour shared with the old vertex
 * (i.e. the axis of the wall between them) is set to `target`'s matching coordinate.
 * Works for rectangles and any rectilinear L/T polygon.
 */
export function orthogonalVertexDrag(polygon: Point[], i: number, target: Point): Point[] {
  const n = polygon.length;
  if (n < 3) return polygon.map<Point>((p, idx) => (idx === i ? target : p));
  const old = polygon[i];
  const slide = (neighbour: Point): Point =>
    // Wall is vertical when the neighbour mainly shares the old vertex's x.
    Math.abs(neighbour[0] - old[0]) <= Math.abs(neighbour[1] - old[1])
      ? [target[0], neighbour[1]]
      : [neighbour[0], target[1]];
  const prevIdx = (i - 1 + n) % n;
  const nextIdx = (i + 1) % n;
  return polygon.map<Point>((p, idx) => {
    if (idx === i) return target;
    if (idx === prevIdx) return slide(p);
    if (idx === nextIdx) return slide(p);
    return p;
  });
}

/** Zero the component of (dx,dy) parallel to wall `i`, so the wall only moves perpendicular. */
export function wallPerpendicularDelta(
  polygon: Point[],
  i: number,
  dx: number,
  dy: number,
): [number, number] {
  const n = polygon.length;
  const a = polygon[i % n];
  const b = polygon[(i + 1) % n];
  // Horizontal wall -> keep dy (drop dx); vertical wall -> keep dx.
  return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? [0, dy] : [dx, 0];
}

/**
 * Push wall `i` by a perpendicular delta, keeping the polygon rectilinear. For each
 * endpoint: if its flanking wall is perpendicular to wall `i`, the endpoint just moves
 * (the flanking wall stretches); if the flanking wall is collinear (the wall is a straight
 * run), the old corner is kept and the moved point added — an automatic right-angle jog.
 * This is how protrusions/notches (L/T shapes) are built. May change the vertex count.
 */
export function orthogonalEdgePush(polygon: Point[], i: number, dx: number, dy: number): Point[] {
  const n = polygon.length;
  if (n < 3) return polygon;
  // Roll so the dragged wall is edge 0 -> A=roll[0], B=roll[1]; no cyclic-wrap special cases.
  const roll = [...polygon.slice(i), ...polygon.slice(0, i)];
  const A = roll[0];
  const B = roll[1];
  const aPrev = roll[n - 1]; // flanking wall aPrev -> A
  const bNext = roll[2]; // flanking wall B -> bNext
  const Amoved: Point = [A[0] + dx, A[1] + dy];
  const Bmoved: Point = [B[0] + dx, B[1] + dy];
  const horizontal = Math.abs(B[0] - A[0]) >= Math.abs(B[1] - A[1]);
  // A flanking wall is perpendicular to a horizontal wall when it is vertical (shares x).
  const perp = (corner: Point, far: Point): boolean =>
    horizontal
      ? Math.abs(far[0] - corner[0]) <= Math.abs(far[1] - corner[1]) // far-corner vertical
      : Math.abs(far[1] - corner[1]) <= Math.abs(far[0] - corner[0]); // far-corner horizontal
  const aPerp = perp(A, aPrev);
  const bPerp = perp(B, bNext);

  const out: Point[] = [];
  if (!aPerp) out.push([A[0], A[1]]); // jog: keep old A corner before the moved point
  out.push(Amoved);
  out.push(Bmoved);
  if (!bPerp) out.push([B[0], B[1]]); // jog: keep old B corner after the moved point
  for (let k = 2; k < n; k++) out.push(roll[k]); // the rest of the loop, in order

  // Unroll back to the original starting vertex so downstream indices line up.
  return [...out.slice(out.length - i), ...out.slice(0, out.length - i)];
}

/**
 * True when vertex `i`'s two incident edges are (nearly) collinear — i.e. it sits on a
 * straight wall run (a 180° corner), as a freshly inserted midpoint corner does. Used to
 * let such a corner be dragged freely instead of being treated as a rectilinear corner
 * whose neighbours slide (which would just move the whole wall and reabsorb the corner).
 */
export function isCollinearVertex(polygon: Point[], i: number, tolMm = 1): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  const prev = polygon[(i - 1 + n) % n];
  const cur = polygon[i];
  const next = polygon[(i + 1) % n];
  const cross =
    (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
  const scale = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
  return Math.abs(cross) / scale <= tolMm;
}

/** Drop vertices whose two edges are collinear (180° corners), tidying up after edits. */
export function dropCollinearVertices(polygon: Point[], tolMm = 1): Point[] {
  const n = polygon.length;
  if (n <= 3) return polygon;
  const keep: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const cur = polygon[i];
    const next = polygon[(i + 1) % n];
    // Cross product of the two incident edges; ~0 means the corner is straight.
    const cross =
      (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    const scale = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
    if (Math.abs(cross) / scale > tolMm) keep.push(cur);
  }
  return keep.length >= 3 ? keep : polygon;
}

/** Axis-aligned rectangle (4 corners, CCW in Y-up space) from two opposite corners. */
export function axisAlignedRect(a: Point, b: Point): Point[] {
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

/**
 * Convert a screen/client point to Y-up plan millimetres for the given SVG.
 * Returns null if the SVG has no current transform matrix.
 */
export function screenToMm(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  bounds: Bounds,
): Point | null {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const local = pt.matrixTransform(ctm.inverse());
  return [local.x, bounds.maxY - local.y + bounds.minY];
}

/**
 * Snap a point to a grid and to nearby existing vertices.
 * Vertex snapping wins over grid snapping when a vertex is within `vertexThreshold`.
 */
export function snapPoint(
  point: Point,
  others: Point[],
  gridMm: number,
  vertexThreshold: number,
): Point {
  let best: Point | null = null;
  let bestDist = vertexThreshold;
  for (const v of others) {
    const d = Math.hypot(v[0] - point[0], v[1] - point[1]);
    if (d <= bestDist) {
      best = v;
      bestDist = d;
    }
  }
  if (best) return [best[0], best[1]];
  if (gridMm > 0) {
    return [Math.round(point[0] / gridMm) * gridMm, Math.round(point[1] / gridMm) * gridMm];
  }
  return point;
}

/**
 * Snap a dragged/placed corner so adjacent rooms share exact walls. Priority:
 *   1. nearby existing corner (within `vertexThreshold`) — share the corner,
 *   2. else the nearest wall edge (within `edgeThreshold`) — land the corner on
 *      the neighbour's wall line so the two walls coincide,
 *   3. else the grid.
 * `edges` are [start, end] segments of OTHER rooms' walls.
 */
export function snapPointToGeometry(
  point: Point,
  vertices: Point[],
  edges: [Point, Point][],
  gridMm: number,
  vertexThreshold: number,
  edgeThreshold: number,
): Point {
  // 1. Corner snap wins (keeps shared corners exact).
  let bestV: Point | null = null;
  let bestVd = vertexThreshold;
  for (const v of vertices) {
    const d = Math.hypot(v[0] - point[0], v[1] - point[1]);
    if (d <= bestVd) {
      bestV = v;
      bestVd = d;
    }
  }
  if (bestV) return [bestV[0], bestV[1]];

  // 2. Edge snap: project onto the nearest wall segment and stick to it.
  let bestP: Point | null = null;
  let bestPd = edgeThreshold;
  for (const [a, b] of edges) {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    if (len2 <= 0) continue;
    const t = Math.min(1, Math.max(0, ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / len2));
    const proj: Point = [a[0] + abx * t, a[1] + aby * t];
    const d = Math.hypot(point[0] - proj[0], point[1] - proj[1]);
    if (d <= bestPd) {
      bestP = proj;
      bestPd = d;
    }
  }
  if (bestP) return bestP;

  // 3. Grid fallback.
  if (gridMm > 0) {
    return [Math.round(point[0] / gridMm) * gridMm, Math.round(point[1] / gridMm) * gridMm];
  }
  return point;
}

/**
 * Snap every vertex across all rooms onto a grid, then merge vertices that fall
 * within `mergeThreshold` of each other so adjacent rooms share exact corners.
 * Returns a new list of polygons (same order as input).
 */
export function snapAndCloseGaps(
  polygons: Point[][],
  gridMm: number,
  mergeThreshold: number,
): Point[][] {
  // 1. Snap to grid.
  const snapped = polygons.map((poly) =>
    poly.map<Point>(([x, y]) => [
      gridMm > 0 ? Math.round(x / gridMm) * gridMm : x,
      gridMm > 0 ? Math.round(y / gridMm) * gridMm : y,
    ]),
  );

  // 2. Cluster near-coincident vertices to a shared representative point.
  const reps: Point[] = [];
  const repFor = (p: Point): Point => {
    for (const r of reps) {
      if (Math.hypot(r[0] - p[0], r[1] - p[1]) <= mergeThreshold) return r;
    }
    reps.push(p);
    return p;
  };
  return snapped.map((poly) => poly.map((p) => repFor(p)));
}

// ---------------------------------------------------------------------------
// Openings (windows / doors) — anchored to a polygon edge by {edgeIndex, t}.
// `t` is the fraction (0..1) along edge `edgeIndex` (vertex i → vertex i+1).
// ---------------------------------------------------------------------------

export type Compass = "north" | "south" | "east" | "west";

/** Point at fraction `t` (0..1) along edge `edgeIndex` of a polygon. */
export function pointAlongEdge(polygon: Point[], edgeIndex: number, t: number): Point {
  const n = polygon.length;
  if (n < 2) return polygon[0] ?? [0, 0];
  const a = polygon[edgeIndex % n];
  const b = polygon[(edgeIndex + 1) % n];
  const c = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * c, a[1] + (b[1] - a[1]) * c];
}

/**
 * Project a point onto every edge of a polygon and return the closest one, with
 * the fraction `t` along that edge (clamped 0..1) and the distance in mm. Used to
 * snap a click/drag onto the nearest wall.
 */
export function nearestEdgeToPoint(
  polygon: Point[],
  p: Point,
): { edgeIndex: number; t: number; point: Point; distMm: number } {
  let best = { edgeIndex: 0, t: 0, point: polygon[0] ?? p, distMm: Infinity };
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2)) : 0;
    const proj: Point = [a[0] + abx * t, a[1] + aby * t];
    const d = Math.hypot(p[0] - proj[0], p[1] - proj[1]);
    if (d < best.distMm) best = { edgeIndex: i, t, point: proj, distMm: d };
  }
  return best;
}

/**
 * The two endpoints of an opening drawn on a wall: a segment of `widthMm`
 * centered at fraction `t` along edge `edgeIndex`, clamped to stay on the edge.
 * Shared by the editor (interactive) and the hub (read-only) so they match.
 */
export function openingEndpoints(
  polygon: Point[],
  edgeIndex: number,
  t: number,
  widthMm: number,
): [Point, Point] {
  const n = polygon.length;
  const a = polygon[edgeIndex % n];
  const b = polygon[(edgeIndex + 1) % n];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const half = Math.min(widthMm, len) / 2;
  const centerMm = Math.min(len - half, Math.max(half, t * len));
  const c = pointAlongEdge(polygon, edgeIndex, centerMm / len);
  return [
    [c[0] - ux * half, c[1] - uy * half],
    [c[0] + ux * half, c[1] + uy * half],
  ];
}

/** Unit outward normal of edge `edgeIndex` (points away from the polygon centroid). */
export function edgeOutwardNormal(polygon: Point[], edgeIndex: number): Point {
  const n = polygon.length;
  const a = polygon[edgeIndex % n];
  const b = polygon[(edgeIndex + 1) % n];
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  // Two candidate normals; pick the one pointing away from the centroid.
  let nx = -ey;
  let ny = ex;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  const [cx, cy] = polygonCentroid(polygon);
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  // If the normal points toward the centroid, flip it.
  if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 < (mx - cx) ** 2 + (my - cy) ** 2) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

/**
 * Compass direction of a wall, from its outward normal (Y-up plan space:
 * +Y = north/top, −Y = south/bottom, +X = east/right, −X = west/left). Matches
 * the orientation the floor-plan analyzer prompt uses.
 */
export function compassForEdge(polygon: Point[], edgeIndex: number): Compass {
  const [nx, ny] = edgeOutwardNormal(polygon, edgeIndex);
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? "east" : "west";
  return ny >= 0 ? "north" : "south";
}

/**
 * Human/AI-readable position string for an opening, kept in sync with the
 * existing "south wall center" vocabulary downstream consumers expect.
 */
export function describeOpening(polygon: Point[], edgeIndex: number, t: number): string {
  const wall = compassForEdge(polygon, edgeIndex);
  const along = t < 0.25 || t > 0.75 ? "near corner" : t >= 0.4 && t <= 0.6 ? "center" : "off-center";
  return `${wall} wall ${along}`;
}

/**
 * Derive an `{edgeIndex, t}` anchor for an opening from its free-text position
 * string (e.g. "south wall center", "back wall, near corner", "left wall").
 * Used to make AI detections that arrived without a wall anchor visible and
 * draggable in the editor. Matches a compass intent to the polygon edge facing
 * that way (longest such edge on ties — the dominant wall the user likely
 * means); falls back to the longest edge overall when the text is unparseable.
 * Returns null for degenerate polygons.
 */
export function anchorFromPositionText(
  polygon: Point[],
  positionText: string,
): { edgeIndex: number; t: number } | null {
  if (polygon.length < 3) return null;
  const text = (positionText || "").toLowerCase();

  // Relative/camera words → compass (Y-up plan space, same convention as
  // compassForEdge: +Y north/top, −Y south/bottom, +X east/right, −X west/left).
  let intent: Compass | null = null;
  if (/\bnorth\b|\bback\b|\bfar\b|\brear\b|\btop\b/.test(text)) intent = "north";
  else if (/\bsouth\b|\bfront\b|\bnear\b|\bbottom\b/.test(text)) intent = "south";
  else if (/\beast\b|\bright\b/.test(text)) intent = "east";
  else if (/\bwest\b|\bleft\b/.test(text)) intent = "west";

  let edgeIndex = -1;
  let bestLen = -1;
  if (intent) {
    for (let i = 0; i < polygon.length; i++) {
      if (compassForEdge(polygon, i) !== intent) continue;
      const len = edgeLengthMm(polygon, i);
      if (len > bestLen) {
        bestLen = len;
        edgeIndex = i;
      }
    }
  }
  if (edgeIndex < 0) {
    // No compass match — anchor to the longest wall overall.
    for (let i = 0; i < polygon.length; i++) {
      const len = edgeLengthMm(polygon, i);
      if (len > bestLen) {
        bestLen = len;
        edgeIndex = i;
      }
    }
  }
  if (edgeIndex < 0) return null;

  // Position along the wall from along-wall words.
  let t = 0.5;
  if (/\bcorner\b|\bnear (?:the )?(?:corner|end)\b|\bend\b/.test(text)) t = 0.2;
  else if (/\boff[- ]?center\b/.test(text)) t = 0.35;
  return { edgeIndex, t: Math.min(1, Math.max(0, t)) };
}

function repairOneOpening<T extends { position: string; edgeIndex?: number; t?: number }>(
  opening: T,
  polygon: Point[],
): T {
  const poly = sanitizePolygon(polygon);
  let edgeIndex = opening.edgeIndex;
  let t = opening.t;
  let position = opening.position;

  if (edgeIndex !== undefined && !isValidEdgeIndex(poly, edgeIndex)) {
    edgeIndex = undefined;
    t = undefined;
  }

  if (edgeIndex === undefined && poly.length >= 3) {
    const anchor = anchorFromPositionText(poly, position);
    if (anchor) {
      edgeIndex = anchor.edgeIndex;
      t = anchor.t;
      position = describeOpening(poly, anchor.edgeIndex, anchor.t);
    }
  } else if (edgeIndex !== undefined && isValidEdgeIndex(poly, edgeIndex)) {
    t = Math.min(1, Math.max(0, t ?? 0.5));
    position = describeOpening(poly, edgeIndex, t);
  }

  if (edgeIndex !== undefined && isValidEdgeIndex(poly, edgeIndex)) {
    return { ...opening, edgeIndex, t: t ?? 0.5, position };
  }

  const { edgeIndex: _ei, t: _t, ...rest } = opening;
  return { ...rest, position } as T;
}

/** Sanitize polygon vertices and re-anchor windows/doors to valid wall edges. */
export function repairOpeningAnchors(room: DetectedRoom): DetectedRoom {
  const polygon = sanitizePolygon(room.polygon);
  return {
    ...room,
    polygon: polygon.length > 0 ? polygon : room.polygon,
    windows: room.windows.map((w) => repairOneOpening(w, polygon)),
    doors: room.doors.map((d) => repairOneOpening(d, polygon)),
  };
}

/**
 * Which space lies on the far side of edge `edgeIndex` of `room`: probe a point
 * just outside the wall (along its outward normal) and return the containing
 * room's id, or "exterior" when it falls outside every room.
 */
export function inferConnectsTo(
  rooms: { id: string; polygon?: Point[] }[],
  room: { id: string; polygon?: Point[] },
  edgeIndex: number,
  t: number,
  probeMm = 300,
): string {
  const poly = room.polygon ?? [];
  if (poly.length < 3) return "exterior";
  const mid = pointAlongEdge(poly, edgeIndex, t);
  const [nx, ny] = edgeOutwardNormal(poly, edgeIndex);
  const probe: Point = [mid[0] + nx * probeMm, mid[1] + ny * probeMm];
  for (const other of rooms) {
    if (other.id === room.id) continue;
    if (pointInPolygon(probe, other.polygon ?? [])) return other.id;
  }
  return "exterior";
}

/** Round-trip an edge into a canonical key so shared edges dedupe regardless of direction. */
function edgeKey(a: Point, b: Point): string {
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
  return `${Math.round(p[0])},${Math.round(p[1])}|${Math.round(q[0])},${Math.round(q[1])}`;
}

/** Derive wall segments from the union of room polygon edges (shared edges deduped). */
export function deriveWallSegments(
  polygons: Point[][],
  thickness = 120,
): WallSegment[] {
  const seen = new Set<string>();
  const walls: WallSegment[] = [];
  for (const poly of polygons) {
    if (poly.length < 2) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      walls.push({
        x1: a[0],
        y1: a[1],
        x2: b[0],
        y2: b[1],
        thickness,
        lengthMm: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])),
      });
    }
  }
  return walls;
}

// ---------------------------------------------------------------------------
// Shared walls — directed room-to-room adjacency from polygon edge overlaps.
// ---------------------------------------------------------------------------

/** 1-D interval overlap: returns [start, end] or null when disjoint. */
function intervalOverlap(
  a0: number, a1: number, b0: number, b1: number, tol: number,
): [number, number] | null {
  const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  if (hi - lo < tol) return null;
  return [lo, hi];
}

/**
 * Detect every directed shared-wall relationship between rooms.
 *
 * For each pair of edges (one from roomA, one from roomB) that are collinear
 * (within `tolMm`) and overlap along the free axis, a SharedWall record is
 * emitted from roomA's perspective. The reverse pair produces a second record
 * from roomB's perspective.
 */
export function computeSharedWalls(rooms: DetectedRoom[], tolMm = 2): SharedWall[] {
  const valid = rooms.filter((r) => (r.polygon?.length ?? 0) >= 3);
  const result: SharedWall[] = [];

  for (const roomA of valid) {
    const polyA = roomA.polygon!;
    for (const roomB of valid) {
      if (roomA.id === roomB.id) continue;
      const polyB = roomB.polygon!;

      for (let i = 0; i < polyA.length; i++) {
        const a0 = polyA[i];
        const a1 = polyA[(i + 1) % polyA.length];
        const edgeLenA = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
        if (edgeLenA < tolMm) continue;

        for (let j = 0; j < polyB.length; j++) {
          const b0 = polyB[j];
          const b1 = polyB[(j + 1) % polyB.length];

          const isHorizA = Math.abs(a1[1] - a0[1]) <= tolMm;
          const isVertA = Math.abs(a1[0] - a0[0]) <= tolMm;
          const isHorizB = Math.abs(b1[1] - b0[1]) <= tolMm;
          const isVertB = Math.abs(b1[0] - b0[0]) <= tolMm;

          let overlap: [number, number] | null = null;
          let spanAxis: "x" | "y";

          if (isHorizA && isHorizB && Math.abs(a0[1] - b0[1]) <= tolMm) {
            overlap = intervalOverlap(a0[0], a1[0], b0[0], b1[0], tolMm);
            spanAxis = "x";
          } else if (isVertA && isVertB && Math.abs(a0[0] - b0[0]) <= tolMm) {
            overlap = intervalOverlap(a0[1], a1[1], b0[1], b1[1], tolMm);
            spanAxis = "y";
          } else {
            // Non-axis-aligned: check if edges are parallel and collinear.
            const dxa = a1[0] - a0[0], dya = a1[1] - a0[1];
            const dxb = b1[0] - b0[0], dyb = b1[1] - b0[1];
            const cross = dxa * dyb - dya * dxb;
            const lenB = Math.hypot(dxb, dyb);
            if (lenB < tolMm) continue;
            if (Math.abs(cross) > tolMm * Math.max(edgeLenA, lenB)) continue;

            // Perpendicular distance from b0 to the line through a0→a1.
            const perpDist = Math.abs((b0[0] - a0[0]) * dya - (b0[1] - a0[1]) * dxa) / edgeLenA;
            if (perpDist > tolMm) continue;

            // Project both segments onto the a0→a1 direction and find overlap.
            const ux = dxa / edgeLenA, uy = dya / edgeLenA;
            const projA0 = 0, projA1 = edgeLenA;
            const projB0 = (b0[0] - a0[0]) * ux + (b0[1] - a0[1]) * uy;
            const projB1 = (b1[0] - a0[0]) * ux + (b1[1] - a0[1]) * uy;
            const proj = intervalOverlap(projA0, projA1, projB0, projB1, tolMm);
            if (!proj) continue;

            // Map projected interval back to global coordinates.
            const startPt: Point = [a0[0] + ux * proj[0], a0[1] + uy * proj[1]];
            const endPt: Point = [a0[0] + ux * proj[1], a0[1] + uy * proj[1]];
            // Pick whichever axis has the larger span for reporting.
            spanAxis = Math.abs(endPt[0] - startPt[0]) >= Math.abs(endPt[1] - startPt[1]) ? "x" : "y";
            const s = spanAxis === "x" ? [startPt[0], endPt[0]] : [startPt[1], endPt[1]];
            overlap = [Math.min(s[0], s[1]), Math.max(s[0], s[1])];
          }

          if (!overlap) continue;

          const overlapLen = Math.round(overlap[1] - overlap[0]);
          result.push({
            roomId: roomA.id,
            roomName: roomA.name,
            neighborRoomId: roomB.id,
            neighborRoomName: roomB.name,
            compass: compassForEdge(polyA, i),
            edgeIndex: i,
            spanAxis: spanAxis!,
            spanStartMm: Math.round(overlap[0]),
            spanEndMm: Math.round(overlap[1]),
            lengthMm: overlapLen,
            fullWidth: Math.abs(overlapLen - Math.round(edgeLenA)) <= tolMm,
          });
        }
      }
    }
  }

  result.sort((a, b) =>
    a.roomName.localeCompare(b.roomName)
    || a.compass.localeCompare(b.compass)
    || a.neighborRoomName.localeCompare(b.neighborRoomName),
  );
  return result;
}

export function formatSharedWall(sw: SharedWall): string {
  const suffix = sw.fullWidth ? " (full width)" : " (partial)";
  return `${sw.roomName} shares ${sw.compass} wall with ${sw.neighborRoomName} from ${sw.spanAxis}=${sw.spanStartMm} to ${sw.spanAxis}=${sw.spanEndMm} mm${suffix}`;
}

export function sharedWallsSummaryText(walls: SharedWall[]): string {
  if (!walls.length) return "";
  return "SHARED WALL ADJACENCY:\n" + walls.map((w) => `- ${formatSharedWall(w)}`).join("\n");
}
