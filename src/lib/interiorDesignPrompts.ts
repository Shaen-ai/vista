/**
 * Interior design prompt engineering utilities (structured brief + edit interpretation).
 */

import { normalizeCatalogSubtype } from "@/lib/normalizeCatalogSubtype";
import {
  bboxFromPolygonEdges,
  formatRoomDimensionsForPrompt,
  parsePolygonEdges,
  roomShapeUsesPolygonEditor,
  syncPolygonEdgesForShape,
} from "@/lib/roomShapePolygon";
import type { RoomPolygonEdge } from "@/lib/roomGeometryTypes";
import type { PhotoConfirmedStructuralElement } from "@/lib/project/types";
import type { QuickRoomPlacementMode } from "@/lib/quickRoom/placementMode";

export const DESIGN_STYLES = [
  { id: "modern", label: "Modern", keywords: "clean lines, open spaces, neutral palette with bold accents, glass, steel, minimal ornament" },
  { id: "scandinavian", label: "Scandinavian", keywords: "light wood, white walls, hygge warmth, functional furniture, natural textiles, soft curves" },
  { id: "industrial", label: "Industrial", keywords: "exposed brick, metal pipes, raw concrete, Edison bulbs, reclaimed wood, loft aesthetic" },
  { id: "bohemian", label: "Bohemian", keywords: "layered textiles, macramé, warm earth tones, plants, eclectic patterns, rattan, global influence" },
  { id: "mid-century", label: "Mid-Century Modern", keywords: "tapered legs, organic curves, walnut wood, teal and mustard accents, retro optimism" },
  { id: "minimalist", label: "Minimalist", keywords: "monochrome palette, hidden storage, negative space, essential furniture only, Zen simplicity" },
  { id: "traditional", label: "Traditional", keywords: "rich wood tones, crown molding, classic patterns, symmetry, upholstered seating, warm lighting" },
  { id: "coastal", label: "Coastal", keywords: "ocean blues, sandy neutrals, driftwood textures, linen, wicker, airy open layout" },
  { id: "japandi", label: "Japandi", keywords: "Japanese wabi-sabi meets Scandinavian simplicity, natural materials, muted earth tones, craft" },
  { id: "art-deco", label: "Art Deco", keywords: "geometric patterns, gold accents, velvet, lacquer, glamour, bold symmetry, jewel tones" },
  { id: "rustic", label: "Rustic", keywords: "reclaimed wood beams, stone fireplace, cozy textiles, warm amber lighting, cabin aesthetic" },
  { id: "contemporary", label: "Contemporary", keywords: "current trends, mixed materials, statement lighting, neutral base with curated accents" },
] as const;

export type DesignStyleId = (typeof DESIGN_STYLES)[number]["id"];

