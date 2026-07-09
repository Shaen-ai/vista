/**
 * Phase 4 — Technical Drawings.
 *
 * Two-step process (one Claude call, not two):
 * 1. `generateTechnicalDrawings` — a single Claude Opus call produces structured
 *    JSON for 8 plan types (measurement, furniture, flooring, ceiling, lighting,
 *    electrical, plumbing, HVAC). `utilityEntryPoints` are injected into the
 *    prompt so Claude routes circuits/pipes from real entry locations.
 * 2. Deterministic SVG renderer converts JSON into clean vector drawings.
 *
 * `generateWallElevations` (in elevationGenerator.ts) is a separate Claude call
 * invoked alongside this one during finalize — it is NOT part of this module.
 *
 * At PDF raster time, `applyApprovedRoomPlans` (approvedRoomPlanBuilder.ts)
 * overwrites furniture, lighting, electrical, and gas with deterministic geometry
 * derived from the actual approved room designs. This is authoritative — Claude's
 * initial coordinates are treated as a scaffold that the builders may fully replace.
 *
 * Infrastructure plans:
 * - Electrical/gas: deterministic from approved layout + utilityEntryPoints.
 * - Plumbing (water): Claude scaffold + fillEmptyPlans heuristic for wet rooms.
 * - HVAC: generated but intentionally excluded from PDF (no real input data).
 */

import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "@/lib/aiRetry";
import {
  collectAnthropicTextBlocks,
  parseAssistantJsonObject,
} from "@/lib/creativeDirectorJson";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import {
  computeBounds,
  flipY,
  openingEndpoints,
  pointInPolygon,
  type Bounds,
} from "./floorPlanGeometry";
import type {
  DetectedRoom,
  FloorPlanAnalysis,
  MasterDesignConcept,
  TechnicalDrawingsSet,
  TechnicalPlanData,
  WallSegment,
  DimensionAnnotation,
  FurniturePlacement,
  FixturePlacement,
  FlooringZone,
  CeilingZone,
  PlumbingFixture,
  PipePath,
  HvacUnit,
  DuctPath,
  WalkingPath,
  RoomZone,
  LightingFixture,
  CircuitGroup,
  UtilityEntryPoint,
  RoomResult,
} from "./types";
import { hasWetRooms } from "./pdfDataHelpers";
import { applyApprovedRoomPlans } from "./approvedRoomPlanBuilder";

function buildTechnicalPlansPrompt(
  analysis: FloorPlanAnalysis,
  concept: MasterDesignConcept,
  utilityEntryPoints: UtilityEntryPoint[] = [],
  approvedRoomIds?: Set<string>,
  approvedDesignSummaries?: Record<string, string>,
): string {
  const designedRooms =
    approvedRoomIds && approvedRoomIds.size > 0
      ? concept.rooms.filter((r) => approvedRoomIds.has(r.roomId))
      : concept.rooms;
  const roomSummary = designedRooms
    .map((r) => {
      const summary = approvedDesignSummaries?.[r.roomId];
      const base = `  - ${r.roomName} (${r.roomId}): type=${r.roomType}, floor=${r.floorMaterial}, ceiling=${r.ceilingDesign}, furniture=[${r.furnitureList.slice(0, 10).join(", ")}]`;
      return summary ? `${base}\n    Approved design: ${summary.slice(0, 300)}` : base;
    })
    .join("\n");
  const designedNote =
    approvedRoomIds && approvedRoomIds.size > 0 && designedRooms.length < concept.rooms.length
      ? `\nIMPORTANT: Only the rooms listed above are designed. Produce FLOORING, CEILING, FURNITURE, LIGHTING, ELECTRICAL, PLUMBING and HVAC data ONLY for these designed rooms. Other rooms are not yet designed — still include their walls and outline in the MEASUREMENT plan, but leave them empty in the design-dependent plans.\n`
      : "";

  const utilitySection =
    utilityEntryPoints.length > 0
      ? `
UTILITY ENTRY POINTS (user-specified):
${JSON.stringify(utilityEntryPoints, null, 2)}

Use these exact locations as the origin points for:
- ELECTRICAL PLAN: Route all circuits from the electrical_panel location
- PLUMBING PLAN: Route cold water from water_inlet, connect drains to water_drain_stack
- HVAC PLAN: Consider gas_inlet location if present
`
      : "";

  return `You are an architectural drafter creating technical plan data for an interior design project. Using the floor plan analysis and design concept below, generate structured JSON for 8 technical drawings.

FLOOR PLAN ANALYSIS:
${JSON.stringify(analysis, null, 2)}

DESIGN CONCEPT (rooms):
${roomSummary}
${designedNote}${utilitySection}
Generate data for these 8 plans (all coordinates in millimeters, origin at bottom-left):

1. MEASUREMENT PLAN — Wall segments from analysis. Dimension annotations for every wall length, room widths, door openings, window widths. Ceiling height annotations.

2. FURNITURE LAYOUT — Furniture from design concept with position (x,y center), width, depth, rotation. Include:
   - "walkingPaths": [{ "points": [[x,y],...], "label": "circulation" }] showing main circulation routes (900mm min width conceptually)
   - "roomZones": [{ "roomId", "label", "polygon": [[x,y],...] }] for functional zoning

3. FLOORING PLAN — Zones per room with material, color, polygon. Include "direction" (horizontal|vertical|diagonal) and "tileSize" (e.g. "600×600") for each zone. Mark transition areas between materials.

4. CEILING PLAN (RCP geometry only) — Ceiling zones per room with type (flat, multi-level). NO lighting fixtures here — only ceiling geometry and heights.

5. LIGHTING PLAN — Lighting fixtures only:
   - downlights, pendants, chandeliers, led_strip, wall_sconce
   - "group" field for circuit grouping (e.g. "L1", "L2")
   - "beamAngle" in degrees for spotlights where applicable

6. ELECTRICAL PLAN — Apply residential wiring best practice derived from the actual furniture layout and room function above:
   - A switch beside the entry door of every room.
   - General-purpose sockets spaced ~2m apart along usable walls (avoid placing them behind large furniture); at least 2 per habitable room.
   - Dedicated appliance_outlet for each major appliance implied by the furniture/room (kitchen: oven, hob, fridge, dishwasher, extractor; laundry: washer/dryer; living: tv_point + data_point near the media wall; bedroom: a socket on each side of the bed).
   - bathroom_socket / shaver sockets only in safe zones for wet rooms.
   - Group fixtures onto sensible circuits in "circuitGroups": [{ "id": "C1", "label": "Kitchen sockets", "fixtureIndices": [0,1,2] }] — separate lighting, general sockets, and high-load appliances onto their own circuits.

7. PLUMBING PLAN — Only if wet rooms exist. Route cold_water, hot_water and drain pipes along walls to the ACTUAL wet fixtures present in the design (kitchen sink + dishwasher/washer feeds; bathroom toilet, basin, shower/bathtub). Fixtures: sink, toilet, shower, bathtub, dishwasher, washing_machine, water_heater, shutoff_valve. Connect every drain fixture back toward the drain stack / water_drain_stack entry point.

8. HVAC PLAN — Radiators, towel rails, supply/exhaust grilles, AC units, duct routes.

Respond ONLY with valid JSON:
{
  "measurement": { "dimensions": [{ "start": [x,y], "end": [x,y], "value": "string", "offset": number }] },
  "furnitureLayout": {
    "furniture": [{ "type", "label", "x", "y", "width", "depth", "rotation" }],
    "walkingPaths": [{ "points": [[x,y],...], "label": "string" }],
    "roomZones": [{ "roomId", "label", "polygon": [[x,y],...] }]
  },
  "flooring": {
    "zones": [{ "roomId", "material", "color", "polygon", "direction": "horizontal|vertical|diagonal", "tileSize": "string" }]
  },
  "ceiling": { "zones": [{ "roomId", "type", "polygon": [[x,y],...] }] },
  "lighting": {
    "fixtures": [{ "type", "x", "y", "symbol", "group", "beamAngle" }]
  },
  "electrical": {
    "fixtures": [{ "type", "x", "y", "symbol" }],
    "circuitGroups": [{ "id", "label", "fixtureIndices": [numbers] }]
  },
  "plumbing": {
    "fixtures": [{ "type", "x", "y", "label" }],
    "pipes": [{ "type": "cold_water|hot_water|drain", "points": [[x,y],...] }]
  },
  "hvac": {
    "units": [{ "type", "x", "y", "label" }],
    "ducts": [{ "type": "supply|return|exhaust", "points": [[x,y],...] }]
  }
}

Use realistic positions. Furniture must fit within room boundaries. Route pipes along walls.`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const WET_ROOM_TYPES = new Set(["kitchen", "bathroom", "toilet", "laundry"]);

interface RoomLayoutCtx {
  roomId: string;
  label: string;
  roomType: string;
  polygon: [number, number][];
  center: [number, number];
  floorMaterial: string;
  ceilingDesign: string;
  furnitureList: string[];
}

function polygonCentroid(poly: [number, number][]): [number, number] {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return [cx, cy];
}

function wallBoundingBox(walls: WallSegment[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!walls.length) return { minX: 0, minY: 0, maxX: 10000, maxY: 8000 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2);
    maxX = Math.max(maxX, w.x1, w.x2);
    maxY = Math.max(maxY, w.y1, w.y2);
  }
  return { minX, minY, maxX, maxY };
}

