/**
 * Deterministic technical-plan geometry from approved room designs.
 * Used at PDF render time so furniture/lighting/electrical/gas/elevations match
 * the actual approved layout — not stale Claude guesses.
 */

import { openingEndpoints, pointInPolygon, type Point } from "./floorPlanGeometry";
import type {
  CircuitGroup,
  DetectedRoom,
  FixturePlacement,
  FloorPlanAnalysis,
  FurniturePlacement,
  LightingFixture,
  MasterDesignConcept,
  PipePath,
  PlumbingFixture,
  RoomResult,
  TechnicalDrawingsSet,
  UtilityEntryPoint,
  WallElevation,
  WallElevationSet,
} from "./types";

const MAX_ELEVATIONS = 12;

interface RoomLayoutCtx {
  roomId: string;
  label: string;
  roomType: string;
  polygon: Point[];
  center: Point;
  floorMaterial: string;
  furnitureList: string[];
}

interface WallEdge {
  index: number;
  length: number;
  mid: Point;
  angleDeg: number;
  hasWindow: boolean;
  hasDoor: boolean;
}

function polygonCentroid(poly: Point[]): Point {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return [cx, cy];
}

function insetFromWall(
  poly: Point[],
  center: Point,
  edgeIndex: number,
  t: number,
  insetMm: number,
): Point {
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

function inferFurnitureSize(label: string): { type: string; width: number; depth: number } {
  const l = label.toLowerCase();
  if (l.includes("sofa") || l.includes("sectional")) return { type: "sofa", width: 2200, depth: 950 };
  if (l.includes("bed")) return { type: "bed", width: 1600, depth: 2000 };
  if (l.includes("wardrobe") || l.includes("closet")) return { type: "wardrobe", width: 2000, depth: 600 };
  if (l.includes("tv") || l.includes("media")) return { type: "tv_unit", width: 1800, depth: 450 };
  if (l.includes("desk")) return { type: "desk", width: 1400, depth: 700 };
  if (l.includes("table") && l.includes("dining")) return { type: "dining_table", width: 1600, depth: 900 };
  if (l.includes("table")) return { type: "table", width: 1100, depth: 600 };
  if (l.includes("chair")) return { type: "chair", width: 550, depth: 550 };
  if (l.includes("nightstand") || l.includes("bedside")) return { type: "nightstand", width: 500, depth: 450 };
  return { type: "furniture", width: 1200, depth: 700 };
}

function classifyFurniture(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("bed")) return "bed";
  if (l.includes("wardrobe") || l.includes("closet")) return "wardrobe";
  if (l.includes("tv") || l.includes("media")) return "tv";
  if (l.includes("sofa") || l.includes("sectional")) return "sofa";
  if (l.includes("desk")) return "desk";
  if (l.includes("dining")) return "dining";
  if (l.includes("nightstand") || l.includes("bedside")) return "nightstand";
  if (l.includes("coffee")) return "coffee_table";
  if (l.includes("chair")) return "chair";
  return "other";
}

function analyzeRoomWalls(room: DetectedRoom): WallEdge[] {
  const poly = room.polygon ?? [];
  if (poly.length < 3) return [];
  const edges: WallEdge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const hasWindow = room.windows.some((w) => w.edgeIndex === i);
    const hasDoor = room.doors.some((d) => d.edgeIndex === i);
    edges.push({
      index: i,
      length: len,
      mid: [(x1 + x2) / 2, (y1 + y2) / 2],
      angleDeg: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
      hasWindow,
      hasDoor,
    });
  }
  return edges.sort((a, b) => b.length - a.length);
}

function oppositeEdge(edges: WallEdge[], edge: WallEdge): WallEdge {
  const parallel = edges.find(
    (e) => e.index !== edge.index && Math.abs(e.length - edge.length) < edge.length * 0.25,
  );
  return parallel ?? edges.find((e) => e.index !== edge.index) ?? edge;
}

function collectFurnitureLabels(room: RoomResult): string[] {
  const fromMaterials = (room.materials?.keyFurniture ?? []).map((k) => k.name).filter(Boolean);
  const fromBrief = room.brief.furnitureList ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...fromMaterials, ...fromBrief]) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out.slice(0, 10);
}