export const ROOM_TYPES = [
  "living room", "bedroom", "kitchen", "bathroom", "dining room",
  "home office", "children's room", "hallway", "outdoor patio", "studio apartment",
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

export const ROOM_SHAPES = [
  "rectangular",
  "l-shaped",
  "u-shaped",
  "open plan",
  "square",
  "irregular",
] as const;

export type RoomShape = (typeof ROOM_SHAPES)[number];

export const CEILING_TYPES = [
  "flat",
  "vaulted",
  "beamed",
  "sloped",
  "coffered",
  "tray",
  "exposed",
  "suspended",
] as const;

export type CeilingType = (typeof CEILING_TYPES)[number];

/** Shared rules for room analysis + geometry extraction — camera-relative wall labels for windows. */
export const WINDOW_OPENING_INSTRUCTIONS = `
WINDOW POSITION NAMING (critical — wrong wall names break image generation):
- Set "camera_angle" first: describe the viewpoint (e.g. "corner view from front-right, looking at far wall and right-side glass wall").
- Label walls relative to the CAMERA in the photo, not compass directions:
  • "back wall" / "far wall" = the main wall facing the camera (often behind the main sofa or focal furniture).
  • "left wall" = the wall along the LEFT edge of the photo frame (perpendicular to the camera).
  • "right wall" = the wall along the RIGHT edge of the photo frame.
- Tall/narrow windows on the FAR wall (even if they appear on the left half of the image) are on the BACK/FAR wall — NEVER call them "left wall". Use "back wall, left of center" / "back wall, near left corner" / "back wall, right of center".
- Count EVERY distinct framed glazed unit. Mullioned floor-to-ceiling glass: one window per vertical pane/bay (three panes → three window_positions on that wall).
- Include ALL windows on the back/far wall (left of any feature panel, right of any feature panel, and near corners) — do not stop at two if a third same-style window exists beside a central feature.
- "window_positions" order: group by wall (back wall openings left-to-right, then left-wall, then right-wall/corner), one string per window.
- Each string must name the WALL first, then position on that wall (e.g. "back wall, left of center, first tall window" / "հետևի պատ, կենտրոնից ձախ, առաջին պատուհան").
- Do NOT use vague labels like "left wall, first window toward center" when the opening is on the far/back wall.
- CORNER POSITIONS on side walls: when a window is on the left wall at the corner where it meets the back wall, write "left wall, at corner adjoining back wall" — NOT "near back-left corner" or "back-left corner" (the word "back" in corner descriptors breaks downstream image generation). Same for right wall: "right wall, at corner adjoining back wall" — NOT "near back-right corner".
- RECESSED ALCOVES (critical for asymmetric rooms): when a foreground pier/column/wall bump-out creates a step-back alcove with windows BEHIND it, do NOT label those windows as flat "left wall" at the frame edge. Use "left recess wall" as the wall name:
  • Example: "left recess wall, first floor-to-ceiling window (behind foreground pier)"
  • Example: "left recess wall, second window (near back-wall corner)"
  • Describe window shape accurately — wide floor-to-ceiling glazing, not "tall narrow", when that is what the photo shows.
  • Set room_shape to "L-shape" or "irregular" when a recess/pier/step-back is visible — not "rectangular".
- TERMINOLOGY (critical — wrong words break downstream curtain/drapery logic):
  • NEVER use "curtain wall" in window_positions — that phrase collides with fabric/drapery instructions. For a glass facade, write "right wall, first floor-to-ceiling window" or "right wall, glazed wall section" — NOT "right wall curtain wall".
  • In window_positions, each entry describes a glazed opening — use "window", "window bay", or "glazed opening". Do NOT use bare "panel" (ambiguous with decorative wall panels). Use "floor-to-ceiling window" not "floor-to-ceiling panel".
  • Do NOT use "window" for solid walls with no glazing — those walls simply have zero entries in window_positions.
- ANTI-SYMMETRY (critical for image generation): If a window is near a corner on one side, the remainder of that wall and any adjacent walls with zero openings in window_positions must stay strictly solid. Do NOT add decorative glass, mirror windows, or extra bays on the opposite corner or adjacent wall to "balance" the composition.`;

/** Map free-form AI ceiling type text to a canonical CEILING_TYPES value. */
export function normalizeCeilingTypeValue(value: string): CeilingType {
  const v = value.toLowerCase().trim();
  for (const ct of CEILING_TYPES) {
    if (v === ct) return ct;
  }
  if (v.includes("vault") || v.includes("cathedral")) return "vaulted";
  if (v.includes("beam")) return "beamed";
  if (v.includes("slope") || v.includes("pitch")) return "sloped";
  if (v.includes("coffer")) return "coffered";
  if (v.includes("tray")) return "tray";
  if (v.includes("exposed")) return "exposed";
  if (v.includes("suspended") || v.includes("drop")) return "suspended";
  if (v.includes("flat") || v.includes("standard") || v.includes("plain")) return "flat";
  return "flat";
}

/** Map free-form AI room type text to a canonical ROOM_TYPES value. */
export function normalizeRoomTypeValue(value: string): RoomType {
  const v = value.toLowerCase().trim();
  for (const rt of ROOM_TYPES) {
    if (v === rt) return rt;
  }
  const byLength = [...ROOM_TYPES].sort((a, b) => b.length - a.length);
  for (const rt of byLength) {
    if (v.includes(rt)) return rt;
  }
  if (/\b(living|lounge|sitting)\b/.test(v)) return "living room";
  if (/\bbed(room)?\b/.test(v)) return "bedroom";
  if (/\bkitchen\b/.test(v)) return "kitchen";
  if (/\bbath(room)?\b/.test(v)) return "bathroom";
  if (/\bdining\b/.test(v)) return "dining room";
  if (/\b(office|study|workspace)\b/.test(v)) return "home office";
  if (/\b(child|kid|nursery)\b/.test(v)) return "children's room";
  if (/\b(hallway|corridor|entry|foyer)\b/.test(v)) return "hallway";
  if (/\b(patio|terrace|balcony|outdoor)\b/.test(v)) return "outdoor patio";
  if (/\b(studio|open[- ]plan)\b/.test(v)) return "studio apartment";
  return "living room";
}

/** Map free-form AI room shape text to a canonical ROOM_SHAPES value. */
export function normalizeRoomShapeValue(value: string): RoomShape {
  const v = value.toLowerCase().trim().replace(/_/g, "-");
  for (const shape of ROOM_SHAPES) {
    if (v === shape) return shape;
  }
  if (v.includes("rectangular") || v === "rectangle") return "rectangular";
  if (v.includes("l-shape") || v.includes("l shape") || v.includes("l-shaped")) return "l-shaped";
  if (v.includes("u-shape") || v.includes("u shape") || v.includes("u-shaped")) return "u-shaped";
  if (v.includes("open") && v.includes("plan")) return "open plan";
  if (v.includes("square")) return "square";
  if (v.includes("irregular")) return "irregular";
  return "rectangular";
}

export type Confidence = "high" | "medium" | "low";

export interface RoomAnalysisConfidence {
  room_type: Confidence;
  dimensions: Confidence;
  style: Confidence;
  window_count: Confidence;
  door_count: Confidence;
}

export interface RoomFurnitureItem {
  name: string;
  position: string;
  approximate_size: string;
}

/**
 * Normalized (0–1) bounding box of an opening in the photo, top-left origin.
 * Used to draw visual markers on the reference image sent to Gemini so opening
 * placement is grounded in pixels, not just prose. Aligned by index to the
 * matching `*_positions` array.
 */
export interface OpeningBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomAnalysis {
  room_type: string;
  room_shape: string;
  estimated_dimensions: { width: number; depth: number; height: number };
  /** Per-edge floor-plan lengths for L-shape / U-shape rooms (clockwise from corner A). */
  polygon_edges?: RoomPolygonEdge[];
  existing_furniture: RoomFurnitureItem[];
  architectural_features: string[];
  lighting_sources: string[];
  current_style: string;
  color_palette: string[];
  suggestions: string[];
  window_count: number;
  door_count: number;
  window_positions: string[];
  door_positions: string[];
  /**
   * Measured length (meters) of each camera-relative wall ("back"/"left"/"right"),
   * from the resolved viewpoint framing. Lets the opening lock tell Gemini which
   * faced wall is the narrow one so a window on a short wall isn't drifted onto a
   * long wall.
   */
  wall_lengths_m?: Partial<Record<"back" | "left" | "right", number>>;
  /** Normalized photo bounding boxes per window, aligned to `window_positions`. */
  window_boxes?: OpeningBox[];
  /** Normalized photo bounding boxes per door, aligned to `door_positions`. */
  door_boxes?: OpeningBox[];
  /**
   * Floor-plan door inventory when it exceeds `door_count` (door behind camera).
   * Keeps the room's true opening count in the lock without forcing a door into frame.
   */
  plan_door_count?: number;
  plan_door_positions?: string[];
  camera_angle: string;
  ceiling_type: string;
  structural_elements: string[];
  /** Photo-gated structural members for FAL column preserve (never merged from plan). */
  photoConfirmedStructuralElements?: PhotoConfirmedStructuralElement[];
  /** Floor-plan polygon vertex count when shape is non-rectangular. */
  polygon_corner_count?: number;
  has_staircase: boolean;
  staircase_description: string | null;
  /** True when the slab has a stairwell cutout, hole to a lower level, or similar void (not merely stairs elsewhere). */
  has_floor_opening: boolean;
  floor_opening_description: string | null;
  confidence?: RoomAnalysisConfidence;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asFiniteNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Parse normalized opening boxes; clamps to 0–1 and drops malformed/degenerate entries. */
function parseOpeningBoxes(raw: unknown): OpeningBox[] {
  if (!Array.isArray(raw)) return [];
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const boxes: OpeningBox[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const x = clamp01(asFiniteNumber(entry.x, NaN));
    const y = clamp01(asFiniteNumber(entry.y, NaN));
    let w = clamp01(asFiniteNumber(entry.w ?? entry.width, NaN));
    let h = clamp01(asFiniteNumber(entry.h ?? entry.height, NaN));
    if (![x, y, w, h].every(Number.isFinite)) continue;
    // Keep the box inside the image and require a non-degenerate area.
    w = Math.min(w, 1 - x);
    h = Math.min(h, 1 - y);
    if (w <= 0.005 || h <= 0.005) continue;
    boxes.push({ x, y, w, h });
  }
  return boxes;
}

function asNonEmptyString(v: unknown, fallback: string): string {
  if (typeof v === "string" && v.trim()) return v;
  return fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asConfidence(v: unknown): Confidence | undefined {
  if (v === "high" || v === "medium" || v === "low") return v;
  return undefined;
}

function syncOpeningPositions(positions: string[], count: number): string[] {
  const c = Math.max(0, Math.min(20, Math.floor(count)));
  const next = positions.slice(0, c);
  while (next.length < c) next.push("unspecified");
  return next;
}

/** Strip architectural "curtain wall" jargon and ambiguous "panel" from window position labels. */
export function sanitizeWindowPosition(position: string): string {
  let s = position.trim();
  if (!s || s === "unspecified") return s;

  s = s.replace(/\bcurtain\s+wall\b/gi, "");
  s = s.replace(/\bglazed\s+bay\b/gi, "window");
  s = s.replace(/\bfloor-to-ceiling\s+panel\b/gi, "floor-to-ceiling window");
  s = s.replace(/\s+,/g, ",");
  s = s.replace(/,\s*,+/g, ",");
  s = s.replace(/\s{2,}/g, " ");
  return s.trim();
}

/** Normalize API / legacy analysis JSON and keep window/door counts aligned with position lists. */
export function normalizeRoomAnalysisOpenings(raw: unknown): RoomAnalysis {
  const o = isRecord(raw) ? raw : {};

  const legacyDims = isRecord(o.estimatedDimensions) ? o.estimatedDimensions : null;
  const dims = isRecord(o.estimated_dimensions) ? o.estimated_dimensions : legacyDims;
  let width = asFiniteNumber(dims?.width, 4);
  let depth = asFiniteNumber(dims?.depth, 4);
  const height = asFiniteNumber(dims?.height, 2.7);
  const room_shape = normalizeRoomShapeValue(asNonEmptyString(o.room_shape ?? o.roomShape, "rectangular"));
  let polygon_edges = parsePolygonEdges(o.polygon_edges ?? o.polygonEdges);
  polygon_edges = syncPolygonEdgesForShape(room_shape, width, depth, polygon_edges);
  if (polygon_edges && roomShapeUsesPolygonEditor(room_shape)) {
    const bbox = bboxFromPolygonEdges(room_shape, polygon_edges);
    width = bbox.width;
    depth = bbox.depth;
  }

  const furnRaw = Array.isArray(o.existing_furniture)
    ? o.existing_furniture
    : Array.isArray(o.existingFurniture)
      ? o.existingFurniture
      : [];
  const existing_furniture: RoomFurnitureItem[] = furnRaw.map((item) => {
    const fi = isRecord(item) ? item : {};
    return {
      name: asNonEmptyString(fi.name, "item"),
      position: asNonEmptyString(
        fi.position ?? fi.pos,
        "unspecified",
      ),
      approximate_size: asNonEmptyString(
        fi.approximate_size ?? fi.approximateSize,
        "unknown",
      ),
    };
  });

  let window_count = Math.floor(
    asFiniteNumber(o.window_count ?? o.windowCount, 0),
  );
  let door_count = Math.floor(asFiniteNumber(o.door_count ?? o.doorCount, 0));
  window_count = Math.max(0, Math.min(20, window_count));
  door_count = Math.max(0, Math.min(20, door_count));

  const window_positions = syncOpeningPositions(
    asStringArray(o.window_positions ?? o.windowPositions).map(sanitizeWindowPosition),
    window_count,
  );
  const door_positions = syncOpeningPositions(
    asStringArray(o.door_positions ?? o.doorPositions),
    door_count,
  );
  const window_boxes = parseOpeningBoxes(o.window_boxes ?? o.windowBoxes);
  const door_boxes = parseOpeningBoxes(o.door_boxes ?? o.doorBoxes);

  const confRaw = isRecord(o.confidence) ? o.confidence : null;
  const confidence: RoomAnalysisConfidence | undefined = confRaw
    ? {
        room_type: asConfidence(confRaw.room_type) ?? "medium",
        dimensions: asConfidence(confRaw.dimensions) ?? "medium",
        style: asConfidence(confRaw.style) ?? "medium",
        window_count: asConfidence(confRaw.window_count) ?? "high",
        door_count: asConfidence(confRaw.door_count) ?? "high",
      }
    : undefined;

  return {
    room_type: normalizeRoomTypeValue(asNonEmptyString(o.room_type ?? o.roomType, "living room")),
    room_shape,
    estimated_dimensions: { width, depth, height },
    polygon_edges,
    existing_furniture,
    architectural_features: asStringArray(o.architectural_features ?? o.architecturalFeatures),
    lighting_sources: asStringArray(o.lighting_sources ?? o.lightingSources),
    current_style: asNonEmptyString(o.current_style ?? o.currentStyle, "unknown"),
    color_palette: asStringArray(o.color_palette ?? o.colorPalette),
    suggestions: asStringArray(o.suggestions),
    window_count,
    door_count,
    window_positions,
    door_positions,
    ...(window_boxes.length ? { window_boxes } : {}),
    ...(door_boxes.length ? { door_boxes } : {}),
    camera_angle: asNonEmptyString(o.camera_angle ?? o.cameraAngle, "unknown"),
    ceiling_type: normalizeCeilingTypeValue(asNonEmptyString(o.ceiling_type ?? o.ceilingType, "flat")),
    structural_elements: asStringArray(o.structural_elements ?? o.structuralElements),
    has_staircase: Boolean(o.has_staircase ?? o.hasStaircase),
    staircase_description:
      typeof o.staircase_description === "string"
        ? o.staircase_description
        : typeof o.staircaseDescription === "string"
          ? o.staircaseDescription
          : null,
    has_floor_opening: Boolean(o.has_floor_opening ?? o.hasFloorOpening),
    floor_opening_description:
      typeof o.floor_opening_description === "string"
        ? o.floor_opening_description
        : typeof o.floorOpeningDescription === "string"
          ? o.floorOpeningDescription
          : null,
    confidence,
  };
}

export interface ProductIntent {
  family: string;
  subtype: string;
  query: string;
  quantity?: number;
  placement?: string;
}

export interface RequiredSlot {
  family: string;
  subtype?: string;
  quantity?: number;
  placement?: string;
}

export interface DesignConstraints {
  materials?: string[];
  colors?: string[];
  style_keywords?: string[];
  max_price?: number;
}

export interface ProductDescription {
  upload_index: number;
  family: string;
  subtype: string;
  description: string;
  search_query: string;
}

export interface DesignBrief {
  subject: string;
  arrangement: string;
  context: string;
  composition: string;
  style: string;
  fullPrompt: string;
  roomType: string;
  cameraAngle: string;
  /** Semantic design narrative for vector retrieval (no SKU ids). */
  designIntent: string;
  /** Product slots resolved server-side via Qdrant + rerank. */
  requiredSlots: RequiredSlot[];
  constraints: DesignConstraints;
  /** Legacy: Claude-picked ids (deprecated when vector catalog mode is on). */
  selectedCatalogIds: string[];
  /** Legacy: FULLTEXT resolve-intents (deprecated when vector catalog mode is on). */
  productIntents: ProductIntent[];
  /** Claude-analyzed categories of user-uploaded product images — used to keep the catalog resolver from adding competing items; uploads themselves render as-is. */
  productDescriptions: ProductDescription[];
  /** Finished door styling concept — leaf material, color, hardware; never location. */
  doorDesign?: string;
}

function asCatalogIdArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.trim()) out.push(x.trim());
  }
  return out;
}

