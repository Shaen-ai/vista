/**
 * Full Home Interior Design Project — shared type definitions.
 *
 * Covers every phase: floor-plan analysis, master design concept,
 * per-room generation, technical drawings, PDF assembly, and the
 * interactive review/edit loop.
 */

import type { ProductPurchaseLink } from "@/lib/productPurchaseLinks";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import { resolveDesignMode } from "@/lib/designModeConfig";

// ---------------------------------------------------------------------------
// Enums & literals
// ---------------------------------------------------------------------------

export const ROOM_TYPES = [
  "hallway",
  "living",
  "kitchen",
  "bedroom",
  "children",
  "bathroom",
  "toilet",
  "laundry",
  "balcony",
  "dining",
  "office",
  "wardrobe",
  "storage",
  "other",
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

export type ProjectStatus =
  | "pending"
  | "analyzing"
  | "designing"
  | "rendering"
  | "reviewing"
  | "finalizing"
  | "complete"
  | "failed";

export type RoomReviewStatus =
  | "pending"
  | "generating"
  | "review"
  | "editing"
  | "approved";

export type BudgetTier = "economy" | "mid" | "premium" | "luxury";

export type UtilityPointType =
  | "water_inlet"
  | "water_drain_stack"
  | "electrical_panel"
  | "gas_inlet";

export interface UtilityEntryPoint {
  id: string;
  type: UtilityPointType;
  /** mm, same coordinate system as room polygons */
  x: number;
  y: number;
  label: string;
}

/**
 * Camera viewpoint for an uploaded room photo: where in the room the photo was
 * shot and which direction the camera faces. Same mm coordinate system as room
 * polygons / utility points. `angleDeg` is the facing direction in degrees,
 * measured counter-clockwise from the +X axis (0 = facing right/east, 90 = up/north).
 */
export interface PhotoViewpoint {
  x: number;
  y: number;
  angleDeg: number;
}

// ---------------------------------------------------------------------------
// Phase 1 — Floor Plan Analysis
// ---------------------------------------------------------------------------

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  lengthMm: number;
}

export interface DetectedRoom {
  id: string;
  name: string;
  type: RoomType;
  estimatedArea: number;
  dimensions: { width: number; depth: number; height: number };
  // `edgeIndex`/`t` anchor the opening to a wall (edgeIndex = polygon edge, t =
  // 0..1 along it). They may be AI-derived (so the opening is visible/draggable
  // in the editor) — anchored does NOT imply reviewed. `confirmed` is the
  // authority signal: it's set when the user edits the opening or confirms the
  // room, and it's what promotes the count to a hard `EXACTLY N` lock downstream.
  windows: { position: string; width: number; height: number; edgeIndex?: number; t?: number; confirmed?: boolean }[];
  // `hinge` is which wall endpoint the leaf pivots on (left = edge start, right = edge end);
  // `swing` is which side the leaf opens toward (in = into the room / inward normal, out = outward).
  // Both are user-set in the editor; absent means hinge:"left", swing:"in" (the default glyph).
  doors: { position: string; width: number; height?: number; connectsTo: string; edgeIndex?: number; t?: number; hinge?: "left" | "right"; swing?: "in" | "out"; confirmed?: boolean }[];
  features: string[];
  /** Polygon vertices (in mm) for the room boundary, used for SVG drawing. */
  polygon?: [number, number][];
}

/** Freestanding structural column detected on the floor plan (not wall jogs). */
export interface PlanColumn {
  id: string;
  /** mm, same coordinate system as room polygons */
  x: number;
  y: number;
  /** approximate width/depth in meters */
  width: number;
  depth: number;
  /** room containing the column, if inferable */
  roomId?: string;
  shape?: "square" | "rectangular" | "circular";
}

export interface SharedWall {
  roomId: string;
  roomName: string;
  neighborRoomId: string;
  neighborRoomName: string;
  /** Compass from this room's outward normal (same as compassForEdge). */
  compass: "north" | "south" | "east" | "west";
  /** Polygon edge index on this room. */
  edgeIndex: number;
  /** Global plan axis along the shared segment. */
  spanAxis: "x" | "y";
  spanStartMm: number;
  spanEndMm: number;
  lengthMm: number;
  /** True when the overlap spans this room's entire edge (within tolerance). */
  fullWidth: boolean;
}