function placeFurnitureForRoom(
  room: RoomResult,
  layout: RoomLayoutCtx,
  detected: DetectedRoom | undefined,
): FurniturePlacement[] {
  const labels = collectFurnitureLabels(room);
  if (labels.length === 0) return [];

  const edges = detected ? analyzeRoomWalls(detected) : [];
  const longEdge = edges[0];
  const windowEdge = edges.find((e) => e.hasWindow);
  const doorEdge = edges.find((e) => e.hasDoor) ?? edges[0];
  const usedEdges = new Set<number>();
  const placements: FurniturePlacement[] = [];

  const placeOnEdge = (
    label: string,
    edge: WallEdge | undefined,
    t: number,
    inset: number,
  ): FurniturePlacement | null => {
    if (!edge) return null;
    usedEdges.add(edge.index);
    const spec = inferFurnitureSize(label);
    const [x, y] = insetFromWall(layout.polygon, layout.center, edge.index, t, inset + spec.depth / 2);
    return {
      type: spec.type,
      label: label.slice(0, 40),
      x,
      y,
      width: spec.width,
      depth: spec.depth,
      rotation: edge.angleDeg,
    };
  };

  const byKind = new Map<string, string[]>();
  for (const label of labels) {
    const kind = classifyFurniture(label);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind)!.push(label);
  }

  const bedLabel = byKind.get("bed")?.[0];
  if (bedLabel && longEdge) {
    const p = placeOnEdge(bedLabel, longEdge, 0.5, 350);
    if (p) placements.push(p);
  }

  const wardrobeLabel = byKind.get("wardrobe")?.[0];
  if (wardrobeLabel && longEdge) {
    const opp = oppositeEdge(edges, longEdge);
    const p = placeOnEdge(wardrobeLabel, opp, 0.5, 300);
    if (p) placements.push(p);
  }

  const tvLabel = byKind.get("tv")?.[0];
  const sofaLabel = byKind.get("sofa")?.[0];
  const tvEdge = longEdge ? oppositeEdge(edges, longEdge) : edges[1];
  if (tvLabel && tvEdge) {
    const p = placeOnEdge(tvLabel, tvEdge, 0.5, 280);
    if (p) placements.push(p);
  }
  if (sofaLabel && tvEdge) {
    const spec = inferFurnitureSize(sofaLabel);
    const [tx, ty] = insetFromWall(layout.polygon, layout.center, tvEdge.index, 0.5, 1400);
    placements.push({
      type: spec.type,
      label: sofaLabel.slice(0, 40),
      x: tx,
      y: ty,
      width: spec.width,
      depth: spec.depth,
      rotation: tvEdge.angleDeg,
    });
  }

  const deskLabel = byKind.get("desk")?.[0];
  if (deskLabel) {
    const edge = windowEdge ?? edges.find((e) => !usedEdges.has(e.index)) ?? longEdge;
    const p = placeOnEdge(deskLabel, edge, 0.65, 450);
    if (p) placements.push(p);
  }

  const diningLabel = byKind.get("dining")?.[0];
  if (diningLabel) {
    const spec = inferFurnitureSize(diningLabel);
    placements.push({
      type: spec.type,
      label: diningLabel.slice(0, 40),
      x: layout.center[0],
      y: layout.center[1],
      width: spec.width,
      depth: spec.depth,
      rotation: 0,
    });
  }

  for (const label of byKind.get("nightstand") ?? []) {
    if (longEdge) {
      const p = placeOnEdge(label, longEdge, 0.22, 320);
      if (p) placements.push(p);
    }
  }

  let spareEdgeIdx = 0;
  for (const label of labels) {
    if (placements.some((p) => p.label === label.slice(0, 40))) continue;
    const edge = edges.find((e) => !usedEdges.has(e.index)) ?? edges[spareEdgeIdx++ % Math.max(edges.length, 1)];
    const p = placeOnEdge(label, edge, 0.5, 500);
    if (p) placements.push(p);
  }

  return placements;
}