function normalizeRequiredSlots(raw: unknown): RequiredSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: RequiredSlot[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const family = typeof item.family === "string" ? item.family.trim() : "";
    if (!family) continue;
    const subtypeRaw = typeof item.subtype === "string" ? item.subtype.trim() : undefined;
    const subtype = subtypeRaw
      ? normalizeCatalogSubtype(family, subtypeRaw)
      : undefined;
    const quantity =
      typeof item.quantity === "number" && Number.isFinite(item.quantity)
        ? Math.max(1, Math.floor(item.quantity))
        : undefined;
    const placement = typeof item.placement === "string" ? item.placement.trim() : undefined;
    out.push({ family, subtype: subtype || undefined, quantity, placement });
  }
  return out;
}

function normalizeDesignConstraints(raw: unknown): DesignConstraints {
  if (!isRecord(raw)) return {};
  const materials = asStringArray(raw.materials);
  const colors = asStringArray(raw.colors);
  const style_keywords = asStringArray(raw.style_keywords ?? raw.styleKeywords);
  const max_price =
    typeof raw.max_price === "number" && Number.isFinite(raw.max_price)
      ? Math.max(0, Math.floor(raw.max_price))
      : typeof raw.maxPrice === "number" && Number.isFinite(raw.maxPrice)
        ? Math.max(0, Math.floor(raw.maxPrice))
        : undefined;
  return {
    materials: materials.length ? materials : undefined,
    colors: colors.length ? colors : undefined,
    style_keywords: style_keywords.length ? style_keywords : undefined,
    max_price,
  };
}

function normalizeProductIntents(raw: unknown): ProductIntent[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductIntent[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const family = typeof item.family === "string" ? item.family.trim() : "";
    const subtype = typeof item.subtype === "string" ? item.subtype.trim() : "";
    const query = typeof item.query === "string" ? item.query.trim() : "";
    if (!family || !query) continue;
    const quantity =
      typeof item.quantity === "number" && Number.isFinite(item.quantity)
        ? Math.max(1, Math.floor(item.quantity))
        : undefined;
    const placement = typeof item.placement === "string" ? item.placement.trim() : undefined;
    out.push({ family, subtype: subtype || "other", query, quantity, placement });
  }
  return out;
}

