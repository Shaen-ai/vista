/**
 * Viewpoint framing resolver.
 *
 * Turns a user-marked camera viewpoint (`x`, `y`, `angleDeg` in Y-up mm space)
 * plus the room geometry into a precise, render-ready description of what the
 * camera actually sees: which wall is ahead, which openings fall inside the field
 * of view and where (left/center/right), and a natural-language note for the
 * Gemini prompt. This replaces the old coarse "near the SW side, facing NE"
 * sentence with geometry-grounded framing.
 *
 * All angles use the plan convention: degrees, CCW, 0° = east (+X), 90° = north
 * (+Y) — matching the UI cone in FloorPlanHub and `compassForEdge`.
 */

import {
  type Compass,
  type Point,
  compassForEdge,
  edgeLengthMm,
  nearestEdgeToPoint,
  pointAlongEdge,
  polygonBBox,
} from "./floorPlanGeometry";
import type { CompassWallMap } from "@/lib/windowWallPlacement";
import type { DetectedRoom, PhotoViewpoint, ViewpointPhotoAnalysis } from "./types";

/** Horizontal field of view assumed for a single marked viewpoint render. */
export const VIEWPOINT_FOV_DEG = 85;

type Side = "left" | "center" | "right";

export interface VisibleOpening {
  kind: "window" | "door";
  wall: Compass;
  side: Side;
  widthM: number;
  /** e.g. "1.2 m window" / "door" */
  label: string;
}

export interface ViewpointFraming {
  fovDeg: number;
  /** 8-wind compass label of the facing direction. */
  facing: string;
  aheadWall: Compass | null;
  leftWall: Compass | null;
  rightWall: Compass | null;
  /** Measured length (meters) of the wall directly ahead, if known. */
  aheadWallM: number | null;
  /** Measured length (meters) of the left/right side walls, if known. */
  leftWallM: number | null;
  rightWallM: number | null;
  standingDesc: string;
  visibleOpenings: VisibleOpening[];
  /** Full natural-language sentence for the camera/vantage note. */
  note: string;
  /** Prompt line describing only the openings in this view (with placement). */
  openingsSummary: string;
  /**
   * Camera-relative wall → measured length (meters). Keyed by the labels the
   * placement lock uses ("back"/"left"/"right"). Lets the opening lock annotate
   * each wall with its size so Gemini renders the narrow wall narrow.
   */
  wallLengthsM: Partial<Record<"back" | "left" | "right", number>>;
}

/**
 * Expected openings reduced to ONLY what the camera can see, in camera-relative
 * wall labels. Openings behind the camera are excluded — they must not be locked
 * into the render or required by the structural validator.
 */
export interface VisibleOpeningExpectation {
  windowCount: number;
  doorCount: number;
  windowPositions: string[];
  doorPositions: string[];
}

/** Camera-relative wall label for an opening's field-of-view side. */
function cameraRelativeWall(side: Side): string {
  if (side === "left") return "left wall";
  if (side === "right") return "right wall";
  return "far/back wall";
}

/**
 * Reduce a resolved framing to the openings actually inside the field of view,
 * expressed in camera-relative terms. Anything not in `visibleOpenings` (e.g. a
 * door on the wall behind the camera) is intentionally dropped.
 */
export function framingVisibleOpenings(framing: ViewpointFraming): VisibleOpeningExpectation {
  const windows = framing.visibleOpenings.filter((o) => o.kind === "window");
  const doors = framing.visibleOpenings.filter((o) => o.kind === "door");
  return {
    windowCount: windows.length,
    doorCount: doors.length,
    windowPositions: windows.map((o) => cameraRelativeWall(o.side)),
    doorPositions: doors.map((o) => cameraRelativeWall(o.side)),
  };
}