function buildLighting(
  layouts: RoomLayoutCtx[],
  furniture: FurniturePlacement[],
): LightingFixture[] {
  const fixtures: LightingFixture[] = [];
  let groupIdx = 1;
  for (const room of layouts) {
    const group = `L${groupIdx++}`;
    const xs = room.polygon.map((p) => p[0]);
    const ys = room.polygon.map((p) => p[1]);
    const w = Math.max(800, Math.max(...xs) - Math.min(...xs));
    const h = Math.max(800, Math.max(...ys) - Math.min(...ys));
    const cols = w > 4500 ? 3 : 2;
    const rows = h > 3500 ? 3 : 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.min(...xs) + (w * (c + 1)) / (cols + 1);
        const y = Math.min(...ys) + (h * (r + 1)) / (rows + 1);
        if (pointInPolygon([x, y], room.polygon)) {
          fixtures.push({ type: "downlight", x, y, symbol: "D", group, beamAngle: 36 });
        }
      }
    }
    const dining = furniture.find(
      (f) => f.type === "dining_table" && pointInPolygon([f.x, f.y], room.polygon),
    );
    if (dining) {
      fixtures.push({
        type: "pendant",
        x: dining.x,
        y: dining.y,
        symbol: "P",
        group,
      });
    }
  }
  return fixtures;
}

function buildElectrical(
  layouts: RoomLayoutCtx[],
  detectedRooms: DetectedRoom[],
  furniture: FurniturePlacement[],
): { fixtures: FixturePlacement[]; circuitGroups: CircuitGroup[] } {
  const fixtures: FixturePlacement[] = [];
  const socketIndices: number[] = [];
  const applianceIndices: number[] = [];
  const switchIndices: number[] = [];

  for (const room of layouts) {
    const detected = detectedRooms.find((r) => r.id === room.roomId);
    const doorEdge = detected ? analyzeRoomWalls(detected).find((e) => e.hasDoor) : undefined;
    const switchEdge = doorEdge?.index ?? 0;
    const [sx, sy] = insetFromWall(room.polygon, room.center, switchEdge, 0.15, 280);
    fixtures.push({ type: "switch", x: sx, y: sy, symbol: "S" });
    switchIndices.push(fixtures.length - 1);

    const edges = detected ? analyzeRoomWalls(detected) : [];
    for (let i = 0; i < Math.min(edges.length, 4); i++) {
      const [x, y] = insetFromWall(room.polygon, room.center, edges[i]!.index, 0.5, 320);
      fixtures.push({ type: "socket", x, y, symbol: "⊡" });
      socketIndices.push(fixtures.length - 1);
    }

    const bed = furniture.find(
      (f) => f.type === "bed" && pointInPolygon([f.x, f.y], room.polygon),
    );
    if (bed) {
      fixtures.push({ type: "socket", x: bed.x - 700, y: bed.y, symbol: "⊡" });
      fixtures.push({ type: "socket", x: bed.x + 700, y: bed.y, symbol: "⊡" });
      socketIndices.push(fixtures.length - 2, fixtures.length - 1);
    }

    const tv = furniture.find(
      (f) => f.type === "tv_unit" && pointInPolygon([f.x, f.y], room.polygon),
    );
    if (tv) {
      fixtures.push({ type: "tv_point", x: tv.x, y: tv.y - 200, symbol: "TV" });
      applianceIndices.push(fixtures.length - 1);
    }
  }

  const circuitGroups: CircuitGroup[] = [];
  if (socketIndices.length) circuitGroups.push({ id: "C1", label: "Sockets", fixtureIndices: socketIndices });
  if (switchIndices.length) circuitGroups.push({ id: "C2", label: "Switches", fixtureIndices: switchIndices });
  if (applianceIndices.length) circuitGroups.push({ id: "C3", label: "Media / appliances", fixtureIndices: applianceIndices });

  return { fixtures, circuitGroups };
}

/**
 * Deterministic gas plan from utility entry points + kitchen furniture.
 * Routes a pipe from the gas_inlet to the nearest cooktop/range in a kitchen.
 */
