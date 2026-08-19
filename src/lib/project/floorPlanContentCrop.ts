import sharp from "sharp";
import type { FloorPlanAnalysis } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Normalized bounding box of plan ink within the full upload (fractions 0–1). */
export type PlanContentInset = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const INK_THRESHOLD = 242;
/** Ignore insets that shrink the frame by less than this on any side. */
const MIN_MARGIN_FRAC = 0.02;

/**
 * Find the bounding box of non-white pixels (plan lines, text) to strip photo margins.
 * Returns null when the image is already full-bleed plan ink.
 */
export async function detectPlanContentInset(imageBase64: string): Promise<PlanContentInset | null> {
  const buf = Buffer.from(imageBase64, "base64");
  const { data, info } = await sharp(buf).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (!width || !height || !data.length) return null;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const stride = channels ?? 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[y * width * stride + x * stride]!;
      if (v < INK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) return null;

  const inset: PlanContentInset = {
    left: minX / width,
    top: minY / height,
    width: (maxX - minX + 1) / width,
    height: (maxY - minY + 1) / height,
  };

  const marginL = inset.left;
  const marginT = inset.top;
  const marginR = 1 - inset.left - inset.width;
  const marginB = 1 - inset.top - inset.height;
  const hasMargin =
    marginL >= MIN_MARGIN_FRAC ||
    marginT >= MIN_MARGIN_FRAC ||
    marginR >= MIN_MARGIN_FRAC ||
    marginB >= MIN_MARGIN_FRAC;
  if (!hasMargin) return null;

  return inset;
}

export async function cropImageBase64ToInset(
  imageBase64: string,
  inset: PlanContentInset,
): Promise<{ base64: string; mimeType: string }> {
  const buf = Buffer.from(imageBase64, "base64");
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error("Invalid image dimensions");

  const left = Math.max(0, Math.min(w - 1, Math.floor(inset.left * w)));
  const top = Math.max(0, Math.min(h - 1, Math.floor(inset.top * h)));
  const width = Math.max(1, Math.min(w - left, Math.ceil(inset.width * w)));
  const height = Math.max(1, Math.min(h - top, Math.ceil(inset.height * h)));

  const cropped = await sharp(buf).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
  return { base64: cropped.toString("base64"), mimeType: "image/jpeg" };
}

/** Crop-space image coords (x 0..1000, y 0..cropHeightUnits) → full-image coords. */
export function remapImagePointFromCropToFull(
  x: number,
  y: number,
  inset: PlanContentInset,
  fullImageHeightUnits: number,
): [number, number] {
  const cropHeightUnits = (1000 * inset.height) / inset.width;
  const fullX = inset.left * 1000 + (x / 1000) * inset.width * 1000;
  const fullY = inset.top * fullImageHeightUnits + (y / cropHeightUnits) * inset.height * fullImageHeightUnits;
  return [fullX, fullY];
}

export function remapAnalysisFromCropToFull(
  analysis: FloorPlanAnalysis,
  inset: PlanContentInset,
  fullImageHeightUnits: number,
): FloorPlanAnalysis {
  const mapPt = (x: number, y: number) => remapImagePointFromCropToFull(x, y, inset, fullImageHeightUnits);

  const rooms = analysis.rooms.map((room) => ({
    ...room,
    polygon: (room.polygon ?? []).map(([x, y]) => mapPt(x, y)),
  }));

  return {
    ...analysis,
    rooms,
    wallSegments: analysis.wallSegments.map((w) => {
      const [x1, y1] = mapPt(w.x1, w.y1);
      const [x2, y2] = mapPt(w.x2, w.y2);
      return { ...w, x1, y1, x2, y2 };
    }),
    utilityPoints: analysis.utilityPoints?.map((u) => {
      const [x, y] = mapPt(u.x, u.y);
      return { ...u, x, y };
    }),
    columns: analysis.columns?.map((c) => {
      const [x, y] = mapPt(c.x, c.y);
      return { ...c, x, y };
    }),
  };
}

/** Remap raw model JSON opening centers before reconcileOpeningPixels. */
export function remapRawParsedFromCropToFull(
  rawParsed: unknown,
  inset: PlanContentInset,
  fullImageHeightUnits: number,
): unknown {
  if (!isRecord(rawParsed) || !Array.isArray(rawParsed.rooms)) return rawParsed;
  const mapOpening = (o: unknown) => {
    if (!isRecord(o)) return o;
    const x = Number(o.x);
    const y = Number(o.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return o;
    const [fx, fy] = remapImagePointFromCropToFull(x, y, inset, fullImageHeightUnits);
    return { ...o, x: fx, y: fy };
  };
  const mapRoom = (r: unknown) => {
    if (!isRecord(r)) return r;
    const poly = r.polygon;
    let nextPoly = poly;
    if (Array.isArray(poly)) {
      nextPoly = poly.map((pt) => {
        if (!Array.isArray(pt) || pt.length < 2) return pt;
        const [fx, fy] = remapImagePointFromCropToFull(Number(pt[0]), Number(pt[1]), inset, fullImageHeightUnits);
        return [fx, fy];
      });
    }
    return {
      ...r,
      polygon: nextPoly,
      windows: Array.isArray(r.windows) ? r.windows.map(mapOpening) : r.windows,
      doors: Array.isArray(r.doors) ? r.doors.map(mapOpening) : r.doors,
    };
  };
  return { ...rawParsed, rooms: rawParsed.rooms.map(mapRoom) };
}
