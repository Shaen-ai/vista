/**
 * Phase 1 — Floor Plan Analysis.
 *
 * Sends a floor-plan image to OpenAI vision and extracts a structured JSON
 * description of every room, wall segment, door/window position, and
 * approximate dimensions.
 */

import sharp from "sharp";
import { withRetry } from "@/lib/aiRetry";
import { parseAssistantJsonObject } from "@/lib/creativeDirectorJson";
import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { pipelineLog } from "@/lib/pipelineLog";
import {
  anchorFromPositionText,
  computeSharedWalls,
  deriveWallSegments,
  describeOpening,
  dimensionsFromPolygon,
  polygonArea,
  repairOpeningAnchors,
  sanitizePolygon,
} from "./floorPlanGeometry";
import type { Point } from "./floorPlanGeometry";
import type { DetectedRoom, FloorPlanAnalysis, PlanColumn, RoomType, UtilityEntryPoint, UtilityPointType } from "./types";

const ROOM_TYPES_LIST: RoomType[] = [
  "hallway", "living", "kitchen", "bedroom", "children",
  "bathroom", "toilet", "laundry", "balcony", "dining",
  "office", "wardrobe", "storage", "other",
];

const UTILITY_POINT_TYPES: UtilityPointType[] = [
  "water_inlet",
  "water_drain_stack",
  "electrical_panel",
  "gas_inlet",
];

function buildManualSeedBlock(manualPlan?: FloorPlanAnalysis): string {
  const rooms = manualPlan?.rooms?.filter((r) => (r.polygon?.length ?? 0) >= 3) ?? [];
  if (rooms.length === 0) return "";

  const seed = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    dimensions: r.dimensions,
    polygon: r.polygon,
  }));

  return `

THE USER HAS ALREADY TRACED THE ROOM LAYOUT over this floor plan, and their drawing is FINAL. It is the authoritative, locked source for the geometry: which rooms exist, their count, identities, shapes, and dimensions. You MUST NOT change the geometry. Specifically:
- Keep EXACTLY these rooms — the same count and identities. Reuse each room's "id", "name", and "type". Do NOT add, remove, split, or merge rooms.
- Do NOT alter geometry: do not move, straighten, square-up, rotate, or re-scale anything. Echo each room's "polygon" and "dimensions" back UNCHANGED, exactly as given below. Do not recompute them from the image.
- Your ONLY job is to read the floor-plan IMAGE and, for each traced room, determine the WINDOWS and DOORS on its walls (how many, which wall, approximate size) plus any notable architectural features. Describe opening positions with compass-style wall references (e.g. "south wall center", "east wall near corner") consistent with the plan's orientation. The traced drawing shares the image's orientation, so "south wall" means the same in both.
- The image is the source of truth for openings and features ONLY. The drawing is the source of truth for everything geometric.

The user's traced rooms (coordinates in mm, bottom-left origin, Y axis up — return these polygons/dimensions unchanged):
${JSON.stringify(seed)}`;
}