function resolveRoomLayouts(analysis: FloorPlanAnalysis, concept: MasterDesignConcept): RoomLayoutCtx[] {
  const withPoly = analysis.rooms.filter((r) => r.polygon && r.polygon.length >= 3);
  if (withPoly.length > 0) {
    return withPoly.map((r) => {
      const poly = r.polygon as [number, number][];
      const brief = concept.rooms.find((c) => c.roomId === r.id);
      return {
        roomId: r.id,
        label: brief?.roomName ?? r.name,
        roomType: r.type,
        polygon: poly,
        center: polygonCentroid(poly),
        floorMaterial: brief?.floorMaterial ?? "flooring",
        ceilingDesign: brief?.ceilingDesign ?? "flat",
        furnitureList: brief?.furnitureList ?? [],
      };
    });
  }

  const bbox = wallBoundingBox(analysis.wallSegments);
  let cursorX = bbox.minX + 600;
  const baseY = bbox.minY + 600;
  return analysis.rooms.map((r) => {
    const brief = concept.rooms.find((c) => c.roomId === r.id);
    const w = r.dimensions?.width ?? 3500;
    const d = r.dimensions?.depth ?? 3000;
    const poly: [number, number][] = [
      [cursorX, baseY],
      [cursorX + w, baseY],
      [cursorX + w, baseY + d],
      [cursorX, baseY + d],
    ];
    cursorX += w + 500;
    return {
      roomId: r.id,
      label: brief?.roomName ?? r.name,
      roomType: r.type,
      polygon: poly,
      center: polygonCentroid(poly),
      floorMaterial: brief?.floorMaterial ?? "flooring",
      ceilingDesign: brief?.ceilingDesign ?? "flat",
      furnitureList: brief?.furnitureList ?? [],
    };
  });
}

function inferFurnitureSize(label: string): { type: string; width: number; depth: number } {
  const l = label.toLowerCase();
  if (l.includes("sofa") || l.includes("sectional")) return { type: "sofa", width: 2200, depth: 950 };
  if (l.includes("bed")) return { type: "bed", width: 1600, depth: 2000 };
  if (l.includes("table") && l.includes("dining")) return { type: "dining_table", width: 1800, depth: 1000 };
  if (l.includes("table")) return { type: "table", width: 1200, depth: 800 };
  if (l.includes("chair")) return { type: "chair", width: 550, depth: 550 };
  if (l.includes("desk")) return { type: "desk", width: 1400, depth: 700 };
  if (l.includes("wardrobe") || l.includes("closet")) return { type: "wardrobe", width: 2000, depth: 600 };
  return { type: "furniture", width: 1200, depth: 700 };
}

function lightingPointsForRoom(poly: [number, number][], center: [number, number]): [number, number][] {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const w = Math.max(800, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(800, Math.max(...ys) - Math.min(...ys));
  const area = w * h;
  if (area > 12_000_000) {
    return [
      [center[0] - w * 0.25, center[1] - h * 0.25],
      [center[0] + w * 0.25, center[1] - h * 0.25],
      [center[0] - w * 0.25, center[1] + h * 0.25],
      [center[0] + w * 0.25, center[1] + h * 0.25],
    ];
  }
  return [
    [center[0] - w * 0.2, center[1]],
    [center[0] + w * 0.2, center[1]],
  ];
}

/** Inset a point from a wall edge toward the room center (for switches/sockets). */
function insetFromWallEdge(
  poly: [number, number][],
  center: [number, number],
  edgeIndex: number,
  t: number,
  insetMm: number,
): [number, number] {
  const n = poly.length;
  const [x1, y1] = poly[edgeIndex % n]!;
  const [x2, y2] = poly[(edgeIndex + 1) % n]!;
  const px = x1 + (x2 - x1) * t;
  const py = y1 + (y2 - y1) * t;
  const dx = center[0] - px;
  const dy = center[1] - py;
  const len = Math.hypot(dx, dy) || 1;
  return [px + (dx / len) * insetMm, py + (dy / len) * insetMm];
}

function wallMidpoints(poly: [number, number][], center: [number, number], insetMm = 350): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    pts.push(insetFromWallEdge(poly, center, i, 0.5, insetMm));
  }
  return pts;
}

