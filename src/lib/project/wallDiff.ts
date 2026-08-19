/**
 * Tolerance-based wall diff for the redevelopment (перепланировка) sheet.
 *
 * Compares an ORIGINAL wall set against a PROPOSED wall set and classifies each
 * segment as unchanged / demolished / built. The match is tolerance-based (not
 * exact) so sub-tolerance coordinate drift from re-anchoring (`anchorAnalysisToImage`)
 * and polygon rounding does NOT produce phantom "demolish old + erect new" pairs.
 */

import type { WallSegment } from "./types";

export interface WallDiffResult {
  /** Segments present in both sets (from the proposed set). */
  unchanged: WallSegment[];
  /** Segments in the original but not the proposed set (to remove). */
  demolished: WallSegment[];
  /** Segments in the proposed but not the original set (to build). */
  built: WallSegment[];
  /** True when nothing was demolished or built. */
  noChanges: boolean;
}

export interface WallDiffOptions {
  /** Endpoint match tolerance in mm (default 50). */
  tolMm?: number;
  /** Orientation tolerance in degrees (default 5). */
  angleTolDeg?: number;
}

function segAngleDeg(w: WallSegment): number {
  // Undirected orientation in [0, 180).
  let a = (Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180) / Math.PI;
  a = ((a % 180) + 180) % 180;
  return a;
}

function angleClose(a: number, b: number, tol: number): boolean {
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d <= tol;
}

/** True when two segments coincide (either endpoint orientation) within tolerance. */
export function wallsMatch(a: WallSegment, b: WallSegment, tolMm = 50, angleTolDeg = 5): boolean {
  if (!angleClose(segAngleDeg(a), segAngleDeg(b), angleTolDeg)) return false;
  const forward =
    Math.hypot(a.x1 - b.x1, a.y1 - b.y1) <= tolMm && Math.hypot(a.x2 - b.x2, a.y2 - b.y2) <= tolMm;
  const reverse =
    Math.hypot(a.x1 - b.x2, a.y1 - b.y2) <= tolMm && Math.hypot(a.x2 - b.x1, a.y2 - b.y1) <= tolMm;
  return forward || reverse;
}

export function diffWalls(
  original: WallSegment[],
  proposed: WallSegment[],
  opts: WallDiffOptions = {},
): WallDiffResult {
  const tolMm = opts.tolMm ?? 50;
  const angleTolDeg = opts.angleTolDeg ?? 5;

  const originalMatched = new Array(original.length).fill(false);
  const unchanged: WallSegment[] = [];
  const built: WallSegment[] = [];

  for (const p of proposed) {
    const idx = original.findIndex((o, i) => !originalMatched[i] && wallsMatch(o, p, tolMm, angleTolDeg));
    if (idx >= 0) {
      originalMatched[idx] = true;
      unchanged.push(p);
    } else {
      built.push(p);
    }
  }

  const demolished = original.filter((_, i) => !originalMatched[i]);

  return {
    unchanged,
    demolished,
    built,
    noChanges: demolished.length === 0 && built.length === 0,
  };
}