function normalizeProductDescriptions(raw: unknown): ProductDescription[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductDescription[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const upload_index =
      typeof item.upload_index === "number" ? item.upload_index
        : typeof item.uploadIndex === "number" ? item.uploadIndex : -1;
    const family = typeof item.family === "string" ? item.family.trim() : "";
    const subtype = typeof item.subtype === "string" ? item.subtype.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const search_query =
      typeof item.search_query === "string" ? item.search_query.trim()
        : typeof item.searchQuery === "string" ? item.searchQuery.trim() : "";
    if (!search_query && !description) continue;
    out.push({
      upload_index,
      family: family || "furniture",
      subtype: subtype || "other",
      description,
      search_query: search_query || description.slice(0, 120),
    });
  }
  return out;
}

export function normalizeParsedDesignBrief(raw: unknown): DesignBrief {
  const o = isRecord(raw) ? raw : {};
  const snake = asCatalogIdArray(o.selected_catalog_ids);
  const camel = asCatalogIdArray(o.selectedCatalogIds);

  const selectedCatalogIds = snake.length ? snake : camel;
  const intentsRaw = o.product_intents ?? o.productIntents;
  const productIntents = normalizeProductIntents(intentsRaw);
  const requiredSlotsRaw = o.required_slots ?? o.requiredSlots;
  let requiredSlots = normalizeRequiredSlots(requiredSlotsRaw);
  if (!requiredSlots.length && productIntents.length) {
    requiredSlots = productIntents.map((i) => ({
      family: i.family,
      subtype: i.subtype !== "other" ? i.subtype : undefined,
      quantity: i.quantity,
      placement: i.placement,
    }));
  }
  const designIntent =
    typeof o.design_intent === "string"
      ? o.design_intent.trim()
      : typeof o.designIntent === "string"
        ? o.designIntent.trim()
        : "";
  const constraints = normalizeDesignConstraints(o.constraints);
  const productDescriptions = normalizeProductDescriptions(
    o.product_descriptions ?? o.productDescriptions,
  );
  const doorDesign =
    typeof o.door_design === "string"
      ? o.door_design.trim()
      : typeof o.doorDesign === "string"
        ? o.doorDesign.trim()
        : undefined;

  return {
    subject: typeof o.subject === "string" ? o.subject : "",
    arrangement: typeof o.arrangement === "string" ? o.arrangement : "",
    context: typeof o.context === "string" ? o.context : "",
    composition: typeof o.composition === "string" ? o.composition : "",
    style: typeof o.style === "string" ? o.style : "",
    fullPrompt: typeof o.fullPrompt === "string" ? o.fullPrompt : "",
    roomType: typeof o.room_type === "string" ? o.room_type
      : typeof o.roomType === "string" ? o.roomType : "",
    cameraAngle: typeof o.camera_angle === "string" ? o.camera_angle
      : typeof o.cameraAngle === "string" ? o.cameraAngle : "",
    designIntent,
    requiredSlots,
    constraints,
    selectedCatalogIds,
    productIntents,
    productDescriptions,
    doorDesign: doorDesign || undefined,
  };
}

export function buildAnalysisSystemPrompt(
  multiImage = false,
  locale: "hy" | "en" | "ru" = "en",
): string {
  const languageInstruction =
    locale === "hy"
      ? `\n\nLANGUAGE: Write ALL descriptive string values in Armenian only — never English or Russian. This includes window_positions, door_positions, architectural_features, lighting_sources, current_style, suggestions, camera_angle, structural_elements, staircase_description, floor_opening_description, and existing_furniture name/position fields.
Example window_positions entry: "հետևի պատի ձախ կողմ"
Example door_positions entry: "աջ պատ, \u0561\u0576\u056F\u0578\u0576\u056B \u0574\u0578\u057F"`
      : locale === "ru"
        ? `\n\nLANGUAGE: Write ALL descriptive string values in Russian only. This includes window_positions, door_positions, architectural_features, lighting_sources, current_style, suggestions, camera_angle, structural_elements, staircase_description, floor_opening_description, and existing_furniture name/position fields.
Example window_positions entry: "задняя стена слева"
Example door_positions entry: "правая стена у угла"`
        : "";

  const multiImageInstructions = multiImage
    ? `

You are provided with MULTIPLE PHOTOS of the SAME room taken from different angles.
Cross-reference all images to build one comprehensive analysis:
- Use different angles to improve dimension accuracy (triangulate wall lengths, room depth, ceiling height).
- Identify ALL furniture visible across every photo — do not miss items hidden in one angle but visible in another.
- Merge architectural features, lighting sources, and color observations from all views into unified lists.
- If photos show conflicting details, use the most complete/clear view as the primary reference.`
    : "";

  return `You are an expert interior designer and spatial analyst. Analyze the room photo${multiImage ? "s" : ""} provided and return a structured JSON response.
${multiImageInstructions}${languageInstruction}
Respond ONLY with valid JSON matching this schema:
{
  "room_type": "MUST be exactly one of: ${ROOM_TYPES.join(", ")}",
  "room_shape": "MUST be exactly one of: ${ROOM_SHAPES.join(", ")}",
  "estimated_dimensions": { "width": number_meters, "depth": number_meters, "height": number_meters },
  "polygon_edges": "OPTIONAL — required when room_shape is l-shaped or u-shaped: [{ \\"label\\": \\"A-B\\", \\"length_m\\": number }, ...] clockwise from corner A; edge labels must match the standard template for that shape (L-shape: 6 edges A-B through F-A; U-shape: 8 edges A-B through H-A). width/depth must be the axis-aligned bounding box of those edges.",
  "existing_furniture": [{ "name": "string", "position": "string (e.g. center, left wall)", "approximate_size": "string (e.g. 2m x 0.8m)" }],
  "architectural_features": ["string (e.g. bay window, crown molding, exposed beam)"],
  "lighting_sources": ["string (e.g. large south-facing window, recessed ceiling lights)"],
  "current_style": "string (closest design style)",
  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "suggestions": ["string (improvement suggestions)"],
  "window_count": number,
  "door_count": number,
  "window_positions": ["string (${locale === "hy" ? "օր. «հետևի պատի ձախ կողմ»" : locale === "ru" ? "напр. «задняя стена слева»" : "e.g. back wall left"} — one per window, in order)"],
  "door_positions": ["string (${locale === "hy" ? "օր. «աջ պատ, \u0561\u0576\u056F\u0578\u0576\u056B \u0574\u0578\u057F»" : locale === "ru" ? "напр. «правая стена у угла»" : "e.g. left wall near corner"} — one per door, in order)"],
  "window_boxes": [{ "x": number, "y": number, "w": number, "h": number }],
  "door_boxes": [{ "x": number, "y": number, "w": number, "h": number }],
  "camera_angle": "string (brief description of viewpoint)",
  "ceiling_type": "MUST be exactly one of: ${CEILING_TYPES.join(", ")}",
  "structural_elements": ["string (columns, hearth, etc.)"],
  "has_staircase": boolean,
  "staircase_description": "string or null",
  "has_floor_opening": boolean,
  "floor_opening_description": "string or null",
  "confidence": {
    "room_type": "high" | "medium" | "low",
    "dimensions": "high" | "medium" | "low",
    "style": "high" | "medium" | "low",
    "window_count": "high" | "medium" | "low",
    "door_count": "high" | "medium" | "low"
  }
}

Be precise with dimension estimates. Count every distinct window and door opening visible${multiImage ? " across all photos" : ""}. Each separate framed glazed unit = one window (six units visible → window_count: 6 and six window_positions strings). Ensure window_positions.length === window_count and door_positions.length === door_count — never leave positions shorter than the count. Identify every piece of furniture visible${multiImage ? " across all photos" : ""}.
${WINDOW_OPENING_INSTRUCTIONS}

OPENING_BOXES: For EACH window and door, also return a bounding box in "window_boxes" / "door_boxes" — same order and length as the matching *_positions array. Each box is { "x", "y", "w", "h" } as fractions of the image (0–1), top-left origin: x,y = top-left corner of the opening, w,h = its width/height. Box the visible glazed/door opening tightly (glass area for windows, the leaf or clear passage for doors). If an opening is fully occluded so you cannot box it, omit just that entry but keep the others aligned by skipping its index. ${multiImage ? "Use the single clearest photo for boxes; do not mix coordinates across photos." : ""}

OPEN_PASSAGES: Treat wide archways or clear openings to another interior space (even without a door leaf) as passages — include them in door_count and door_positions so downstream rendering does not "wall them up".

FLOOR_VOIDS: If the concrete slab has a stairwell cutout, hole to a lower level, or vertical rebar around a floor edge, set has_floor_opening to true and describe it in floor_opening_description (shape, rough position in frame). Set has_staircase true when stairs are visible, even when the main issue is the void.

STRUCTURAL_COLUMNS: List every structural column, post, load-bearing pier, or pillar TOUCHING or INSIDE this room under "structural_elements" with a SHORT position cue (e.g. "central column midway between window and fireplace", "pair of posts flanking doorway on right wall relative to camera").

STRUCTURAL_RECESS: When a foreground pier/wall bump-out creates a recessed alcove (common on one side of asymmetric rooms), you MUST capture:
- The foreground pier/column in "structural_elements" (e.g. "white foreground pier on far left, partially blocks view into recess")
- The recess/alcove step-back in "structural_elements" AND "architectural_features" (e.g. "recessed alcove behind foreground pier on left")
- Any lower soffit/drop ceiling with spotlights above the recess in "structural_elements" or "architectural_features"
- Window positions on the recess wall using "left recess wall" labels (see WINDOW POSITION NAMING above)
- room_shape "l-shaped" or "irregular" — not "rectangular" when this geometry is visible

POLYGON_EDGES (l-shaped / u-shaped only): When room_shape is "l-shaped" or "u-shaped", include "polygon_edges" with one entry per wall segment, labelled clockwise from corner A (L-shape: A-B, B-D, D-E, E-F, F-C, C-A; U-shape: A-B, B-C, C-D, D-E, E-F, F-G, G-H, H-A). Estimate each edge length in metres from visible scale cues. Set estimated_dimensions.width and .depth to the bounding box of that polygon.

CONFIDENCE_CALIBRATION — set honesty levels for downstream UX gates:
- "dimensions": Use "high" ONLY when estimates are justified by multiple independent cues visible in the photo(s) (furniture of known ergonomic scale ~0.75m seating height; standard doorway height (~2–2.1m); tiling/grid/ruler-like references; repeatable depth cues). Use "medium" for plausible single-photo eyeball estimates WITHOUT strong scale anchors. Use "low" when the framing hides scale (extreme wide-angle warp, cropped corners, fisheye/stylized render), or no reliable reference exists.
- "window_count" / "door_count": Use "high" when openings are plainly visible/unambiguous from the viewpoint; "medium" when partial occlusion or glare; "low" when ambiguity or heavy distortion.`;
}

