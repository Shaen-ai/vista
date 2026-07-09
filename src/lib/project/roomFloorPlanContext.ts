/**
 * Floor-plan context shared by both AI touchpoints in project mode.
 *
 * Claude receives the original plan, highlighted schematic, and plan text.
 * Gemini receives only real room photos + Claude's translated text rules.
 *
 * This module assembles that context and renders the highlighted schematic
 * server-side (sharp via `svgToPngBuffer`), mirroring the glyphs/colors of
 * `renderFloorPlanImage` and `viewpointDiagram`.
 */

import {
  type Bounds,
  type Point,
  edgeOutwardNormal,
  flipY,
  openingEndpoints,
  pointAlongEdge,
  polygonBBox,
  polygonCentroid,
  sharedWallsSummaryText,
} from "./floorPlanGeometry";
import { svgToPngBuffer } from "./svgRaster";
import { getRoomPhotos } from "./types";
import type {
  DetectedRoom,
  FloorPlanAnalysis,
  ProjectState,
  RoomPhotoWithViewpoint,
} from "./types";

const WALL_COLOR = "#334155";
const ROOM_FILL = "rgba(148,163,184,0.18)";
const TARGET_FILL = "rgba(99,102,241,0.38)";
const TARGET_STROKE = "#6366f1";
const LABEL_COLOR = "#0f172a";
const TARGET_LABEL_COLOR = "#312e81";
const WINDOW_COLOR = "#0ea5e9";
const DOOR_COLOR = "#d97706";