function entrySwitchPoint(room: RoomLayoutCtx): [number, number] {
  const poly = room.polygon;
  const doorEdge = poly.length >= 3 ? 0 : 0;
  return insetFromWallEdge(poly, room.center, doorEdge, 0.12, 280);
}

function pointInsideAnyRoom(x: number, y: number, layouts: RoomLayoutCtx[]): boolean {
  return layouts.some((r) => pointInPolygon([x, y], r.polygon));
}

function insideRoomRatio(items: { x: number; y: number }[], layouts: RoomLayoutCtx[]): number {
  if (!items.length || !layouts.length) return 0;
  const inside = items.filter((f) => pointInsideAnyRoom(f.x, f.y, layouts)).length;
  return inside / items.length;
}

function assignRoomZonesToAllPlans(drawings: TechnicalDrawingsSet, layouts: RoomLayoutCtx[]): void {
  const zones = layouts.map((r) => ({ roomId: r.roomId, label: r.label, polygon: r.polygon }));
  for (const key of [
    "measurement",
    "furnitureLayout",
    "flooring",
    "lighting",
    "electrical",
    "plumbing",
  ] as const) {
    if (!drawings[key].roomZones?.length) {
      drawings[key].roomZones = zones;
    }
  }
}

function flooringZonesValid(zones: FlooringZone[], layouts: RoomLayoutCtx[]): boolean {
  const centroids = zones
    .filter((z) => z.polygon.length >= 3)
    .map((z) => {
      const cx = z.polygon.reduce((s, p) => s + p[0], 0) / z.polygon.length;
      const cy = z.polygon.reduce((s, p) => s + p[1], 0) / z.polygon.length;
      return [cx, cy] as [number, number];
    });
  if (!centroids.length) return false;
  const inside = centroids.filter(([x, y]) => pointInsideAnyRoom(x, y, layouts)).length;
  return inside / centroids.length >= 0.55;
}

/** Replace AI coordinates that land outside room polygons with deterministic layout data. */
export function prepareTechnicalDrawingsForRender(
  drawings: TechnicalDrawingsSet,
  analysis: FloorPlanAnalysis,
  concept: MasterDesignConcept,
  approvedRooms: RoomResult[] = [],
  utilityEntryPoints: UtilityEntryPoint[] = [],
): TechnicalDrawingsSet {
  const layouts = resolveRoomLayouts(analysis, concept);
  if (layouts.length === 0) return fillEmptyPlans(drawings, analysis, concept);

  const minValidRatio = 0.55;

  if (
    drawings.flooring.flooringZones?.length &&
    !flooringZonesValid(drawings.flooring.flooringZones, layouts)
  ) {
    drawings.flooring.flooringZones = [];
  }
  if (
    drawings.furnitureLayout.furniture?.length &&
    insideRoomRatio(drawings.furnitureLayout.furniture, layouts) < minValidRatio
  ) {
    drawings.furnitureLayout.furniture = [];
  }
  if (
    drawings.lighting.lightingFixtures?.length &&
    insideRoomRatio(drawings.lighting.lightingFixtures, layouts) < minValidRatio
  ) {
    drawings.lighting.lightingFixtures = [];
  }
  if (
    drawings.electrical.fixtures?.length &&
    insideRoomRatio(drawings.electrical.fixtures, layouts) < minValidRatio
  ) {
    drawings.electrical.fixtures = [];
    drawings.electrical.circuitGroups = [];
  }
  if (
    drawings.plumbing.plumbingFixtures?.length &&
    insideRoomRatio(drawings.plumbing.plumbingFixtures, layouts) < minValidRatio
  ) {
    drawings.plumbing.plumbingFixtures = [];
    drawings.plumbing.pipes = [];
  }

  const filled = fillEmptyPlans(drawings, analysis, concept);
  assignRoomZonesToAllPlans(filled, layouts);
  if (approvedRooms.length > 0) {
    applyApprovedRoomPlans(filled, approvedRooms, analysis, concept, utilityEntryPoints);
  }
  return filled;
}