/** Camera-relative wall label for a photo-analysis wall position. */
function cameraRelativeWallFromPosition(
  position: ViewpointPhotoAnalysis["walls"][number]["position"],
): string {
  if (position === "left" || position === "partial-left") return cameraRelativeWall("left");
  if (position === "right" || position === "partial-right") return cameraRelativeWall("right");
  return cameraRelativeWall("center");
}

/**
 * Photo-verified opening expectation. When a room photo has been analyzed
 * against its viewpoint (`analyzePhotoWithViewpoint`), the photo is ground truth:
 * use the openings it actually CONFIRMED, in camera-relative wall labels, instead
 * of the pure-geometry projection from `framingVisibleOpenings`. Anything the
 * analyst did not confirm (geometry predicted it but the photo doesn't show it)
 * is dropped.
 */
export function photoVerifiedVisibleOpenings(
  analysis: ViewpointPhotoAnalysis,
): VisibleOpeningExpectation {
  const windowPositions: string[] = [];
  const doorPositions: string[] = [];
  for (const wall of analysis.walls) {
    const label = cameraRelativeWallFromPosition(wall.position);
    for (const opening of wall.openings) {
      if (!opening.confirmed) continue;
      if (opening.type === "door") doorPositions.push(label);
      else windowPositions.push(label);
    }
  }
  return {
    windowCount: windowPositions.length,
    doorCount: doorPositions.length,
    windowPositions,
    doorPositions,
  };
}

/**
 * Build a compass → camera-relative wall map from a resolved framing: the wall the
 * camera faces becomes "back", the left/right FOV walls become "left"/"right". Used
 * to translate plan-sourced compass labels ("south wall") into the camera-relative
 * vocabulary the placement lock understands.
 */
export function compassToCameraWallMap(framing: ViewpointFraming): CompassWallMap {
  const map: CompassWallMap = {};
  if (framing.aheadWall) map[framing.aheadWall] = "back";
  if (framing.leftWall) map[framing.leftWall] = "left";
  if (framing.rightWall) map[framing.rightWall] = "right";
  return map;
}

const COMPASS8 = [
  "east",
  "north-east",
  "north",
  "north-west",
  "west",
  "south-west",
  "south",
  "south-east",
];

/** Map a Y-up facing angle (deg, CCW from +X/east) to an 8-wind compass label. */
function compass8FromAngle(angleDeg: number): string {
  const idx = Math.round(((((angleDeg % 360) + 360) % 360) / 45)) % 8;
  return COMPASS8[idx];
}