export function buildGas(
  utilityEntryPoints: UtilityEntryPoint[],
  layouts: RoomLayoutCtx[],
  furniture: FurniturePlacement[],
): { fixtures: PlumbingFixture[]; pipes: PipePath[] } {
  const inlet = utilityEntryPoints.find((u) => u.type === "gas_inlet");
  if (!inlet) return { fixtures: [], pipes: [] };

  const fixtures: PlumbingFixture[] = [
    { type: "gas_meter", x: inlet.x, y: inlet.y, label: "Gas meter" },
  ];
  const pipes: PipePath[] = [];

  const kitchens = layouts.filter((r) => r.roomType === "kitchen");
  const gasAppliance = furniture.find((f) => {
    const l = f.label.toLowerCase();
    return (
      (l.includes("cooktop") || l.includes("range") || l.includes("stove") || l.includes("gas") || l.includes("oven")) &&
      kitchens.some((k) => pointInPolygon([f.x, f.y], k.polygon))
    );
  });

  if (gasAppliance) {
    fixtures.push({ type: "gas_appliance", x: gasAppliance.x, y: gasAppliance.y, label: "Cooktop" });
    pipes.push({
      type: "gas",
      points: [[inlet.x, inlet.y], [gasAppliance.x, inlet.y], [gasAppliance.x, gasAppliance.y]],
    });
  } else if (kitchens.length > 0) {
    const kitchen = kitchens[0]!;
    fixtures.push({ type: "gas_appliance", x: kitchen.center[0], y: kitchen.center[1], label: "Cooktop" });
    pipes.push({
      type: "gas",
      points: [[inlet.x, inlet.y], [kitchen.center[0], inlet.y], [kitchen.center[0], kitchen.center[1]]],
    });
  }

  return { fixtures, pipes };
}

function resolveRoomLayouts(
  analysis: FloorPlanAnalysis,
  concept: MasterDesignConcept,
): RoomLayoutCtx[] {
  const withPoly = analysis.rooms.filter((r) => r.polygon && r.polygon.length >= 3);
  return withPoly.map((r) => {
    const poly = r.polygon as Point[];
    const brief = concept.rooms.find((c) => c.roomId === r.id);
    return {
      roomId: r.id,
      label: brief?.roomName ?? r.name,
      roomType: r.type,
      polygon: poly,
      center: polygonCentroid(poly),
      floorMaterial: brief?.floorMaterial ?? "flooring",
      furnitureList: brief?.furnitureList ?? [],
    };
  });
}

/** Overwrite design-dependent plan layers from approved room results. */
export function applyApprovedRoomPlans(
  drawings: TechnicalDrawingsSet,
  approvedRooms: RoomResult[],
  analysis: FloorPlanAnalysis,
  concept: MasterDesignConcept,
  utilityEntryPoints: UtilityEntryPoint[] = [],
): TechnicalDrawingsSet {
  if (approvedRooms.length === 0) return drawings;

  const layouts = resolveRoomLayouts(analysis, concept);
  const allFurniture: FurniturePlacement[] = [];
  for (const room of approvedRooms) {
    const layout = layouts.find((l) => l.roomId === room.brief.roomId);
    if (!layout) continue;
    const detected = analysis.rooms.find((r) => r.id === room.brief.roomId);
    allFurniture.push(...placeFurnitureForRoom(room, layout, detected));
  }

  drawings.furnitureLayout.furniture = allFurniture;
  drawings.furnitureLayout.roomZones = layouts.map((r) => ({
    roomId: r.roomId,
    label: r.label,
    polygon: r.polygon,
  }));

  drawings.lighting.lightingFixtures = buildLighting(layouts, allFurniture);
  const elec = buildElectrical(layouts, analysis.rooms, allFurniture);
  drawings.electrical.fixtures = elec.fixtures;
  drawings.electrical.circuitGroups = elec.circuitGroups;
  const gas = buildGas(utilityEntryPoints, layouts, allFurniture);
  drawings.gas.plumbingFixtures = gas.fixtures;
  drawings.gas.pipes = gas.pipes;

  if (!drawings.flooring.flooringZones?.length) {
    drawings.flooring.flooringZones = approvedRooms.flatMap((room) => {
      const layout = layouts.find((l) => l.roomId === room.brief.roomId);
      if (!layout) return [];
      const mat = room.materials?.floorMaterial.type ?? room.brief.floorMaterial;
      return [
        {
          roomId: layout.roomId,
          material: mat,
          color: "#E8E0D4",
          polygon: layout.polygon,
          direction: "horizontal" as const,
          tileSize: mat.toLowerCase().includes("tile") ? "600×600" : undefined,
        },
      ];
    });
  }

  return drawings;
}