export interface FloorPlanAnalysis {
  totalArea: number;
  ceilingHeight: number;
  rooms: DetectedRoom[];
  wallSegments: WallSegment[];
  overallShape: string;
  notes: string;
  /** AI-suggested utility entry points (editable in floor plan review). */
  utilityPoints?: UtilityEntryPoint[];
  /**
   * Extent (mm) of the uploaded plan image in the same coordinate system as the
   * room polygons. When present, the room layout was anchored to the image: the
   * overlay viewBox should be this frame (origin 0,0) and the canvas should take
   * this aspect ratio, so detected rooms sit on the real walls. Absent for the
   * legacy/auto path that invented a self-cropped coordinate system.
   */
  imageFrame?: { width: number; height: number };
  /** Directed room-to-room shared wall records, computed at confirm-plan. */
  sharedWalls?: SharedWall[];
  /** Freestanding load-bearing columns detected on the plan. */
  columns?: PlanColumn[];
}

// ---------------------------------------------------------------------------
// Phase 2 — Master Design Concept
// ---------------------------------------------------------------------------

export interface NcsColor {
  hex: string;
  ncs: string;
  name: string;
}

export interface MaterialPalette {
  woodType: string;
  metalFinish: string;
  stoneType: string;
  textilePrimary: string;
}

export interface RoomDesignBrief {
  roomId: string;
  roomName: string;
  roomType: RoomType;
  wallColor: { hex: string; ncs: string };
  /** Built-in / freestanding furniture finish color (NCS), shown on PDF room spreads. */
  furnitureColor?: { hex: string; ncs: string };
  floorMaterial: string;
  ceilingDesign: string;
  lightingConcept: string;
  furnitureList: string[];
  keyDesignElements: string[];
  renderAngles: string[];
  specialNotes: string;
}

export interface MasterDesignConcept {
  projectName: string;
  overallStyle: string;
  colorPalette: {
    primary: NcsColor;
    secondary: NcsColor;
    accent: NcsColor;
    neutral: NcsColor;
  };
  materialPalette: MaterialPalette;
  rooms: RoomDesignBrief[];
}

/** Shared floor/ceiling/wall finishes — identical across all photo renders in a room. */
export interface RoomFinishLock {
  floorMaterial: string;
  ceilingDesign: string;
  wallColor: string;
  lightingConcept: string;
  paletteSummary?: string;
}

/** Per-photo staging prompt for apartment-staging (one FAL call per photo). */
export interface PhotoRenderPrompt {
  photoId: string;
  label?: string;
  /** 80–220 chars sent to FAL apartment-staging; must repeat finishLock snippet verbatim. */
  stagingPrompt: string;
  /** Full instruction for edit-pipeline renderer (no char clamp). */
  renderInstruction?: string;
  cameraNote?: string;
}

/** Per-room render prompt composed once by Claude from the floor plan + viewpoints. */
export interface RoomRenderPlan {
  roomId: string;
  roomName: string;
  /** Claude-composed design concept (300–400 words). Legacy alias: geminiPrompt. */
  designConcept: string;
  /** Shared finishes locked across all viewpoints in this room. */
  finishLock?: RoomFinishLock;
  /** Camera-specific staging prompts — one entry per assigned photo. */
  photoPrompts?: PhotoRenderPrompt[];
  /** Short distill for fal apartment-staging (~80–220 chars). Hero / legacy fallback. */
  stagingPrompt?: string;
  /** Canonical furniture placement — identical across all multi-view prompts. */
  furnitureLayoutLock?: string;
  /** @deprecated Same as designConcept — kept for older stored projects. */
  geminiPrompt: string;
  /** Extended structured design data from Claude render director. */
  style?: string;
  primaryColor?: string;
  accentColor?: string;
  materials?: string[];
  mood?: string;
  furnitureList?: string[];
  floorMaterial?: string;
  wallColor?: string;
  ceilingDesign?: string;
  lightingConcept?: string;
}

/** @deprecated Use RoomRenderPlan. Kept for Redis backward compat. */
export type RoomGeminiRenderPlan = RoomRenderPlan;

// ---------------------------------------------------------------------------
// Phase 3 — Room Generation
// ---------------------------------------------------------------------------

export type DesignPhase = "base" | "furniture" | "decor";

export type RenderViewType = "wide" | "detail" | "entrance" | "standard";