/** Normalize an angle difference into (-180, 180]. */
function normDeg(d: number): number {
  let r = ((d % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return r;
}

/**
 * Relative bearing of `target` as seen from the camera: 0 = dead ahead,
 * positive = to the LEFT (CCW), negative = to the RIGHT. Returns null if the
 * target coincides with the camera.
 */
function relativeBearing(camera: Point, angleDeg: number, target: Point): number | null {
  const dx = target[0] - camera[0];
  const dy = target[1] - camera[1];
  if (dx === 0 && dy === 0) return null;
  const bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
  return normDeg(bearing - angleDeg);
}

function sideFromRel(rel: number): Side {
  if (rel > 15) return "left";
  if (rel < -15) return "right";
  return "center";
}

/** Extract the leading compass word from an opening `position` string. */
function compassFromPosition(position: string | undefined): Compass | null {
  if (!position) return null;
  const m = position.toLowerCase().match(/north|south|east|west/);
  return (m?.[0] as Compass | undefined) ?? null;
}

/**
 * Ray-cast from the camera along `angleDeg`; return the polygon edge the ray
 * first crosses (the wall the camera looks at), or null if none is hit.
 */
function raycastWallAhead(polygon: Point[], camera: Point, angleDeg: number): number | null {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const n = polygon.length;
  let bestIdx: number | null = null;
  let bestS = Infinity;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    // Solve camera + s*D = a + u*E  →  s along ray, u along edge.
    const denom = dx * -ey - dy * -ex; // = dx*(-ey) - dy*(-ex)
    if (Math.abs(denom) < 1e-9) continue; // parallel
    const rhsX = a[0] - camera[0];
    const rhsY = a[1] - camera[1];
    const s = (rhsX * -ey - rhsY * -ex) / denom;
    const u = (dx * rhsY - dy * rhsX) / denom;
    if (s > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && s < bestS) {
      bestS = s;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function metersFromMm(mm: number): number {
  return Math.round((mm / 1000) * 10) / 10;
}

function openingLabel(kind: "window" | "door", widthM: number): string {
  if (kind === "door") return widthM > 0 ? `${widthM} m door` : "door";
  return widthM > 0 ? `${widthM} m window` : "window";
}

function sidePhrase(side: Side): string {
  if (side === "left") return "on the left";
  if (side === "right") return "on the right";
  return "ahead";
}

/**
 * Coarse fallback (no usable polygon): facing-only description, matching the
 * legacy `describeViewpoint` behaviour so nothing regresses.
 */
function fallbackFraming(vp: PhotoViewpoint): ViewpointFraming {
  const facing = compass8FromAngle(vp.angleDeg);
  return {
    fovDeg: VIEWPOINT_FOV_DEG,
    facing,
    aheadWall: null,
    leftWall: null,
    rightWall: null,
    aheadWallM: null,
    leftWallM: null,
    rightWallM: null,
    standingDesc: `camera facing ${facing}`,
    visibleOpenings: [],
    note: `camera facing ${facing}`,
    openingsSummary: "",
    wallLengthsM: {},
  };
}

/**
 * Resolve the full framing for a marked viewpoint within a room. Pure geometry;
 * never throws — degrades to a facing-only description when the polygon is
 * missing, and approximates opening sides from `position` strings when the
 * openings were not placed on specific edges (auto-detected rooms).
 */
export function resolveViewpointFraming(
  vp: PhotoViewpoint,
  room: DetectedRoom | undefined,
  fovDeg: number = VIEWPOINT_FOV_DEG,
): ViewpointFraming {
  const polygon = room?.polygon;
  if (!polygon || polygon.length < 3) return fallbackFraming(vp);

  const camera: Point = [vp.x, vp.y];
  const facing = compass8FromAngle(vp.angleDeg);
  const half = fovDeg / 2;

  // Standing position: nearest wall + distance, plus corner proximity.
  const nearest = nearestEdgeToPoint(polygon, camera);
  const nearWall = compassForEdge(polygon, nearest.edgeIndex);
  const distM = metersFromMm(nearest.distMm);
  const bbox = polygonBBox(polygon);
  const fx = (vp.x - bbox.minX) / Math.max(bbox.maxX - bbox.minX, 1);
  const fy = (vp.y - bbox.minY) / Math.max(bbox.maxY - bbox.minY, 1); // Y-up: 1 = north
  const ns = fy > 0.66 ? "north" : fy < 0.33 ? "south" : "";
  const ew = fx > 0.66 ? "east" : fx < 0.33 ? "west" : "";
  const corner = `${ns}${ns && ew ? "-" : ""}${ew}`;
  const standingDesc = corner
    ? `camera ~${distM} m from the ${nearWall} wall, near the ${corner} corner, facing ${facing}`
    : `camera ~${distM} m from the ${nearWall} wall, facing ${facing}`;

  // Wall directly ahead via raycast (fallback: edge with the smallest |rel|).
  let aheadIdx = raycastWallAhead(polygon, camera, vp.angleDeg);
  if (aheadIdx === null) {
    let bestAbs = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const mid = pointAlongEdge(polygon, i, 0.5);
      const rel = relativeBearing(camera, vp.angleDeg, mid);
      if (rel !== null && Math.abs(rel) < bestAbs) {
        bestAbs = Math.abs(rel);
        aheadIdx = i;
      }
    }
  }
  const aheadWall = aheadIdx !== null ? compassForEdge(polygon, aheadIdx) : null;

  // Left/right walls: edges whose midpoint sits within the FOV, most off to
  // each side (excluding the wall straight ahead).
  let leftWall: Compass | null = null;
  let rightWall: Compass | null = null;
  let leftIdx: number | null = null;
  let rightIdx: number | null = null;
  let maxRel = 0;
  let minRel = 0;
  for (let i = 0; i < polygon.length; i++) {
    if (i === aheadIdx) continue;
    const mid = pointAlongEdge(polygon, i, 0.5);
    const rel = relativeBearing(camera, vp.angleDeg, mid);
    if (rel === null || Math.abs(rel) > half) continue;
    if (rel > maxRel) {
      maxRel = rel;
      leftWall = compassForEdge(polygon, i);
      leftIdx = i;
    }
    if (rel < minRel) {
      minRel = rel;
      rightWall = compassForEdge(polygon, i);
      rightIdx = i;
    }
  }

  // Measured wall lengths (meters) for the camera-relative walls + a narrow/long
  // classification of the room footprint. Gemini renders the faced wall "wide" by
  // default; telling it the faced wall is the SHORT wall is what keeps a window
  // that sits on the narrow wall from drifting onto the long wall.
  const allEdgeLensM = polygon.map((_, i) => metersFromMm(edgeLengthMm(polygon, i)));
  const longestM = Math.max(...allEdgeLensM);
  const shortestM = Math.min(...allEdgeLensM.filter((l) => l > 0));
  const isElongated = shortestM > 0 && longestM / shortestM >= 1.35;
  const aheadWallM = aheadIdx !== null ? allEdgeLensM[aheadIdx] : null;
  const leftWallM = leftIdx !== null ? allEdgeLensM[leftIdx] : null;
  const rightWallM = rightIdx !== null ? allEdgeLensM[rightIdx] : null;
  const classify = (lenM: number | null): string => {
    if (lenM === null || !isElongated) return "";
    if (lenM <= shortestM * 1.1) return ", the room's SHORT/narrow wall";
    if (lenM >= longestM * 0.9) return ", a LONG wall";
    return "";
  };
  const sizeOf = (lenM: number | null): string => (lenM !== null ? ` (${lenM} m wide${classify(lenM)})` : "");
  const wallLengthsM: Partial<Record<"back" | "left" | "right", number>> = {};
  if (aheadWallM !== null) wallLengthsM.back = aheadWallM;
  if (leftWallM !== null) wallLengthsM.left = leftWallM;
  if (rightWallM !== null) wallLengthsM.right = rightWallM;

  // Openings that fall inside the field of view, with left/center/right placement.
  const visibleOpenings: VisibleOpening[] = [];
  const visibleWalls = new Set<Compass>([aheadWall, leftWall, rightWall].filter(Boolean) as Compass[]);

  const collect = (
    kind: "window" | "door",
    items: { position: string; width: number; edgeIndex?: number; t?: number }[],
  ) => {
    for (const o of items) {
      const widthM = metersFromMm(o.width);
      if (typeof o.edgeIndex === "number" && typeof o.t === "number") {
        const center = pointAlongEdge(polygon, o.edgeIndex, o.t);
        const rel = relativeBearing(camera, vp.angleDeg, center);
        if (rel === null || Math.abs(rel) > half) continue;
        visibleOpenings.push({
          kind,
          wall: compassForEdge(polygon, o.edgeIndex),
          side: sideFromRel(rel),
          widthM,
          label: openingLabel(kind, widthM),
        });
      } else {
        // No edge placement (auto-detected): keep it only if its wall is in view.
        const wall = compassFromPosition(o.position);
        if (!wall || !visibleWalls.has(wall)) continue;
        const side: Side = wall === aheadWall ? "center" : wall === leftWall ? "left" : "right";
        visibleOpenings.push({ kind, wall, side, widthM, label: openingLabel(kind, widthM) });
      }
    }
  };
  collect("window", room?.windows ?? []);
  collect("door", room?.doors ?? []);

  // Assemble the note + openings summary.
  const parts: string[] = [standingDesc + "."];
  if (aheadWall) {
    const aheadOpenings = visibleOpenings.filter((o) => o.side === "center");
    const ahead = aheadOpenings.length
      ? ` with ${aheadOpenings.map((o) => o.label).join(" and ")}`
      : "";
    parts.push(`Ahead: ${aheadWall} wall${sizeOf(aheadWallM)}${ahead}.`);
  }
  const leftOpenings = visibleOpenings.filter((o) => o.side === "left");
  if (leftWall || leftOpenings.length) {
    const desc = leftOpenings.length ? ` with ${leftOpenings.map((o) => o.label).join(" and ")}` : "";
    parts.push(`Left: ${leftWall ?? "wall"}${sizeOf(leftWallM)}${desc}.`);
  }
  const rightOpenings = visibleOpenings.filter((o) => o.side === "right");
  if (rightWall || rightOpenings.length) {
    const desc = rightOpenings.length ? ` with ${rightOpenings.map((o) => o.label).join(" and ")}` : "";
    parts.push(`Right: ${rightWall ?? "wall"}${sizeOf(rightWallM)}${desc}.`);
  }
  if (isElongated && aheadWallM !== null && aheadWallM <= shortestM * 1.1) {
    parts.push(
      `This room is elongated (${longestM} m × ${shortestM} m); you are looking down its length toward the narrow ${aheadWallM} m far wall, so render the far/back wall NARROW and the side walls long.`,
    );
  }

  const note = parts.join(" ");

  const openingsSummary = visibleOpenings.length
    ? "In view: " +
      visibleOpenings
        .map((o) => `${o.label} on the ${o.wall} wall ${sidePhrase(o.side)}`)
        .join("; ")
    : "No windows or doors are visible from this camera angle.";

  return {
    fovDeg,
    facing,
    aheadWall,
    leftWall,
    rightWall,
    aheadWallM,
    leftWallM,
    rightWallM,
    standingDesc,
    visibleOpenings,
    note,
    openingsSummary,
    wallLengthsM,
  };
}

/** Shortest separation between two camera facing angles (0–180°). */
export function viewpointFacingSeparationDeg(a: number, b: number): number {
  const raw = Math.abs((((b - a) % 360) + 360) % 360);
  return raw > 180 ? 360 - raw : raw;
}

/** True when two marked viewpoints face roughly opposite directions (~180°). */
export function areViewpointsRoughlyOpposite(
  a: number,
  b: number,
  toleranceDeg = 50,
): boolean {
  return Math.abs(viewpointFacingSeparationDeg(a, b) - 180) <= toleranceDeg;
}

/** Image labels used inside the transfer directive (pipeline-specific). */
export interface ViewpointTransferLabels {
  photoLabel: string;
  referenceLabel: string;
}

const DEFAULT_TRANSFER_LABELS: ViewpointTransferLabels = {
  photoLabel: "EDIT TARGET photo",
  referenceLabel: "PRIMARY DESIGN REFERENCE",
};

/**
 * Prompt block for transferring an approved design onto a different camera.
 * Uses compass-wall-anchored placement so furniture stays on its physical wall
 * regardless of camera direction. Architecture (doors, windows, columns) always
 * comes from the photo — never mirrored from the reference.
 */
export function buildViewpointTransferDirective(opts: {
  referenceAngleDeg?: number;
  editTargetAngleDeg?: number;
  referenceFacing?: string;
  editTargetFacing?: string;
  /** Hero camera's visible walls (compass) — used to anchor furniture to physical walls. */
  heroFraming?: ViewpointFraming | null;
  /** Secondary camera's visible walls (compass). */
  editTargetFraming?: ViewpointFraming | null;
  /** Pipeline-specific names for the photo and reference images in the prompt. */
  labels?: Partial<ViewpointTransferLabels>;
}): string {
  const photoLabel = opts.labels?.photoLabel ?? DEFAULT_TRANSFER_LABELS.photoLabel;
  const referenceLabel = opts.labels?.referenceLabel ?? DEFAULT_TRANSFER_LABELS.referenceLabel;

  const opposite =
    opts.referenceAngleDeg !== undefined &&
    opts.editTargetAngleDeg !== undefined &&
    areViewpointsRoughlyOpposite(opts.referenceAngleDeg, opts.editTargetAngleDeg);

  const facingNote =
    opts.referenceFacing && opts.editTargetFacing
      ? ` (reference camera facing ${opts.referenceFacing}; this camera facing ${opts.editTargetFacing})`
      : "";

  const architectureLock = `ARCHITECTURE IS FIXED (mandatory):
- All walls, door openings, windows, columns, structural posts, ceiling, and floor come ONLY from the ${photoLabel} — never copied, moved, or mirrored from the ${referenceLabel}.
- Do NOT mirror, flip, or swap door positions, window positions, or columns between the reference and this output.`;

  const wallAnchor = buildWallAnchorBlock(opts.heroFraming, opposite);

  if (opposite) {
    return `OPPOSITE-CAMERA FURNITURE PLACEMENT (~180° from reference — mandatory)${facingNote}:
${architectureLock}
${wallAnchor}
FURNITURE PLACEMENT RULES (furniture only — architecture stays as above):
- Every piece of furniture stays on the SAME PHYSICAL COMPASS WALL as in the ${referenceLabel} — do NOT move any furniture to a different wall.
- The bed headboard wall in the reference is the bed headboard wall in this output. The wardrobe wall in the reference is the wardrobe wall here. No exceptions.
- Because the camera turned ~180°, furniture will appear on the OPPOSITE screen side compared to the reference — that left/right swap applies to FURNITURE ONLY, never to doors, windows, or columns.
- Match the SAME products, finishes, colors, materials, ceiling treatment, and floor finish as the ${referenceLabel}.`;
  }

  return `VIEWPOINT FURNITURE PLACEMENT${facingNote}:
${architectureLock}
${wallAnchor}
Every piece of furniture stays on its PHYSICAL COMPASS WALL from the ${referenceLabel} — only the camera moved. Match the reference's products, finishes, and palette.`;
}

/**
 * Build a compass-wall map showing which furniture is on which physical wall,
 * so the secondary viewpoint knows the bed stays on e.g. "the NORTH wall"
 * regardless of camera angle.
 */
function buildWallAnchorBlock(
  heroFraming: ViewpointFraming | null | undefined,
  opposite: boolean,
): string {
  if (!heroFraming) return "";

  const lines: string[] = [];
  lines.push("FURNITURE WALL MAP (compass walls are FIXED — furniture does not move between walls):");

  if (heroFraming.aheadWall) {
    lines.push(`- ${heroFraming.aheadWall.toUpperCase()} wall (furniture anchor in reference)`);
  }
  if (heroFraming.leftWall) {
    lines.push(`- ${heroFraming.leftWall.toUpperCase()} wall (furniture anchor in reference)`);
  }
  if (heroFraming.rightWall) {
    lines.push(`- ${heroFraming.rightWall.toUpperCase()} wall (furniture anchor in reference)`);
  }

  lines.push(
    "Furniture placed against any wall in the reference STAYS on that same compass wall. " +
    "The bed headboard, wardrobe, TV unit, desk — each keeps its wall assignment.",
  );
  if (opposite) {
    lines.push(
      "With a ~180° camera turn, those pieces appear on the opposite screen side — that is expected for furniture only.",
    );
  }

  return lines.join("\n");
}