/** Spatial fields used by Quick Room to gate UX (defaults match schema fallbacks → "medium"). */
export type QuickRoomSpatialConfidenceKey = "dimensions" | "window_count" | "door_count";

export function effectiveQuickRoomSpatialConfidence(
  analysis: RoomAnalysis | null | undefined,
  key: QuickRoomSpatialConfidenceKey,
): Confidence {
  const c = analysis?.confidence?.[key];
  if (c === "high" || c === "medium" || c === "low") return c;
  return "medium";
}

/** Blocking Room facts verification when ANY spatial cue is unreliable. */
export function quickRoomNeedsMandatorySpatialClarification(analysis: RoomAnalysis | null | undefined): boolean {
  if (!analysis) return false;
  return (
    effectiveQuickRoomSpatialConfidence(analysis, "dimensions") === "low" ||
    effectiveQuickRoomSpatialConfidence(analysis, "window_count") === "low" ||
    effectiveQuickRoomSpatialConfidence(analysis, "door_count") === "low"
  );
}

/** Soft hint banner when plausible but user may want to tighten numbers. */
export function quickRoomShowsOptionalSpatialHint(analysis: RoomAnalysis | null | undefined): boolean {
  if (!analysis) return false;
  if (quickRoomNeedsMandatorySpatialClarification(analysis)) return false;
  return (
    effectiveQuickRoomSpatialConfidence(analysis, "dimensions") === "medium" ||
    effectiveQuickRoomSpatialConfidence(analysis, "window_count") === "medium" ||
    effectiveQuickRoomSpatialConfidence(analysis, "door_count") === "medium"
  );
}

function buildPlacementOnlyDirectorPrompt(
  userRequest: string,
  roomAnalysis: RoomAnalysis | null | undefined,
  editContext: string | undefined,
  merchantCatalogDirectorBlock: string | undefined,
  inspirationImageCount: number,
): string {
  const roomContext = roomAnalysis
    ? `\nRoom Analysis:\n- Type: ${roomAnalysis.room_type}\n- Existing furniture: ${roomAnalysis.existing_furniture.map((f) => f.name).join(", ") || "see photo"}\n- Current style: ${roomAnalysis.current_style}`
    : "";

  const editInfo = editContext ? `\n\nPrevious design context:\n${editContext}` : "";

  const pinnedBlock = merchantCatalogDirectorBlock?.trim()
    ? `\n\n${merchantCatalogDirectorBlock.trim()}\nOnly these pinned catalog products may be placed — do not add any other catalog items.`
    : "";

  const inspirationSection =
    inspirationImageCount > 0
      ? `\n\nUSER-PROVIDED PRODUCT IMAGES (${inspirationImageCount} attached above):
The user uploaded photos of specific products to place in this room. These exact images are handed to the image generator — never substitute them.
1. Output "product_descriptions" — one entry per uploaded image, in order.
2. In "subject" and "arrangement", describe ONLY where and how to place these products.
3. Do NOT add furniture, decor, or finishes beyond what the user provided.
4. Leave "required_slots" empty — do not request extra catalog items.`
      : "";

  return `You are a furniture placement specialist. The user wants to add specific products to their existing room photo WITHOUT redesigning the room.

PLACEMENT-ONLY MODE (absolute):
- Keep walls, floor, ceiling, lighting, camera angle, and ALL existing furniture/decor exactly as photographed.
- ONLY place the user-provided product(s) — uploaded photos and/or catalog pins.
- Do NOT change wall colors, flooring, curtains, lighting fixtures, or add new decor.
- Do NOT add furniture beyond what the user provided.
- If a provided product should replace a similar existing piece (e.g. new sofa replaces old sofa), describe that replacement in arrangement only.
- NEVER describe room shape, window count/positions, door count, ceiling type, or camera angle — the photo defines all structure.
${roomContext}${editInfo}${pinnedBlock}${inspirationSection}

User request: "${userRequest}"

Output formatting: return a single JSON object only. Use strict JSON: double-quoted keys and string values, escape internal double quotes as \\", no trailing commas, no comments, no markdown fences around the JSON.

Respond ONLY with valid JSON:
{
  "room_type": "string",
  "camera_angle": "Reference photo determines angle",
  "subject": "string (ONLY the provided products being placed — material, color, shape)",
  "arrangement": "string (where each provided product goes; replacement vs addition if applicable)",
  "context": "string (unchanged room atmosphere — do not redesign)",
  "composition": "Reference photo determines angle and framing",
  "style": "string (match the existing room — do not impose a new style)",
  "door_design": "",
  "design_intent": "string (single paragraph: placement plan only — no surface redesign)",
  "required_slots": [],
  "constraints": {},
  ${inspirationImageCount > 0
    ? `"product_descriptions": [{ "upload_index": 0, "family": "furniture|lighting|decor", "subtype": "sofa|lamp|etc", "description": "detailed description of the uploaded product" }],`
    : ""}
  "fullPrompt": "string (MUST start with 'Place the user-provided products in this room:' — describe placement only; never redesign walls, floor, ceiling, or lighting)"
}`;
}

