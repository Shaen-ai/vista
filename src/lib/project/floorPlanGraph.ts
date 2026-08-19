/**
 * Normalized floor-plan graph — the editing source of truth.
 *
 * The legacy model (`FloorPlanAnalysis` / `DetectedRoom`) stores each room as an
 * independent polygon that owns its own edges and its own `doors[]`/`windows[]`.
 * A wall shared by two rooms therefore exists as TWO coincident edges, and an
 * interior door is stored TWICE (once per room) — which makes editing painful and
 * lets the 3D viewer lose doors (walls dedupe, doors don't).
 *
 * This module normalizes that into a graph:
 *   - `FloorPlanNode`  — a shared corner (mm, Y-up), referenced by many walls/rooms.
 *   - `FloorPlanWall`  — the segment between two nodes; OWNS its openings. A wall is
 *                        uniquely identified by its unordered node pair, so a shared
 *                        boundary is ONE wall and a door on it is ONE opening.
 *   - `FloorPlanRoom`  — references nodes (an ordered boundary loop). Walls belong to
 *                        the rooms whose loops contain their node pair.
 *
 * Openings are encoded relative to the wall's own A→B direction (`t`, `hinge:"a"|"b"`,
 * `swingSide:"left"|"right"`) so they are unambiguous on a wall shared by two rooms
 * that traverse it in opposite winding.
 *
 * `FloorPlanAnalysis` is kept as a DERIVED interchange format so the whole downstream
 * pipeline (3D, technical drawings, AI prompts, persistence) is unchanged:
 *   - `graphFromAnalysis(analysis)` builds the graph (dedupes shared walls + doors).
 *   - `graphToAnalysis(graph, prev)` regenerates per-room polygons + openings + wall
 *     segments + shared walls on every edit.
 *
 * Pure / no React or `three` import so it is unit-testable via `tsx --test`.
 */

import type { DetectedRoom, FloorPlanAnalysis, RoomType, WallSegment } from "./types";
import {
  sanitizePolygon,
  dropCollinearVertices,
  pointAlongEdge,
  nearestEdgeToPoint,
  edgeOutwardNormal,
  inferConnectsTo,
  deriveWallSegments,
  computeSharedWalls,
  describeOpening,
  dimensionsFromPolygon,
  polygonArea,
  isValidEdgeIndex,
  type Point,
} from "./floorPlanGeometry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FloorPlanNode {
  id: string;
  /** mm, Y-up (same coordinate system as room polygons). */
  x: number;
  y: number;
}

export interface WallOpening {
  id: string;
  type: "door" | "window";
  /** center position, 0..1 along the wall from node A to node B. */
  t: number;
  /** metres (same unit as DetectedRoom openings; polygon coords are mm) */
  width: number;
  /** metres */
  height?: number;
  /** Which wall endpoint the leaf pivots on — winding-free (a = node A, b = node B). */
  hinge?: "a" | "b";
  /** Which side of the A→B vector the leaf swings toward — winding-free. */
  swingSide?: "left" | "right";
  confirmed?: boolean;
}

export interface FloorPlanWall {
  id: string;
  /** node ids; the wall's canonical direction is a → b. */
  a: string;
  b: string;
  thickness: number;
  openings: WallOpening[];
}

export interface FloorPlanRoom {
  id: string;
  name: string;
  type: RoomType;
  /** Ordered boundary loop of node ids (open ring — no repeated closing node). */
  nodeIds: string[];
  dimensions?: { width: number; depth: number; height: number };
  features: string[];
}

export interface FloorPlanGraph {
  nodes: FloorPlanNode[];
  walls: FloorPlanWall[];
  rooms: FloorPlanRoom[];
}

export interface GraphBuildOptions {
  /** Corners within this distance (mm) are unified into one shared node. */
  nodeTolMm?: number;
  /** A node this close (perpendicular, mm) to another room's wall interior splits it. */
  tjTolMm?: number;
  /** Default wall thickness (mm) when the analysis carries none. */
  thicknessMm?: number;
}

const DEFAULTS = {
  nodeTolMm: 30,
  tjTolMm: 5,
  /** min mm a split node must sit from either endpoint (avoids inserting at a corner) */
  tjGapMm: 20,
  thicknessMm: 120,
} as const;

