/**
 * DEV-ONLY floor-plan fixture — lets us exercise the graph-mode review editor
 * without the create/analyze/persistence pipeline. Installed on `window` only when
 * `NODE_ENV === "development"` (see ProjectMode). Trivially removable.
 *
 * Run in the browser console:  __vistaLoadFloorPlanFixture()
 *
 * Produces two 4×3 m rooms sharing the vertical wall at x=4 m, with the interior
 * door reported on BOTH rooms (as the analyzer does) so graph mode's dedupe + shared
 * editing are exercised, plus a window on room A's exterior south wall.
 */

import type { FloorPlanAnalysis, DetectedRoom } from "./types";

/** 1×1 transparent PNG — just satisfies the review step's `floorPlanSrc` guard. */
export const FIXTURE_PLAN_IMAGE = {
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  mimeType: "image/png",
} as const;

export function twoRoomFixtureAnalysis(): FloorPlanAnalysis {
  const roomA: DetectedRoom = {
    id: "room_a",
    name: "Living",
    type: "living",
    estimatedArea: 12,
    dimensions: { width: 4, depth: 3, height: 2.7 },
    polygon: [
      [0, 0],
      [4000, 0],
      [4000, 3000],
      [0, 3000],
    ],
    // shared interior door (edge 1 = the x=4000 wall) + exterior window (edge 0 = south wall)
    doors: [
      { position: "east wall center", width: 0.9, connectsTo: "room_b", edgeIndex: 1, t: 0.5, hinge: "left", swing: "in" },
    ],
    windows: [
      { position: "south wall center", width: 1.2, height: 1.5, edgeIndex: 0, t: 0.5 },
    ],
    features: [],
  };

  const roomB: DetectedRoom = {
    id: "room_b",
    name: "Kitchen",
    type: "kitchen",
    estimatedArea: 12,
    dimensions: { width: 4, depth: 3, height: 2.7 },
    polygon: [
      [4000, 0],
      [8000, 0],
      [8000, 3000],
      [4000, 3000],
    ],
    // the SAME physical door, reported again from room B (edge 3 = the x=4000 wall)
    doors: [
      { position: "west wall center", width: 0.9, connectsTo: "room_a", edgeIndex: 3, t: 0.5, hinge: "left", swing: "in" },
    ],
    windows: [],
    features: [],
  };

  return {
    totalArea: 24,
    ceilingHeight: 2.7,
    rooms: [roomA, roomB],
    wallSegments: [],
    overallShape: "rectangular",
    notes: "DEV fixture: 2 rooms, shared wall + interior door",
    imageFrame: { width: 8000, height: 3000 },
  };
}