function buildElevationForEdge(
  room: RoomResult,
  detected: DetectedRoom,
  edge: WallEdge,
  wallLabel: string,
): WallElevation {
  const wallW = edge.length;
  const wallH = detected.dimensions?.height ? detected.dimensions.height * 1000 : 2700;
  const labels = collectFurnitureLabels(room);
  const elements: WallElevation["elements"] = [];
  let cursorX = 400;

  for (const label of labels) {
    const kind = classifyFurniture(label);
    const spec = inferFurnitureSize(label);
    let y = 0;
    let h = spec.depth;
    let w = Math.min(spec.width, wallW - 800);
    if (kind === "bed") {
      h = 600;
      y = 0;
    } else if (kind === "wardrobe" || kind === "tv") {
      h = 2200;
      y = 0;
    } else if (kind === "tv") {
      h = 800;
      y = 1000;
    } else if (kind === "desk") {
      h = 750;
      y = 0;
    } else {
      h = Math.min(1200, wallH - 200);
      y = 0;
    }
    if (cursorX + w > wallW - 200) break;
    elements.push({
      type: kind === "wardrobe" ? "cabinet" : kind === "tv" ? "tv" : kind,
      label: label.slice(0, 28),
      x: cursorX,
      y,
      width: w,
      height: h,
      material: label,
    });
    cursorX += w + 250;
  }

  return {
    elevationId: `elev-${room.brief.roomId}-${edge.index}`,
    roomId: room.brief.roomId,
    roomName: room.brief.roomName,
    wallLabel,
    wallWidthMm: wallW,
    wallHeightMm: wallH,
    elements,
    materialBands: [
      {
        yStart: 0,
        yEnd: 120,
        material: room.materials?.floorMaterial.type ?? room.brief.floorMaterial,
        color: "#e8e0d4",
      },
      {
        yStart: 120,
        yEnd: wallH,
        material: room.brief.wallColor.ncs,
        color: room.brief.wallColor.hex,
      },
    ],
    dimensions: [
      { start: [0, 0], end: [wallW, 0], value: `${(wallW / 1000).toFixed(2)} m`, offset: 120 },
      { start: [0, 0], end: [0, wallH], value: `${(wallH / 1000).toFixed(2)} m`, offset: 120 },
    ],
  };
}

export function buildElevationsFromApprovedRooms(
  approvedRooms: RoomResult[],
  analysis: FloorPlanAnalysis,
): WallElevation[] {
  const out: WallElevation[] = [];
  for (const room of approvedRooms) {
    const detected = analysis.rooms.find((r) => r.id === room.brief.roomId);
    if (!detected?.polygon || detected.polygon.length < 3) continue;
    const edges = analyzeRoomWalls(detected);
    if (edges.length === 0) continue;

    const longEdge = edges[0]!;
    const oppositeLong = oppositeEdge(edges, longEdge);
    const windowEdge = edges.find((e) => e.hasWindow) ?? edges[edges.length - 1]!;

    out.push(
      buildElevationForEdge(
        room,
        detected,
        longEdge,
        `${room.brief.roomName} — Headboard / Feature Wall`,
      ),
    );
    if (oppositeLong.index !== longEdge.index) {
      out.push(
        buildElevationForEdge(
          room,
          detected,
          oppositeLong,
          `${room.brief.roomName} — TV / Storage Wall`,
        ),
      );
    }
    if (windowEdge && windowEdge.index !== longEdge.index && windowEdge.index !== oppositeLong.index) {
      out.push(
        buildElevationForEdge(
          room,
          detected,
          windowEdge,
          `${room.brief.roomName} — Window Wall`,
        ),
      );
    }
  }
  return out.slice(0, MAX_ELEVATIONS);
}

export function prepareApprovedWallElevations(
  set: WallElevationSet,
  approvedRooms: RoomResult[],
  analysis: FloorPlanAnalysis | null,
): WallElevationSet {
  if (!analysis || approvedRooms.length === 0) return set;
  return { elevations: buildElevationsFromApprovedRooms(approvedRooms, analysis) };
}