export function buildCreativeDirectorPrompt(
  userRequest: string,
  styleId: DesignStyleId,
  roomAnalysis?: RoomAnalysis | null,
  editContext?: string,
  hasReferenceImage?: boolean,
  merchantCatalogDirectorBlock?: string,
  options?: {
    vectorCatalogMode?: boolean;
    freeRender?: boolean;
    inspirationImageCount?: number;
    styleInspirationCount?: number;
    placementMode?: QuickRoomPlacementMode;
  },
): string {
  const style = DESIGN_STYLES.find((s) => s.id === styleId) ?? DESIGN_STYLES[0];

  if (options?.placementMode === "placeOnly") {
    return buildPlacementOnlyDirectorPrompt(
      userRequest,
      roomAnalysis,
      editContext,
      merchantCatalogDirectorBlock,
      options.inspirationImageCount ?? 0,
    );
  }

  const roomContext = roomAnalysis
    ? `\nRoom Analysis:\n- Type: ${roomAnalysis.room_type} (${roomAnalysis.room_shape})\n- Dimensions: ${formatRoomDimensionsForPrompt(roomAnalysis.room_shape, roomAnalysis.estimated_dimensions, roomAnalysis.polygon_edges)}\n- STRUCTURAL LOCK — Windows: EXACTLY ${roomAnalysis.window_count} (${roomAnalysis.window_positions.join("; ") || "positions unspecified"}) — downstream image generation MUST preserve this count\n- STRUCTURAL LOCK — Doors / passages: EXACTLY ${roomAnalysis.door_count} (${roomAnalysis.door_positions.join("; ") || "positions unspecified"})\n- Existing furniture: ${roomAnalysis.existing_furniture.map((f) => f.name).join(", ")}\n- Architectural features: ${roomAnalysis.architectural_features.join(", ")}\n- Lighting: ${roomAnalysis.lighting_sources.join(", ")}\n- Current style: ${roomAnalysis.current_style}\n- Color palette: ${roomAnalysis.color_palette.join(", ")}${roomAnalysis.has_staircase ? `\n- Staircase: ${roomAnalysis.staircase_description || "present"}` : ""}${roomAnalysis.has_floor_opening ? `\n- Floor void / cutout (must not be covered by flooring in the image): ${roomAnalysis.floor_opening_description || "see photo"}` : ""}`
    : "";

  const editInfo = editContext ? `\n\nPrevious design context (user wants to edit):\n${editContext}` : "";

  // Free render = a one-of-a-kind concept design with NO product catalog. The model
  // may invent any furniture, materials, and decor; it must not emit catalog ids.
  const freeRender = options?.freeRender === true;
  const vectorCatalogMode = !freeRender && options?.vectorCatalogMode === true;
  const inspirationImageCount = options?.inspirationImageCount ?? 0;
  const styleInspirationCount = options?.styleInspirationCount ?? 0;
  const catalogSection = freeRender
    ? `\n\nFREE DESIGN MODE — no product catalog applies:
- Design the room freely with any furniture, materials, lighting, and decor that best fit the style and the user's request. You are NOT limited to any inventory.
- Choose beautiful, cohesive, realistic pieces — describe them by type, material, color, and finish.
- Do NOT output "selected_catalog_ids" or "product_intents"; there are no SKUs to reference.`
    : vectorCatalogMode || !merchantCatalogDirectorBlock?.trim()
      ? vectorCatalogMode
        ? `\n\nCATALOG RESOLUTION (server-side — do NOT output SKU ids):
- The server assigns a complete base product kit for the room type (flooring, curtains, lighting, core furniture). You do NOT need to list every essential item.
- Describe the design in "design_intent" (rich paragraph: style, materials, colors, mood, room role).
- Use "required_slots" ONLY for optional extras beyond the base kit (e.g. add armchair, side table, extra lamp) — not to replace core room furniture.
- Put color/material/style hints in "constraints" when useful.
- NEVER output selected_catalog_ids or product_intents — the backend resolves real SKUs.`
        : ""
      : `\n\n${merchantCatalogDirectorBlock.trim()}`;

  const inspirationImageSection =
    inspirationImageCount > 0
      ? `\n\nUSER-PROVIDED PRODUCT IMAGES (${inspirationImageCount} image${inspirationImageCount > 1 ? "s" : ""} attached above):
The user uploaded photos of specific products they want in this room. These exact images are handed to the image generator and placed as-is — they are never substituted with catalog items. You MUST:
1. Analyze each uploaded product image carefully — identify its category (furniture, lighting, flooring, decor, etc.), material, color, style, and approximate dimensions.
2. Output a "product_descriptions" array in your JSON — one entry per uploaded image, in order, with an accurate "family" and "subtype" (the server uses them to avoid adding a competing catalog item of the same category).
3. Incorporate these products into your design — they MUST appear in subject, arrangement, and fullPrompt.
4. In "required_slots", include ADDITIONAL products the room needs BEYOND what the user uploaded (do not duplicate uploads in required_slots).`
      : "";

  const styleInspirationSection =
    styleInspirationCount > 0
      ? `\n\nSTYLE INSPIRATION IMAGES (${styleInspirationCount} image${styleInspirationCount > 1 ? "s" : ""} attached above):
The user uploaded design inspiration photos (room designs, mood boards, or spaces they love).
You MUST:
1. Analyze the color palette, material choices, spatial arrangement, lighting mood, and overall aesthetic.
2. Incorporate these stylistic elements into your design_intent, fullPrompt, and style fields.
3. The generated room should FEEL like these inspiration images but use ONLY real products from the catalog.
4. Do NOT copy specific products from these images — extract the STYLE and apply it with catalog items.`
      : "";

  const referenceImageWarning = hasReferenceImage
    ? `
CRITICAL — REFERENCE PHOTO MODE:
A reference photo of the real room will be sent alongside your prompt to the image generator. The image generator will use the photo as the structural base. Therefore EVERY output field (subject, arrangement, context, composition, style, AND fullPrompt) must ONLY describe DESIGN CHANGES — never describe the room's architecture. Specifically:
- Do NOT describe room shape, number of walls, corners, or room dimensions in ANY field.
- Do NOT describe window positions, sizes, shapes, or count in ANY field. Just describe WINDOW TREATMENTS (curtains, drapes) without specifying window architecture.
- Do NOT describe door positions or count in ANY field except "door_design" (styling only — never location).
- Do NOT describe ceiling type or height in ANY field.
- Do NOT describe camera angle or viewpoint in ANY field — the reference photo determines this.
- Do NOT describe what is visible outside the windows (no city views, no landscapes, no skylines).
- Do NOT use phrases like "floor-to-ceiling windows", "large corner windows", "panoramic view", "expansive windows", "wall of windows", "double-height ceiling" — these phrases cause the image generator to ALTER the room structure.
- You MAY include one short preservation clause in fullPrompt: "Preserve every existing window and door opening from the reference photo exactly; apply curtain/fabric changes only, never remove or brick over glazed openings."
- When describing wall paneling, slats, or accent bands on a wall that has windows in the photo, specify finishes AROUND the openings — never a continuous solid panel that replaces windows.
- In "subject": list ONLY decorative/finish elements — wall paint/wallpaper, flooring/rugs, curtain fabrics, furniture pieces, lighting fixtures, textiles, art, plants. ZERO architectural descriptions.
- In "arrangement": describe ONLY furniture placement, spatial flow, and layering. Do NOT mention room shape, dimensions, or number of windows/doors. Keep at least 90 cm clearance in front of and beside every door/passage — never place wardrobes, tall cabinets, or bookcases adjacent to a door opening or where they would obstruct the door swing; prefer walls without openings for tall storage.
- In "context": describe ONLY light mood, atmosphere, time of day. Do NOT mention room dimensions or architectural features.
- In "composition": say ONLY "Reference photo determines angle" and describe visual focal point. Do NOT specify any camera angle or lens.
- In "style": describe ONLY mood, color palette, material harmony. Do NOT mention architectural features.
- ONLY describe: wall colors/finishes, flooring/rugs, window treatments (curtains/drapes fabric only), furniture, lighting fixtures, textiles, decor, art, plants, and color palette.
- Start the fullPrompt with: "Redesign this room's interior:"`
    : "";

  return `You are a Creative Director for COMPLETE interior design — not just furniture placement. You design the ENTIRE room atmosphere: walls, floors, lighting, textiles, decor, art, plants, and furniture together as one cohesive vision.

Your job: Transform the user's casual request into an optimized image-generation prompt for a photorealistic interior render that shows a FULLY DESIGNED room — not just furniture in a space.
${referenceImageWarning}

WHAT "INTERIOR DESIGN" MEANS (you MUST address ALL of these in every prompt):
- WALL DESIGN: paint color, wallpaper, accent walls, textured finishes, wainscoting, wall paneling
- FLOORING: area rugs, runners, layered rugs on hardwood, floor patterns
- WINDOW TREATMENTS: curtains, drapes, blinds, sheers — fabric type, color, hang style
- LIGHTING DESIGN: describe a deliberate, symmetric ARCHITECTURAL layout — recessed downlights in an evenly-spaced grid aligned to the walls, a continuous concealed LED cove running parallel to the walls, one pendant/chandelier centered over the main furniture anchor, sconces in matching pairs — plus floor/table lamps, candles, warm natural-light interaction. Never a loose pile of scattered fixtures
- TEXTILES & SOFT FURNISHINGS: throw pillows, cushions, upholstery fabrics, textures
- DECOR & ACCESSORIES: vases, books, candles, trays, sculptures, clocks, mirrors
- WALL ART: framed prints, canvas art, photo walls, floating shelves with objects
- PLANTS & GREENERY: potted plants, hanging plants, dried flowers, plant stands
- COLOR PALETTE: a cohesive 3-5 color scheme tying everything together
- FURNITURE: sofas, tables, chairs, storage — with specific materials and finishes

THE 5-COMPONENT FORMULA:
1. SUBJECT — Wall treatments, floor treatments, window treatments (curtains/drapes only), key furniture, decor objects, plants, art
2. ARRANGEMENT — Layout, spatial flow, focal point, layering of textures and colors across the room
3. CONTEXT — Natural light atmosphere, time of day mood${hasReferenceImage ? "" : ", room dimensions, architectural features"}
4. COMPOSITION — ${hasReferenceImage ? "Let the reference photo determine the camera angle" : "Camera angle (eye-level, slightly elevated, corner view), depth of field, what draws the eye"}
5. STYLE — "${style.label}" style: ${style.keywords}. Overall mood, color temperature, material harmony.

STRUCTURAL INTEGRITY (absolute — apply to every prompt):
- All walls, partitions, built-in structures, alcoves, and columns stay exactly as they appear in the reference photo.
- Every doorway, archway, and wide passage remains fully open, connecting to adjacent spaces exactly as in the photo.
- DOOR CLEARANCE: Keep at least 90 cm clear in front of and beside every door/passage. Never place wardrobes, tall cabinets, or bookcases against a door frame or where they block the door swing. Prefer solid walls without openings for tall storage.
- Stairwell cutouts, slab holes, and floor openings remain open voids; rugs and flooring apply only to solid walkable slab.
- No elements that visually imply a new wall or structural boundary.
- Built-in shelving, cabinetry, or millwork only if the user explicitly requests it.
- ALL furniture must be freestanding and removable — no flush-to-corner items that imply structure.
- Architectural features stay exactly as the original room shows them — no invented features.
- You CAN and SHOULD change: wall colors, wallpaper, curtains, rugs, lighting fixtures, art, decor — these are design, not structure.
- Every glazed window opening visible in the reference photo stays as transparent glass with light coming through — wall slats/panels frame each window bay on either side.

COMPLETENESS — EVERY SURFACE MUST BE FULLY DESIGNED (this is critical):
- The fullPrompt MUST describe finishes for all visible WALL and CEILING surfaces, and for solid WALKABLE floor only (not across voids)
- WALLS: explicitly describe the finish for every wall (paint color, wallpaper, texture, paneling); on walls with windows in the reference photo, finishes go around each glazed bay — never a solid panel that removes windows
- FLOOR: describe finishes on solid slab areas only; if the room photo shows a stairwell hole or cutout, say rugs stop at the edge of the void — never a single rug spanning the hole
- CEILING: explicitly describe the ceiling finish (painted color, molding, coffered, beamed, or smooth) AND a deliberate, symmetric fixture layout — recessed downlights in an evenly-spaced grid aligned to the walls, and/or a continuous LED cove parallel to the walls, and/or one centered pendant/chandelier — never scattered off-center spots; do not invent a false ceiling height that hides real structure
- The prompt must produce a FULLY FINISHED, magazine-quality room — never a half-designed space with bare/unfinished surfaces on actual build surfaces
- Think of it as a complete renovation — every real surface from floor to ceiling must be intentionally designed while preserving openings and voids

PROMPT CONSTRUCTION RULES:
- Output MUST be a single, detailed paragraph (the image prompt)
- ALWAYS describe wall treatment first (color, wallpaper, or texture — never leave walls plain/bare)
- ALWAYS describe the ceiling finish (painted, with molding, or with specific fixtures — never leave ceiling unmentioned)
- ALWAYS describe the floor treatment on solid slab only (material + rugs/runners that lie on walkable floor — rugs must not bridge stairwell openings or slab holes)
${roomAnalysis?.window_count === 0 ? "- Do NOT include window treatments — this room has no glazed openings" : "- Include window treatments (curtains, drapes, sheers) ONLY if the room has windows — describe the FABRIC only, not the windows themselves; server-side placement lock anchors treatments to existing openings"}
- ALWAYS include at least 2-3 lighting sources (ambient + accent + task or decorative), and specify their LAYOUT and alignment — symmetric grids, fixtures centered over their anchor, paired sconces — so the lighting reads as professionally planned, never randomly placed
- ALWAYS include textiles (throw pillows, cushions, rugs) — do NOT describe throw blankets or draped blankets on furniture
- ALWAYS include at least one piece of wall art or wall decor
- ALWAYS include at least one plant or greenery element
- Include specific materials (oak, marble, linen, brass, velvet, bouclé, jute)
- Specify a cohesive color palette with 3-5 named colors
${hasReferenceImage ? "- Do NOT specify camera angle or lens — the reference photo determines this" : "- Mention camera: \"photographed at eye level with a 24mm lens\" or similar"}
- Add realism cues: "interior photography, 8K, architectural digest quality"
${freeRender
    ? `- FREE DESIGN: invent any furniture, lighting, and decor that make the room beautiful and cohesive — you are not constrained to any catalog. Describe pieces by type, material, color, and finish; do not reference SKU ids or brand names.`
    : `- STRICT CATALOG RULE: When a product catalog is provided, EVERY piece of furniture, lighting fixture, appliance, and major decor object in the design MUST come from that catalog. NEVER invent, imagine, or add furniture not in the catalog. If a needed item type is missing, LEAVE that space empty — a sparsely furnished room with ONLY catalog products is better than a room with non-catalog items. Generic finishes (wall paint, rugs, curtains, art, plants, small tabletop props) are allowed.
- Never mention third-party designer brand names unrelated to merchant catalog titles
- For every catalog-bound furniture/decoration object, weave the PRODUCT NAME verbatim (from AVAILABLE list) somewhere in arrangement + fullPrompt narrative (no bracket ID codes, omit prices/currency symbols)`}
- Keep the user's original intent central
- Match the exact style the user requests — do not blend styles unless asked
${roomContext}${editInfo}${catalogSection}${inspirationImageSection}${styleInspirationSection}

User request: "${userRequest}"
Target style: ${style.label}

Output formatting: return a single JSON object only. Use strict JSON: double-quoted keys and string values, escape internal double quotes as \\", no trailing commas, no comments, no markdown fences around the JSON.

Respond ONLY with valid JSON:
{
  "room_type": "string (specific room type, e.g. 'Living Room', 'Master Bedroom', 'Kitchen', 'Bathroom', 'Home Office', 'Dining Room', 'Children\\'s Room', 'Hallway', 'Studio Apartment')",
  "camera_angle": "string (describe the viewpoint, e.g. 'Front wall, looking toward windows', 'Corner view from entrance', 'Eye-level from doorway facing left wall')",
  "subject": "string (${hasReferenceImage ? "ONLY decorative elements: wall paint/wallpaper, curtain fabric, rug material, furniture pieces, lighting, textiles, art, plants — absolutely NO window/door/room architecture" : "wall finishes, flooring, window treatments, furniture, decor, plants, art — design elements only, NOT architecture"})",
  "arrangement": "string (${hasReferenceImage ? "furniture placement and spatial flow ONLY — do NOT mention room shape, window count, or dimensions" : "layout, spatial flow, color layering, focal point"})",
  "context": "string (${hasReferenceImage ? "light atmosphere, time of day, mood ONLY — do NOT mention room dimensions or architecture" : "room dimensions, light sources, time of day, atmosphere"})",
  "composition": "string (${hasReferenceImage ? "ONLY say: reference photo determines angle. Then describe focal point and visual flow" : "camera angle, depth of field, what draws the eye"})",
  "style": "string (${hasReferenceImage ? "mood, color palette of 3-5 colors, material harmony ONLY — NO architectural features" : "overall mood, color palette of 3-5 colors, material harmony"})",
  "door_design": "string (describe a finished door for every doorway: leaf material, color, handle/hardware, and trim coherent with the overall style; choose open or closed per door as appropriate — NEVER a bare dark empty opening; styling ONLY — do NOT describe door count, position, or wall location)",
  ${freeRender
    ? `"design_intent": "string (single rich paragraph: style, materials, colors, mood, furniture roles — invented freely, NO SKU ids)",`
    : vectorCatalogMode
    ? `"design_intent": "string (single rich paragraph: style, materials, colors, mood, furniture roles — NO SKU ids)",
  "required_slots": [{ "family": "flooring|walls|window_treatments|lighting|furniture", "subtype": "laminate|sofa|ceiling|curtain|etc", "quantity": 1, "placement": "optional" }],
  "constraints": { "materials": ["oak", "linen"], "colors": ["beige", "warm white"], "style_keywords": ["scandinavian", "minimal"] },`
    : `"product_intents": [{ "family": "flooring|walls|window_treatments|lighting|furniture", "subtype": "laminate|sofa|ceiling|curtain|etc", "query": "search phrase for DB", "quantity": 1, "placement": "optional" }],
  "selected_catalog_ids": ["string (ONLY mp-<id> from AVAILABLE PRODUCT CATALOG for SKUs visibly placed — never pad)"],`}${inspirationImageCount > 0
    ? `
  "product_descriptions": [{ "upload_index": 0, "family": "furniture|lighting|flooring|walls|window_treatments|decor|appliance", "subtype": "sofa|lamp|tile|curtain|etc", "description": "detailed description of the uploaded product — material, color, style, shape, approximate dimensions" }],`
    : ""}
  "fullPrompt": "string (${hasReferenceImage ? "starts with 'Redesign this room\\'s interior:' — apply flooring/wall finishes first, then curtains and lighting, then furniture. Describe ONLY design changes. NEVER describe room shape, window count/positions, door count, ceiling type, or outside views" : "complete merged prompt — flooring/walls first, then curtains, lighting, textiles, art, plants AND furniture"})"
}`;
}