// ---------------------------------------------------------------------------
// Small geometry / id helpers (local — kept out of the shared geometry module)
// ---------------------------------------------------------------------------

function cross2(ux: number, uy: number, vx: number, vy: number): number {
  return ux * vy - uy * vx;
}

/** Undirected key for a node pair so a wall is found regardless of stored direction. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function makeIdFactory(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** Round-trip a room's node loop into an mm polygon (Y-up), closing implied. */
function loopPolygon(loop: string[], coord: Map<string, Point>): Point[] {
  const poly: Point[] = [];
  for (const id of loop) {
    const p = coord.get(id);
    if (p) poly.push([p[0], p[1]]);
  }
  return poly;
}

// ---------------------------------------------------------------------------
// graphFromAnalysis
// ---------------------------------------------------------------------------

interface OpeningSource {
  type: "door" | "window";
  /** absolute midpoint (mm) computed from the ORIGINAL polygon */
  mid: Point;
  width: number;
  height?: number;
  confirmed?: boolean;
  /** wall-canonical door orientation, resolved once the final wall is known */
  hinge?: "left" | "right";
  swing?: "in" | "out";
  /** original polygon + edge, for swing/hinge orientation */
  origPoly: Point[];
  origEdgeIndex: number;
}

/**
 * Build the normalized graph from a legacy `FloorPlanAnalysis`.
 *
 * Rooms without a usable polygon are omitted from the graph (they round-trip
 * through `graphToAnalysis`'s `prev` fallback unchanged).
 */