function buildFloorPlanAnalysisPrompt(
  userAreaM2?: number,
  manualPlan?: FloorPlanAnalysis,
  hasDrawnImage = false,
): string {
  const areaHint = userAreaM2
    ? `\nThe user states the total apartment area is approximately ${userAreaM2} m². Use this to calibrate your dimension estimates.`
    : "";

  const drawnImageHint = hasDrawnImage
    ? `\n\nTWO images are attached. The FIRST is the original uploaded floor plan. The SECOND is the user's own schematic drawing of the SAME plan, with room shapes, doors (orange, with swing arcs) and windows (blue) marked — it is the AUTHORITATIVE layout. Read the room shapes, doors, and windows primarily from the second (drawn) image; use the first only to disambiguate.`
    : "";

  return `You are an expert architectural analyst and interior designer. Analyze the floor plan image provided and extract a complete structured description of the apartment or house.
${areaHint}${drawnImageHint}${buildManualSeedBlock(manualPlan)}

COORDINATE SYSTEM — READ CAREFULLY. You are tracing rooms ONTO the image you see, like drawing on tracing paper laid over it:
- The image's LEFT edge is x=0; its RIGHT edge is x=1000.
- y uses the SAME scale as x and grows DOWNWARD: the TOP edge of the image is y=0, and y increases toward the BOTTOM. This is the only rule that matters for y — keep x and y on one common scale; you do NOT need to know where the bottom edge falls (the system computes the image's true height from its pixels).
- So a point at the horizontal middle, vertical middle of the image is roughly [500, imageHeightUnits/2].
- Every polygon vertex MUST be the location of that corner AS IT APPEARS in the image. Do NOT invent an abstract layout — read the real pixel position of each room and each wall.

INSTRUCTIONS:
1. Identify EVERY distinct room/space in the floor plan. Use room labels if visible; otherwise infer from layout (kitchens have counters, bathrooms have fixtures, etc.).
2. For each room, trace its TRUE outline as a closed polygon in the coordinate system above. Walk the room's corners in order. Use 4 points for a simple rectangular room and MORE points for L-shaped or irregular rooms — do not flatten a non-rectangular room into a rectangle. For rooms with curved or rounded walls (bay windows, rounded corridors, turrets), approximate the curve as 8-16 short straight segments so the polygon closely follows the actual arc; use more vertices for longer curves.
3. Rooms MUST NOT overlap. Two rooms never occupy the same area. Adjacent rooms share a common wall line (their edges touch but do not cross). The set of room polygons should tile the apartment footprint the way the real plan does. Before you answer, double-check that no room sits on top of another.
4. Also estimate each room's real-world dimensions in METERS (width × depth) using any printed dimension annotations or area labels on the plan (e.g. a "14.7 m²" label). If dimensions are in millimeters, convert to meters.
5. Assume a standard ceiling height of 2.7m unless annotations suggest otherwise.
6. Identify all windows and doors. On an architectural plan these render as breaks in the wall line: a DOOR is a gap in the wall, usually with a thin quarter-circle swing arc showing how the leaf opens; a WINDOW is a gap spanned by a thin line or 2-3 short parallel lines across the wall thickness. Scan every wall segment carefully for these — they are small, thin marks. Do NOT report an opening where the wall is drawn solid with no break, and do NOT miss a break just because it is small. For each opening, report which polygon edge it sits on ("edgeIndex", 0-based: edge 0 goes from vertex 0 to vertex 1, edge 1 from vertex 1 to vertex 2, etc.) and the approximate fraction "t" (0.0 = at the edge's start vertex, 0.5 = center of the edge, 1.0 = at the edge's end vertex) where the opening's center falls. Also note the compass position (e.g. "north wall, center") for readability. "north" = top of the image (smaller y), "south" = bottom (larger y), "east" = right, "west" = left.
7. Extract wall segments as coordinate pairs in the SAME coordinate system (x right, y down).
8. Note architectural features like balcony access, built-in closets, etc. Only list freestanding load-bearing columns if the plan explicitly draws a distinct column symbol inside the room — an L-shaped wall jog, polygon corner, or small edge notch is wall geometry, NOT a column; describe those as "wall notch" or "L-shape corner", never as column/shaft/pier.
9. "imageHeightUnits" is OPTIONAL and may be omitted — the system computes the image's true height from its pixels and does not rely on your estimate. Just keep every y on the same scale as x (see the coordinate system above).
10. Detect utility entry points if visible on the plan or infer likely locations:
   - water_inlet: main cold water meter / riser entry (often near kitchen or bathroom)
   - water_drain_stack: main sewer/drain stack (often in bathroom or kitchen wet wall)
   - electrical_panel: main breaker panel / fuse box (often in hallway or near entrance)
   - gas_inlet: gas meter entry if applicable (optional — omit if not relevant)
   Place each at approximate coordinates in mm. Only include points you can identify or reasonably infer; omit uncertain ones.

Room types to use: ${ROOM_TYPES_LIST.join(", ")}

Respond ONLY with valid JSON matching this schema:
{
  "totalArea": number (m²),
  "ceilingHeight": number (meters, default 2.7),
  "imageHeightUnits": number (OPTIONAL — ignored; the system uses the image's real pixel ratio),
  "overallShape": "string (rectangular, L-shaped, irregular, etc.)",
  "notes": "string (any observations about the plan quality, unusual features, etc.)",
  "rooms": [
    {
      "id": "string (e.g. room-1, room-2)",
      "name": "string (e.g. Living Room, Master Bedroom, Hallway)",
      "type": "string (one of the room types listed above)",
      "estimatedArea": number (m²),
      "dimensions": { "width": number_meters, "depth": number_meters, "height": number_meters },
      "windows": [{ "position": "string (e.g. south wall center)", "width": number_meters, "height": number_meters, "edgeIndex": number (0-based polygon edge index), "t": number (0..1 fraction along that edge) }],
      "doors": [{ "position": "string (e.g. east wall, near corner)", "width": number_meters, "height": number_meters (default 2.1), "connectsTo": "string (room id or 'exterior')", "edgeIndex": number (0-based polygon edge index), "t": number (0..1 fraction along that edge) }],
      "features": ["string (e.g. balcony access, built-in closet, load-bearing column)"],
      "polygon": [[x, y], [x, y], ...]  (image coordinates: x 0..1000 left→right, y 0..imageHeightUnits top→bottom; trace the room's real corners, no overlaps)
    }
  ],
  "wallSegments": [
    {
      "x1": number, "y1": number,
      "x2": number, "y2": number,
      "thickness": number (wall thickness in the same units; typically 8-25),
      "lengthMm": number (real wall length in mm, from the plan's annotations)
    }
  ],
  "utilityPoints": [
    {
      "id": "string (e.g. util-water-1)",
      "type": "water_inlet | water_drain_stack | electrical_panel | gas_inlet",
      "x": number,
      "y": number,
      "label": "string (e.g. Main water inlet)"
    }
  ]
}

All polygon, wallSegment, and utilityPoint x/y values are in the image coordinate system (x 0..1000, y 0..imageHeightUnits). Real-world sizes go in the meter "dimensions" fields and in wallSegment "lengthMm". Every room must have a polygon traced from the image, and no two room polygons may overlap.`;
}

