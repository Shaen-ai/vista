import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { applyPlanarSurfaceUvs } from "./wallPrism";

/**
 * Ported from metrics_platform_published/src/app/planner/utils/polygonWallCsg.ts.
 * `edgeFrame` and `polygonWallHoleCutsForSegment` are verbatim; the wall builder
 * adds per-end corner extension (miter) + an epsilon outward bias so adjacent
 * walls fill acute/diagonal corners without gaps and without coplanar z-fighting.
 */

const csgEvaluator = new Evaluator();
csgEvaluator.useGroups = false;
csgEvaluator.attributes = ["position", "normal"];

const HOLE_DEPTH_MARGIN = 0.06;

export type PolygonWallHoleCut = {
  along0: number;
  along1: number;
  yBottom: number;
  yTop: number;
};

type OpeningLike = {
  type: string;
  position: number;
  width: number;
  height?: number;
};

/** Unit tangent (XZ) from A → B, length L; outward normal for CCW polygon. */
export function edgeFrame(ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const L = Math.hypot(dx, dz);
  if (L < 1e-9) {
    return { tx: 1, tz: 0, L: 0, ox: 0, oz: 1 };
  }
  const tx = dx / L;
  const tz = dz / L;
  const ox = tz;
  const oz = -tx;
  return { tx, tz, L, ox, oz };
}

/**
 * Miter/corner extension distance for a wall end meeting a corner of interior
 * angle `angleDeg`. For 90° this is thickness/2; for a 45° corner it grows to the
 * true miter (thickness / (2·tan(θ/2))); for straight (~180°) it goes to 0.
 * Clamped so very acute corners don't produce runaway slabs.
 */
export function miterExtension(angleDeg: number, thickness: number): number {
  if (!Number.isFinite(angleDeg)) return thickness / 2;
  const clampedAngle = Math.min(179, Math.max(1, angleDeg));
  const half = (clampedAngle * Math.PI) / 180 / 2;
  const t = Math.tan(half);
  if (t < 1e-4) return thickness * 4;
  return Math.min(thickness * 4, Math.max(0, thickness / (2 * t)));
}

/**
 * Cuts along one wall segment from A→B. `along` runs from inner edge midpoint: −halfLen…+halfLen.
 */
export function polygonWallHoleCutsForSegment(
  segAlong0: number,
  segAlong1: number,
  halfLen: number,
  wallOpenings: OpeningLike[],
  ceilingCap: number
): PolygonWallHoleCut[] {
  const cuts: PolygonWallHoleCut[] = [];
  const lo = Math.min(segAlong0, segAlong1);
  const hi = Math.max(segAlong0, segAlong1);
  const sorted = [...wallOpenings].sort((a, b) => a.position - b.position);

  for (const opening of sorted) {
    const openingCenterAlong = opening.position * halfLen;
    const openingHeight = Math.min(
      opening.height || (opening.type === "door" ? 2.1 : 1.2),
      Math.max(0.5, ceilingCap - 0.04)
    );
    const openingWidth = opening.width;
    const openingStart = openingCenterAlong - openingWidth / 2;
    const openingEnd = openingCenterAlong + openingWidth / 2;
    const a0 = Math.max(openingStart, lo);
    const a1 = Math.min(openingEnd, hi);
    if (a1 - a0 < 1e-4) continue;

    if (opening.type === "door") {
      cuts.push({ along0: a0, along1: a1, yBottom: 0, yTop: openingHeight });
    } else if (opening.type === "window") {
      const sillHeight = openingHeight > 1.5 ? 0 : 0.8;
      const windowTopY = sillHeight + openingHeight;
      cuts.push({ along0: a0, along1: a1, yBottom: sillHeight, yTop: windowTopY });
    }
  }

  return cuts;
}

function holeBrushOriented(
  worldX: number,
  worldZ: number,
  rotationY: number,
  halfAlong: number,
  yBottom: number,
  yTop: number,
  thickness: number
): Brush {
  const dx = halfAlong * 2;
  const dy = yTop - yBottom;
  const dz = thickness + HOLE_DEPTH_MARGIN;
  const cy = (yBottom + yTop) / 2;
  const geo = new THREE.BoxGeometry(dx, dy, dz);
  geo.deleteAttribute("uv");
  const brush = new Brush(geo);
  brush.rotation.y = rotationY;
  brush.position.set(worldX, cy, worldZ);
  brush.updateMatrixWorld();
  return brush;
}

export interface WallSegmentOptions {
  /** extra length beyond endpoint A along −tangent (corner fill / miter). */
  extend0?: number;
  /** extra length beyond endpoint B along +tangent (corner fill / miter). */
  extend1?: number;
  /** tiny outward offset so overlapping corner slabs never share a coplanar face. */
  epsilon?: number;
}

/**
 * Vertical wall slab along inner edge A→B, extruded outward by thickness/2, with
 * rectangular holes. Openings stay anchored to the true A→B midpoint/half-length;
 * `extend0`/`extend1` lengthen the slab past each corner without moving the holes.
 */
export function createPolygonWallSegmentWithHoles(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  height: number,
  thickness: number,
  cuts: PolygonWallHoleCut[],
  opts: WallSegmentOptions = {}
): THREE.BufferGeometry {
  const { tx, tz, L, ox, oz } = edgeFrame(ax, az, bx, bz);
  if (L < 1e-6) {
    return new THREE.BufferGeometry();
  }

  const extend0 = Math.max(0, opts.extend0 ?? 0);
  const extend1 = Math.max(0, opts.extend1 ?? 0);
  const epsilon = opts.epsilon ?? 0;

  const Mx = (ax + bx) / 2;
  const Mz = (az + bz) / 2;
  const outward = thickness / 2 + epsilon;
  // Base slab centered on the true edge midpoint, offset outward.
  const mx = Mx + ox * outward;
  const mz = Mz + oz * outward;
  const rotationY = Math.atan2(-tz, tx);

  // Extend the slab past each corner; recenter along the tangent by the imbalance.
  const boxLen = L + extend0 + extend1;
  const centerShift = (extend1 - extend0) / 2;

  const baseGeo = new THREE.BoxGeometry(boxLen, height, thickness);
  baseGeo.deleteAttribute("uv");
  let wallBrush = new Brush(baseGeo);
  wallBrush.rotation.y = rotationY;
  wallBrush.position.set(mx + tx * centerShift, height / 2, mz + tz * centerShift);
  wallBrush.updateMatrixWorld();

  if (cuts.length === 0) {
    return applyPlanarSurfaceUvs(wallBrush.geometry);
  }

  for (const cut of cuts) {
    const midAlong = (cut.along0 + cut.along1) / 2;
    const halfAlong = (cut.along1 - cut.along0) / 2;
    const hx = Mx + tx * midAlong + ox * outward;
    const hz = Mz + tz * midAlong + oz * outward;
    const holeBrush = holeBrushOriented(hx, hz, rotationY, halfAlong, cut.yBottom, cut.yTop, thickness);
    const next = csgEvaluator.evaluate(wallBrush, holeBrush, SUBTRACTION) as Brush;
    wallBrush.geometry.dispose();
    holeBrush.geometry.dispose();
    wallBrush = next;
  }

  return applyPlanarSurfaceUvs(wallBrush.geometry);
}