export interface RenderResult {
  angleIndex: number;
  angleDescription: string;
  viewType?: RenderViewType;
  base64: string;
  mimeType: string;
  /** OpenAI vision validation did not pass after retries — shown but unconfirmed. */
  notConfirmed?: boolean;
}

export interface MarketplaceMatch {
  marketplaceId: number;
  name: string;
  price: number;
  currency: string;
  url: string;
  imageUrl: string | null;
  sourceMarketplace?: string;
}

export interface MaterialProduct {
  name: string;
  category: string;
  suggestedProduct?: MarketplaceMatch;
}

export interface RoomMaterialSpec {
  wallColor: { ncs: string; hex: string; paintBrand?: string };
  floorMaterial: {
    type: string;
    productName?: string;
    productUrl?: string;
    price?: number;
    /** When floor row maps to scraped_products (exclusive mode resolver) */
    scrapedListing?: MarketplaceMatch;
  };
  tileMaterial?: {
    type: string;
    productName?: string;
    productUrl?: string;
    price?: number;
    imageUrl?: string;
    scrapedListing?: MarketplaceMatch;
  };
  keyFurniture: MaterialProduct[];
}

export function marketplaceMatchFromProductLink(link: ProductPurchaseLink): MarketplaceMatch {
  return {
    marketplaceId: link.id,
    name: link.name,
    price: link.price,
    currency: link.currency,
    url: link.sourceUrl,
    imageUrl: link.imageUrl,
    sourceMarketplace: link.sourceMarketplace || undefined,
  };
}

export function marketplaceMatchesFromMaterialSpec(spec: RoomMaterialSpec | null): MarketplaceMatch[] {
  if (!spec) return [];
  const out: MarketplaceMatch[] = [];
  const seen = new Set<number>();
  const push = (sp: MarketplaceMatch | undefined) => {
    if (!sp || !sp.marketplaceId || sp.marketplaceId <= 0 || seen.has(sp.marketplaceId)) return;
    seen.add(sp.marketplaceId);
    out.push(sp);
  };
  push(spec.floorMaterial.scrapedListing);
  push(spec.tileMaterial?.scrapedListing);
  for (const kf of spec.keyFurniture) push(kf.suggestedProduct);
  return out;
}

export type RoomPhaseStatus = "pending" | "generating" | "review" | "approved";

/** Per-phase interactive state for a single room (mirrors Quick Room's stepper). */
export interface RoomPhaseState {
  /** Each generate / regenerate / edit appends a version. */
  versions: RenderResult[];
  selectedIndex: number;
  status: RoomPhaseStatus;
  /** Catalog SKUs sent to Gemini for this phase. */
  selectedCatalogIds: string[];
  /** Catalog SKUs Claude vision confirmed in the render (+ flooring). */
  confirmedCatalogIds: string[];
  /** Cumulative purchase links (this phase + prior phases). */
  productLinks: ProductPurchaseLink[];
  editHistory: { feedback: string; timestamp: string }[];
}

export interface RoomPhases {
  base: RoomPhaseState;
  furniture: RoomPhaseState;
  decor: RoomPhaseState;
}

export function emptyRoomPhaseState(): RoomPhaseState {
  return {
    versions: [],
    selectedIndex: 0,
    status: "pending",
    selectedCatalogIds: [],
    confirmedCatalogIds: [],
    productLinks: [],
    editHistory: [],
  };
}

export function emptyRoomPhases(): RoomPhases {
  return {
    base: emptyRoomPhaseState(),
    furniture: emptyRoomPhaseState(),
    decor: emptyRoomPhaseState(),
  };
}