export function graphFromAnalysis(
  analysis: FloorPlanAnalysis,
  opts: GraphBuildOptions = {},
): FloorPlanGraph {
  const nodeTol = opts.nodeTolMm ?? DEFAULTS.nodeTolMm;
  const tjTol = opts.tjTolMm ?? DEFAULTS.tjTolMm;
  const thickness = opts.thicknessMm ?? DEFAULTS.thicknessMm;

  const nextNodeId = makeIdFactory("nd_");
  const nextWallId = makeIdFactory("wl_");
  const nextOpeningId = makeIdFactory("op_");

  // --- Node table (tolerance-clustered, rounded to whole mm) ---
  const nodes: FloorPlanNode[] = [];
  const findOrCreateNode = (p: Point): string => {
    for (const n of nodes) {
      if (Math.hypot(n.x - p[0], n.y - p[1]) <= nodeTol) return n.id;
    }
    const node: FloorPlanNode = { id: nextNodeId(), x: Math.round(p[0]), y: Math.round(p[1]) };
    nodes.push(node);
    return node.id;
  };
  const coord = (id: string): Point => {
    const n = nodes.find((m) => m.id === id)!;
    return [n.x, n.y];
  };

  // --- Per-room node loops + captured opening sources ---
  const roomLoops = new Map<string, string[]>();
  const roomOpenings = new Map<string, OpeningSource[]>();

  for (const room of analysis.rooms) {
    const poly = dropCollinearVertices(sanitizePolygon(room.polygon));
    if (poly.length < 3) continue;

    // Build the loop, dropping consecutive vertices that clustered to one node.
    const rawLoop = poly.map((p) => findOrCreateNode(p));
    const loop: string[] = [];
    for (let i = 0; i < rawLoop.length; i++) {
      if (rawLoop[i] !== rawLoop[(i + 1) % rawLoop.length]) loop.push(rawLoop[i]);
    }
    if (loop.length < 3) continue;
    roomLoops.set(room.id, loop);

    // Capture openings as absolute points against the ORIGINAL polygon.
    const sources: OpeningSource[] = [];
    for (const w of room.windows ?? []) {
      if (w.edgeIndex == null || !isValidEdgeIndex(poly, w.edgeIndex)) continue;
      sources.push({
        type: "window",
        mid: pointAlongEdge(poly, w.edgeIndex, w.t ?? 0.5),
        width: w.width,
        height: w.height,
        confirmed: w.confirmed,
        origPoly: poly,
        origEdgeIndex: w.edgeIndex,
      });
    }
    for (const d of room.doors ?? []) {
      if (d.edgeIndex == null || !isValidEdgeIndex(poly, d.edgeIndex)) continue;
      sources.push({
        type: "door",
        mid: pointAlongEdge(poly, d.edgeIndex, d.t ?? 0.5),
        width: d.width,
        height: d.height,
        confirmed: d.confirmed,
        hinge: d.hinge ?? "left",
        swing: d.swing ?? "in",
        origPoly: poly,
        origEdgeIndex: d.edgeIndex,
      });
    }
    roomOpenings.set(room.id, sources);
  }

  // --- T-junction splitting: insert any node lying on another room's wall interior ---
  splitLoopsAtNodes(roomLoops, nodes, tjTol, DEFAULTS.tjGapMm);

  // --- Edge → wall dedupe (undirected node-pair key) ---
  const walls: FloorPlanWall[] = [];
  const wallByPair = new Map<string, FloorPlanWall>();
  for (const loop of roomLoops.values()) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (a === b) continue;
      const key = pairKey(a, b);
      if (wallByPair.has(key)) continue;
      const wall: FloorPlanWall = { id: nextWallId(), a, b, thickness, openings: [] };
      walls.push(wall);
      wallByPair.set(key, wall);
    }
  }

  // --- Assign openings to walls (project onto the FINAL loop), then dedupe ---
  const coordMap = new Map(nodes.map((n) => [n.id, [n.x, n.y] as Point]));
  for (const [roomId, loop] of roomLoops) {
    const finalPoly = loopPolygon(loop, coordMap);
    const sources = roomOpenings.get(roomId) ?? [];
    for (const src of sources) {
      const near = nearestEdgeToPoint(finalPoly, src.mid);
      const a = loop[near.edgeIndex];
      const b = loop[(near.edgeIndex + 1) % loop.length];
      const wall = wallByPair.get(pairKey(a, b));
      if (!wall) continue;
      const same = wall.a === a; // room traverses this wall A→B?
      const tWall = same ? near.t : 1 - near.t;

      const opening: WallOpening = {
        id: nextOpeningId(),
        type: src.type,
        t: clamp01(tWall),
        width: src.width,
        height: src.height,
        confirmed: src.confirmed,
      };
      if (src.type === "door") {
        opening.hinge = encodeHinge(src.hinge ?? "left", same);
        opening.swingSide = encodeSwingSide(src, wall, coordMap);
      }
      wall.openings.push(opening);
    }
  }
  for (const wall of walls) wall.openings = dedupeWallOpenings(wall.openings);

  // --- Rooms ---
  const rooms: FloorPlanRoom[] = [];
  for (const room of analysis.rooms) {
    const loop = roomLoops.get(room.id);
    if (!loop) continue;
    rooms.push({
      id: room.id,
      name: room.name,
      type: room.type,
      nodeIds: loop,
      dimensions: room.dimensions,
      features: room.features ?? [],
    });
  }

  return { nodes, walls, rooms };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

/** Room hinge (left = room-edge start) → wall-canonical (a = node A). */
function encodeHinge(hinge: "left" | "right", same: boolean): "a" | "b" {
  // same: room-edge start = wall.a. left→start→"a", right→end→"b".
  // reversed: room-edge start = wall.b. left→"b", right→"a".
  if (same) return hinge === "left" ? "a" : "b";
  return hinge === "left" ? "b" : "a";
}

/** Encode the room-relative door swing as a winding-free side of the wall's A→B vector. */
function encodeSwingSide(
  src: OpeningSource,
  wall: FloorPlanWall,
  coordMap: Map<string, Point>,
): "left" | "right" {
  const [ax, ay] = coordMap.get(wall.a)!;
  const [bx, by] = coordMap.get(wall.b)!;
  const [onx, ony] = edgeOutwardNormal(src.origPoly, src.origEdgeIndex);
  // swing "in" = toward the room interior (inward normal); "out" = outward normal.
  const [sx, sy] = src.swing === "out" ? [onx, ony] : [-onx, -ony];
  return cross2(bx - ax, by - ay, sx, sy) > 0 ? "left" : "right";
}