/** Prompt for upload-only auto-detect: rooms, doors, windows, columns only. */
function buildAutoDetectFloorPlanPrompt(userAreaM2?: number): string {
  const areaHint = userAreaM2
    ? `\nThe user states the total apartment area is approximately ${userAreaM2} m². Use this to calibrate your dimension estimates.`
    : "";

  return `You are an expert architectural analyst. Analyze the floor plan image and extract ONLY: rooms, doors, windows, and freestanding structural columns.

${areaHint}

COORDINATE SYSTEM — trace rooms ONTO the image like tracing paper:
- LEFT edge of image is x=0; RIGHT edge is x=1000.
- y uses the SAME scale as x and grows DOWNWARD: TOP is y=0, y increases toward the BOTTOM.
- Every polygon vertex must match where that corner APPEARS in the image.

INSTRUCTIONS:
1. Identify EVERY distinct room/space. Use printed labels when visible; otherwise infer from layout.
2. For each room, trace its TRUE outline as a closed polygon (4+ points; more for L-shaped or curved walls).
3. Rooms MUST NOT overlap — they should tile the apartment footprint.
4. Estimate each room's real-world dimensions in METERS from annotations or area labels on the plan.
5. Assume ceiling height 2.7m unless the plan says otherwise.
6. Identify all doors and windows on wall segments. For each opening report edgeIndex (0-based polygon edge) and t (0..1 along that edge), plus compass position text.
7. Identify freestanding load-bearing COLUMNS only when the plan shows an explicit column symbol (filled square/circle) inside a room — NOT wall jogs, L-corners, or notches. Report each column's center position in image coordinates and approximate width/depth in meters.

Room types: ${ROOM_TYPES_LIST.join(", ")}

Respond ONLY with valid JSON:
{
  "totalArea": number (m²),
  "ceilingHeight": number (default 2.7),
  "overallShape": "string",
  "notes": "string",
  "rooms": [
    {
      "id": "string",
      "name": "string",
      "type": "string",
      "estimatedArea": number,
      "dimensions": { "width": number, "depth": number, "height": number },
      "windows": [{ "position": "string", "width": number, "height": number, "edgeIndex": number, "t": number }],
      "doors": [{ "position": "string", "width": number, "height": number, "connectsTo": "string", "edgeIndex": number, "t": number }],
      "polygon": [[x, y], ...]
    }
  ],
  "columns": [
    {
      "id": "string",
      "x": number,
      "y": number,
      "width": number,
      "depth": number,
      "roomId": "string (optional)",
      "shape": "square | rectangular | circular"
    }
  ]
}

All room polygon and column x/y values use image coordinates (x 0..1000, y downward). Real sizes in meters. Do NOT include utility points, wall segment arrays, or generic features.`;
}