export interface RoomResult {
  roomId: string;
  status: RoomReviewStatus;
  brief: RoomDesignBrief;
  renders: RenderResult[];
  materials: RoomMaterialSpec | null;
  editHistory: { feedback: string; timestamp: string }[];
  version: number;
  /** Purchase links for scraped marketplace rows surfaced in materials (esp. Armenia + Local) */
  usedScrapedProducts: MarketplaceMatch[];
  /** Catalog SKUs sent to Gemini for this room render */
  selectedCatalogIds?: string[];
  plannedCatalogIds?: string[];
  /** Per-phase interactive design state (base → furniture → decor). */
  phases?: RoomPhases;
  /** Phase the user is currently working on. */
  currentPhase?: DesignPhase;
  /** Per-viewpoint independent phase tracks (photoId → base/furniture/decor). */
  viewpointPhases?: Record<string, RoomPhases>;
  /** Which viewpoint track is the UI-facing primary (drives `room.phases`). */
  primaryPhotoId?: string;
  /** Per-photo errors from secondary viewpoint renders (photoId → error message). */
  viewpointErrors?: Record<string, string>;
  /** Mapping from photoId to index in `renders` array. */
  photoRenderMap?: Record<string, number>;
  /** Assigned camera targets for this room (hero + secondary photos). */
  viewpointTargetCount?: number;
  /** Photo IDs the user excluded from the render gallery (won't be regenerated). */
  excludedViewpointPhotoIds?: string[];
  /** True after the gallery sync pass has completed (all views regenerated with cross-refs). */
  gallerySyncComplete?: boolean;
  /** Public URL of the Stage 1 geometry-locked neutral base (legacy — Kontext pipeline). */
  lockedBaseUrl?: string;
  /** FAL seed from master angle render — locked for secondary viewpoints. */
  falRenderSeed?: number;
  /** Prompt snapshot from master render — reused for secondary angles. */
  masterRenderPrompt?: string;
  /** Hero photo id when Stage 1 locked base was generated — invalidate cache on change. */
  stage1PhotoId?: string;
  /** Current generation pipeline step (staging path). */
  generationStep?: "idle" | "workspace" | "prep" | "upload" | "shell" | "furnish" | "staging" | "validate" | "complete";
  /** Last room-scoped generation error (not project-wide). */
  generationError?: string;
  generationFailedAt?: string;
  generationAttempt?: number;
  lastSuccessfulStep?: "prep" | "staging";
  /** Last Stage 1 opening validation — used to avoid reusing a bad cached locked base on redo. */
  stage1Validation?: {
    match: boolean;
    reason?: string;
    failureType?: "none" | "count" | "wall" | "size_drift" | "added_opening" | "unknown";
  };
  /** Cached Gemini style reference plate (FAL custom mode). */
  styleReferenceCache?: {
    base64: string;
    mimeType: string;
    cacheKey: string;
    source: "gemini";
  };
  /** Non-blocking warning from last FAL render (structural fallback, style ref failure). */
  lastRenderWarning?: string;
  /** Per-piece wall/adjacency map observed in the master render — injected into secondary prompts. */
  heroPlacementMap?: string;
  /** Decor identity lock (rug, pillows, wall art, etc.) observed in the master render — injected into secondary prompts. */
  heroDecorLock?: string;
  /** Machine-readable corrective feedback from the last failed validation (photoId → feedback), consumed by "Redo this view". */
  lastValidationFeedback?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Phase 4 — Technical Drawings
// ---------------------------------------------------------------------------

export type TechnicalPlanType =
  | "measurement"
  | "furniture_layout"
  | "flooring"
  | "ceiling"
  | "lighting"
  | "electrical"
  | "plumbing"
  | "gas"
  | "hvac";

export interface DimensionAnnotation {
  start: [number, number];
  end: [number, number];
  value: string;
  offset?: number;
}

export interface FurniturePlacement {
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
}

export interface FixturePlacement {
  type: string;
  x: number;
  y: number;
  symbol: string;
}

export interface FlooringZone {
  roomId: string;
  material: string;
  color: string;
  polygon: [number, number][];
  /** wood | tile */
  direction?: "horizontal" | "vertical" | "diagonal";
  tileSize?: string;
}

export interface WalkingPath {
  points: [number, number][];
  label?: string;
}

export interface RoomZone {
  roomId: string;
  label: string;
  polygon: [number, number][];
}

export interface LightingFixture extends FixturePlacement {
  group?: string;
  beamAngle?: number;
}

export interface CircuitGroup {
  id: string;
  label: string;
  fixtureIndices: number[];
}

export interface CeilingZone {
  roomId: string;
  type: string;
  polygon: [number, number][];
}

export interface TechnicalPlanData {
  planType: TechnicalPlanType;
  title: string;
  walls: WallSegment[];
  dimensions?: DimensionAnnotation[];
  furniture?: FurniturePlacement[];
  fixtures?: FixturePlacement[];
  lightingFixtures?: LightingFixture[];
  circuitGroups?: CircuitGroup[];
  flooringZones?: FlooringZone[];
  ceilingZones?: CeilingZone[];
  walkingPaths?: WalkingPath[];
  roomZones?: RoomZone[];
  plumbingFixtures?: PlumbingFixture[];
  pipes?: PipePath[];
  hvacUnits?: HvacUnit[];
  ducts?: DuctPath[];
  doorArcs?: { x: number; y: number; radius: number; startAngle: number; endAngle: number }[];
  windowMarkers?: { x1: number; y1: number; x2: number; y2: number }[];
}

export interface PlumbingFixture {
  type: string;
  x: number;
  y: number;
  label: string;
}

export interface PipePath {
  type: "cold_water" | "hot_water" | "drain" | "gas";
  points: [number, number][];
}

export interface HvacUnit {
  type: string;
  x: number;
  y: number;
  label: string;
}

export interface DuctPath {
  type: "supply" | "return" | "exhaust";
  points: [number, number][];
}

export interface TechnicalDrawingsSet {
  measurement: TechnicalPlanData;
  furnitureLayout: TechnicalPlanData;
  flooring: TechnicalPlanData;
  ceiling: TechnicalPlanData;
  lighting: TechnicalPlanData;
  electrical: TechnicalPlanData;
  plumbing: TechnicalPlanData;
  gas: TechnicalPlanData;
  hvac: TechnicalPlanData;
}

// ---------------------------------------------------------------------------
// Phase 4b — Wall Elevations
// ---------------------------------------------------------------------------

export interface ElevationElement {
  type: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  material?: string;
}

export interface MaterialBand {
  yStart: number;
  yEnd: number;
  material: string;
  color?: string;
}

export interface WallElevation {
  elevationId: string;
  roomId: string;
  roomName: string;
  wallLabel: string;
  wallWidthMm: number;
  wallHeightMm: number;
  elements: ElevationElement[];
  materialBands: MaterialBand[];
  dimensions: DimensionAnnotation[];
}

export interface WallElevationSet {
  elevations: WallElevation[];
}

// ---------------------------------------------------------------------------
// Project state & orchestration
// ---------------------------------------------------------------------------

export interface UserPreferences {
  style: string;
  familyMembers: number;
  budgetTier: BudgetTier;
  wishes: string;
  /** Optional per-room wishes keyed by detected roomId (e.g. "room_1"). */
  roomWishes?: Record<string, string>;
  totalArea?: number;
  address?: string;
  /** ISO-ish country code, e.g. AM — aligns with Vista quick-design country picker */
  countryCode?: string;
  /** Vista shop coverage: local | regional | global */
  searchMode?: string;
  /**
   * Room-design mode (mirrors the Quick Room flow):
   *   "made"   = real catalog products, full base→furniture→decor phased flow.
   *   "custom" = single-phase free imaginary render, no catalog tie, no materials list.
   * Absent is treated as "custom".
   */
  designMode?: "made" | "custom";
}

const ROOM_WISH_MAX_CHARS = 500;

/** Parse `roomWishes` (roomId → free text): strings only, trimmed, empties dropped. */
function parseRoomWishes(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [roomId, wish] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof wish !== "string") continue;
    const trimmed = wish.trim().slice(0, ROOM_WISH_MAX_CHARS);
    if (trimmed) out[roomId] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Parse client preferences JSON for project create / concept routes. */
export function parseUserPreferences(raw: unknown): UserPreferences {
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const designModeRaw = parsed.designMode;
  const designMode = resolveDesignMode(
    designModeRaw === "custom" || designModeRaw === "made" ? designModeRaw : undefined,
  );

  return {
    style: typeof parsed.style === "string" ? parsed.style : "modern-neutral",
    familyMembers: typeof parsed.familyMembers === "number" ? parsed.familyMembers : 2,
    budgetTier: (["economy", "mid", "premium", "luxury"].includes(String(parsed.budgetTier))
      ? parsed.budgetTier
      : "mid") as BudgetTier,
    wishes: typeof parsed.wishes === "string" ? parsed.wishes : "",
    roomWishes: parseRoomWishes(parsed.roomWishes),
    totalArea: typeof parsed.totalArea === "number" ? parsed.totalArea : undefined,
    address: typeof parsed.address === "string" ? parsed.address : undefined,
    countryCode: typeof parsed.countryCode === "string" ? parsed.countryCode : undefined,
    searchMode: typeof parsed.searchMode === "string" ? parsed.searchMode : undefined,
    designMode,
  };
}

export interface RoomPhoto {
  roomId: string;
  base64: string;
  mimeType: string;
}

export interface ProjectInput {
  floorPlanBase64: string;
  floorPlanMimeType: string;
  preferences: UserPreferences;
  roomPhotos?: RoomPhoto[];
  pinnedProductIds?: number[];
  inspirationUploads?: Array<{ base64: string; mimeType: string; label: string }>;
}

/** Summary of an approved room design for cross-room consistency. */
export interface ApprovedDesignSummary {
  roomName: string;
  roomType: string;
  style: string;
  wallColorHex: string;
  wallColorNcs: string;
  floorMaterial: string;
  furnitureList: string[];
  keyDesignElements: string[];
  lightingConcept: string;
  materialChoices: string;
  renderDescription: string;
}

export type StructuralMemberType = "column" | "post" | "pier" | "beam";

export interface ViewpointStructuralMember {
  type: StructuralMemberType;
  /** Camera-relative: left | center | right | foreground | mid-room */
  position: string;
  confidence: "high" | "medium" | "low";
  bbox?: { x: number; y: number; w: number; h: number };
  /** Debug/logs only — not used in FAL render prompts. */
  description?: string;
}

/** Photo-verified structural observations from OpenAI viewpoint analysis. */
export interface ViewpointPhotoAnalysis {
  walls: Array<{
    position: "left" | "center" | "right" | "partial-left" | "partial-right";
    compass: string;
    openings: Array<{
      type: "window" | "door";
      placementAlongWall: string;
      confirmed: boolean;
      /** Normalized (0–1) photo bounding box of the opening, top-left origin. */
      bbox?: { x: number; y: number; w: number; h: number };
    }>;
    features: string[];
    currentFinish: string;
  }>;
  ceiling: { type: string; features: string[] };
  floor: { currentFinish: string };
  structuralNotes: string;
  /** Freestanding structural members visible in the photo (FAL column preserve path). */
  structuralMembers: ViewpointStructuralMember[];
}

/** Gated photo-confirmed columns/posts for FAL pipeline (separate from plan structural_elements). */
export interface PhotoConfirmedStructuralElement {
  type: StructuralMemberType;
  position: string;
  label: string;
  bbox: { x: number; y: number; w: number; h: number };
}

/** Client-side photo with optional room assignment from analysis. */
export interface ProjectUploadedPhoto {
  id: string;
  base64: string;
  mimeType: string;
  label: string;
  roomId?: string;
  confidence?: "high" | "medium" | "low";
  /** Camera position + facing direction within the room (optional, user-set). */
  viewpoint?: PhotoViewpoint;
  /** Cached viewpoint-grounded photo analysis (computed lazily, once). */
  viewpointAnalysis?: ViewpointPhotoAnalysis;
  /** Pro mode — user-drawn structural boundary line map for FAL ControlNet. */
  structuralLineMap?: { base64: string; mimeType: string; strokeOnly?: boolean };
  /** Pro mode — user-marked regions to clear before redesign. */
  objectRemovalMask?: { base64: string; mimeType: string };
  /** After inpaint prep — cleared room photo for apartment-staging. */
  prepBase64?: string;
  prepMimeType?: string;
  /** After shell pass — finishes applied, no furniture (layered staging). */
  shellBase64?: string;
  shellMimeType?: string;
  /** Cached vision-detected opening boxes for FAL freeze-mask inpainting. */
  openingAnalysis?: {
    window_boxes: OpeningBox[];
    door_boxes: OpeningBox[];
  };
}

export interface ProjectState {
  id: string;
  status: ProjectStatus;
  preferences: UserPreferences;
  floorPlanBase64: string;
  floorPlanMimeType: string;
  analysis: FloorPlanAnalysis | null;
  concept: MasterDesignConcept | null;
  /** Claude-composed per-room render prompts (floor plan → text, one batch at concept time). */
  roomRenderPlans: Record<string, RoomRenderPlan> | null;
  rooms: RoomResult[];
  currentRoomIndex: number;
  technicalDrawings: TechnicalDrawingsSet | null;
  wallElevations: WallElevationSet | null;
  pdfBase64: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** roomId → reference photo for grounded renders */
  roomPhotos: Record<string, { base64: string; mimeType: string }>;
  /** All uploaded photos with metadata (for floor plan review UI) */
  uploadedPhotos: ProjectUploadedPhoto[];
  /** roomId → scraped_product ids used for Gemini / materials lock */
  scrapedRoomAllowlists: Record<string, number[]> | null;
  /** User-pinned marketplace product ids (design board / inspiration catalog picks) */
  pinnedProductIds: number[];
  /** Inspiration product images for Gemini collage reference */
  inspirationUploads: Array<{ base64: string; mimeType: string; label: string }>;
  /** Claude-suggested room design order (hallway/entrance first when present) */
  suggestedRoomOrder: string[];
  /** Approved room summaries for cross-room design consistency */
  approvedDesignSummaries: Record<string, ApprovedDesignSummary>;
  /** Whether user confirmed floor plan after review */
  floorPlanConfirmed: boolean;
  /** User-confirmed utility entry points (water, electrical, gas). */
  utilityEntryPoints: UtilityEntryPoint[];
  /** User locale for PDF generation (hy | en | ru). */
  locale?: string;
  /** Linked Laravel design_projects.id for PDF persistence. */
  laravelProjectId?: number | null;
  /** Single overview render when user uploaded a floor plan with no room photos. */
  furnishedPlanRender?: { base64: string; mimeType: string } | null;
  furnishedPlanStatus?: FurnishedPlanStatus;
  furnishedPlanError?: string | null;
}

export type FurnishedPlanStatus = "pending" | "generating" | "review" | "error";

/** True when the project has zero uploaded room photos (floor-plan-only path). */
export function isPlanOnlyProject(state: Pick<ProjectState, "uploadedPhotos">): boolean {
  return (state.uploadedPhotos?.length ?? 0) === 0;
}

export function getRoomPhoto(
  state: ProjectState,
  roomId: string,
): { base64: string; mimeType: string } | undefined {
  return state.roomPhotos[roomId];
}

export interface RoomPhotoWithViewpoint {
  id: string;
  base64: string;
  mimeType: string;
  label: string;
  viewpoint?: PhotoViewpoint;
  structuralLineMap?: { base64: string; mimeType: string; strokeOnly?: boolean };
  objectRemovalMask?: { base64: string; mimeType: string };
  prepBase64?: string;
  prepMimeType?: string;
  shellBase64?: string;
  shellMimeType?: string;
  openingAnalysis?: {
    window_boxes: OpeningBox[];
    door_boxes: OpeningBox[];
  };
}

/**
 * All photos the user assigned to a room, each with its (optional) camera
 * viewpoint. Photos that carry a viewpoint are ordered first, so index 0 is the
 * best "primary" reference. Reads from `uploadedPhotos` (the full set) rather
 * than `roomPhotos` (which only ever holds a single collapsed photo per room).
 */
export function getRoomPhotos(
  state: ProjectState,
  roomId: string,
): RoomPhotoWithViewpoint[] {
  return state.uploadedPhotos
    .filter((p) => p.roomId === roomId && p.base64)
    .map((p) => ({
      id: p.id,
      base64: p.base64,
      mimeType: p.mimeType,
      label: p.label,
      viewpoint: p.viewpoint,
      structuralLineMap: p.structuralLineMap,
      objectRemovalMask: p.objectRemovalMask,
      openingAnalysis: p.openingAnalysis,
      prepBase64: p.prepBase64,
      prepMimeType: p.prepMimeType,
      shellBase64: p.shellBase64,
      shellMimeType: p.shellMimeType,
    }))
    .sort((a, b) => (b.viewpoint ? 1 : 0) - (a.viewpoint ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Room edit / action
// ---------------------------------------------------------------------------

export interface RoomEditRequest {
  projectId: string;
  roomId: string;
  action: "approve" | "regenerate" | "edit";
  editFeedback?: string;
  /** User drew on a render to highlight the area to change (red strokes). */
  editAnnotation?: EditAnnotation;
}

/** Marked region on an approved render — sent to Gemini as a visual edit reference. */
export interface EditAnnotation {
  base64: string;
  mimeType: string;
  /** Which render (0-based) the user marked; omitted for single-view rooms. */
  renderIndex?: number;
}

// ---------------------------------------------------------------------------
// Progress events (SSE / UI)
// ---------------------------------------------------------------------------

export type ProgressPhase =
  | ProjectStatus
  | "floor_plan"
  | "master_concept"
  | "complete"
  | "error"
  | "preparing"
  | "generating"
  | "materials";

export interface ProgressEvent {
  phase: ProgressPhase;
  message: string;
  code?: string;
  room?: string;
  progress?: number;
  angleIndex?: number;
  data?: unknown;
}