export function buildEditInterpretationPrompt(
  editMessage: string,
  previousPrompt: string,
  chatHistory: Array<{ role: string; content: string }>,
  merchantInteriorCatalogPreserveBlock?: string,
): string {
  const historyText = chatHistory
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const catalogRetain = merchantInteriorCatalogPreserveBlock?.trim()
    ? `\n\nMERCHANT CATALOG ALIGNMENT (${merchantInteriorCatalogPreserveBlock.trim()}) Keep existing catalog-bound furniture SKU names unless edit explicitly swaps them — if swaps needed, cite replacement ids from surfaced list ONLY.`
    : "";

  return `You are a Creative Director for interior design. The user wants to modify an existing design.

Previous image prompt:
"${previousPrompt}"

Recent conversation:
${historyText}

User's edit request: "${editMessage}"${catalogRetain}

STRUCTURAL INTEGRITY (absolute — never violate):
- NEVER add, remove, or modify walls, partitions, built-in structures, alcoves, or columns.
- ALL furniture must be freestanding and removable.
- Preserve the room's exact shape, dimensions, windows, and doors from the previous design.
- Do NOT add built-in shelving or cabinetry unless the user explicitly asks for it.

Create an updated image generation prompt that applies the user's requested changes while keeping everything else from the previous design intact. Maintain the same camera angle, room structure, and architectural features unless explicitly asked to change.

Respond ONLY with valid JSON:
{
  "interpretation": "string (what the user wants changed)",
  "fullPrompt": "string (complete updated prompt for image generation)",
  "message": "string (friendly response to the user explaining what you changed)"
}`;
}