function f(n: number): string {
  return n.toFixed(1);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Corner letter for a vertex index: 0 -> "A", 1 -> "B", … */
function cornerLabel(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

/** Per-edge dimensions string: "A-B: 4.91m, B-C: 2.50m, …" */
export function edgeDimsText(poly: [number, number][]): string {
  const n = poly.length;
  return poly
    .map((_, i) => {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000;
      return `${cornerLabel(i)}-${cornerLabel((i + 1) % n)}: ${len.toFixed(2)}m`;
    })
    .join(", ");
}

export function openingEdgeLabel(edgeIndex: number | undefined, t: number | undefined, poly?: [number, number][]): string {
  if (typeof edgeIndex !== "number" || !poly || poly.length < 2) return "";
  const n = poly.length;
  return ` [wall ${cornerLabel(edgeIndex)}-${cornerLabel((edgeIndex + 1) % n)}, t=${(t ?? 0.5).toFixed(2)}]`;
}

/**
 * Per-room name/type/area/dims/openings summary — the "texts of the floor plan".
 * Shared by the Claude director and the Gemini render prompts so both read the
 * same description of the home.
 */
export function roomSummaryText(analysis: FloorPlanAnalysis, targetRoomId?: string): string {
  const roomLines = analysis.rooms
    .map((r) => {
      const poly = r.polygon;
      const hasEdges = poly && poly.length >= 3;
      const dimsLine = hasEdges
        ? `edges: ${edgeDimsText(poly)}, ceiling ${r.dimensions.height}m`
        : `${r.dimensions.width}×${r.dimensions.depth}m, ceiling ${r.dimensions.height}m`;
      const base =
        `- ${r.name} (${r.type}, ${hasEdges ? poly.length + " corners" : "rect"}): ~${r.estimatedArea}m², ${dimsLine}, ` +
        `${r.windows.length} window(s), ${r.doors.length} door(s)` +
        (r.features.length ? `, features: ${r.features.join(", ")}` : "");
      if (r.id !== targetRoomId) return base;
      // Reference openings ONLY by the diagram's corner-letter edges (A-B, B-C…)
      // — do NOT restate compass placement here. Authoritative wall placement
      // lives once in the OPENINGS lock (camera-relative); mixing vocabularies
      // (compass vs camera-relative) drifts windows onto the wrong wall.
      const winLines = r.windows.map((w, i) => {
        const place = openingEdgeLabel(w.edgeIndex, w.t, poly).trim();
        return `  Window ${i + 1}${place ? ` ${place}` : ""}, ${w.width}m × ${w.height}m`;
      });
      const doorLines = r.doors.map((d, i) => {
        const place = openingEdgeLabel(d.edgeIndex, d.t, poly).trim();
        return `  Door ${i + 1}${place ? ` ${place}` : ""}, ${d.width}m × ${d.height ?? 2.1}m wide → ${d.connectsTo}`;
      });
      return [base, ...winLines, ...doorLines].join("\n");
    })
    .join("\n");

  const adjacency = sharedWallsSummaryText(analysis.sharedWalls ?? []);
  return [roomLines, adjacency].filter(Boolean).join("\n\n");
}

function drawableRooms(rooms: DetectedRoom[]): DetectedRoom[] {
  return rooms.filter((r) => (r.polygon?.length ?? 0) >= 3);
}

/** Bounds (mm) covering every drawable room polygon, with a small margin. */
function extentForRooms(
  rooms: DetectedRoom[],
  imageFrame?: { width: number; height: number },
): Bounds {
  if (imageFrame && imageFrame.width > 0 && imageFrame.height > 0) {
    return { minX: 0, minY: 0, maxX: imageFrame.width, maxY: imageFrame.height };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of rooms) {
    if (!room.polygon || room.polygon.length < 3) continue;
    const bbox = polygonBBox(room.polygon);
    minX = Math.min(minX, bbox.minX);
    minY = Math.min(minY, bbox.minY);
    maxX = Math.max(maxX, bbox.maxX);
    maxY = Math.max(maxY, bbox.maxY);
  }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.05 || 100;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function roomSvgParts(
  room: DetectedRoom,
  bounds: Bounds,
  isTarget: boolean,
  strokes: { wall: number; window: number; door: number; label: number },
  opts?: { omitEdgeLabels?: boolean },
): string[] {
  const poly = room.polygon!;
  const parts: string[] = [];

  const pts = poly.map(([x, y]) => `${f(x)},${f(flipY(y, bounds))}`).join(" ");
  parts.push(
    `<polygon points="${pts}" fill="${isTarget ? TARGET_FILL : ROOM_FILL}" stroke="${
      isTarget ? TARGET_STROKE : WALL_COLOR
    }" stroke-width="${f(isTarget ? strokes.wall * 1.6 : strokes.wall)}" stroke-linejoin="round" />`,
  );

  const [cx, cy] = polygonCentroid(poly);
  parts.push(
    `<text x="${f(cx)}" y="${f(flipY(cy, bounds))}" text-anchor="middle" dominant-baseline="middle" fill="${
      isTarget ? TARGET_LABEL_COLOR : LABEL_COLOR
    }" font-size="${f(isTarget ? strokes.label * 1.1 : strokes.label)}" font-family="sans-serif" font-weight="${
      isTarget ? 800 : 600
    }">${esc(isTarget ? `▶ ${room.name}` : room.name)}</text>`,
  );

  // Corner letters (A, B, C…) at each vertex and per-edge length labels — only on
  // the target room, so the "wall A-B"/"[wall A-B, t=…]" references in the plan
  // text have a visible anchor without cluttering the whole-home schematic.
  if (isTarget) {
    const n = poly.length;
    const cornerFont = strokes.label * 0.62;
    const edgeFont = strokes.label * 0.5;
    const cornerOffset = strokes.label * 0.7;
    for (let i = 0; i < n; i++) {
      const [vx, vy] = poly[i];
      // Push the letter outward from the centroid so it sits beyond the corner.
      const ox = vx - cx;
      const oy = vy - cy;
      const mag = Math.hypot(ox, oy) || 1;
      const lx = vx + (ox / mag) * cornerOffset;
      const ly = vy + (oy / mag) * cornerOffset;
      parts.push(
        `<text x="${f(lx)}" y="${f(flipY(ly, bounds))}" text-anchor="middle" dominant-baseline="middle" fill="${TARGET_STROKE}" font-size="${f(
          cornerFont,
        )}" font-family="sans-serif" font-weight="800">${cornerLabel(i)}</text>`,
      );

      // Edge length labels omitted for FAL Kontext (OCR leak into renders).
      if (!opts?.omitEdgeLabels) {
        const b = poly[(i + 1) % n];
        const lenM = Math.hypot(b[0] - vx, b[1] - vy) / 1000;
        const [nx, ny] = edgeOutwardNormal(poly, i);
        const mid = pointAlongEdge(poly, i, 0.5);
        const ex = mid[0] + nx * strokes.label * 0.45;
        const ey = mid[1] + ny * strokes.label * 0.45;
        parts.push(
          `<text x="${f(ex)}" y="${f(flipY(ey, bounds))}" text-anchor="middle" dominant-baseline="middle" fill="${TARGET_LABEL_COLOR}" font-size="${f(
            edgeFont,
          )}" font-family="sans-serif" font-weight="600">${lenM.toFixed(2)}m</text>`,
        );
      }
    }
  }

  for (const win of room.windows ?? []) {
    if (typeof win.edgeIndex !== "number") continue;
    const [a, b] = openingEndpoints(poly, win.edgeIndex, win.t ?? 0.5, (win.width || 1.2) * 1000);
    parts.push(
      `<line x1="${f(a[0])}" y1="${f(flipY(a[1], bounds))}" x2="${f(b[0])}" y2="${f(
        flipY(b[1], bounds),
      )}" stroke="${WINDOW_COLOR}" stroke-width="${f(strokes.window)}" stroke-linecap="round" />`,
    );
  }

  for (const door of room.doors ?? []) {
    if (typeof door.edgeIndex !== "number") continue;
    const widthMm = (door.width || 0.8) * 1000;
    const [a, b] = openingEndpoints(poly, door.edgeIndex, door.t ?? 0.5, widthMm);
    const [nx, ny] = edgeOutwardNormal(poly, door.edgeIndex);
    const mid = pointAlongEdge(poly, door.edgeIndex, door.t ?? 0.5);
    const tip: Point = [mid[0] + nx * widthMm, mid[1] + ny * widthMm];
    parts.push(
      `<line x1="${f(a[0])}" y1="${f(flipY(a[1], bounds))}" x2="${f(b[0])}" y2="${f(
        flipY(b[1], bounds),
      )}" stroke="${DOOR_COLOR}" stroke-width="${f(strokes.door)}" stroke-linecap="round" />`,
    );
    parts.push(
      `<line x1="${f(mid[0])}" y1="${f(flipY(mid[1], bounds))}" x2="${f(tip[0])}" y2="${f(
        flipY(tip[1], bounds),
      )}" stroke="${DOOR_COLOR}" stroke-width="${f(strokes.door * 0.6)}" stroke-dasharray="${f(
        strokes.door * 2,
      )} ${f(strokes.door)}" />`,
    );
  }

  return parts;
}

/**
 * Render a top-down schematic of the WHOLE plan, filling the target room in an
 * accent color so the model can see which room is being generated. Returns a
 * base64 PNG (no data-URL prefix), or null when no room has a usable polygon.
 *
 * When `targetRoomId` is undefined (whole-home director), every room is drawn
 * with the neutral fill — the schematic still labels all rooms.
 */
export async function renderHighlightedFloorPlan(
  rooms: DetectedRoom[],
  imageFrame: { width: number; height: number } | undefined,
  targetRoomId?: string,
  opts?: { omitEdgeLabels?: boolean },
): Promise<{ base64: string; mimeType: string } | null> {
  const drawable = drawableRooms(rooms);
  if (drawable.length === 0) return null;

  const bounds = extentForRooms(drawable, imageFrame);
  const vbW = bounds.maxX - bounds.minX;
  const vbH = bounds.maxY - bounds.minY;
  if (!(vbW > 0) || !(vbH > 0)) return null;

  const strokes = {
    wall: Math.max(vbW * 0.006, 50),
    window: Math.max(vbW * 0.012, 110),
    door: Math.max(vbW * 0.008, 80),
    label: Math.max(vbW * 0.02, 200),
  };

  const parts: string[] = [];
  // Non-target rooms first so the highlighted room's stroke sits on top.
  for (const room of drawable) {
    if (room.id === targetRoomId) continue;
    parts.push(...roomSvgParts(room, bounds, false, strokes, opts));
  }
  const target = targetRoomId ? drawable.find((r) => r.id === targetRoomId) : undefined;
  if (target) parts.push(...roomSvgParts(target, bounds, true, strokes, opts));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(bounds.minX)} ${f(
    bounds.minY,
  )} ${f(vbW)} ${f(vbH)}"><rect x="${f(bounds.minX)}" y="${f(bounds.minY)}" width="${f(
    vbW,
  )}" height="${f(vbH)}" fill="#ffffff" />${parts.join("")}</svg>`;

  const png = await svgToPngBuffer(svg, 1400);
  if (!png) return null;
  return { base64: png.toString("base64"), mimeType: "image/png" };
}

export interface RoomFloorPlanContext {
  /** Original uploaded plan image (carries printed labels/dimensions). */
  originalPlan?: { base64: string; mimeType: string };
  /** Schematic with the target room filled in an accent color. */
  highlightedPlan?: { base64: string; mimeType: string };
  /** Per-room floor-plan summary + a caption naming the target room. */
  planText: string;
  /** Every photo assigned to this room. */
  roomPhotos: RoomPhotoWithViewpoint[];
}

/**
 * Assemble the floor-plan context for a single room being generated.
 * Every field is best-effort: missing data is simply omitted.
 */
export async function buildRoomFloorPlanContext(
  state: ProjectState,
  roomId: string,
): Promise<RoomFloorPlanContext> {
  const analysis = state.analysis;
  const targetRoom = analysis?.rooms.find((r) => r.id === roomId);

  const originalPlan =
    state.floorPlanBase64 && state.floorPlanMimeType
      ? { base64: state.floorPlanBase64, mimeType: state.floorPlanMimeType }
      : undefined;

  const highlightedPlan = analysis
    ? (await renderHighlightedFloorPlan(analysis.rooms, analysis.imageFrame, roomId)) ?? undefined
    : undefined;

  const caption = targetRoom
    ? `\nTarget room to generate: "${targetRoom.name}" (${targetRoom.type}), id ${roomId} — highlighted in the schematic.`
    : `\nTarget room id: ${roomId}.`;
  const planText = (analysis ? roomSummaryText(analysis, roomId) : "") + caption;

  return {
    originalPlan,
    highlightedPlan,
    planText: planText.trim(),
    roomPhotos: getRoomPhotos(state, roomId),
  };
}
