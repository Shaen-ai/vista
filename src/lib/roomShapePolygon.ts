/**
 * Quick Room polygon templates — labeled corners (A, B, C…) and per-edge lengths.
 * Used by RoomShapeEditor and generation prompts for non-rectangular rooms.
 */

import type { RoomShape as QuickRoomShape } from "@/lib/interiorDesignPrompts";
import type { RoomPolygonEdge } from "@/lib/roomGeometryTypes";

export type Point2 = [number, number];

/** Corner letter for a vertex index: 0 -> "A", 1 -> "B", … (cycles past Z). */
export function cornerLabel(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

export function edgeLabel(fromIndex: number, toIndex: number, cornerCount: number): string {
  return `${cornerLabel(fromIndex)}-${cornerLabel(toIndex % cornerCount)}`;
}

/** True when Quick Room should show the polygon edge editor instead of width/depth. */
export function roomShapeUsesPolygonEditor(shape: string): boolean {
  const s = shape.toLowerCase().trim();
  return s === "l-shaped" || s === "u-shaped";
}

/** Map quick-room shape slug to geometry-extractor shape name. */
export function quickShapeToGeometryShape(shape: string): "L-shape" | "U-shape" | null {
  const s = shape.toLowerCase().trim();
  if (s === "l-shaped") return "L-shape";
  if (s === "u-shaped") return "U-shape";
  return null;
}

/** Unit direction vectors (east=+x, north=+y) for each edge, clockwise from corner A. */
export interface ShapeTemplate {
  geometryShape: "L-shape" | "U-shape";
  /** Edge count and topology — directions are axis-aligned unit steps. */
  edgeDirections: Point2[];
}

/** L-shape: A—B top, B—D right, D—E left, E—F down, F—C left, C—A up. */
export const L_SHAPE_TEMPLATE: ShapeTemplate = {
  geometryShape: "L-shape",
  edgeDirections: [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ],
};

/** U-shape: eight edges forming a U with opening at the top (between B and G). */
export const U_SHAPE_TEMPLATE: ShapeTemplate = {
  geometryShape: "U-shape",
  edgeDirections: [
    [1, 0],
    [0, -1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ],
};

export function getShapeTemplate(shape: string): ShapeTemplate | null {
  const geo = quickShapeToGeometryShape(shape);
  if (geo === "L-shape") return L_SHAPE_TEMPLATE;
  if (geo === "U-shape") return U_SHAPE_TEMPLATE;
  return null;
}

export function defaultEdgeLengthsForTemplate(
  template: ShapeTemplate,
  width: number,
  depth: number,
): number[] {
  const w = Math.max(0.1, width);
  const d = Math.max(0.1, depth);
  if (template.geometryShape === "L-shape") {
    const legW = Math.round(w * 0.55 * 10) / 10;
    const legD = Math.round(d * 0.55 * 10) / 10;
    const notchW = Math.round((w - legW) * 10) / 10;
    const notchD = Math.round((d - legD) * 10) / 10;
    return [w, notchD, notchW, legD, legW, d];
  }
  // U-shape: outer width w, outer depth d, notch width ~40%, leg depth ~55%
  const legD = Math.round(d * 0.55 * 10) / 10;
  const notchW = Math.round(w * 0.4 * 10) / 10;
  const sideW = Math.round(((w - notchW) / 2) * 10) / 10;
  const innerD = Math.round((d - legD) * 10) / 10;
  return [sideW, innerD, notchW, innerD, sideW, legD, w, d];
}

export function buildPolygonEdges(
  template: ShapeTemplate,
  lengths: number[],
): RoomPolygonEdge[] {
  return template.edgeDirections.map((_, i) => ({
    label: edgeLabel(i, i + 1, template.edgeDirections.length),
    length_m: Math.max(0.1, lengths[i] ?? 1),
  }));
}

export function defaultPolygonEdgesForShape(
  shape: string,
  width: number,
  depth: number,
): RoomPolygonEdge[] | undefined {
  const template = getShapeTemplate(shape);
  if (!template) return undefined;
  const lengths = defaultEdgeLengthsForTemplate(template, width, depth);
  return buildPolygonEdges(template, lengths);
}

/** Walk the template using edge lengths to produce corner coordinates (A at origin). */
export function cornersFromPolygonEdges(
  template: ShapeTemplate,
  edges: RoomPolygonEdge[],
): Point2[] {
  const corners: Point2[] = [[0, 0]];
  let x = 0;
  let y = 0;
  for (let i = 0; i < template.edgeDirections.length; i++) {
    const [dx, dy] = template.edgeDirections[i]!;
    const len = Math.max(0.1, edges[i]?.length_m ?? 1);
    const mag = Math.hypot(dx, dy) || 1;
    x += (dx / mag) * len;
    y += (dy / mag) * len;
    corners.push([x, y]);
  }
  return corners;
}

export function bboxFromCorners(corners: Point2[]): { width: number; depth: number } {
  if (corners.length < 2) return { width: 4, depth: 4 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    width: Math.round((maxX - minX) * 10) / 10,
    depth: Math.round((maxY - minY) * 10) / 10,
  };
}

export function bboxFromPolygonEdges(
  shape: string,
  edges: RoomPolygonEdge[],
): { width: number; depth: number } {
  const template = getShapeTemplate(shape);
  if (!template || edges.length !== template.edgeDirections.length) {
    return { width: 4, depth: 4 };
  }
  return bboxFromCorners(cornersFromPolygonEdges(template, edges));
}

export function syncPolygonEdgesForShape(
  shape: string,
  width: number,
  depth: number,
  existing?: RoomPolygonEdge[] | null,
): RoomPolygonEdge[] | undefined {
  const template = getShapeTemplate(shape);
  if (!template) return undefined;
  if (existing && existing.length === template.edgeDirections.length) {
    return existing.map((e, i) => ({
      label: edgeLabel(i, i + 1, template.edgeDirections.length),
      length_m: Math.max(0.1, e.length_m),
    }));
  }
  return defaultPolygonEdgesForShape(shape, width, depth);
}

export function parsePolygonEdges(raw: unknown): RoomPolygonEdge[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const edges: RoomPolygonEdge[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const label =
      typeof o.label === "string" && o.label.trim()
        ? o.label.trim()
        : typeof o.from === "string" && typeof o.to === "string"
          ? `${o.from}-${o.to}`
          : "";
    const length_m =
      typeof o.length_m === "number" && Number.isFinite(o.length_m)
        ? o.length_m
        : typeof o.lengthM === "number" && Number.isFinite(o.lengthM)
          ? o.lengthM
          : NaN;
    if (!label || !Number.isFinite(length_m)) continue;
    edges.push({ label, length_m: Math.max(0.1, length_m) });
  }
  return edges.length > 0 ? edges : undefined;
}

/** Human-readable edge list for Gemini / Claude prompts. */
export function formatPolygonEdgesForPrompt(
  shape: string,
  edges: RoomPolygonEdge[] | undefined,
): string {
  if (!edges?.length || !roomShapeUsesPolygonEditor(shape)) return "";
  const parts = edges.map((e) => `${e.label}: ${e.length_m}m`);
  return `Per-edge floor-plan dimensions (clockwise from corner A): ${parts.join("; ")}. Bounding box ~ ${bboxFromPolygonEdges(shape, edges).width}m × ${bboxFromPolygonEdges(shape, edges).depth}m.`;
}

export function formatRoomDimensionsForPrompt(
  roomShape: string,
  dims: { width: number; depth: number; height: number },
  polygonEdges?: RoomPolygonEdge[] | null,
): string {
  const edgeBlock = formatPolygonEdgesForPrompt(roomShape, polygonEdges ?? undefined);
  if (edgeBlock) return `${edgeBlock} Ceiling: ${dims.height}m.`;
  return `${dims.width}m × ${dims.depth}m, ceiling ${dims.height}m`;
}

/** Normalize quick-room shape for template lookup. */
export function isQuickRoomShape(value: string): value is QuickRoomShape {
  return typeof value === "string" && value.length > 0;
}