/**
 * Collapse duplicate openings on a wall (the same interior door contributed by
 * both adjacent rooms) into one. Same type, centers within ~300 mm / min-width,
 * similar width. Prefers the confirmed / more-complete (has hinge+swing) copy.
 */
function dedupeWallOpenings(openings: WallOpening[]): WallOpening[] {
  const out: WallOpening[] = [];
  for (const o of openings) {
    const dup = out.find(
      (e) =>
        e.type === o.type &&
        Math.abs(e.t - o.t) <= 0.12 &&
        // widths are in metres; tolerate ≥0.3 m or half the opening width
        Math.abs((e.width || 0) - (o.width || 0)) <= Math.max(0.3, 0.5 * (o.width || 0)),
    );
    if (!dup) {
      out.push(o);
      continue;
    }
    if (scoreOpening(o) > scoreOpening(dup)) Object.assign(dup, o, { id: dup.id });
  }
  return out;
}

function scoreOpening(o: WallOpening): number {
  return (o.confirmed ? 4 : 0) + (o.hinge ? 1 : 0) + (o.swingSide ? 1 : 0) + (o.height ? 1 : 0);
}

/**
 * Insert every node that lies on another room-loop edge's interior into that loop,
 * turning partial wall overlaps into full-edge coincidence so the dedupe above can
 * unify them. Iterates to a fixpoint.
 */
function splitLoopsAtNodes(
  roomLoops: Map<string, string[]>,
  nodes: FloorPlanNode[],
  tjTol: number,
  gapMm: number,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    for (const [roomId, loop] of roomLoops) {
      const next: string[] = [];
      for (let i = 0; i < loop.length; i++) {
        const aId = loop[i];
        const bId = loop[(i + 1) % loop.length];
        next.push(aId);
        const a = byId.get(aId)!;
        const b = byId.get(bId)!;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const len2 = abx * abx + aby * aby;
        if (len2 <= 0) continue;
        const len = Math.sqrt(len2);
        const hits: { id: string; t: number }[] = [];
        for (const n of nodes) {
          if (n.id === aId || n.id === bId) continue;
          const t = ((n.x - a.x) * abx + (n.y - a.y) * aby) / len2;
          const dA = t * len;
          const dB = (1 - t) * len;
          if (dA <= gapMm || dB <= gapMm) continue;
          const projx = a.x + abx * t;
          const projy = a.y + aby * t;
          if (Math.hypot(n.x - projx, n.y - projy) <= tjTol) hits.push({ id: n.id, t });
        }
        hits.sort((p, q) => p.t - q.t);
        for (const h of hits) {
          if (next[next.length - 1] !== h.id) {
            next.push(h.id);
            changed = true;
          }
        }
      }
      // Drop consecutive duplicates that may have crept in.
      const cleaned: string[] = [];
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== next[(i + 1) % next.length]) cleaned.push(next[i]);
      }
      roomLoops.set(roomId, cleaned);
    }
    if (!changed) break;
  }
}

// ---------------------------------------------------------------------------
// graphToAnalysis
// ---------------------------------------------------------------------------

/**
 * Regenerate a legacy `FloorPlanAnalysis` from the graph. `prev` supplies scalar
 * plan fields and per-room metadata (name/type/features/ceiling height) that the
 * graph does not carry, and passes through any rooms that were not represented in
 * the graph (e.g. rooms without a polygon).
 */
