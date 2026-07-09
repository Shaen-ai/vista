"use client";

/**
 * Read-only window/door glyphs drawn on a room's walls. Shared by FloorPlanHub
 * (review) and mirrored by the editor's interactive layer, so the symbols match.
 *
 * Openings are anchored to a polygon edge via {edgeIndex, t}; `width` is in
 * metres. Coordinates are mm, Y-up — callers pass `bounds` for the flipY into
 * SVG space and `planWidth` to scale stroke sizes.
 */

import type { DetectedRoom } from "@/lib/project/types";
import {
  type Bounds,
  type Point,
  edgeOutwardNormal,
  flipY,
  openingEndpoints,
} from "@/lib/project/floorPlanGeometry";

const WINDOW_COLOR = "rgb(14, 165, 233)";
const DOOR_COLOR = "rgb(217, 119, 6)";

/** Sample the door swing arc from the free end around the hinge to the leaf tip. */
function doorSwingPath(hinge: Point, free: Point, tip: Point, bounds: Bounds): string {
  const v0 = [free[0] - hinge[0], free[1] - hinge[1]];
  const v1 = [tip[0] - hinge[0], tip[1] - hinge[1]];
  // Signed angle from v0 to v1 (±~90°).
  const cross = v0[0] * v1[1] - v0[1] * v1[0];
  const sign = cross >= 0 ? 1 : -1;
  const steps = 6;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const ang = sign * (Math.PI / 2) * (i / steps);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const x = hinge[0] + v0[0] * cos - v0[1] * sin;
    const y = hinge[1] + v0[0] * sin + v0[1] * cos;
    pts.push(`${x},${flipY(y, bounds)}`);
  }
  return pts.join(" ");
}

export function RoomOpenings({
  room,
  bounds,
  planWidth: _planWidth,
}: {
  room: DetectedRoom;
  bounds: Bounds;
  planWidth: number;
}) {
  const poly = room.polygon;
  if (!poly || poly.length < 3) return null;

  return (
    <g style={{ pointerEvents: "none" }}>
      {room.windows.map((w, i) => {
        if (w.edgeIndex === undefined) return null;
        const [a, b] = openingEndpoints(poly, w.edgeIndex, w.t ?? 0.5, (w.width || 1.2) * 1000);
        // Unreviewed (AI-detected, not yet confirmed) openings draw dashed + faint
        // so the user can tell at a glance what still needs a look.
        const unreviewed = !w.confirmed;
        return (
          <line
            key={`win-${i}`}
            x1={a[0]}
            y1={flipY(a[1], bounds)}
            x2={b[0]}
            y2={flipY(b[1], bounds)}
            stroke={WINDOW_COLOR}
            strokeWidth={4}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeOpacity={unreviewed ? 0.55 : 1}
            strokeDasharray={unreviewed ? "6 4" : undefined}
          />
        );
      })}
      {room.doors.map((d, i) => {
        if (d.edgeIndex === undefined) return null;
        const widthMm = (d.width || 0.8) * 1000;
        const [a, b] = openingEndpoints(poly, d.edgeIndex, d.t ?? 0.5, widthMm);
        const [nx, ny] = edgeOutwardNormal(poly, d.edgeIndex);
        const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 || widthMm / 2;
        // Hinge endpoint: "left" = edge start (a), "right" = edge end (b).
        const hinge = d.hinge === "right" ? b : a;
        const free = d.hinge === "right" ? a : b;
        // Swing side: "out" follows the outward normal, "in" (default) opens into the room.
        const sign = d.swing === "out" ? 1 : -1;
        const tip: Point = [hinge[0] + sign * nx * (half * 2), hinge[1] + sign * ny * (half * 2)];
        const unreviewed = !d.confirmed;
        return (
          <g key={`door-${i}`} style={{ opacity: unreviewed ? 0.6 : 1 }}>
            <line
              x1={a[0]}
              y1={flipY(a[1], bounds)}
              x2={b[0]}
              y2={flipY(b[1], bounds)}
              stroke={DOOR_COLOR}
              strokeWidth={4}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeDasharray={unreviewed ? "6 4" : undefined}
            />
            <line
              x1={hinge[0]}
              y1={flipY(hinge[1], bounds)}
              x2={tip[0]}
              y2={flipY(tip[1], bounds)}
              stroke={DOOR_COLOR}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={doorSwingPath(hinge, free, tip, bounds)}
              fill="none"
              stroke={DOOR_COLOR}
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="5 4"
            />
          </g>
        );
      })}
    </g>
  );
}

export { WINDOW_COLOR, DOOR_COLOR };