/** Fill sparse Claude output with deterministic defaults from floor plan + concept. */
function fillEmptyPlans(
  drawings: TechnicalDrawingsSet,
  analysis: FloorPlanAnalysis,
  concept: MasterDesignConcept,
): TechnicalDrawingsSet {
  const layouts = resolveRoomLayouts(analysis, concept);
  if (layouts.length === 0) return drawings;

  const walls = analysis.wallSegments;

  if (!drawings.measurement.dimensions?.length && walls.length > 0) {
    drawings.measurement.dimensions = walls.map((w) => ({
      start: [w.x1, w.y1] as [number, number],
      end: [w.x2, w.y2] as [number, number],
      value: w.lengthMm > 0 ? `${w.lengthMm}` : `${Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1))}`,
      offset: 200,
    }));
  }

  if (!drawings.furnitureLayout.furniture?.length) {
    const furniture: FurniturePlacement[] = [];
    for (const room of layouts) {
      const items = room.furnitureList.length > 0 ? room.furnitureList.slice(0, 6) : ["sofa", "coffee table"];
      const wallPts = wallMidpoints(room.polygon, room.center, 600);
      items.forEach((label, i) => {
        const spec = inferFurnitureSize(label);
        const pt = wallPts[i % wallPts.length] ?? room.center;
        furniture.push({
          type: spec.type,
          label: label.slice(0, 40),
          x: pt[0],
          y: pt[1],
          width: spec.width,
          depth: spec.depth,
          rotation: 0,
        });
      });
    }
    drawings.furnitureLayout.furniture = furniture;
  }

  if (!drawings.furnitureLayout.roomZones?.length) {
    drawings.furnitureLayout.roomZones = layouts.map((r) => ({
      roomId: r.roomId,
      label: r.label,
      polygon: r.polygon,
    }));
  }

  if (!drawings.flooring.flooringZones?.length) {
    drawings.flooring.flooringZones = layouts.map((r) => ({
      roomId: r.roomId,
      material: r.floorMaterial,
      color: "#E8E0D4",
      polygon: r.polygon,
      direction: "horizontal" as const,
      tileSize: r.floorMaterial.toLowerCase().includes("tile") ? "600×600" : undefined,
    }));
  }

  if (!drawings.ceiling.ceilingZones?.length) {
    drawings.ceiling.ceilingZones = layouts.map((r) => ({
      roomId: r.roomId,
      type: r.ceilingDesign.toLowerCase().includes("multi") ? "multi-level" : "flat",
      polygon: r.polygon,
    }));
  }

  if (!drawings.lighting.lightingFixtures?.length) {
    const fixtures: LightingFixture[] = [];
    let groupIdx = 1;
    for (const room of layouts) {
      const group = `L${groupIdx++}`;
      for (const [x, y] of lightingPointsForRoom(room.polygon, room.center)) {
        fixtures.push({ type: "downlight", x, y, symbol: "D", group, beamAngle: 36 });
      }
    }
    drawings.lighting.lightingFixtures = fixtures;
  }

  if (!drawings.electrical.fixtures?.length) {
    const fixtures: FixturePlacement[] = [];
    const socketIndices: number[] = [];
    const applianceIndices: number[] = [];
    for (const room of layouts) {
      const switchPt = entrySwitchPoint(room);
      fixtures.push({ type: "switch", x: switchPt[0], y: switchPt[1], symbol: "S" });
      const wallPts = wallMidpoints(room.polygon, room.center, 320);
      const socketCount = Math.max(2, Math.min(4, wallPts.length));
      for (let i = 0; i < socketCount; i++) {
        const [x, y] = wallPts[i]!;
        fixtures.push({ type: "socket", x, y, symbol: "⊡" });
        socketIndices.push(fixtures.length - 1);
      }
      if (room.roomType === "kitchen" || room.roomType === "laundry") {
        fixtures.push({
          type: "appliance_outlet",
          x: room.center[0],
          y: room.center[1],
          symbol: "A",
        });
        applianceIndices.push(fixtures.length - 1);
      }
      if (room.roomType === "living" || room.roomType === "dining") {
        fixtures.push({
          type: "tv_point",
          x: insetFromWallEdge(room.polygon, room.center, 0, 0.5, 450)[0],
          y: insetFromWallEdge(room.polygon, room.center, 0, 0.5, 450)[1],
          symbol: "TV",
        });
      }
    }
    drawings.electrical.fixtures = fixtures;
    if (!drawings.electrical.circuitGroups?.length && fixtures.length > 0) {
      const groups: CircuitGroup[] = [];
      if (socketIndices.length > 0) {
        groups.push({ id: "C1", label: "General sockets", fixtureIndices: socketIndices });
      }
      if (applianceIndices.length > 0) {
        groups.push({ id: "C2", label: "Appliances", fixtureIndices: applianceIndices });
      }
      const switchIndices = fixtures.map((f, i) => (f.type === "switch" ? i : -1)).filter((i) => i >= 0);
      if (switchIndices.length > 0) {
        groups.push({ id: "C3", label: "Switches", fixtureIndices: switchIndices });
      }
      drawings.electrical.circuitGroups = groups.length > 0 ? groups : [{ id: "C1", label: "General", fixtureIndices: fixtures.map((_, i) => i) }];
    }
  }

  const wetLayouts = layouts.filter((r) => WET_ROOM_TYPES.has(r.roomType));
  if (wetLayouts.length > 0 && !drawings.plumbing.plumbingFixtures?.length) {
    const plumbingFixtures: PlumbingFixture[] = [];
    const pipes: PipePath[] = [];
    for (const room of wetLayouts) {
      const [cx, cy] = room.center;
      if (room.roomType === "bathroom" || room.roomType === "toilet") {
        plumbingFixtures.push(
          { type: "toilet", x: cx - 400, y: cy, label: "WC" },
          { type: "sink", x: cx + 300, y: cy - 200, label: "Lav" },
        );
        if (room.roomType === "bathroom") {
          plumbingFixtures.push({ type: "shower", x: cx, y: cy + 500, label: "Shower" });
        }
      }
      if (room.roomType === "kitchen" || room.roomType === "laundry") {
        plumbingFixtures.push(
          { type: "sink", x: cx, y: cy, label: "Sink" },
          { type: "washing_machine", x: cx + 600, y: cy, label: "WM" },
        );
      }
      pipes.push({
        type: "drain",
        points: [
          [cx, cy],
          [cx, cy - 800],
        ],
      });
    }
    drawings.plumbing.plumbingFixtures = plumbingFixtures;
    drawings.plumbing.pipes = pipes;
  }

  if (!drawings.hvac.hvacUnits?.length) {
    drawings.hvac.hvacUnits = layouts.map((r) => ({
      type: "radiator",
      x: r.polygon[0]![0] + 200,
      y: r.center[1],
      label: "Rad",
    }));
  }

  return drawings;
}