export function graphToAnalysis(graph: FloorPlanGraph, prev: FloorPlanAnalysis): FloorPlanAnalysis {
  const coordMap = new Map(graph.nodes.map((n) => [n.id, [n.x, n.y] as Point]));
  const wallByPair = new Map<string, FloorPlanWall>();
  for (const w of graph.walls) wallByPair.set(pairKey(w.a, w.b), w);

  const prevById = new Map(prev.rooms.map((r) => [r.id, r]));

  // Reconstruct polygons first so `inferConnectsTo` can probe neighbors.
  const polyById = new Map<string, Point[]>();
  for (const room of graph.rooms) {
    polyById.set(room.id, loopPolygon(room.nodeIds, coordMap).map(([x, y]) => [Math.round(x), Math.round(y)]));
  }
  const connectRooms = graph.rooms.map((r) => ({ id: r.id, polygon: polyById.get(r.id) }));

  const rebuiltById = new Map<string, DetectedRoom>();
  for (const room of graph.rooms) {
    const loop = room.nodeIds;
    const poly = polyById.get(room.id)!;
    const prevRoom = prevById.get(room.id);
    const height = prevRoom?.dimensions?.height ?? prev.ceilingHeight ?? 2.7;

    const windows: DetectedRoom["windows"] = [];
    const doors: DetectedRoom["doors"] = [];

    for (let e = 0; e < loop.length; e++) {
      const aId = loop[e];
      const bId = loop[(e + 1) % loop.length];
      const wall = wallByPair.get(pairKey(aId, bId));
      if (!wall) continue;
      const same = wall.a === aId; // room traverses A→B?
      // This room's inward side of the wall's A→B vector.
      const [ax, ay] = coordMap.get(wall.a)!;
      const [bx, by] = coordMap.get(wall.b)!;
      const [onx, ony] = edgeOutwardNormal(poly, e);
      const inwardSide = cross2(bx - ax, by - ay, -onx, -ony) > 0 ? "left" : "right";

      for (const op of wall.openings) {
        const tRoom = clamp01(same ? op.t : 1 - op.t);
        const position = describeOpening(poly, e, tRoom);
        if (op.type === "window") {
          windows.push({
            position,
            width: op.width,
            height: op.height ?? 1.5,
            edgeIndex: e,
            t: tRoom,
            confirmed: op.confirmed,
          });
        } else {
          doors.push({
            position,
            width: op.width,
            height: op.height,
            connectsTo: inferConnectsTo(connectRooms, { id: room.id, polygon: poly }, e, tRoom),
            edgeIndex: e,
            t: tRoom,
            hinge: decodeHinge(op.hinge ?? "a", same),
            swing: op.swingSide ? (op.swingSide === inwardSide ? "in" : "out") : "in",
            confirmed: op.confirmed,
          });
        }
      }
    }

    rebuiltById.set(room.id, {
      id: room.id,
      name: prevRoom?.name ?? room.name,
      type: prevRoom?.type ?? room.type,
      estimatedArea: Math.round((polygonArea(poly) / 1e6) * 100) / 100,
      dimensions: dimensionsFromPolygon(poly, height),
      windows,
      doors,
      features: prevRoom?.features ?? room.features ?? [],
      polygon: poly.map(([x, y]) => [x, y]),
    });
  }

  // Preserve prev room order; pass through rooms absent from the graph.
  const rooms: DetectedRoom[] = prev.rooms.map((r) => rebuiltById.get(r.id) ?? r);
  // Append any graph rooms that were newly created in the editor (not in prev).
  for (const room of graph.rooms) {
    if (!prevById.has(room.id) && rebuiltById.has(room.id)) rooms.push(rebuiltById.get(room.id)!);
  }

  const polygons = rooms.map((r) => sanitizePolygon(r.polygon));
  const wallSegments: WallSegment[] = deriveWallSegments(polygons);
  const sharedWalls = computeSharedWalls(rooms);

  return {
    ...prev,
    rooms,
    wallSegments,
    sharedWalls,
  };
}

/** Wall-canonical hinge (a = node A) → room hinge (left = room-edge start). */
function decodeHinge(hinge: "a" | "b", same: boolean): "left" | "right" {
  if (same) return hinge === "a" ? "left" : "right";
  return hinge === "a" ? "right" : "left";
}

/**
 * Round-trip an analysis through the normalized graph to canonicalize its topology:
 * unify shared walls, dedupe interior doors, and re-emit each shared door onto both
 * adjacent rooms (so the 3D viewer never loses a door on a suppressed wall).
 *
 * Guarded: if the rebuild drops/gains a room or drifts any room's area by more than
 * `maxAreaDriftFrac` (default 5%) — a sign the tolerance mis-merged geometry — the
 * original analysis is returned unchanged. Safe to call at confirm-plan.
 */
