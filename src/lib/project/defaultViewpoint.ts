/**
 * Default camera viewpoint for a room photo that the user hasn't placed manually.
 *
 * The floor-plan review step seeds every assigned photo with one of these so the
 * flow never blocks on a missing viewpoint — the user can still reposition or
 * clear it. Same mm Y-up coordinate space and angle convention (degrees CCW from
 * +X/east) as `PhotoViewpoint` / `viewpointFraming`.
 */

import {
  type Point,
  edgeLengthMm,
  edgeOutwardNormal,
  pointAlongEdge,
  pointInPolygon,
  polygonCentroid,
  sanitizePolygon,
} from "./floorPlanGeometry";
import type { DetectedRoom, PhotoViewpoint } from "./types";

/** How far inside the room the default camera stands from its wall (mm). */
const CAMERA_INSET_MM = 500;
/** Walls shorter than this can't host a sensible camera position (mm). */
const MIN_CAMERA_WALL_MM = 1000;

function bearingDeg(from: Point, to: Point): number {
  const deg = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360);
}

/**
 * Compute a default viewpoint for the `indexInRoom`-th photo assigned to a room:
 * camera just inside the midpoint of a wall, facing the room centroid. Successive
 * photos use successive walls (longest first) so multi-photo rooms get distinct
 * cameras. Returns null when the room has no usable polygon — downstream prompts
 * already degrade gracefully to the photo label.
 */
export function defaultViewpointForRoom(
  room: Pick<DetectedRoom, "polygon">,
  indexInRoom = 0,
): PhotoViewpoint | null {
  const polygon = sanitizePolygon(room.polygon);
  if (polygon.length < 3) return null;

  const centroid = polygonCentroid(polygon);
  const candidates = polygon
    .map((_, i) => ({ edgeIndex: i, lengthMm: edgeLengthMm(polygon, i) }))
    .filter((e) => e.lengthMm >= MIN_CAMERA_WALL_MM)
    .sort((a, b) => b.lengthMm - a.lengthMm);

  for (let attempt = 0; attempt < candidates.length; attempt++) {
    const pick = candidates[(indexInRoom + attempt) % candidates.length];
    const mid = pointAlongEdge(polygon, pick.edgeIndex, 0.5);
    const [nx, ny] = edgeOutwardNormal(polygon, pick.edgeIndex);
    const inset = Math.min(CAMERA_INSET_MM, pick.lengthMm / 4);
    const camera: Point = [mid[0] - nx * inset, mid[1] - ny * inset];
    if (!pointInPolygon(camera, polygon)) continue;
    return {
      x: Math.round(camera[0]),
      y: Math.round(camera[1]),
      angleDeg: bearingDeg(camera, centroid),
    };
  }

  // Concave/degenerate shapes where every inset midpoint lands outside: stand at
  // the centroid facing the longest wall's midpoint.
  if (pointInPolygon(centroid, polygon) && candidates.length > 0) {
    const target = pointAlongEdge(polygon, candidates[0].edgeIndex, 0.5);
    return {
      x: Math.round(centroid[0]),
      y: Math.round(centroid[1]),
      angleDeg: bearingDeg(centroid, target),
    };
  }
  return null;
}