function parseDrawingsResponse(
  raw: unknown,
  analysis: FloorPlanAnalysis,
  concept: MasterDesignConcept,
): TechnicalDrawingsSet {
  const o = isRecord(raw) ? raw : {};
  const walls = analysis.wallSegments;

  const parseDims = (arr: unknown): DimensionAnnotation[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((d) => ({
      start: Array.isArray(d.start)
        ? ([Number(d.start[0]) || 0, Number(d.start[1]) || 0] as [number, number])
        : [0, 0],
      end: Array.isArray(d.end)
        ? ([Number(d.end[0]) || 0, Number(d.end[1]) || 0] as [number, number])
        : [0, 0],
      value: typeof d.value === "string" ? d.value : "0",
      offset: typeof d.offset === "number" ? d.offset : 200,
    }));

  const parseFurniture = (arr: unknown): FurniturePlacement[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((f) => ({
      type: typeof f.type === "string" ? f.type : "unknown",
      label: typeof f.label === "string" ? f.label : "",
      x: Number(f.x) || 0,
      y: Number(f.y) || 0,
      width: Number(f.width) || 500,
      depth: Number(f.depth) || 500,
      rotation: Number(f.rotation) || 0,
    }));

  const parseFixtures = (arr: unknown): FixturePlacement[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((f) => ({
      type: typeof f.type === "string" ? f.type : "fixture",
      x: Number(f.x) || 0,
      y: Number(f.y) || 0,
      symbol: typeof f.symbol === "string" ? f.symbol : "○",
    }));

  const parseLightingFixtures = (arr: unknown): LightingFixture[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((f) => ({
      type: typeof f.type === "string" ? f.type : "downlight",
      x: Number(f.x) || 0,
      y: Number(f.y) || 0,
      symbol: typeof f.symbol === "string" ? f.symbol : "○",
      group: typeof f.group === "string" ? f.group : undefined,
      beamAngle: typeof f.beamAngle === "number" ? f.beamAngle : undefined,
    }));

  const parseCircuitGroups = (arr: unknown): CircuitGroup[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((g) => ({
      id: typeof g.id === "string" ? g.id : "C1",
      label: typeof g.label === "string" ? g.label : "",
      fixtureIndices: Array.isArray(g.fixtureIndices)
        ? g.fixtureIndices.map((n) => Number(n) || 0)
        : [],
    }));

  const parseWalkingPaths = (arr: unknown): WalkingPath[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((p) => ({
      label: typeof p.label === "string" ? p.label : undefined,
      points: (Array.isArray(p.points) ? p.points : [])
        .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length >= 2)
        .map(([x, y]) => [Number(x) || 0, Number(y) || 0] as [number, number]),
    }));

  const parseRoomZones = (arr: unknown): RoomZone[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((z) => ({
      roomId: typeof z.roomId === "string" ? z.roomId : "",
      label: typeof z.label === "string" ? z.label : "",
      polygon: (Array.isArray(z.polygon) ? z.polygon : [])
        .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
        .map(([x, y]) => [Number(x) || 0, Number(y) || 0] as [number, number]),
    }));

  const parseFloorZones = (arr: unknown): FlooringZone[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((z) => ({
      roomId: typeof z.roomId === "string" ? z.roomId : "",
      material: typeof z.material === "string" ? z.material : "",
      color: typeof z.color === "string" ? z.color : "#DDD",
      polygon: (Array.isArray(z.polygon) ? z.polygon : [])
        .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
        .map(([x, y]) => [Number(x) || 0, Number(y) || 0] as [number, number]),
      direction:
        z.direction === "horizontal" || z.direction === "vertical" || z.direction === "diagonal"
          ? z.direction
          : undefined,
      tileSize: typeof z.tileSize === "string" ? z.tileSize : undefined,
    }));

  const parseCeilingZones = (arr: unknown): CeilingZone[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((z) => ({
      roomId: typeof z.roomId === "string" ? z.roomId : "",
      type: typeof z.type === "string" ? z.type : "flat",
      polygon: (Array.isArray(z.polygon) ? z.polygon : [])
        .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
        .map(([x, y]) => [Number(x) || 0, Number(y) || 0] as [number, number]),
    }));

  const parsePlumbingFixtures = (arr: unknown): PlumbingFixture[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((f) => ({
      type: typeof f.type === "string" ? f.type : "fixture",
      x: Number(f.x) || 0,
      y: Number(f.y) || 0,
      label: typeof f.label === "string" ? f.label : "",
    }));

  const parsePipes = (arr: unknown): PipePath[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((p) => ({
      type: (typeof p.type === "string" && ["cold_water", "hot_water", "drain", "gas"].includes(p.type)
        ? p.type
        : "cold_water") as PipePath["type"],
      points: (Array.isArray(p.points) ? p.points : [])
        .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length >= 2)
        .map(([x, y]) => [Number(x) || 0, Number(y) || 0] as [number, number]),
    }));

  const parseHvacUnits = (arr: unknown): HvacUnit[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((u) => ({
      type: typeof u.type === "string" ? u.type : "unit",
      x: Number(u.x) || 0,
      y: Number(u.y) || 0,
      label: typeof u.label === "string" ? u.label : "",
    }));

  const parseDucts = (arr: unknown): DuctPath[] =>
    (Array.isArray(arr) ? arr : []).filter(isRecord).map((d) => ({
      type: (typeof d.type === "string" && ["supply", "return", "exhaust"].includes(d.type)
        ? d.type
        : "supply") as DuctPath["type"],
      points: (Array.isArray(d.points) ? d.points : [])
        .filter((pt): pt is [number, number] => Array.isArray(pt) && pt.length >= 2)
        .map(([x, y]) => [Number(x) || 0, Number(y) || 0] as [number, number]),
    }));

  const meas = isRecord(o.measurement) ? o.measurement : {};
  const furn = isRecord(o.furnitureLayout) ? o.furnitureLayout : {};
  const floor = isRecord(o.flooring) ? o.flooring : {};
  const ceil = isRecord(o.ceiling) ? o.ceiling : {};
  const light = isRecord(o.lighting) ? o.lighting : {};
  const elec = isRecord(o.electrical) ? o.electrical : {};
  const plumb = isRecord(o.plumbing) ? o.plumbing : {};
  const hvacRaw = isRecord(o.hvac) ? o.hvac : {};

  // Fallback: if lighting empty but ceiling has fixtures in old format, migrate
  const ceilingFixtures = parseFixtures(ceil.fixtures);
  const lightingFixtures =
    parseLightingFixtures(light.fixtures).length > 0
      ? parseLightingFixtures(light.fixtures)
      : ceilingFixtures.map((f) => ({ ...f, group: "L1" }));

  const drawings: TechnicalDrawingsSet = {
    measurement: {
      planType: "measurement",
      title: "MEASUREMENT PLAN",
      walls,
      dimensions: parseDims(meas.dimensions),
    },
    furnitureLayout: {
      planType: "furniture_layout",
      title: "FURNITURE LAYOUT",
      walls,
      furniture: parseFurniture(furn.furniture),
      walkingPaths: parseWalkingPaths(furn.walkingPaths),
      roomZones: parseRoomZones(furn.roomZones),
    },
    flooring: {
      planType: "flooring",
      title: "FLOORING PLAN",
      walls,
      flooringZones: parseFloorZones(floor.zones),
    },
    ceiling: {
      planType: "ceiling",
      title: "REFLECTED CEILING PLAN",
      walls,
      ceilingZones: parseCeilingZones(ceil.zones),
    },
    lighting: {
      planType: "lighting",
      title: "LIGHTING PLAN",
      walls,
      lightingFixtures,
    },
    electrical: {
      planType: "electrical",
      title: "ELECTRICAL PLAN",
      walls,
      fixtures: parseFixtures(elec.fixtures),
      circuitGroups: parseCircuitGroups(elec.circuitGroups),
    },
    plumbing: {
      planType: "plumbing",
      title: "PLUMBING PLAN",
      walls,
      plumbingFixtures: parsePlumbingFixtures(plumb.fixtures),
      pipes: parsePipes(plumb.pipes),
    },
    gas: {
      planType: "gas",
      title: "GAS PLAN",
      walls,
    },
    hvac: {
      planType: "hvac",
      title: "HVAC PLAN",
      walls,
      hvacUnits: parseHvacUnits(hvacRaw.units),
      ducts: parseDucts(hvacRaw.ducts),
    },
  };

  return prepareTechnicalDrawingsForRender(drawings, analysis, concept);
}

export async function generateTechnicalDrawings(
  analysis: FloorPlanAnalysis,
  concept: MasterDesignConcept,
  utilityEntryPoints: UtilityEntryPoint[] = [],
  approvedRoomIds?: Set<string>,
  approvedDesignSummaries?: Record<string, string>,
): Promise<TechnicalDrawingsSet> {
  const anthropicKey = getAnthropicApiKey();
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey: anthropicKey });
  const prompt = buildTechnicalPlansPrompt(analysis, concept, utilityEntryPoints, approvedRoomIds, approvedDesignSummaries);

  const response = await withRetry(
    () =>
      client.messages
        .stream({
          model: "claude-opus-4-8",
          max_tokens: 32768,
          messages: [{ role: "user", content: prompt }],
        })
        .finalMessage(),
    "Technical drawings",
  );

  if (response.stop_reason === "max_tokens") {
    console.warn(
      "[Technical drawings] Response hit max_tokens; truncated JSON repair will be attempted.",
    );
  }

  const rawText = collectAnthropicTextBlocks(response.content);
  if (!rawText) {
    throw new Error("Technical drawings returned no text response");
  }

  let parsed: unknown;
  try {
    parsed = parseAssistantJsonObject(rawText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid JSON";
    throw new Error(`Technical drawings JSON parse failed: ${msg}`);
  }

  const drawings = parseDrawingsResponse(parsed, analysis, concept);

  // Defensive scoping: drop flooring/ceiling zones for rooms that aren't designed yet.
  if (approvedRoomIds && approvedRoomIds.size > 0) {
    drawings.flooring.flooringZones = (drawings.flooring.flooringZones ?? []).filter(
      (z) => !z.roomId || approvedRoomIds.has(z.roomId),
    );
    drawings.ceiling.ceilingZones = (drawings.ceiling.ceilingZones ?? []).filter(
      (z) => !z.roomId || approvedRoomIds.has(z.roomId),
    );
  }

  return drawings;
}

// ---------------------------------------------------------------------------
// Deterministic SVG renderer (Y-up plan mm → Y-down SVG via flipY)
// ---------------------------------------------------------------------------

type FyFn = (y: number) => number;

function svgHeader(viewBox: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" style="background:#fff" font-family="Arial, Helvetica, sans-serif">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <polygon points="0,0 8,4 0,8" fill="#222"/>
    </marker>
  </defs>`;
}

function formatDimLabel(value: string): string {
  const n = parseFloat(value.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return value;
  if (n >= 1000) return `${(n / 1000).toFixed(2)} m`;
  return `${Math.round(n)} mm`;
}

function considerPoint(minX: number, minY: number, maxX: number, maxY: number, x: number, y: number) {
  return {
    minX: Math.min(minX, x),
    minY: Math.min(minY, y),
    maxX: Math.max(maxX, x),
    maxY: Math.max(maxY, y),
  };
}

function computePlanBounds(plan: TechnicalPlanData, analysis: FloorPlanAnalysis | null): Bounds {
  if (analysis) {
    return computeBounds(analysis, []);
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const consider = (x: number, y: number) => {
    ({ minX, minY, maxX, maxY } = considerPoint(minX, minY, maxX, maxY, x, y));
  };

  for (const w of plan.walls) {
    consider(w.x1, w.y1);
    consider(w.x2, w.y2);
  }
  for (const z of plan.roomZones ?? []) {
    for (const [x, y] of z.polygon) consider(x, y);
  }
  for (const f of plan.furniture ?? []) consider(f.x, f.y);
  for (const f of plan.fixtures ?? []) consider(f.x, f.y);
  for (const f of plan.lightingFixtures ?? []) consider(f.x, f.y);

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 10000, maxY: 8000 };
  }
  return { minX, minY, maxX, maxY };
}

function renderNorthArrow(svgMinX: number, svgMinY: number): string {
  const x = svgMinX + 400;
  const y = svgMinY + 400;
  return `
    <g transform="translate(${x},${y})">
      <polygon points="0,-120 40,40 -40,40" fill="#222"/>
      <text x="0" y="80" text-anchor="middle" font-size="70" fill="#222">N</text>
    </g>`;
}

function renderRoomPolygons(zones: RoomZone[], fy: FyFn): string {
  return zones
    .map((z) => {
      if (z.polygon.length < 3) return "";
      const points = z.polygon.map(([x, y]) => `${x},${fy(y)}`).join(" ");
      const cx = z.polygon.reduce((s, p) => s + p[0], 0) / z.polygon.length;
      const cy = z.polygon.reduce((s, p) => s + p[1], 0) / z.polygon.length;
      return `
      <polygon points="${points}" fill="#f8fafc" fill-opacity="0.6" stroke="none"/>
      <text x="${cx}" y="${fy(cy)}" text-anchor="middle" dominant-baseline="central" font-size="90" font-weight="600" fill="#334155">${z.label}</text>`;
    })
    .join("\n");
}

function renderOpenings(rooms: DetectedRoom[], fy: FyFn): string {
  const parts: string[] = [];
  for (const room of rooms) {
    const poly = room.polygon;
    if (!poly || poly.length < 3) continue;
    for (const w of room.windows) {
      if (w.edgeIndex === undefined) continue;
      const [a, b] = openingEndpoints(poly, w.edgeIndex, w.t ?? 0.5, (w.width || 1.2) * 1000);
      parts.push(
        `<line x1="${a[0]}" y1="${fy(a[1])}" x2="${b[0]}" y2="${fy(b[1])}" stroke="#0ea5e9" stroke-width="90" stroke-linecap="round"/>`,
      );
    }
    for (const d of room.doors) {
      if (d.edgeIndex === undefined) continue;
      const [a, b] = openingEndpoints(poly, d.edgeIndex, d.t ?? 0.5, (d.width || 0.9) * 1000);
      parts.push(
        `<line x1="${a[0]}" y1="${fy(a[1])}" x2="${b[0]}" y2="${fy(b[1])}" stroke="#d97706" stroke-width="70" stroke-linecap="round"/>`,
      );
    }
  }
  return parts.join("\n");
}

function renderWalls(walls: WallSegment[], fy: FyFn): string {
  return walls
    .map(
      (w) =>
        `<line x1="${w.x1}" y1="${fy(w.y1)}" x2="${w.x2}" y2="${fy(w.y2)}" stroke="#1e293b" stroke-width="${Math.max(w.thickness * 0.5, 6)}" stroke-linecap="square"/>`,
    )
    .join("\n");
}

function renderDimensions(dims: DimensionAnnotation[], fy: FyFn): string {
  return dims
    .map((d) => {
      const [sx, sy] = d.start;
      const [ex, ey] = d.end;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      const offset = d.offset ?? 200;
      const dx = ex - sx;
      const dy = ey - sy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) return "";
      const nx = (-dy / len) * offset;
      const ny = (dx / len) * offset;
      const osx = sx + nx,
        osy = sy + ny;
      const oex = ex + nx,
        oey = ey + ny;
      const omx = mx + nx,
        omy = my + ny;
      const label = formatDimLabel(d.value);
      return `
      <line x1="${sx}" y1="${fy(sy)}" x2="${osx}" y2="${fy(osy)}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="6,4"/>
      <line x1="${ex}" y1="${fy(ey)}" x2="${oex}" y2="${fy(oey)}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="6,4"/>
      <line x1="${osx}" y1="${fy(osy)}" x2="${oex}" y2="${fy(oey)}" stroke="#334155" stroke-width="2"/>
      <text x="${omx}" y="${fy(omy) - 50}" text-anchor="middle" font-size="85" fill="#334155">${label}</text>`;
    })
    .join("\n");
}

function renderWalkingPaths(paths: WalkingPath[], fy: FyFn): string {
  return paths
    .map((p) => {
      if (p.points.length < 2) return "";
      const d = p.points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0]},${fy(pt[1])}`).join(" ");
      return `<path d="${d}" fill="none" stroke="#94a3b8" stroke-width="70" stroke-opacity="0.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("\n");
}

function renderFurniture(items: FurniturePlacement[], fy: FyFn): string {
  return items
    .map((f) => {
      const hw = f.width / 2,
        hd = f.depth / 2;
      const svgY = fy(f.y);
      return `
      <g transform="translate(${f.x},${svgY}) rotate(${-f.rotation})">
        <rect x="${-hw}" y="${-hd}" width="${f.width}" height="${f.depth}" fill="#f5efe6" stroke="#334155" stroke-width="2" rx="20"/>
        <text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="75" fill="#475569">${f.label || f.type}</text>
      </g>`;
    })
    .join("\n");
}

function electricalSymbol(type: string): string {
  if (type === "switch") return "S";
  if (type === "socket" || type === "double_socket") return "⊡";
  if (type === "usb_socket") return "USB";
  if (type === "bathroom_socket") return "⊡*";
  if (type === "tv_point") return "TV";
  if (type === "data_point") return "D";
  if (type.startsWith("appliance")) return "A";
  return "○";
}

function renderFixtures(items: FixturePlacement[], fy: FyFn): string {
  return items
    .map((f) => {
      const sym = f.symbol || electricalSymbol(f.type);
      const cy = fy(f.y);
      return `
      <circle cx="${f.x}" cy="${cy}" r="65" fill="#fff" stroke="#334155" stroke-width="2"/>
      <text x="${f.x}" y="${cy + 18}" text-anchor="middle" font-size="52" fill="#334155">${sym}</text>`;
    })
    .join("\n");
}

function renderCircuitLegend(groups: CircuitGroup[], bounds: Bounds, fy: FyFn): string {
  if (!groups.length) return "";
  const x = bounds.maxX - 120;
  const startY = fy(bounds.minY) - 100;
  const lines = groups.slice(0, 6).map((g, i) => {
    return `<text x="${x}" y="${startY - i * 85}" text-anchor="end" font-size="62" fill="#475569">${g.id}: ${g.label}</text>`;
  });
  return `<g>${lines.join("")}</g>`;
}

function renderLightingFixtures(items: LightingFixture[], fy: FyFn): string {
  return items
    .map((f) => {
      const sym =
        f.type === "pendant" || f.type === "chandelier"
          ? "P"
          : f.type === "led_strip"
            ? "LED"
            : "D";
      const cy = fy(f.y);
      const beam =
        f.beamAngle != null
          ? `<line x1="${f.x}" y1="${cy}" x2="${f.x + 180}" y2="${cy - 180}" stroke="#64748b" stroke-width="2" stroke-dasharray="6,4"/>`
          : "";
      return `
      ${beam}
      <circle cx="${f.x}" cy="${cy}" r="70" fill="#fff" stroke="#334155" stroke-width="2"/>
      <text x="${f.x}" y="${cy + 18}" text-anchor="middle" font-size="48" fill="#334155">${sym}</text>
      ${f.group ? `<text x="${f.x}" y="${cy - 85}" text-anchor="middle" font-size="42" fill="#64748b">${f.group}</text>` : ""}`;
    })
    .join("\n");
}

function renderFlooringZones(zones: FlooringZone[], fy: FyFn): string {
  return zones
    .map((z) => {
      if (z.polygon.length < 3) return "";
      const points = z.polygon.map(([x, y]) => `${x},${fy(y)}`).join(" ");
      const cx = z.polygon.reduce((s, p) => s + p[0], 0) / z.polygon.length;
      const cy = z.polygon.reduce((s, p) => s + p[1], 0) / z.polygon.length;
      const svgCy = fy(cy);
      const arrow =
        z.direction === "horizontal"
          ? `<line x1="${cx - 200}" y1="${svgCy}" x2="${cx + 200}" y2="${svgCy}" stroke="#334155" stroke-width="3" marker-end="url(#arrow)"/>`
          : z.direction === "vertical"
            ? `<line x1="${cx}" y1="${svgCy - 200}" x2="${cx}" y2="${svgCy + 200}" stroke="#334155" stroke-width="3" marker-end="url(#arrow)"/>`
            : "";
      const sizeLabel = z.tileSize ? `<tspan x="${cx}" dy="85">${z.tileSize}</tspan>` : "";
      return `
      <polygon points="${points}" fill="${z.color}" fill-opacity="0.35" stroke="#334155" stroke-width="2"/>
      ${arrow}
      <text x="${cx}" y="${svgCy}" text-anchor="middle" dominant-baseline="central" font-size="85" fill="#334155">${z.material}${sizeLabel}</text>`;
    })
    .join("\n");
}

function renderCeilingZones(zones: CeilingZone[], fy: FyFn): string {
  return zones
    .map((z) => {
      if (z.polygon.length < 3) return "";
      const points = z.polygon.map(([x, y]) => `${x},${fy(y)}`).join(" ");
      const cx = z.polygon.reduce((s, p) => s + p[0], 0) / z.polygon.length;
      const cy = z.polygon.reduce((s, p) => s + p[1], 0) / z.polygon.length;
      return `
      <polygon points="${points}" fill="#eef2ff" fill-opacity="0.35" stroke="#334155" stroke-width="2" stroke-dasharray="8,4"/>
      <text x="${cx}" y="${fy(cy)}" text-anchor="middle" dominant-baseline="central" font-size="75" fill="#475569">${z.type}</text>`;
    })
    .join("\n");
}

function renderPlumbingFixtures(items: PlumbingFixture[], fy: FyFn): string {
  return items
    .map((f) => {
      const symbol =
        f.type === "toilet" ? "WC" : f.type === "shutoff_valve" ? "V" : f.type === "water_heater" ? "WH"
        : f.type === "gas_meter" ? "GM" : f.type === "gas_appliance" ? "G" : "W";
      const cy = fy(f.y);
      return `
      <rect x="${f.x - 80}" y="${cy - 80}" width="160" height="160" fill="#fff" stroke="#334155" stroke-width="2" rx="10"/>
      <text x="${f.x}" y="${cy + 5}" text-anchor="middle" dominant-baseline="central" font-size="58" fill="#334155">${symbol}</text>
      <text x="${f.x}" y="${cy + 115}" text-anchor="middle" font-size="48" fill="#64748b">${f.label || f.type}</text>`;
    })
    .join("\n");
}

function renderPipes(paths: PipePath[], fy: FyFn): string {
  return paths
    .map((p) => {
      if (p.points.length < 2) return "";
      const dash = p.type === "drain" ? ' stroke-dasharray="12,6"' : p.type === "gas" ? ' stroke-dasharray="18,8"' : "";
      const d = p.points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0]},${fy(pt[1])}`).join(" ");
      const color = p.type === "hot_water" ? "#dc2626" : p.type === "cold_water" ? "#2563eb" : p.type === "gas" ? "#eab308" : "#334155";
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="5"${dash}/>`;
    })
    .join("\n");
}

function renderHvacUnits(items: HvacUnit[], fy: FyFn): string {
  return items
    .map((u) => {
      const w = u.type === "radiator" ? 220 : 120;
      const h = u.type === "radiator" ? 90 : 120;
      const cy = fy(u.y);
      return `
      <rect x="${u.x - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="#fff" stroke="#334155" stroke-width="2" rx="8"/>
      <text x="${u.x}" y="${cy + 5}" text-anchor="middle" dominant-baseline="central" font-size="48" fill="#334155">${u.label || u.type}</text>`;
    })
    .join("\n");
}

function renderDucts(paths: DuctPath[], fy: FyFn): string {
  return paths
    .map((d) => {
      if (d.points.length < 2) return "";
      const pathD = d.points.map((pt, i) => `${i === 0 ? "M" : "L"}${pt[0]},${fy(pt[1])}`).join(" ");
      return `<path d="${pathD}" fill="none" stroke="#64748b" stroke-width="6" stroke-dasharray="16,8" stroke-linecap="round"/>`;
    })
    .join("\n");
}

function roomZonesFromAnalysis(analysis: FloorPlanAnalysis | null): RoomZone[] {
  if (!analysis) return [];
  return analysis.rooms
    .filter((r) => r.polygon && r.polygon.length >= 3)
    .map((r) => ({
      roomId: r.id,
      label: r.name,
      polygon: r.polygon as [number, number][],
    }));
}

/** Render a single technical plan to an SVG string. */
export function renderPlanToSvg(plan: TechnicalPlanData, analysis: FloorPlanAnalysis | null = null): string {
  const bounds = computePlanBounds(plan, analysis);
  const fy: FyFn = (y) => flipY(y, bounds);
  const pad = 800;
  const viewBox = `${bounds.minX - pad} ${bounds.minY - pad} ${bounds.maxX - bounds.minX + 2 * pad} ${bounds.maxY - bounds.minY + 2 * pad}`;
  const titleX = (bounds.minX + bounds.maxX) / 2;
  const titleY = bounds.minY - pad + 180;
  const roomZones = plan.roomZones?.length ? plan.roomZones : roomZonesFromAnalysis(analysis);

  const parts: string[] = [svgHeader(viewBox)];

  parts.push(
    `<text x="${titleX}" y="${titleY}" text-anchor="middle" font-size="150" font-weight="bold" fill="#1e293b">${plan.title}</text>`,
  );
  parts.push(renderNorthArrow(bounds.minX - pad, bounds.minY - pad));

  if (plan.flooringZones?.length) parts.push(renderFlooringZones(plan.flooringZones, fy));
  if (plan.ceilingZones?.length) parts.push(renderCeilingZones(plan.ceilingZones, fy));
  if (roomZones.length) parts.push(renderRoomPolygons(roomZones, fy));
  if (analysis?.rooms?.length) parts.push(renderOpenings(analysis.rooms, fy));
  if (plan.walkingPaths?.length) parts.push(renderWalkingPaths(plan.walkingPaths, fy));

  parts.push(renderWalls(plan.walls, fy));

  if (plan.furniture?.length) parts.push(renderFurniture(plan.furniture, fy));
  if (plan.lightingFixtures?.length) parts.push(renderLightingFixtures(plan.lightingFixtures, fy));
  if (plan.fixtures?.length) parts.push(renderFixtures(plan.fixtures, fy));
  if (plan.pipes?.length) parts.push(renderPipes(plan.pipes, fy));
  if (plan.plumbingFixtures?.length) parts.push(renderPlumbingFixtures(plan.plumbingFixtures, fy));
  if (plan.ducts?.length) parts.push(renderDucts(plan.ducts, fy));
  if (plan.hvacUnits?.length) parts.push(renderHvacUnits(plan.hvacUnits, fy));
  if (plan.dimensions?.length) parts.push(renderDimensions(plan.dimensions, fy));
  if (plan.circuitGroups?.length) parts.push(renderCircuitLegend(plan.circuitGroups, bounds, fy));

  parts.push("</svg>");
  return parts.join("\n");
}

const PLAN_ORDER: (keyof TechnicalDrawingsSet)[] = [
  "measurement",
  "furnitureLayout",
  "flooring",
  "ceiling",
  "lighting",
  "electrical",
  "plumbing",
  "gas",
  "hvac",
];

/** Render all technical plans; skips plumbing when no wet rooms, gas when no inlet. */
export function renderAllPlans(
  drawings: TechnicalDrawingsSet,
  analysis: FloorPlanAnalysis | null,
  concept: MasterDesignConcept | null = null,
  approvedRooms: RoomResult[] = [],
  utilityEntryPoints: UtilityEntryPoint[] = [],
): Record<string, string> {
  const prepared =
    analysis && concept
      ? prepareTechnicalDrawingsForRender(drawings, analysis, concept, approvedRooms, utilityEntryPoints)
      : drawings;
  const wet = hasWetRooms(analysis);
  const hasGasInlet = utilityEntryPoints.some((u) => u.type === "gas_inlet");
  const out: Record<string, string> = {};
  for (const key of PLAN_ORDER) {
    if (key === "plumbing" && !wet) continue;
    if (key === "gas" && !hasGasInlet) continue;
    if (key === "ceiling" || key === "hvac") continue;
    out[key] = renderPlanToSvg(prepared[key], analysis);
  }
  return out;
}

export { PLAN_ORDER };