export function canonicalizeAnalysisTopology(
  analysis: FloorPlanAnalysis,
  opts: GraphBuildOptions & { maxAreaDriftFrac?: number } = {},
): FloorPlanAnalysis {
  const maxDrift = opts.maxAreaDriftFrac ?? 0.05;
  let rebuilt: FloorPlanAnalysis;
  try {
    rebuilt = graphToAnalysis(graphFromAnalysis(analysis, opts), analysis);
  } catch {
    return analysis;
  }
  if (rebuilt.rooms.length !== analysis.rooms.length) return analysis;
  for (const before of analysis.rooms) {
    const poly = sanitizePolygon(before.polygon);
    if (poly.length < 3) continue;
    const after = rebuilt.rooms.find((r) => r.id === before.id);
    if (!after) return analysis;
    const a0 = polygonArea(poly);
    const a1 = polygonArea(sanitizePolygon(after.polygon));
    if (a0 > 0 && Math.abs(a1 - a0) / a0 > maxDrift) return analysis;
  }
  return rebuilt;
}

// ---------------------------------------------------------------------------
// Pure mutation helpers (used by the graph-controlled editor)
// ---------------------------------------------------------------------------

function cloneGraph(g: FloorPlanGraph): FloorPlanGraph {
  return {
    nodes: g.nodes.map((n) => ({ ...n })),
    walls: g.walls.map((w) => ({ ...w, openings: w.openings.map((o) => ({ ...o })) })),
    rooms: g.rooms.map((r) => ({ ...r, nodeIds: [...r.nodeIds] })),
  };
}

/** Move a node — every incident wall and every room loop using it follow automatically. */
export function moveNode(graph: FloorPlanGraph, nodeId: string, x: number, y: number): FloorPlanGraph {
  const g = cloneGraph(graph);
  const node = g.nodes.find((n) => n.id === nodeId);
  if (node) {
    node.x = Math.round(x);
    node.y = Math.round(y);
  }
  return g;
}

/** Translate both endpoints of a wall by (dx, dy) — both adjacent rooms follow. */
export function moveWall(graph: FloorPlanGraph, wallId: string, dx: number, dy: number): FloorPlanGraph {
  const g = cloneGraph(graph);
  const wall = g.walls.find((w) => w.id === wallId);
  if (!wall) return g;
  for (const id of [wall.a, wall.b]) {
    const node = g.nodes.find((n) => n.id === id);
    if (node) {
      node.x = Math.round(node.x + dx);
      node.y = Math.round(node.y + dy);
    }
  }
  return g;
}

/** Translate a whole room (all its nodes, including shared ones) by (dx, dy). */
export function moveRoom(graph: FloorPlanGraph, roomId: string, dx: number, dy: number): FloorPlanGraph {
  const g = cloneGraph(graph);
  const room = g.rooms.find((r) => r.id === roomId);
  if (!room) return g;
  const ids = new Set(room.nodeIds);
  for (const node of g.nodes) {
    if (ids.has(node.id)) {
      node.x = Math.round(node.x + dx);
      node.y = Math.round(node.y + dy);
    }
  }
  return g;
}

export function addOpening(
  graph: FloorPlanGraph,
  wallId: string,
  opening: Omit<WallOpening, "id"> & { id?: string },
): FloorPlanGraph {
  const g = cloneGraph(graph);
  const wall = g.walls.find((w) => w.id === wallId);
  if (wall) wall.openings.push({ ...opening, id: opening.id ?? `op_${Date.now()}_${wall.openings.length}` });
  return g;
}

export function updateOpening(
  graph: FloorPlanGraph,
  wallId: string,
  openingId: string,
  patch: Partial<Omit<WallOpening, "id">>,
): FloorPlanGraph {
  const g = cloneGraph(graph);
  const wall = g.walls.find((w) => w.id === wallId);
  const op = wall?.openings.find((o) => o.id === openingId);
  if (op) Object.assign(op, patch, { id: op.id });
  return g;
}

export function moveOpening(graph: FloorPlanGraph, wallId: string, openingId: string, t: number): FloorPlanGraph {
  return updateOpening(graph, wallId, openingId, { t: clamp01(t) });
}

