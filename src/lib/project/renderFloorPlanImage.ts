/**
 * Rasterize the user's drawn floor plan (rooms + windows + doors) to a clean PNG.
 *
 * The drawing is the authoritative layout, so we send Claude a self-contained
 * schematic image — explicit colours, white background, no overlay photo or CSS
 * vars — alongside the original uploaded plan. It mirrors the on-screen glyphs in
 * <OpeningGlyphs> / <FloorPlanEditor> (same geometry helpers, same hinge/swing
 * rules) so what Claude sees matches what the user drew.
 */

import type { DetectedRoom } from "./types";
import {
  edgeOutwardNormal,
  flipY,
  openingEndpoints,
  polygonCentroid,
  type Bounds,
  type Point,
} from "./floorPlanGeometry";

const WALL_COLOR = "#334155";
const ROOM_FILL = "rgba(148,163,184,0.18)";
const LABEL_COLOR = "#0f172a";
const WINDOW_COLOR = "#0ea5e9";
const DOOR_COLOR = "#d97706";

const OUTPUT_WIDTH = 1400; // px

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Door swing arc from the free leaf end around the hinge to the open tip. */
function doorSwingPath(hinge: Point, free: Point, tip: Point, bounds: Bounds): string {
  const v0 = [free[0] - hinge[0], free[1] - hinge[1]];
  const v1 = [tip[0] - hinge[0], tip[1] - hinge[1]];
  const cross = v0[0] * v1[1] - v0[1] * v1[0];
  const sign = cross >= 0 ? 1 : -1;
  const steps = 8;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const ang = sign * (Math.PI / 2) * (i / steps);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const x = hinge[0] + v0[0] * cos - v0[1] * sin;
    const y = hinge[1] + v0[0] * sin + v0[1] * cos;
    pts.push(`${x.toFixed(1)},${flipY(y, bounds).toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Build the standalone SVG markup for the drawn plan. */
function buildSvg(rooms: DetectedRoom[], extentMm: { width: number; height: number }): string {
  const bounds: Bounds = { minX: 0, minY: 0, maxX: extentMm.width, maxY: extentMm.height };
  const planWidth = extentMm.width;
  const wallStroke = Math.max(planWidth * 0.006, 60);
  const windowStroke = Math.max(planWidth * 0.012, 130);
  const doorStroke = Math.max(planWidth * 0.008, 90);
  const labelSize = Math.max(planWidth * 0.02, 200);

  const parts: string[] = [];

  for (const room of rooms) {
    const poly = room.polygon;
    if (!poly || poly.length < 3) continue;
    const pts = poly.map(([x, y]) => `${x.toFixed(1)},${flipY(y, bounds).toFixed(1)}`).join(" ");
    parts.push(
      `<polygon points="${pts}" fill="${ROOM_FILL}" stroke="${WALL_COLOR}" stroke-width="${wallStroke.toFixed(1)}" stroke-linejoin="round" />`,
    );
    const [cx, cy] = polygonCentroid(poly);
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${flipY(cy, bounds).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="${LABEL_COLOR}" font-size="${labelSize.toFixed(0)}" font-family="sans-serif" font-weight="600">${esc(room.name)}</text>`,
    );

    for (const w of room.windows) {
      if (w.edgeIndex === undefined) continue;
      const [a, b] = openingEndpoints(poly, w.edgeIndex, w.t ?? 0.5, (w.width || 1.2) * 1000);
      parts.push(
        `<line x1="${a[0].toFixed(1)}" y1="${flipY(a[1], bounds).toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${flipY(b[1], bounds).toFixed(1)}" stroke="${WINDOW_COLOR}" stroke-width="${windowStroke.toFixed(1)}" stroke-linecap="round" />`,
      );
    }

    for (const d of room.doors) {
      if (d.edgeIndex === undefined) continue;
      const widthMm = (d.width || 0.8) * 1000;
      const [a, b] = openingEndpoints(poly, d.edgeIndex, d.t ?? 0.5, widthMm);
      const [nx, ny] = edgeOutwardNormal(poly, d.edgeIndex);
      const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 || widthMm / 2;
      const hinge = d.hinge === "right" ? b : a;
      const free = d.hinge === "right" ? a : b;
      const sign = d.swing === "out" ? 1 : -1;
      const tip: Point = [hinge[0] + sign * nx * (half * 2), hinge[1] + sign * ny * (half * 2)];
      parts.push(
        `<line x1="${a[0].toFixed(1)}" y1="${flipY(a[1], bounds).toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${flipY(b[1], bounds).toFixed(1)}" stroke="${DOOR_COLOR}" stroke-width="${doorStroke.toFixed(1)}" stroke-linecap="round" />`,
      );
      parts.push(
        `<line x1="${hinge[0].toFixed(1)}" y1="${flipY(hinge[1], bounds).toFixed(1)}" x2="${tip[0].toFixed(1)}" y2="${flipY(tip[1], bounds).toFixed(1)}" stroke="${DOOR_COLOR}" stroke-width="${(doorStroke * 0.7).toFixed(1)}" />`,
      );
      parts.push(
        `<polyline points="${doorSwingPath(hinge, free, tip, bounds)}" fill="none" stroke="${DOOR_COLOR}" stroke-width="${(doorStroke * 0.6).toFixed(1)}" stroke-dasharray="${(doorStroke * 2).toFixed(0)} ${(doorStroke * 1.5).toFixed(0)}" />`,
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extentMm.width} ${extentMm.height}" width="${extentMm.width}" height="${extentMm.height}"><rect x="0" y="0" width="${extentMm.width}" height="${extentMm.height}" fill="#ffffff" />${parts.join("")}</svg>`;
}

/**
 * Render the drawn rooms to a PNG (base64, no data-URL prefix). Returns null if
 * there is nothing to draw or the browser canvas is unavailable.
 */
export async function renderFloorPlanImage(
  rooms: DetectedRoom[],
  extentMm: { width: number; height: number },
): Promise<{ base64: string; mimeType: string } | null> {
  const drawable = rooms.filter((r) => (r.polygon?.length ?? 0) >= 3);
  if (drawable.length === 0) return null;
  if (typeof document === "undefined") return null;

  const svg = buildSvg(drawable, extentMm);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const aspect = extentMm.height > 0 ? extentMm.width / extentMm.height : 4 / 3;
  const outW = OUTPUT_WIDTH;
  const outH = Math.max(1, Math.round(outW / aspect));

  const img = new Image();
  img.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to rasterize floor plan SVG"));
  });
  img.src = svgUrl;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1] ?? "";
  if (!base64) return null;
  return { base64, mimeType: "image/png" };
}