function asColumnShape(v: unknown): PlanColumn["shape"] | undefined {
  if (v === "square" || v === "rectangular" || v === "circular") return v;
  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function asRoomType(v: unknown): RoomType {
  if (typeof v === "string" && ROOM_TYPES_LIST.includes(v as RoomType)) return v as RoomType;
  return "other";
}

function asUtilityPointType(v: unknown): UtilityPointType | null {
  if (typeof v === "string" && UTILITY_POINT_TYPES.includes(v as UtilityPointType)) {
    return v as UtilityPointType;
  }
  return null;
}

function defaultUtilityLabel(type: UtilityPointType): string {
  switch (type) {
    case "water_inlet":
      return "Water inlet";
    case "water_drain_stack":
      return "Drain stack";
    case "electrical_panel":
      return "Electrical panel";
    case "gas_inlet":
      return "Gas inlet";
    default:
      return "Utility";
  }
}

/**
 * Disambiguate machine-generated room names and ids. Rooms that share a name
 * (e.g. two "Bedroom"s from the model) get a sequential suffix in encounter
 * order ("Bedroom 1", "Bedroom 2"); names that occur only once are left as-is.
 * Ids are independently made unique (the model or sanitization can repeat them)
 * so downstream id-keyed lookups stay correct.
 */
function ensureUniqueRoomNames(rooms: DetectedRoom[]): DetectedRoom[] {
  const nameCounts = new Map<string, number>();
  for (const r of rooms) {
    const key = r.name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const nameSeen = new Map<string, number>();
  const usedIds = new Set<string>();

  return rooms.map((r) => {
    const key = r.name.trim().toLowerCase();
    let name = r.name;
    if ((nameCounts.get(key) ?? 0) > 1) {
      const n = (nameSeen.get(key) ?? 0) + 1;
      nameSeen.set(key, n);
      name = `${r.name.trim()} ${n}`;
    }

    let id = r.id;
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${r.id}-${n}`)) n += 1;
      id = `${r.id}-${n}`;
    }
    usedIds.add(id);

    return id === r.id && name === r.name ? r : { ...r, id, name };
  });
}

/** Parse and normalize the raw JSON from the model into a typed FloorPlanAnalysis. */
export function normalizeAnalysis(raw: unknown): FloorPlanAnalysis {
  const o = isRecord(raw) ? raw : {};
  const rooms = Array.isArray(o.rooms) ? o.rooms : [];
  const walls = Array.isArray(o.wallSegments) ? o.wallSegments : [];
  const utilityRaw = Array.isArray(o.utilityPoints) ? o.utilityPoints : [];
  const columnsRaw = Array.isArray(o.columns) ? o.columns : [];

  const utilityPoints: UtilityEntryPoint[] = utilityRaw
    .filter(isRecord)
    .map((u, i) => {
      const type = asUtilityPointType(u.type);
      if (!type) return null;
      return {
        id: asString(u.id, `util-${type}-${i + 1}`),
        type,
        x: asNumber(u.x, 0),
        y: asNumber(u.y, 0),
        label: asString(u.label, defaultUtilityLabel(type)),
      };
    })
    .filter((u): u is UtilityEntryPoint => u !== null);

  const columns: PlanColumn[] = columnsRaw
    .filter(isRecord)
    .map((c, i) => ({
      id: asString(c.id, `column-${i + 1}`).replace(/[\/\\?#%\s]+/g, "-"),
      x: asNumber(c.x, 0),
      y: asNumber(c.y, 0),
      width: Math.max(0.1, asNumber(c.width, 0.4)),
      depth: Math.max(0.1, asNumber(c.depth, 0.4)),
      ...(typeof c.roomId === "string" && c.roomId.trim() ? { roomId: c.roomId.trim() } : {}),
      ...(asColumnShape(c.shape) ? { shape: asColumnShape(c.shape) } : {}),
    }));

  const mappedRooms = rooms
      .filter(isRecord)
      .map((r, i) => {
        const dims = isRecord(r.dimensions) ? r.dimensions : {};
        const polygonPoints: Point[] = sanitizePolygon(r.polygon);
        // When the model omits a wall anchor, derive one from the position text so
        // the opening is visible/draggable in the editor. Anchored ≠ confirmed:
        // `confirmed` stays unset until the user reviews it (see types.ts).
        const anchorOpening = <T extends { position: string; edgeIndex?: number; t?: number }>(o: T): T => {
          if (o.edgeIndex !== undefined || polygonPoints.length < 3) return o;
          const anchor = anchorFromPositionText(polygonPoints, o.position);
          if (!anchor) return o;
          o.edgeIndex = anchor.edgeIndex;
          o.t = anchor.t;
          o.position = describeOpening(polygonPoints, anchor.edgeIndex, anchor.t);
          return o;
        };
        const roomDraft = {
          id: asString(r.id, `room-${i + 1}`).replace(/[\/\\?#%\s]+/g, "-"),
          name: asString(r.name, `Room ${i + 1}`),
          type: asRoomType(r.type),
          estimatedArea: asNumber(r.estimatedArea, 0),
          dimensions: {
            width: asNumber(dims.width, 3),
            depth: asNumber(dims.depth, 3),
            height: asNumber(dims.height, 2.7),
          },
          windows: (Array.isArray(r.windows) ? r.windows : [])
            .filter(isRecord)
            .map((w) => {
              const win: DetectedRoom["windows"][number] = {
                position: asString(w.position, "unknown"),
                width: asNumber(w.width, 1.2),
                height: asNumber(w.height, 1.5),
              };
              const ei = Number(w.edgeIndex);
              if (Number.isFinite(ei) && ei >= 0 && polygonPoints.length >= 2) {
                win.edgeIndex = Math.min(Math.round(ei), polygonPoints.length - 1);
                win.t = Math.min(1, Math.max(0, asNumber(w.t, 0.5)));
              }
              return anchorOpening(win);
            }),
          doors: (Array.isArray(r.doors) ? r.doors : [])
            .filter(isRecord)
            .map((d) => {
              const door: DetectedRoom["doors"][number] = {
                position: asString(d.position, "unknown"),
                width: asNumber(d.width, 0.8),
                connectsTo: asString(d.connectsTo, "unknown"),
              };
              const dh = Number(d.height);
              if (Number.isFinite(dh) && dh > 0) door.height = dh;
              const ei = Number(d.edgeIndex);
              if (Number.isFinite(ei) && ei >= 0 && polygonPoints.length >= 2) {
                door.edgeIndex = Math.min(Math.round(ei), polygonPoints.length - 1);
                door.t = Math.min(1, Math.max(0, asNumber(d.t, 0.5)));
              }
              return anchorOpening(door);
            }),
          features: (Array.isArray(r.features) ? r.features : [])
            .filter((f): f is string => typeof f === "string"),
          polygon: polygonPoints,
        };
        return repairOpeningAnchors(roomDraft);
      });

  return {
    totalArea: asNumber(o.totalArea, 0),
    ceilingHeight: asNumber(o.ceilingHeight, 2.7),
    overallShape: asString(o.overallShape, "rectangular"),
    notes: asString(o.notes, ""),
    utilityPoints: utilityPoints.length > 0 ? utilityPoints : undefined,
    columns: columns.length > 0 ? columns : undefined,
    rooms: ensureUniqueRoomNames(mappedRooms),
    wallSegments: walls
      .filter(isRecord)
      .map((w) => ({
        x1: asNumber(w.x1, 0),
        y1: asNumber(w.y1, 0),
        x2: asNumber(w.x2, 0),
        y2: asNumber(w.y2, 0),
        thickness: asNumber(w.thickness, 120),
        lengthMm: asNumber(w.lengthMm, 0),
      })),
  };
}


/** Axis-aligned bounds of a polygon (mm). */
function polygonBBox(poly: ReadonlyArray<readonly [number, number]>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Overlap area (mm²) of two axis-aligned bounding boxes. */
function bboxOverlapArea(
  a: ReturnType<typeof polygonBBox>,
  b: ReturnType<typeof polygonBBox>,
): number {
  const ox = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const oy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return ox * oy;
}

/**
 * DIAGNOSTIC (investigation only): log how coherent the detected geometry is.
 * The auto-detect path has the model invent an mm coordinate frame not tied to
 * the image pixels, so its polygons routinely overlap and drift off the real walls.
 * This prints the overall bbox aspect ratio plus the worst pairwise bbox overlap
 * so a real upload confirms (vs. just describing) the "wrong plan" symptom.
 */
function logGeometryDiagnostics(analysis: FloorPlanAnalysis): void {
  const withPoly = analysis.rooms.filter((r) => (r.polygon?.length ?? 0) >= 3);
  if (withPoly.length === 0) {
    pipelineLog("FLOOR_PLAN_RESULTS", "geom — no room polygons", {}, "warn");
    return;
  }
  const boxes = withPoly.map((r) => ({ room: r, bbox: polygonBBox(r.polygon!) }));
  const overall = boxes.reduce(
    (acc, { bbox }) => ({
      minX: Math.min(acc.minX, bbox.minX), minY: Math.min(acc.minY, bbox.minY),
      maxX: Math.max(acc.maxX, bbox.maxX), maxY: Math.max(acc.maxY, bbox.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const overallW = overall.maxX - overall.minX;
  const overallH = overall.maxY - overall.minY;
  pipelineLog("FLOOR_PLAN_RESULTS", "geom — overall bbox", {
    roomCount: boxes.length,
    overallW: Math.round(overallW),
    overallH: Math.round(overallH),
    aspect: Number((overallW / (overallH || 1)).toFixed(2)),
  });
  let worst = { a: "", b: "", frac: 0 };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const ov = bboxOverlapArea(boxes[i].bbox, boxes[j].bbox);
      if (ov <= 0) continue;
      const smaller = Math.min(
        boxes[i].bbox.w * boxes[i].bbox.h,
        boxes[j].bbox.w * boxes[j].bbox.h,
      ) || 1;
      const frac = ov / smaller;
      if (frac > worst.frac) {
        worst = { a: `${boxes[i].room.id}/"${boxes[i].room.name}"`, b: `${boxes[j].room.id}/"${boxes[j].room.name}"`, frac };
      }
    }
  }
  if (worst.frac > 0) {
    pipelineLog("FLOOR_PLAN_RESULTS", "geom — room overlap detected", {
      roomA: worst.a,
      roomB: worst.b,
      overlapPct: Math.round(worst.frac * 100),
    }, "warn");
  } else {
    pipelineLog("FLOOR_PLAN_RESULTS", "geom — no pairwise overlaps");
  }
}

/**
 * Anchor the auto-detected geometry to the uploaded image.
 *
 * The model returns polygons/walls/utilities in image coordinates (x 0..1000 left→
 * right, y 0..imageHeightUnits top→bottom). The rest of the app speaks mm with a
 * bottom-left origin and Y up, so we:
 *   1. pick a single mm-per-unit scale so the whole plan's real area matches the
 *      stated total (keeps furniture/room dimensions realistic), then
 *   2. flip Y and scale every coordinate, and
 *   3. record the full image frame (mm) so the editor/hub can lay the overlay on
 *      the image 1:1 instead of cropping to the rooms' bounding box.
 * Per-room metre dimensions and area are recomputed from the scaled polygon so
 * the side lengths the user sees match the shape exactly.
 */
export function anchorAnalysisToImage(
  analysis: FloorPlanAnalysis,
  imageHeightUnitsRaw: number,
  userAreaM2: number | undefined,
): FloorPlanAnalysis {
  // Bottom edge of the image in unit-space. Fall back to the rooms' own extent
  // (plus a margin) when the model omitted/garbled it.
  let maxY = 0;
  for (const r of analysis.rooms) for (const [, y] of r.polygon ?? []) maxY = Math.max(maxY, y);
  for (const w of analysis.wallSegments) maxY = Math.max(maxY, w.y1, w.y2);
  for (const c of analysis.columns ?? []) maxY = Math.max(maxY, c.y);
  const imageHeightUnits =
    Number.isFinite(imageHeightUnitsRaw) && imageHeightUnitsRaw > 0
      ? imageHeightUnitsRaw
      : maxY > 0
        ? maxY * 1.05
        : 1000; // square fallback

  // Real area target (m²) → choose mm-per-unit so the footprint scales to it.
  const footprintUnits = analysis.rooms.reduce(
    (sum, r) => sum + (r.polygon && r.polygon.length >= 3 ? polygonArea(r.polygon) : 0),
    0,
  );
  const targetAreaM2 = userAreaM2 && userAreaM2 > 0 ? userAreaM2 : analysis.totalArea;
  const scale =
    targetAreaM2 > 0 && footprintUnits > 0
      ? Math.sqrt((targetAreaM2 * 1_000_000) / footprintUnits)
      : 12; // ~12 m wide apartment when no area is known (1000 units → 12000 mm)

  const toMm = (x: number, y: number): [number, number] => [
    x * scale,
    (imageHeightUnits - y) * scale, // flip Y-down (image) → Y-up (plan)
  ];

  const rooms: DetectedRoom[] = analysis.rooms.map((room) => {
    const poly = (room.polygon ?? []).map(([x, y]) => toMm(x, y));
    if (poly.length < 3) return room;
    const dims = dimensionsFromPolygon(poly, room.dimensions.height || 2.7);
    return {
      ...room,
      polygon: poly,
      dimensions: dims,
      estimatedArea: Math.round((polygonArea(poly) / 1_000_000) * 10) / 10,
    };
  });

  return {
    ...analysis,
    rooms,
    wallSegments: analysis.wallSegments.map((w) => {
      const [x1, y1] = toMm(w.x1, w.y1);
      const [x2, y2] = toMm(w.x2, w.y2);
      return {
        ...w,
        x1,
        y1,
        x2,
        y2,
        thickness: w.thickness * scale,
        lengthMm: w.lengthMm || Math.hypot(x2 - x1, y2 - y1),
      };
    }),
    utilityPoints: analysis.utilityPoints?.map((u) => {
      const [x, y] = toMm(u.x, u.y);
      return { ...u, x, y };
    }),
    columns: analysis.columns?.map((c) => {
      const [x, y] = toMm(c.x, c.y);
      return { ...c, x, y };
    }),
    imageFrame: { width: 1000 * scale, height: imageHeightUnits * scale },
  };
}

/**
 * Seeded path: the user's traced drawing is the locked source of truth for all
 * geometry. We keep the manual plan's rooms/polygons/dimensions/walls verbatim
 * and only adopt the windows, doors, and features the model read off the uploaded
 * image (matched by room id). The model's polygons/dimensions/utility points are
 * ignored here — utilities carry image-space coordinates that do not align with
 * the drawn plan, so they stay user-placed.
 */
function stripOpeningAnchor<T extends { edgeIndex?: number; t?: number }>(opening: T): T {
  const { edgeIndex: _ei, t: _t, ...rest } = opening;
  return rest as T;
}

function mergeOpeningsIntoManualPlan(
  manualPlan: FloorPlanAnalysis,
  modelAnalysis: FloorPlanAnalysis,
): FloorPlanAnalysis {
  const modelById = new Map(modelAnalysis.rooms.map((r) => [r.id, r]));

  const rooms: DetectedRoom[] = manualPlan.rooms.map((room) => {
    const detected = modelById.get(room.id);
    // User-placed openings (any anchored to a wall via edgeIndex) are
    // authoritative — the drawn plan is final. Only adopt the model's openings for
    // rooms where the user placed none of that kind.
    const userWindows = room.windows.some((w) => w.edgeIndex !== undefined);
    const userDoors = room.doors.some((d) => d.edgeIndex !== undefined);
    const windows = userWindows
      ? room.windows
      : detected && detected.windows.length > 0
        ? detected.windows.map(stripOpeningAnchor)
        : room.windows;
    const doors = userDoors
      ? room.doors
      : detected && detected.doors.length > 0
        ? detected.doors.map(stripOpeningAnchor)
        : room.doors;
    const features = detected && detected.features.length > 0 ? detected.features : room.features;
    return repairOpeningAnchors({ ...room, windows, doors, features });
  });

  return {
    ...manualPlan,
    rooms,
    // Geometry stays from the drawn plan.
    wallSegments: manualPlan.wallSegments,
    utilityPoints: manualPlan.utilityPoints,
  };
}

/**
 * FAL-direct project flow: user-drawn rooms are authoritative — no GPT vision.
 */
export function finalizeManualFloorPlan(
  manualPlan: FloorPlanAnalysis,
  userAreaM2?: number,
): FloorPlanAnalysis {
  const rooms: DetectedRoom[] = manualPlan.rooms.map((room) => {
    const poly = room.polygon ?? [];
    if (poly.length >= 3) {
      const height = room.dimensions?.height || manualPlan.ceilingHeight || 2.7;
      const dims =
        room.dimensions?.width && room.dimensions?.depth
          ? room.dimensions
          : dimensionsFromPolygon(poly, height);
      return {
        ...room,
        dimensions: dims,
        estimatedArea:
          room.estimatedArea ||
          Math.round((polygonArea(poly) / 1_000_000) * 10) / 10,
      };
    }
    return room;
  });

  const polys = rooms.map((r) => r.polygon ?? []).filter((p) => p.length >= 3);
  const computedArea = Math.round(rooms.reduce((s, r) => s + (r.estimatedArea || 0), 0) * 10) / 10;

  const result: FloorPlanAnalysis = {
    ...manualPlan,
    rooms,
    totalArea: userAreaM2 && userAreaM2 > 0 ? userAreaM2 : manualPlan.totalArea || computedArea,
    wallSegments:
      manualPlan.wallSegments?.length > 0
        ? manualPlan.wallSegments
        : deriveWallSegments(polys),
    sharedWalls: computeSharedWalls(rooms),
  };

  logGeometryDiagnostics(result);
  pipelineLog("ANALYZE_FLOOR_PLAN", "manual plan finalized (GPT skipped)", {
    roomCount: result.rooms.length,
    totalArea: result.totalArea,
  });
  return result;
}

export async function analyzeFloorPlan(
  imageBase64: string,
  imageMimeType: string,
  userAreaM2?: number,
  manualPlan?: FloorPlanAnalysis,
  drawnPlanBase64?: string,
  drawnPlanMimeType?: string,
): Promise<FloorPlanAnalysis> {
  const seeded = (manualPlan?.rooms?.filter((r) => (r.polygon?.length ?? 0) >= 3).length ?? 0) > 0;

  // User-traced rooms are authoritative — skip OpenAI entirely.
  if (seeded && manualPlan) {
    return finalizeManualFloorPlan(manualPlan, userAreaM2);
  }

  if (!imageBase64?.trim()) {
    throw new Error("Upload a floor plan to continue.");
  }

  const openAiKey = getOpenAiApiKey();
  if (!openAiKey) throw new Error("OPENAI_API_KEY is not configured");

  const hasDrawnImage = Boolean(drawnPlanBase64);

  pipelineLog("ANALYZE_FLOOR_PLAN", "openai floor plan analysis start", {
    model: process.env.FLOOR_PLAN_ANALYSIS_MODEL || "gpt-5.5",
    mimeType: imageMimeType,
    planKB: Math.round((imageBase64.length * 3) / 4 / 1024),
    hasDrawnPlan: hasDrawnImage,
    seeded,
    userAreaM2: userAreaM2 ?? null,
  });

  let trueImageHeightUnits = 0;
  try {
    const meta = await sharp(Buffer.from(imageBase64, "base64")).metadata();
    if (meta.width && meta.height) {
      trueImageHeightUnits = (1000 * meta.height) / meta.width;
    }
  } catch (err) {
    pipelineLog(
      "ANALYZE_FLOOR_PLAN",
      "could not read image dimensions for aspect ratio",
      { error: String(err).slice(0, 200) },
      "warn",
    );
  }

  const systemPrompt = hasDrawnImage
    ? buildFloorPlanAnalysisPrompt(userAreaM2, manualPlan, true)
    : buildAutoDetectFloorPlanPrompt(userAreaM2);

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } };
  const content: ContentPart[] = [
    { type: "text", text: systemPrompt },
    { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: "high" } },
  ];
  if (hasDrawnImage && drawnPlanBase64) {
    content.push({
      type: "text",
      text: "The SECOND image is the user's own schematic drawing of the SAME floor plan — room shapes, doors (orange with swing arcs), and windows (blue) are marked. Treat it as the authoritative layout.",
    });
    content.push({
      type: "image_url",
      image_url: { url: `data:${drawnPlanMimeType ?? "image/png"};base64,${drawnPlanBase64}`, detail: "high" },
    });
  }

  pipelineLog("ANALYZE_FLOOR_PLAN", "OpenAI floor-plan request", {
    model: process.env.FLOOR_PLAN_ANALYSIS_MODEL || "gpt-5.5",
    hasDrawnImage,
    autoDetect: !hasDrawnImage,
  });

  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const t0 = Date.now();
  const response = await withRetry(async () => {
    const res = await openAiFetch(
      apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model: process.env.FLOOR_PLAN_ANALYSIS_MODEL || "gpt-5.5",
          messages: [{ role: "user", content }],
          response_format: { type: "json_object" },
          max_completion_tokens: 16000,
        }),
      },
      { vision: true },
    );
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const err: Error & { status?: number } = new Error(
        `OpenAI floor plan analysis failed (${res.status}): ${errBody.slice(0, 500)}`,
      );
      err.status = res.status;
      throw err;
    }
    return res.json();
  }, "Floor plan analysis");
  pipelineLog("ANALYZE_FLOOR_PLAN", "OpenAI floor-plan response", {
    durationSec: Math.round((Date.now() - t0) / 1000),
  });

  const assistantText = response?.choices?.[0]?.message?.content;
  if (!assistantText || typeof assistantText !== "string") {
    throw new Error("Floor plan analysis returned no text response");
  }

  const parsed = parseAssistantJsonObject(assistantText);
  let analysis = normalizeAnalysis(parsed);

  const modelImageHeightUnits = asNumber(isRecord(parsed) ? parsed.imageHeightUnits : undefined, 0);
  const imageHeightUnits = trueImageHeightUnits > 0 ? trueImageHeightUnits : modelImageHeightUnits;

  if (hasDrawnImage && manualPlan) {
    analysis = mergeOpeningsIntoManualPlan(manualPlan, analysis);
    const anchored = anchorAnalysisToImage(
      { ...analysis, rooms: manualPlan.rooms, wallSegments: manualPlan.wallSegments ?? [] },
      imageHeightUnits,
      userAreaM2,
    );
    logGeometryDiagnostics(anchored);
    pipelineLog("ANALYZE_FLOOR_PLAN", "openai floor plan analysis complete", {
      mode: "drawn-image-merge",
      roomCount: anchored.rooms.length,
    });
    return anchored;
  }

  const anchored = anchorAnalysisToImage(analysis, imageHeightUnits, userAreaM2);
  const polys = anchored.rooms.map((r) => r.polygon ?? []).filter((p) => p.length >= 3);
  const result: FloorPlanAnalysis = {
    ...anchored,
    wallSegments: deriveWallSegments(polys),
    sharedWalls: computeSharedWalls(anchored.rooms),
    totalArea:
      userAreaM2 && userAreaM2 > 0
        ? userAreaM2
        : anchored.totalArea ||
          Math.round(anchored.rooms.reduce((s, r) => s + (r.estimatedArea || 0), 0) * 10) / 10,
  };

  logGeometryDiagnostics(result);
  pipelineLog("ANALYZE_FLOOR_PLAN", "openai floor plan analysis complete", {
    mode: "auto-detect",
    roomCount: result.rooms.length,
    columnCount: result.columns?.length ?? 0,
    rooms: result.rooms.map((r) => ({
      roomId: r.id,
      name: r.name,
      area: r.estimatedArea,
      windows: r.windows.length,
      doors: r.doors.length,
      corners: r.polygon?.length ?? 0,
    })),
  });
  return result;
}
