import type { DetectedRoom, FloorPlanAnalysis } from "./types";
import type { FloorPlanDetection, RoboflowDetectPayload } from "./floorPlanDetections";
import type { NormalizedFloorPlanDetection } from "./floorPlanDetections";
import { describeOpening, nearestEdgeToPoint } from "./floorPlanGeometry";
import type { Point } from "./floorPlanGeometry";

const MIN_CV_CONFIDENCE = 0.28;
const SNAP_MAX_DIST_UNITS = 45;

export type FloorPlanCvReview = {
  cvDoorCount: number;
  cvWindowCount: number;
  gptDoorCount: number;
  gptWindowCount: number;
  unmatchedOpeningCount: number;
  problematic: boolean;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Map inference pixels → model image coords (x 0..1000, y downward). */
export function detectionCenterInImageUnits(
  p: FloorPlanDetection,
  imageWidth: number,
  imageHeight: number,
  imageHeightUnits: number,
): [number, number] {
  const x = (p.x / imageWidth) * 1000;
  const y = (p.y / imageHeight) * imageHeightUnits;
  return [x, y];
}

const MAX_PRIOR_OPENINGS = 40;
const MAX_PRIOR_WALLS = 30;

export function buildCvGeometryPriorBlock(
  payload: RoboflowDetectPayload | null | undefined,
  imageHeightUnits: number,
): string {
  if (!payload || payload.predictions.length === 0) return "";

  const { width: iw, height: ih } = payload.image;
  type PriorEntry = { class: string; x: number; y: number; w: number; c: number };
  const openings: PriorEntry[] = [];
  const walls: PriorEntry[] = [];

  for (const p of payload.predictions) {
    if (p.confidence < MIN_CV_CONFIDENCE) continue;
    const [cx, cy] = detectionCenterInImageUnits(p, iw, ih, imageHeightUnits);
    const wNorm = (p.width / iw) * 1000;
    const hNorm = (p.height / ih) * imageHeightUnits;
    const entry: PriorEntry = {
      class: p.class,
      x: Math.round(cx * 10) / 10,
      y: Math.round(cy * 10) / 10,
      w: Math.round(Math.max(wNorm, hNorm) * 10) / 10,
      c: Math.round(p.confidence * 100) / 100,
    };
    if (p.class === "wall") walls.push(entry);
    else openings.push(entry);
  }

  openings.sort((a, b) => b.c - a.c);
  walls.sort((a, b) => b.c - a.c);

  const openingSample = openings.slice(0, MAX_PRIOR_OPENINGS);
  const wallSample = walls.slice(0, MAX_PRIOR_WALLS);
  if (openingSample.length === 0 && wallSample.length === 0) return "";

  const snippet = JSON.stringify({ openings: openingSample, walls: wallSample });
  return `

COMPUTER-VISION PRIOR (CubiCasa detections — same image coords as your polygons: x 0..1000, y downward). JSON is ground truth for openings; align wall breaks and place doors/windows at listed centers when visible.
${snippet}`;
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function cvOpeningsByClass(
  payload: RoboflowDetectPayload,
  imageHeightUnits: number,
  cls: "door" | "window",
): Array<{ center: [number, number]; confidence: number; used: boolean }> {
  const { width: iw, height: ih } = payload.image;
  return payload.predictions
    .filter((p) => p.class === cls && p.confidence >= MIN_CV_CONFIDENCE)
    .map((p) => ({
      center: detectionCenterInImageUnits(p, iw, ih, imageHeightUnits),
      confidence: p.confidence,
      used: false,
    }));
}

/**
 * Snap GPT openings to nearest CV door/window in image space; drop extras when CV is confident and sparse.
 */
export function snapOpeningsToCvDetections(
  analysis: FloorPlanAnalysis,
  rawParsed: unknown,
  payload: RoboflowDetectPayload | null | undefined,
  imageHeightUnits: number,
): { analysis: FloorPlanAnalysis; rawParsed: unknown } {
  if (!payload || payload.predictions.length === 0 || imageHeightUnits <= 0) {
    return { analysis, rawParsed };
  }

  const rawRooms = isRecord(rawParsed) && Array.isArray(rawParsed.rooms)
    ? rawParsed.rooms.filter(isRecord)
    : [];

  const cvDoors = cvOpeningsByClass(payload, imageHeightUnits, "door");
  const cvWindows = cvOpeningsByClass(payload, imageHeightUnits, "window");

  const snapOpeningList = <
    T extends { edgeIndex?: number; t?: number; position: string },
  >(
    openings: T[],
    rawOpenings: unknown[],
    polygon: Point[],
    cvList: Array<{ center: [number, number]; confidence: number; used: boolean }>,
  ): { openings: T[]; rawOpenings: unknown[] } => {
    if (polygon.length < 3) return { openings, rawOpenings: rawOpenings };

    const nextRaw: unknown[] = [];
    const nextOpenings: T[] = [];

    for (let j = 0; j < openings.length; j++) {
      const o = openings[j]!;
      const raw = rawOpenings[j];
      let cx: number | null = null;
      let cy: number | null = null;
      if (isRecord(raw)) {
        const x = Number(raw.x);
        const y = Number(raw.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          cx = x;
          cy = y;
        }
      }

      let bestIdx = -1;
      let bestD = SNAP_MAX_DIST_UNITS;
      if (cx != null && cy != null) {
        for (let k = 0; k < cvList.length; k++) {
          const cv = cvList[k]!;
          const d = dist([cx, cy], cv.center);
          if (d < bestD) {
            bestD = d;
            bestIdx = k;
          }
        }
      }

      if (bestIdx >= 0) {
        const cv = cvList[bestIdx]!;
        cv.used = true;
        const snap = nearestEdgeToPoint(polygon, cv.center);
        nextOpenings.push({
          ...o,
          edgeIndex: snap.edgeIndex,
          t: snap.t,
          position: describeOpening(polygon, snap.edgeIndex, snap.t),
        });
        nextRaw.push({
          ...(isRecord(raw) ? raw : {}),
          x: cv.center[0],
          y: cv.center[1],
        });
      } else if (cvList.length === 0) {
        nextOpenings.push(o);
        nextRaw.push(raw ?? {});
      }
    }

    return { openings: nextOpenings, rawOpenings: nextRaw };
  };

  const rooms = analysis.rooms.map((room, i) => {
    const raw = rawRooms[i];
    const poly = room.polygon ?? [];
    if (!isRecord(raw) || poly.length < 3) return room;

    const rawWindows = (Array.isArray(raw.windows) ? raw.windows : []).filter(isRecord);
    const rawDoors = (Array.isArray(raw.doors) ? raw.doors : []).filter(isRecord);

    const winSnap = snapOpeningList(room.windows, rawWindows, poly, cvWindows);
    const doorSnap = snapOpeningList(room.doors, rawDoors, poly, cvDoors);

    if (rawRooms[i]) {
      rawRooms[i] = {
        ...raw,
        windows: winSnap.rawOpenings,
        doors: doorSnap.rawOpenings,
      };
    }

    return { ...room, windows: winSnap.openings, doors: doorSnap.openings };
  });

  return {
    analysis: { ...analysis, rooms },
    rawParsed: isRecord(rawParsed) ? { ...rawParsed, rooms: rawRooms } : rawParsed,
  };
}

export function assessCvGptOpeningDisagreement(
  analysis: FloorPlanAnalysis,
  payload: RoboflowDetectPayload | null | undefined,
  imageHeightUnits: number,
): FloorPlanCvReview | undefined {
  if (!payload || imageHeightUnits <= 0) return undefined;

  const cvDoors = cvOpeningsByClass(payload, imageHeightUnits, "door");
  const cvWindows = cvOpeningsByClass(payload, imageHeightUnits, "window");
  let gptDoors = 0;
  let gptWindows = 0;
  let unmatched = 0;

  for (const room of analysis.rooms) {
    gptDoors += room.doors.length;
    gptWindows += room.windows.length;
  }

  const allCv = [...cvDoors, ...cvWindows];
  for (const room of analysis.rooms) {
    const poly = room.polygon ?? [];
    if (poly.length < 3) continue;
    for (const list of [room.doors, room.windows]) {
      for (const o of list) {
        if (o.edgeIndex == null || o.t == null) {
          unmatched += 1;
          continue;
        }
        const a = poly[o.edgeIndex]!;
        const b = poly[(o.edgeIndex + 1) % poly.length]!;
        const cx = a[0] + (b[0] - a[0]) * o.t;
        const cy = a[1] + (b[1] - a[1]) * o.t;
        const near = allCv.some((cv) => dist([cx, cy], cv.center) <= SNAP_MAX_DIST_UNITS * 1.2);
        if (!near) unmatched += 1;
      }
    }
  }

  const countDelta =
    Math.abs(gptDoors - cvDoors.length) + Math.abs(gptWindows - cvWindows.length);
  const problematic = countDelta >= 3 || unmatched >= 4;

  return {
    cvDoorCount: cvDoors.length,
    cvWindowCount: cvWindows.length,
    gptDoorCount: gptDoors,
    gptWindowCount: gptWindows,
    unmatchedOpeningCount: unmatched,
    problematic,
  };
}

/** Confirm-plan: snap openings to stored normalized CV overlay (mm polygons). */
export function applyCvOpeningsFromNormalized(
  analysis: FloorPlanAnalysis,
  normalized: NormalizedFloorPlanDetection[],
  imageFrame: { width: number; height: number },
): FloorPlanAnalysis {
  const frame = imageFrame;
  const openings = normalized.filter((d) => d.class === "door" || d.class === "window");
  if (openings.length === 0 || !frame.width || !frame.height) return analysis;

  const centers = openings.map((d) => {
    const cx = (d.left + d.width / 2) * frame.width;
    const cy = (1 - (d.top + d.height / 2)) * frame.height;
    return { class: d.class, center: [cx, cy] as [number, number], confidence: d.confidence };
  });

  const rooms: DetectedRoom[] = analysis.rooms.map((room) => {
    const poly = room.polygon ?? [];
    if (poly.length < 3) return room;

    const snapOpenings = <T extends DetectedRoom["doors"][number] | DetectedRoom["windows"][number]>(
      list: T[],
      cls: "door" | "window",
    ): T[] => {
      const cv = centers.filter((c) => c.class === cls && c.confidence >= MIN_CV_CONFIDENCE);
      return list.map((o, idx) => {
        const cvPick = cv[idx];
        if (!cvPick) return o;
        const snap = nearestEdgeToPoint(poly, cvPick.center);
        return {
          ...o,
          edgeIndex: snap.edgeIndex,
          t: snap.t,
          position: describeOpening(poly, snap.edgeIndex, snap.t),
          confirmed: true,
        };
      });
    };

    return {
      ...room,
      doors: snapOpenings(room.doors, "door"),
      windows: snapOpenings(room.windows, "window"),
    };
  });

  return { ...analysis, rooms };
}

export function applyCvOpeningsFromPayload(
  analysis: FloorPlanAnalysis,
  payload: RoboflowDetectPayload,
  imageHeightUnits: number,
): FloorPlanAnalysis {
  const rawRooms = analysis.rooms.map((r) => ({
    windows: r.windows.map((w) => ({
      ...w,
      x: w.edgeIndex != null && w.t != null && r.polygon
        ? (() => {
            const poly = r.polygon!;
            const a = poly[w.edgeIndex!]!;
            const b = poly[(w.edgeIndex! + 1) % poly.length]!;
            return a[0] + (b[0] - a[0]) * w.t!;
          })()
        : undefined,
      y: w.edgeIndex != null && w.t != null && r.polygon
        ? (() => {
            const poly = r.polygon!;
            const a = poly[w.edgeIndex!]!;
            const b = poly[(w.edgeIndex! + 1) % poly.length]!;
            return a[1] + (b[1] - a[1]) * w.t!;
          })()
        : undefined,
    })),
    doors: r.doors.map((d) => ({ ...d })),
  }));
  const rawParsed = { rooms: rawRooms };
  const snapped = snapOpeningsToCvDetections(analysis, rawParsed, payload, imageHeightUnits);
  return snapped.analysis;
}