export function buildExtractPlanPrompt(catalogSummary?: string): string {
  const catalogInstructions = catalogSummary
    ? `

PRODUCT CATALOG MATCHING:
The merchant has these real products. For each furniture item you identify in the image, check if it closely matches a catalog product (similar type, category, and approximate dimensions). If it does, set "catalog_id" to that product's ID. If no good match exists, leave "catalog_id" as null.

${catalogSummary}`
    : "";

  return `You are a furniture identification and spatial analysis AI. Analyze this interior design image and extract every piece of furniture with approximate real-world dimensions.
${catalogInstructions}
Respond ONLY with valid JSON:
{
  "room": { "width": number_meters, "depth": number_meters, "height": number_meters },
  "items": [
    {
      "id": "string (unique, e.g. sofa-1)",
      "name": "string (e.g. Three-seat sofa)",
      "category": "string (e.g. Seating, Tables, Storage, Lighting, Decor)",
      "width_m": number,
      "depth_m": number,
      "height_m": number,
      "color": "#hexcolor",
      "position": { "x": number_meters_from_left, "z": number_meters_from_back }${catalogSummary ? ',\n      "catalog_id": "string or null (product ID from the catalog above, if a close match exists)"' : ""}
    }
  ],
  "estimated_total_price_usd": number
}

Be realistic with dimensions. A standard sofa is ~2.2m wide, a coffee table ~1.2m, a dining table ~1.8m.`;
}