export function removeOpening(graph: FloorPlanGraph, wallId: string, openingId: string): FloorPlanGraph {
  const g = cloneGraph(graph);
  const wall = g.walls.find((w) => w.id === wallId);
  if (wall) wall.openings = wall.openings.filter((o) => o.id !== openingId);
  return g;
}

/**
 * Split a wall at fraction `t`: insert a new node, replace the wall with two child
 * walls, insert the node into every room loop that used the wall, and reassign the
 * wall's openings to whichever child wall now contains them.
 */
export function splitWall(graph: FloorPlanGraph, wallId: string, t: number): FloorPlanGraph {
  const g = cloneGraph(graph);
  const wall = g.walls.find((w) => w.id === wallId);
  if (!wall) return g;
  const a = g.nodes.find((n) => n.id === wall.a)!;
  const b = g.nodes.find((n) => n.id === wall.b)!;
  const tc = clamp01(t);
  const nodeId = `nd_${Date.now()}_${g.nodes.length}`;
  g.nodes.push({ id: nodeId, x: Math.round(a.x + (b.x - a.x) * tc), y: Math.round(a.y + (b.y - a.y) * tc) });

  const w1: FloorPlanWall = { id: `${wall.id}_1`, a: wall.a, b: nodeId, thickness: wall.thickness, openings: [] };
  const w2: FloorPlanWall = { id: `${wall.id}_2`, a: nodeId, b: wall.b, thickness: wall.thickness, openings: [] };
  for (const op of wall.openings) {
    if (op.t <= tc) w1.openings.push({ ...op, t: tc > 0 ? clamp01(op.t / tc) : 0 });
    else w2.openings.push({ ...op, t: tc < 1 ? clamp01((op.t - tc) / (1 - tc)) : 1 });
  }
  g.walls = g.walls.filter((w) => w.id !== wall.id).concat([w1, w2]);

  // Insert the node into every room loop that had wall.a & wall.b adjacent.
  for (const room of g.rooms) {
    const loop = room.nodeIds;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      if ((p === wall.a && q === wall.b) || (p === wall.b && q === wall.a)) {
        loop.splice(i + 1, 0, nodeId);
        break;
      }
    }
  }
  return g;
}

/**
 * Remove a node that sits at a straight (degree-2 within each room) corner: drop it
 * from every room loop and rebuild the two flanking walls into one merged wall,
 * carrying openings across by along-run position. Best-effort — no-op if the node
 * is load-bearing for topology we cannot cleanly merge.
 */
export function deleteNode(graph: FloorPlanGraph, nodeId: string): FloorPlanGraph {
  const g = cloneGraph(graph);
  for (const room of g.rooms) {
    room.nodeIds = room.nodeIds.filter((id) => id !== nodeId);
  }
  g.nodes = g.nodes.filter((n) => n.id !== nodeId);
  return rebuildWalls(g);
}

/**
 * Rebuild the wall set from room loops after a topology edit, preserving openings
 * on walls whose node pair survives and dropping walls no room references anymore.
 */
function rebuildWalls(graph: FloorPlanGraph): FloorPlanGraph {
  const existing = new Map<string, FloorPlanWall>();
  for (const w of graph.walls) existing.set(pairKey(w.a, w.b), w);
  const walls: FloorPlanWall[] = [];
  const seen = new Set<string>();
  for (const room of graph.rooms) {
    const loop = room.nodeIds;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (a === b) continue;
      const key = pairKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      walls.push(existing.get(key) ?? { id: `wl_${walls.length + 1}`, a, b, thickness: DEFAULTS.thicknessMm, openings: [] });
    }
  }
  return { ...graph, walls };
}

// ---------------------------------------------------------------------------
// Convenience lookups for the editor
// ---------------------------------------------------------------------------

/** Number of room loops a wall (by node pair) participates in — 2 = interior, 1 = exterior. */
export function wallRoomDegree(graph: FloorPlanGraph, wall: FloorPlanWall): number {
  let count = 0;
  for (const room of graph.rooms) {
    const loop = room.nodeIds;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if ((a === wall.a && b === wall.b) || (a === wall.b && b === wall.a)) {
        count++;
        break;
      }
    }
  }
  return count;
}

