/**
 * Server-side floor-plan-with-camera-cone diagram.
 *
 * Renders a single room polygon, its openings, and a translucent field-of-view
 * wedge from the marked camera viewpoint, then rasterizes to PNG via the shared
 * sharp helper. Sent to Gemini as a visual anchor so the generated render matches
 * the intended vantage. Mirrors the on-screen cone in FloorPlanHub and reuses the
 * same geometry helpers, so the diagram matches what the user marked.
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
} from "./floorPlanGeometry";
import { svgToPngBuffer } from "./svgRaster";
import { VIEWPOINT_FOV_DEG } from "./viewpointFraming";
import type { DetectedRoom, PhotoViewpoint } from "./types";

const WALL_COLOR = "#334155";
const ROOM_FILL = "rgba(148,163,184,0.15)";
const WINDOW_COLOR = "#0ea5e9";
const DOOR_COLOR = "#d97706";
const CONE_FILL = "rgba(99,102,241,0.22)";
const CONE_STROKE = "rgba(99,102,241,0.9)";
const CAM_COLOR = "#6366f1";

function f(n: number): string {
  return n.toFixed(1);
}

/** Corner letter for a vertex index: 0 -> "A", 1 -> "B", … */
function cornerLabel(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

/** Padded bounds + viewbox dimensions for a single room polygon. */
function boundsForRoom(poly: Point[]): { bounds: Bounds; vbW: number; vbH: number } {
  const bbox = polygonBBox(poly);
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  const pad = Math.max(w, h) * 0.08 || 100;
  const bounds: Bounds = {
    minX: bbox.minX - pad,
    minY: bbox.minY - pad,
    maxX: bbox.maxX + pad,
    maxY: bbox.maxY + pad,
  };
  return { bounds, vbW: bounds.maxX - bounds.minX, vbH: bounds.maxY - bounds.minY };
}

/**
 * Camera-agnostic SVG body: room polygon + every window (cyan) and door (orange,
 * with swing arc) drawn at its exact `openingEndpoints(edgeIndex, t, width)`.
 * Shared by the viewpoint-cone diagram and the standalone openings diagram so the
 * opening geometry lives in exactly one place.
 */
function buildRoomAndOpeningsParts(room: DetectedRoom, bounds: Bounds, vbW: number): string[] {
  const poly = room.polygon!;
  const stroke = Math.max(vbW * 0.006, 50);
  const windowStroke = Math.max(vbW * 0.012, 110);
  const doorStroke = Math.max(vbW * 0.008, 80);

  const parts: string[] = [];

  // Room polygon.
  const pts = poly.map(([x, y]) => `${f(x)},${f(flipY(y, bounds))}`).join(" ");
  parts.push(
    `<polygon points="${pts}" fill="${ROOM_FILL}" stroke="${WALL_COLOR}" stroke-width="${f(stroke)}" stroke-linejoin="round" />`,
  );

  // Openings (only those placed on a specific edge are drawable).
  for (const win of room.windows ?? []) {
    if (typeof win.edgeIndex !== "number") continue;
    const [a, b] = openingEndpoints(poly, win.edgeIndex, win.t ?? 0.5, (win.width || 1.2) * 1000);
    parts.push(
      `<line x1="${f(a[0])}" y1="${f(flipY(a[1], bounds))}" x2="${f(b[0])}" y2="${f(flipY(b[1], bounds))}" stroke="${WINDOW_COLOR}" stroke-width="${f(windowStroke)}" stroke-linecap="round" />`,
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
      `<line x1="${f(a[0])}" y1="${f(flipY(a[1], bounds))}" x2="${f(b[0])}" y2="${f(flipY(b[1], bounds))}" stroke="${DOOR_COLOR}" stroke-width="${f(doorStroke)}" stroke-linecap="round" />`,
    );
    parts.push(
      `<line x1="${f(mid[0])}" y1="${f(flipY(mid[1], bounds))}" x2="${f(tip[0])}" y2="${f(flipY(tip[1], bounds))}" stroke="${DOOR_COLOR}" stroke-width="${f(doorStroke * 0.6)}" stroke-dasharray="${f(doorStroke * 2)} ${f(doorStroke)}" />`,
    );
  }

  return parts;
}

function buildSvg(room: DetectedRoom, vp: PhotoViewpoint, fovDeg: number): string {
  const poly = room.polygon!;
  const { bounds, vbW, vbH } = boundsForRoom(poly);
  const stroke = Math.max(vbW * 0.006, 50);

  const parts: string[] = buildRoomAndOpeningsParts(room, bounds, vbW);

  // Field-of-view wedge from the camera.
  const reach = Math.hypot(vbW, vbH);
  const half = (fovDeg / 2) * (Math.PI / 180);
  const rad = (vp.angleDeg * Math.PI) / 180;
  const leftA = rad + half;
  const rightA = rad - half;
  const lx = vp.x + reach * Math.cos(leftA);
  const ly = vp.y + reach * Math.sin(leftA);
  const rx = vp.x + reach * Math.cos(rightA);
  const ry = vp.y + reach * Math.sin(rightA);
  const camY = flipY(vp.y, bounds);
  parts.push(
    `<path d="M ${f(vp.x)} ${f(camY)} L ${f(lx)} ${f(flipY(ly, bounds))} L ${f(rx)} ${f(flipY(ry, bounds))} Z" fill="${CONE_FILL}" stroke="${CONE_STROKE}" stroke-width="${f(stroke * 0.6)}" stroke-linejoin="round" />`,
  );

  // Camera marker + facing arrow.
  const arrowLen = Math.max(vbW, vbH) * 0.12;
  const ax = vp.x + arrowLen * Math.cos(rad);
  const ay = vp.y + arrowLen * Math.sin(rad);
  parts.push(
    `<line x1="${f(vp.x)}" y1="${f(camY)}" x2="${f(ax)}" y2="${f(flipY(ay, bounds))}" stroke="${CAM_COLOR}" stroke-width="${f(stroke * 1.4)}" stroke-linecap="round" />`,
  );
  parts.push(
    `<circle cx="${f(vp.x)}" cy="${f(camY)}" r="${f(Math.max(vbW, vbH) * 0.03)}" fill="#ffffff" stroke="${CAM_COLOR}" stroke-width="${f(stroke)}" />`,
  );
  parts.push(
    `<circle cx="${f(vp.x)}" cy="${f(camY)}" r="${f(Math.max(vbW, vbH) * 0.014)}" fill="${CAM_COLOR}" />`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(bounds.minX)} ${f(bounds.minY)} ${f(vbW)} ${f(vbH)}"><rect x="${f(bounds.minX)}" y="${f(bounds.minY)}" width="${f(vbW)}" height="${f(vbH)}" fill="#ffffff" />${parts.join("")}</svg>`;
}

/**
 * Render a top-down diagram of the room with the camera position + FOV cone.
 * Returns base64 PNG (no data-URL prefix) for a Gemini inlineData part, or null
 * when the room has no usable polygon or rasterization fails.
 */
export async function renderViewpointDiagram(
  room: DetectedRoom | undefined,
  vp: PhotoViewpoint,
  fovDeg: number = VIEWPOINT_FOV_DEG,
): Promise<{ base64: string; mimeType: string } | null> {
  if (!room?.polygon || room.polygon.length < 3) return null;
  const svg = buildSvg(room, vp, fovDeg);
  const png = await svgToPngBuffer(svg, 1024);
  if (!png) return null;
  return { base64: png.toString("base64"), mimeType: "image/png" };
}

function buildOpeningsSvg(room: DetectedRoom): string {
  const poly = room.polygon!;
  const { bounds, vbW, vbH } = boundsForRoom(poly);

  const parts: string[] = buildRoomAndOpeningsParts(room, bounds, vbW);

  // Corner letters (A, B, C…) so the "[wall A-B, t=…]" references in the prompt
  // text have a visible anchor on this diagram.
  const [cx, cy] = polygonCentroid(poly);
  const cornerFont = Math.max(vbW * 0.04, 300);
  const cornerOffset = Math.max(vbW * 0.04, 300);
  for (let i = 0; i < poly.length; i++) {
    const [vx, vy] = poly[i];
    const ox = vx - cx;
    const oy = vy - cy;
    const mag = Math.hypot(ox, oy) || 1;
    const lx = vx + (ox / mag) * cornerOffset;
    const ly = vy + (oy / mag) * cornerOffset;
    parts.push(
      `<text x="${f(lx)}" y="${f(flipY(ly, bounds))}" text-anchor="middle" dominant-baseline="middle" fill="${WALL_COLOR}" font-size="${f(cornerFont)}" font-family="sans-serif" font-weight="800">${cornerLabel(i)}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(bounds.minX)} ${f(bounds.minY)} ${f(vbW)} ${f(vbH)}"><rect x="${f(bounds.minX)}" y="${f(bounds.minY)}" width="${f(vbW)}" height="${f(vbH)}" fill="#ffffff" />${parts.join("")}</svg>`;
}

/**
 * Render a camera-agnostic top-down diagram of the room — polygon, every window
 * (cyan) and door (orange + swing arc) at its exact position, and corner letters
 * A/B/C… labeling the walls. No camera cone. Sent to Gemini on every render angle
 * as the authoritative placement map for openings. Returns base64 PNG (no data-URL
 * prefix), or null when the room has no usable polygon or rasterization fails.
 */
export async function renderOpeningsDiagram(
  room: DetectedRoom | undefined,
): Promise<{ base64: string; mimeType: string } | null> {
  if (!room?.polygon || room.polygon.length < 3) return null;
  const svg = buildOpeningsSvg(room);
  const png = await svgToPngBuffer(svg, 1024);
  if (!png) return null;
  return { base64: png.toString("base64"), mimeType: "image/png" };
}