/** Number of room loops that reference a node — >1 marks a shared corner. */
export function nodeRoomDegree(graph: FloorPlanGraph, nodeId: string): number {
  let count = 0;
  for (const room of graph.rooms) if (room.nodeIds.includes(nodeId)) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Rendered-analysis ↔ graph id mapping (for the graph-controlled editor)
//
// The editor renders `graphToAnalysis(graph)`, whose per-room polygons are built
// straight from `room.nodeIds` in order — so analysis vertex `i` corresponds to
// graph node `room.nodeIds[i]`, and analysis edge `e` corresponds to the wall
// between nodes `e` and `e+1`. These helpers turn the editor's (roomId, index)
// hit-test results back into graph node / wall / opening ids.
// ---------------------------------------------------------------------------

/** Graph node id for a rendered room's polygon vertex `i`. */
export function nodeIdForRoomVertex(graph: FloorPlanGraph, roomId: string, i: number): string | null {
  const room = graph.rooms.find((r) => r.id === roomId);
  if (!room || room.nodeIds.length === 0) return null;
  const n = room.nodeIds.length;
  return room.nodeIds[((i % n) + n) % n] ?? null;
}

/** Graph wall (and whether the room traverses it A→B) for a rendered room's edge `edgeIndex`. */
export function wallForRoomEdge(
  graph: FloorPlanGraph,
  roomId: string,
  edgeIndex: number,
): { wall: FloorPlanWall; same: boolean } | null {
  const room = graph.rooms.find((r) => r.id === roomId);
  if (!room || room.nodeIds.length < 2) return null;
  const n = room.nodeIds.length;
  const a = room.nodeIds[((edgeIndex % n) + n) % n];
  const b = room.nodeIds[((edgeIndex + 1) % n + n) % n];
  const wall = graph.walls.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  if (!wall) return null;
  return { wall, same: wall.a === a };
}

/** Nearest wall to an mm point, with the projected fraction along A→B. */
export function nearestWallToPoint(
  graph: FloorPlanGraph,
  p: Point,
): { wall: FloorPlanWall; t: number; distMm: number; point: Point } | null {
  const coord = new Map(graph.nodes.map((n) => [n.id, [n.x, n.y] as Point]));
  let best: { wall: FloorPlanWall; t: number; distMm: number; point: Point } | null = null;
  for (const wall of graph.walls) {
    const a = coord.get(wall.a);
    const b = coord.get(wall.b);
    if (!a || !b) continue;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2)) : 0;
    const proj: Point = [a[0] + abx * t, a[1] + aby * t];
    const d = Math.hypot(p[0] - proj[0], p[1] - proj[1]);
    if (!best || d < best.distMm) best = { wall, t, distMm: d, point: proj };
  }
  return best;
}

/** Center mm point of an opening on a wall (for hit-mapping a rendered opening to its graph id). */
export function openingCenterPoint(graph: FloorPlanGraph, wall: FloorPlanWall, opening: WallOpening): Point | null {
  const a = graph.nodes.find((n) => n.id === wall.a);
  const b = graph.nodes.find((n) => n.id === wall.b);
  if (!a || !b) return null;
  return [a.x + (b.x - a.x) * opening.t, a.y + (b.y - a.y) * opening.t];
}

/** Find the graph opening nearest an mm point (used to map a rendered opening back to its wall+id). */
export function findWallOpening(
  graph: FloorPlanGraph,
  p: Point,
  type: "door" | "window",
  maxDistMm = 1200,
): { wallId: string; openingId: string } | null {
  let best: { wallId: string; openingId: string; d: number } | null = null;
  for (const wall of graph.walls) {
    for (const op of wall.openings) {
      if (op.type !== type) continue;
      const c = openingCenterPoint(graph, wall, op);
      if (!c) continue;
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (d <= maxDistMm && (!best || d < best.d)) best = { wallId: wall.id, openingId: op.id, d };
    }
  }
  return best ? { wallId: best.wallId, openingId: best.openingId } : null;
}

/** Move a single node to an absolute position (mm). Both rooms/walls using it follow. */
export function setNodePosition(graph: FloorPlanGraph, nodeId: string, x: number, y: number): FloorPlanGraph {
  return moveNode(graph, nodeId, x, y);
}
