import { create } from "zustand";
import { clearSession, clearSessionBlobs } from "@/lib/project/sessionStorage";
import {
  type SupportedCountry,
  SUPPORTED_COUNTRIES_FALLBACK,
} from "@/lib/supportedCountriesFallback";
import { resolveDesignMode } from "@/lib/designModeConfig";
import type {
  FloorPlanAnalysis,
  DetectedRoom,
  MasterDesignConcept,
  RoomResult,
  UserPreferences,
  BudgetTier,
  UtilityEntryPoint,
  PhotoViewpoint,
} from "@/lib/project/types";
import { quickRoomNeedsMandatorySpatialClarification, type RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import type { DesignPhase } from "@/lib/phaseRouter";

export interface MarketplaceProduct {
  id: number;
  source_marketplace: string;
  external_url: string;
  name: string;
  name_en: string | null;
  price: number;
  currency: string;
  main_image_url: string | null;
  images: string[] | null;
  width_cm: number | null;
  depth_cm: number | null;
  height_cm: number | null;
  has_dimensions: boolean;
  category: string | null;
  category_en: string | null;
  brand: string | null;
  /** Lower values rank higher in the sidebar; null = no manual ranking. */
  priority: number | null;
  product_family?: string | null;
  product_subtype?: string | null;
}

export interface LiveSearchProduct {
  name: string;
  price: number;
  currency: string;
  old_price: number | null;
  product_url: string;
  image_url: string | null;
  source_marketplace: string;
  source_key: string;
  in_stock: boolean | null;
  brand: string | null;
  category: string | null;
  rating: number | null;
  review_count: number | null;
  width_cm: string | null;
  depth_cm: string | null;
  height_cm: string | null;
}

export interface LiveSearchSource {
  key: string;
  name: string;
  logo: string | null;
  count: number;
  elapsed_ms: number;
  status: string;
  error?: string;
}

export type { SupportedCountry };

export type SearchMode = "local" | "regional" | "global";

export interface DesignBriefResult {
  subject: string;
  style: string;
  arrangement: string;
  fullPrompt: string;
  roomType: string;
  cameraAngle: string;
  composition?: string;
  doorDesign?: string;
}

export interface DesignVersion {
  id: string;
  imageBase64: string;
  imageMimeType: string;
  brief: DesignBriefResult | null;
  feedback: string | null;
  timestamp: number;
}

export interface PhaseVersion {
  id: string;
  image: { base64: string; mimeType: string };
  products: string[];
  timestamp: number;
}

type PhaseVersionFields = {
  versionsKey: "phase1Versions" | "phase2Versions" | "phase3Versions";
  indexKey: "phase1SelectedIndex" | "phase2SelectedIndex" | "phase3SelectedIndex";
};

function phaseVersionFields(phase: DesignPhase): PhaseVersionFields {
  switch (phase) {
    case "base":
      return { versionsKey: "phase1Versions", indexKey: "phase1SelectedIndex" };
    case "furniture":
      return { versionsKey: "phase2Versions", indexKey: "phase2SelectedIndex" };
    case "decor":
      return { versionsKey: "phase3Versions", indexKey: "phase3SelectedIndex" };
  }
}

export function getPhaseVersions(
  state: Pick<
    ConsumerDesignState,
    "phase1Versions" | "phase2Versions" | "phase3Versions"
  >,
  phase: DesignPhase,
): PhaseVersion[] {
  const { versionsKey } = phaseVersionFields(phase);
  return state[versionsKey];
}

export function getSelectedPhaseVersion(
  state: Pick<
    ConsumerDesignState,
    | "phase1Versions"
    | "phase2Versions"
    | "phase3Versions"
    | "phase1SelectedIndex"
    | "phase2SelectedIndex"
    | "phase3SelectedIndex"
  >,
  phase: DesignPhase,
): PhaseVersion | null {
  const { versionsKey, indexKey } = phaseVersionFields(phase);
  const versions = state[versionsKey];
  if (versions.length === 0) return null;
  const index = Math.min(Math.max(0, state[indexKey]), versions.length - 1);
  return versions[index] ?? null;
}

export function getSelectedPhaseImage(
  state: Parameters<typeof getSelectedPhaseVersion>[0],
  phase: DesignPhase,
): { base64: string; mimeType: string } | null {
  return getSelectedPhaseVersion(state, phase)?.image ?? null;
}

export function getSelectedPhaseProducts(
  state: Parameters<typeof getSelectedPhaseVersion>[0],
  phase: DesignPhase,
): string[] {
  return getSelectedPhaseVersion(state, phase)?.products ?? [];
}

export interface ApprovedRoom {
  id: string;
  roomImageBase64: string;
  roomImageMimeType: string;
  designImageBase64: string;
  designImageMimeType: string;
  brief: DesignBriefResult | null;
  versions: DesignVersion[];
  plans: TechnicalPlan[];
  timestamp: number;
}

export interface TechnicalPlan {
  key: string;
  title: string;
  titleRu: string;
  svg: string | null;
}

export interface ProductPurchaseLink {
  id: number;
  name: string;
  price: number;
  currency: string;
  sourceUrl: string;
  sourceMarketplace: string;
  imageUrl: string | null;
  dimensions: string | null;
  category?: string | null;
}

export interface InspirationProduct {
  id: string;
  base64: string | null;
  mimeType: string | null;
  url: string | null;
  label: string;
  thumbnailUrl: string | null;
}

/** @deprecated Project custom mode uses style reference photos capped at MAX_STYLE_REFERENCE_PHOTOS. */
export const MAX_INSPIRATION_PRODUCTS = 10;

/** Style reference photos for FAL Kontext (mood, palette, wardrobe — not room geometry). */
export const MAX_STYLE_REFERENCE_PHOTOS = 4;

export interface StyleInspirationImage {
  id: string;
  base64: string;
  mimeType: string;
}

export const MAX_STYLE_INSPIRATIONS = 4;

export type VistaMode = "quick" | "project";

export type ProjectStep =
  | "upload"
  | "designBrief"
  /** OpenAI floor-plan vision (`create-stream`). Legacy sessions may still store `"analyzing"`. */
  | "analyzingFloorPlan"
  /** Claude design concept (`create-concept-stream`). */
  | "creatingConcept"
  | "floorPlanReview"
  | "rooms"
  | "finalizing"
  | "complete";

export type ProjectHubView = "floorPlan" | "roomDesign";

export interface UploadedRoomPhoto {
  id: string;
  base64: string;
  mimeType: string;
  label: string;
  matchedRoomId: string | null;
  matchConfidence: "high" | "medium" | "low" | null;
  /** Camera position + facing direction within the matched room (optional, user-set). */
  viewpoint?: PhotoViewpoint;
  /** Pro mode — user-drawn structural boundary lines for FAL ControlNet. */
  structuralLineMap?: { base64: string; mimeType: string; strokeOnly?: boolean };
  /** Pro mode — regions to clear (furniture/debris) before redesign. */
  objectRemovalMask?: { base64: string; mimeType: string };
  /** Optional door/window boxes to preserve during object-removal prep. */
  openingAnalysis?: {
    window_boxes: Array<{ x: number; y: number; w: number; h: number }>;
    door_boxes: Array<{ x: number; y: number; w: number; h: number }>;
  };
}

export interface ProjectConceptSummary {
  projectName: string;
  overallStyle: string;
  colorPalette: MasterDesignConcept["colorPalette"];
  materialPalette: MasterDesignConcept["materialPalette"];
  roomCount: number;
  roomNames: { id: string; name: string; type: string }[];
}

export { type FloorPlanAnalysis, type RoomResult, type UserPreferences, type BudgetTier, type PhotoViewpoint };

export interface SavedProjectSummary {
  id: string;
  mode: "quick_room" | "project";
  title: string;
  coverImageUrl: string | null;
  orchestratorProjectId: string | null;
  style: string | null;
  messageCount: number;
  versionCount: number;
  lastInteractionAt: string | null;
  createdAt: string | null;
}

interface ConsumerDesignState {
  searchQuery: string;
  searchResults: MarketplaceProduct[];
  searchLoading: boolean;

  // Live search (multi-country)
  selectedCountry: string;
  searchMode: SearchMode;
  liveSearchResults: LiveSearchProduct[];
  liveSearchSources: LiveSearchSource[];
  liveSearchLoading: boolean;
  supportedCountries: SupportedCountry[];
  countryDetected: boolean;

  selectedProducts: MarketplaceProduct[];

  roomImageBase64: string | null;
  roomImageMimeType: string | null;
  /** Additional room angles for Quick Room mode (up to 3, alongside the primary image). */
  quickRoomExtraPhotos: Array<{ id: string; base64: string; mimeType: string }>;

  /** Vision analysis for Quick Room — attached to `/api/interior-design/generate` as structured lock. */
  quickRoomAnalysis: RoomAnalysis | null;
  quickRoomAnalyzing: boolean;
  quickRoomAnalyzeError: string | null;
  /** Mandatory check when spatial confidence includes `"low"` */
  quickRoomFactsConfirmed: boolean;

  textPrompt: string;
  selectedStyle: string;
  /** Room-design mode: "made" = real catalog products (phased), "custom" = free imaginary render. */
  designMode: "made" | "custom";

  generatedImageBase64: string | null;
  generatedImageMimeType: string | null;
  designBrief: DesignBriefResult | null;
  designHistory: DesignVersion[];
  lastRoomGeometry: RoomGeometry | null;
  lastGeometryExtractionFailed: boolean;
  isGenerating: boolean;
  error: string | null;

  productLinks: ProductPurchaseLink[];
  /** SKU rows the model selected (scraped_products) — preferred for "products in this design" */
  usedScrapedProducts: ProductPurchaseLink[];

  technicalPlans: TechnicalPlan[];
  isGeneratingPlans: boolean;

  approvedRooms: ApprovedRoom[];

  inspirationProducts: InspirationProduct[];
  styleInspirations: StyleInspirationImage[];

  tokenBalance: number | null;

  // --- Phased design ---
  phasedDesignActive: boolean;
  phasedCurrentPhase: DesignPhase | "idle" | "complete";
  phasedStatus: "idle" | "selecting" | "generating" | "validating" | "retrying" | "done" | "error";
  phasedRetryCount: number;
  phase1Versions: PhaseVersion[];
  phase1SelectedIndex: number;
  phase2Versions: PhaseVersion[];
  phase2SelectedIndex: number;
  phase3Versions: PhaseVersion[];
  phase3SelectedIndex: number;
  phasedAllProductLinks: ProductPurchaseLink[];
  phasedError: string | null;
  /** Complete confirmed product set across all phases — fed to the extra-viewpoint renders. */
  phasedAllProductIds: string[];
  /** Final result images, one per uploaded room photo (primary first). Length > 1 => gallery. */
  phasedFinalViews: Array<{ id: string; base64: string; mimeType: string }>;
  /** Per-viewpoint independent phase tracks (Quick Room). Key: "primary" or extra photo id. */
  viewpointTracks: Record<string, {
    phase1Versions: PhaseVersion[];
    phase1SelectedIndex: number;
    phase2Versions: PhaseVersion[];
    phase2SelectedIndex: number;
    phase3Versions: PhaseVersion[];
    phase3SelectedIndex: number;
  }>;

  // --- Project mode ---
  vistaMode: VistaMode;
  projectStep: ProjectStep;
  floorPlanBase64: string | null;
  floorPlanMimeType: string | null;
  roomPhotos: UploadedRoomPhoto[];
  projectPreferences: UserPreferences;
  projectId: string | null;
  projectAnalysis: FloorPlanAnalysis | null;
  projectConcept: ProjectConceptSummary | null;
  projectRooms: RoomResult[];
  currentProjectRoomIndex: number;
  projectLoading: boolean;
  projectError: string | null;
  hasPdf: boolean;
  projectSuggestedRoomOrder: string[];
  selectedFloorPlanRoomId: string | null;
  projectHubView: ProjectHubView;
  activeDesignRoomId: string | null;
  projectAnalysisProgress: number;
  projectAnalysisMessage: string;
  projectUtilityEntryPoints: UtilityEntryPoint[];
  /** Rooms the user traced in the upload-step "Draw plan" editor (seed for analysis). */
  projectDraftRooms: DetectedRoom[];

  // --- Saved projects (persistence) ---
  currentProjectDbId: string | null;
  savedProjects: SavedProjectSummary[];
  savedProjectsLoading: boolean;

  setVistaMode: (mode: VistaMode) => void;
  setProjectStep: (step: ProjectStep) => void;
  setFloorPlan: (base64: string | null, mimeType: string | null) => void;
  addRoomPhoto: (
    base64: string,
    mimeType: string,
    label?: string,
    opts?: { matchedRoomId?: string },
  ) => string;
  removeRoomPhoto: (id: string) => void;
  updateRoomPhotoLabel: (id: string, label: string) => void;
  setPhotoRoomMatch: (photoId: string, roomId: string | null) => void;
  setPhotoStructuralLineMap: (
    photoId: string,
    lineMap: { base64: string; mimeType: string; strokeOnly?: boolean } | null,
  ) => void;
  setPhotoObjectRemovalMask: (
    photoId: string,
    mask: { base64: string; mimeType: string } | null,
  ) => void;
  setPhotoOpeningAnalysis: (
    photoId: string,
    analysis: UploadedRoomPhoto["openingAnalysis"] | null,
  ) => void;
  setPhotoViewpoint: (photoId: string, viewpoint: PhotoViewpoint | null) => void;
  setProjectPreferences: (prefs: Partial<UserPreferences>) => void;
  setProjectData: (data: {
    id: string;
    analysis?: FloorPlanAnalysis | null;
    concept?: ProjectConceptSummary | null;
    rooms?: RoomResult[];
    currentRoomIndex?: number;
    error?: string | null;
    hasPdf?: boolean;
    suggestedRoomOrder?: string[];
    utilityEntryPoints?: UtilityEntryPoint[];
  }) => void;
  setProjectRooms: (
    rooms: RoomResult[] | ((prev: RoomResult[]) => RoomResult[]),
  ) => void;
  setCurrentProjectRoomIndex: (index: number) => void;
  setProjectLoading: (loading: boolean) => void;
  setProjectError: (error: string | null) => void;
  setHasPdf: (has: boolean) => void;
  setProjectAnalysis: (analysis: FloorPlanAnalysis | null) => void;
  setSelectedFloorPlanRoomId: (roomId: string | null) => void;
  setProjectSuggestedRoomOrder: (order: string[]) => void;
  setProjectHubView: (view: ProjectHubView) => void;
  setActiveDesignRoomId: (roomId: string | null) => void;
  setProjectAnalysisProgress: (progress: number, message?: string) => void;
  setProjectUtilityEntryPoints: (points: UtilityEntryPoint[]) => void;
  setProjectDraftRooms: (rooms: DetectedRoom[]) => void;
  resetProject: () => void;

  setSearchQuery: (q: string) => void;
  setSearchResults: (results: MarketplaceProduct[]) => void;
  setSearchLoading: (loading: boolean) => void;
  setSelectedCountry: (country: string) => void;
  setSearchMode: (mode: SearchMode) => void;
  setLiveSearchResults: (results: LiveSearchProduct[]) => void;
  setLiveSearchSources: (sources: LiveSearchSource[]) => void;
  setLiveSearchLoading: (loading: boolean) => void;
  setSupportedCountries: (countries: SupportedCountry[]) => void;
  setCountryDetected: (detected: boolean) => void;
  addProduct: (product: MarketplaceProduct) => void;
  removeProduct: (id: number) => void;
  setRoomImage: (base64: string | null, mimeType: string | null) => void;
  addQuickRoomExtraPhoto: (base64: string, mimeType: string) => void;
  removeQuickRoomExtraPhoto: (id: string) => void;
  setQuickRoomAnalysis: (analysis: RoomAnalysis | null) => void;
  setQuickRoomAnalyzing: (v: boolean) => void;
  setQuickRoomAnalyzeError: (error: string | null) => void;
  setQuickRoomFactsConfirmed: (v: boolean) => void;

  setTextPrompt: (prompt: string) => void;
  setSelectedStyle: (style: string) => void;
  setDesignMode: (mode: "made" | "custom") => void;
  setGeneratedImage: (base64: string | null, mimeType: string | null) => void;
  setDesignBrief: (brief: DesignBriefResult | null) => void;
  setDesignHistory: (history: DesignVersion[]) => void;
  pushDesignVersion: (version: DesignVersion) => void;
  restoreDesignVersion: (versionId: string) => void;
  setLastRoomGeometry: (geometry: RoomGeometry | null, failed: boolean) => void;
  setIsGenerating: (generating: boolean) => void;
  setError: (error: string | null) => void;
  setProductLinks: (links: ProductPurchaseLink[]) => void;
  setUsedScrapedProducts: (links: ProductPurchaseLink[]) => void;
  addInspirationProduct: (product: Omit<InspirationProduct, "id">) => void;
  removeInspirationProduct: (id: string) => void;
  updateInspirationProductLabel: (id: string, label: string) => void;
  clearInspirationProducts: () => void;
  addStyleInspiration: (image: Omit<StyleInspirationImage, "id">) => void;
  removeStyleInspiration: (id: string) => void;
  clearStyleInspirations: () => void;
  setTechnicalPlans: (plans: TechnicalPlan[]) => void;
  setIsGeneratingPlans: (generating: boolean) => void;
  acceptAndContinue: () => void;
  setTokenBalance: (balance: number | null) => void;
  setCurrentProjectDbId: (id: string | null) => void;
  setSavedProjects: (projects: SavedProjectSummary[]) => void;
  setSavedProjectsLoading: (loading: boolean) => void;

  // --- Phased design actions ---
  startPhasedDesign: () => void;
  setPhasedPhase: (phase: DesignPhase | "idle" | "complete") => void;
  setPhasedStatus: (status: "idle" | "selecting" | "generating" | "validating" | "retrying" | "done" | "error") => void;
  setPhasedRetryCount: (count: number) => void;
  pushPhaseVersion: (phase: DesignPhase, version: PhaseVersion) => void;
  setPhaseSelectedIndex: (phase: DesignPhase, index: number) => void;
  approvePhase: (phase: DesignPhase) => void;
  setPhaseResult: (phase: DesignPhase, image: { base64: string; mimeType: string }, products: string[]) => void;
  setPhasedAllProductLinks: (links: ProductPurchaseLink[]) => void;
  setPhasedAllProductIds: (ids: string[]) => void;
  setPhasedFinalViews: (views: Array<{ id: string; base64: string; mimeType: string }>) => void;
  clearPhasedFinalViews: () => void;
  removePhasedFinalView: (id: string) => void;
  setViewpointTrackResult: (trackId: string, phase: DesignPhase, version: PhaseVersion) => void;
  setPhasedError: (error: string | null) => void;
  resetPhasedDesign: () => void;

  reset: () => void;
}

function appendPhaseVersion(
  s: ConsumerDesignState,
  phase: DesignPhase,
  version: PhaseVersion,
): Partial<ConsumerDesignState> {
  const { versionsKey, indexKey } = phaseVersionFields(phase);
  const nextVersions = [...s[versionsKey], version];
  return {
    [versionsKey]: nextVersions,
    [indexKey]: nextVersions.length - 1,
    phasedStatus: "done",
  } as Partial<ConsumerDesignState>;
}

const initialState = {
  searchQuery: "",
  searchResults: [] as MarketplaceProduct[],
  searchLoading: false,
  selectedCountry: "AM",
  searchMode: "local" as SearchMode,
  liveSearchResults: [] as LiveSearchProduct[],
  liveSearchSources: [] as LiveSearchSource[],
  liveSearchLoading: false,
  supportedCountries: SUPPORTED_COUNTRIES_FALLBACK,
  countryDetected: true,
  selectedProducts: [] as MarketplaceProduct[],
  roomImageBase64: null as string | null,
  roomImageMimeType: null as string | null,
  quickRoomExtraPhotos: [] as Array<{ id: string; base64: string; mimeType: string }>,
  quickRoomAnalysis: null as RoomAnalysis | null,
  quickRoomAnalyzing: false,
  quickRoomAnalyzeError: null as string | null,
  quickRoomFactsConfirmed: false,
  textPrompt: "",
  selectedStyle: "modern",
  designMode: "custom" as "made" | "custom",
  generatedImageBase64: null as string | null,
  generatedImageMimeType: null as string | null,
  designBrief: null as DesignBriefResult | null,
  designHistory: [] as DesignVersion[],
  lastRoomGeometry: null as RoomGeometry | null,
  lastGeometryExtractionFailed: false,
  isGenerating: false,
  error: null as string | null,
  productLinks: [] as ProductPurchaseLink[],
  usedScrapedProducts: [] as ProductPurchaseLink[],
  technicalPlans: [] as TechnicalPlan[],
  isGeneratingPlans: false,
  approvedRooms: [] as ApprovedRoom[],
  inspirationProducts: [] as InspirationProduct[],
  styleInspirations: [] as StyleInspirationImage[],
  tokenBalance: null as number | null,
  // --- Phased design ---
  phasedDesignActive: false,
  phasedCurrentPhase: "idle" as DesignPhase | "idle" | "complete",
  phasedStatus: "idle" as "idle" | "selecting" | "generating" | "validating" | "retrying" | "done" | "error",
  phasedRetryCount: 0,
  phase1Versions: [] as PhaseVersion[],
  phase1SelectedIndex: 0,
  phase2Versions: [] as PhaseVersion[],
  phase2SelectedIndex: 0,
  phase3Versions: [] as PhaseVersion[],
  phase3SelectedIndex: 0,
  phasedAllProductLinks: [] as ProductPurchaseLink[],
  phasedError: null as string | null,
  phasedAllProductIds: [] as string[],
  phasedFinalViews: [] as Array<{ id: string; base64: string; mimeType: string }>,
  viewpointTracks: {} as Record<string, {
    phase1Versions: PhaseVersion[];
    phase1SelectedIndex: number;
    phase2Versions: PhaseVersion[];
    phase2SelectedIndex: number;
    phase3Versions: PhaseVersion[];
    phase3SelectedIndex: number;
  }>,
  // --- Project mode ---
  vistaMode: "quick" as VistaMode,
  projectStep: "upload" as ProjectStep,
  floorPlanBase64: null as string | null,
  floorPlanMimeType: null as string | null,
  roomPhotos: [] as UploadedRoomPhoto[],
  projectPreferences: {
    style: "modern-neutral",
    familyMembers: 2,
    budgetTier: "mid" as BudgetTier,
    wishes: "",
    designMode: "custom",
  } as UserPreferences,
  projectId: null as string | null,
  projectAnalysis: null as FloorPlanAnalysis | null,
  projectConcept: null as ProjectConceptSummary | null,
  projectRooms: [] as RoomResult[],
  currentProjectRoomIndex: 0,
  projectLoading: false,
  projectError: null as string | null,
  hasPdf: false,
  projectSuggestedRoomOrder: [] as string[],
  selectedFloorPlanRoomId: null as string | null,
  projectHubView: "floorPlan" as ProjectHubView,
  activeDesignRoomId: null as string | null,
  projectAnalysisProgress: 0,
  projectAnalysisMessage: "",
  projectDraftRooms: [] as DetectedRoom[],
  projectUtilityEntryPoints: [] as UtilityEntryPoint[],
  // --- Saved projects ---
  currentProjectDbId: null as string | null,
  savedProjects: [] as SavedProjectSummary[],
  savedProjectsLoading: false,
};

export const useConsumerDesignStore = create<ConsumerDesignState>((set) => ({
  ...initialState,

  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSearchLoading: (loading) => set({ searchLoading: loading }),
  setSelectedCountry: (country) => set({ selectedCountry: country }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  setLiveSearchResults: (results) => set({ liveSearchResults: results }),
  setLiveSearchSources: (sources) => set({ liveSearchSources: sources }),
  setLiveSearchLoading: (loading) => set({ liveSearchLoading: loading }),
  setSupportedCountries: (countries) => set({ supportedCountries: countries }),
  setCountryDetected: (detected) => set({ countryDetected: detected }),

  addProduct: (product) =>
    set((s) => {
      const duplicate = s.selectedProducts.some(
        (p) =>
          p.id === product.id ||
          (!!product.external_url && product.external_url === p.external_url),
      );
      if (duplicate) return s;
      return { selectedProducts: [...s.selectedProducts, product] };
    }),

  removeProduct: (id) =>
    set((s) => ({
      selectedProducts: s.selectedProducts.filter((p) => p.id !== id),
    })),

  setRoomImage: (base64, mimeType) =>
    set({
      roomImageBase64: base64,
      roomImageMimeType: mimeType,
      quickRoomExtraPhotos: [],
      quickRoomAnalysis: null,
      quickRoomAnalyzing: false,
      quickRoomAnalyzeError: null,
      quickRoomFactsConfirmed: false,
      lastRoomGeometry: null,
      lastGeometryExtractionFailed: false,
    }),

  addQuickRoomExtraPhoto: (base64, mimeType) =>
    set((s) => {
      if (s.quickRoomExtraPhotos.length >= 5) return s;
      return {
        quickRoomExtraPhotos: [
          ...s.quickRoomExtraPhotos,
          { id: `qre-${Date.now()}-${Math.random().toString(36).slice(2)}`, base64, mimeType },
        ],
      };
    }),

  removeQuickRoomExtraPhoto: (id) =>
    set((s) => ({ quickRoomExtraPhotos: s.quickRoomExtraPhotos.filter((p) => p.id !== id) })),

  setQuickRoomAnalysis: (analysis) =>
    set({
      quickRoomAnalysis: analysis,
      quickRoomFactsConfirmed: !!(analysis && !quickRoomNeedsMandatorySpatialClarification(analysis)),
    }),

  setQuickRoomAnalyzing: (v) => set({ quickRoomAnalyzing: v }),

  setQuickRoomAnalyzeError: (error) => set({ quickRoomAnalyzeError: error }),

  setQuickRoomFactsConfirmed: (v) => set({ quickRoomFactsConfirmed: v }),

  setTextPrompt: (prompt) => set({ textPrompt: prompt }),
  setSelectedStyle: (style) => set({ selectedStyle: style }),
  setDesignMode: (mode) => set({ designMode: resolveDesignMode(mode) }),

  setGeneratedImage: (base64, mimeType) =>
    set({ generatedImageBase64: base64, generatedImageMimeType: mimeType }),

  setDesignBrief: (brief) => set({ designBrief: brief }),
  setDesignHistory: (history) => set({ designHistory: history }),
  pushDesignVersion: (version) =>
    set((s) => ({ designHistory: [version, ...s.designHistory] })),
  restoreDesignVersion: (versionId) =>
    set((s) => {
      const target = s.designHistory.find((v) => v.id === versionId);
      if (!target) return s;
      const currentVersion: DesignVersion | null =
        s.generatedImageBase64 && s.generatedImageMimeType
          ? {
              id: `v-${Date.now()}`,
              imageBase64: s.generatedImageBase64,
              imageMimeType: s.generatedImageMimeType,
              brief: s.designBrief,
              feedback: null,
              timestamp: Date.now(),
            }
          : null;
      const historyWithoutTarget = s.designHistory.filter((v) => v.id !== versionId);
      const newHistory = currentVersion
        ? [currentVersion, ...historyWithoutTarget]
        : historyWithoutTarget;
      return {
        generatedImageBase64: target.imageBase64,
        generatedImageMimeType: target.imageMimeType,
        designBrief: target.brief,
        designHistory: newHistory,
      };
    }),
  setLastRoomGeometry: (geometry, failed) =>
    set({ lastRoomGeometry: geometry, lastGeometryExtractionFailed: failed }),
  setIsGenerating: (generating) => set({ isGenerating: generating }),
  setError: (error) => set({ error }),
  setProductLinks: (links) => set({ productLinks: links }),
  setUsedScrapedProducts: (links) => set({ usedScrapedProducts: links }),

  addInspirationProduct: (product) =>
    set((s) => {
      if (s.inspirationProducts.length >= MAX_STYLE_REFERENCE_PHOTOS) return s;
      const item: InspirationProduct = {
        ...product,
        id: `insp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      return { inspirationProducts: [...s.inspirationProducts, item] };
    }),

  removeInspirationProduct: (id) =>
    set((s) => ({
      inspirationProducts: s.inspirationProducts.filter((p) => p.id !== id),
    })),

  updateInspirationProductLabel: (id, label) =>
    set((s) => ({
      inspirationProducts: s.inspirationProducts.map((p) =>
        p.id === id ? { ...p, label } : p,
      ),
    })),

  clearInspirationProducts: () => set({ inspirationProducts: [] }),

  addStyleInspiration: (image) =>
    set((s) => {
      if (s.styleInspirations.length >= MAX_STYLE_INSPIRATIONS) return s;
      const item: StyleInspirationImage = {
        ...image,
        id: `style-insp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      return { styleInspirations: [...s.styleInspirations, item] };
    }),

  removeStyleInspiration: (id) =>
    set((s) => ({
      styleInspirations: s.styleInspirations.filter((img) => img.id !== id),
    })),

  clearStyleInspirations: () => set({ styleInspirations: [] }),

  setTechnicalPlans: (plans) => set({ technicalPlans: plans }),
  setIsGeneratingPlans: (generating) => set({ isGeneratingPlans: generating }),
  acceptAndContinue: () =>
    set((s) => {
      if (!s.generatedImageBase64 || !s.generatedImageMimeType || !s.roomImageBase64 || !s.roomImageMimeType) return s;
      const approved: ApprovedRoom = {
        id: `room-${Date.now()}`,
        roomImageBase64: s.roomImageBase64,
        roomImageMimeType: s.roomImageMimeType,
        designImageBase64: s.generatedImageBase64,
        designImageMimeType: s.generatedImageMimeType,
        brief: s.designBrief,
        versions: s.designHistory,
        plans: s.technicalPlans,
        timestamp: Date.now(),
      };
      return {
        approvedRooms: [...s.approvedRooms, approved],
        roomImageBase64: null,
        roomImageMimeType: null,
        quickRoomAnalysis: null,
        quickRoomAnalyzing: false,
        quickRoomAnalyzeError: null,
        quickRoomFactsConfirmed: false,
        generatedImageBase64: null,
        generatedImageMimeType: null,
        designBrief: null,
        designHistory: [],
        technicalPlans: [],
        isGeneratingPlans: false,
        textPrompt: "",
        error: null,
        productLinks: [],
        usedScrapedProducts: [],
        inspirationProducts: [],
        styleInspirations: [],
      };
    }),
  setTokenBalance: (balance) => set({ tokenBalance: balance }),

  // --- Saved projects actions ---
  setCurrentProjectDbId: (id) => set({ currentProjectDbId: id }),
  setSavedProjects: (projects) => set({ savedProjects: projects }),
  setSavedProjectsLoading: (loading) => set({ savedProjectsLoading: loading }),

  // --- Phased design actions ---
  startPhasedDesign: () =>
    set({
      phasedDesignActive: true,
      phasedCurrentPhase: "base",
      phasedStatus: "selecting",
      phasedRetryCount: 0,
      phase1Versions: [],
      phase1SelectedIndex: 0,
      phase2Versions: [],
      phase2SelectedIndex: 0,
      phase3Versions: [],
      phase3SelectedIndex: 0,
      phasedAllProductLinks: [],
      phasedAllProductIds: [],
      phasedFinalViews: [],
      viewpointTracks: {},
      phasedError: null,
      generatedImageBase64: null,
      generatedImageMimeType: null,
      designBrief: null,
      productLinks: [],
    }),
  setPhasedPhase: (phase) => set({ phasedCurrentPhase: phase, phasedStatus: "selecting", phasedRetryCount: 0, phasedError: null }),
  setPhasedStatus: (status) => set({ phasedStatus: status }),
  setPhasedRetryCount: (count) => set({ phasedRetryCount: count }),
  pushPhaseVersion: (phase, version) =>
    set((s) => appendPhaseVersion(s, phase, version)),
  setPhaseSelectedIndex: (phase, index) =>
    set((s) => {
      const { versionsKey, indexKey } = phaseVersionFields(phase);
      const versions = s[versionsKey];
      if (versions.length === 0) return s;
      const clamped = Math.min(Math.max(0, index), versions.length - 1);
      return { [indexKey]: clamped } as Partial<ConsumerDesignState>;
    }),
  approvePhase: (phase) =>
    set((s) => {
      const { versionsKey, indexKey } = phaseVersionFields(phase);
      const versions = s[versionsKey];
      if (versions.length === 0) return s;
      const index = Math.min(Math.max(0, s[indexKey]), versions.length - 1);
      const selected = versions[index];
      if (!selected) return s;
      return {
        [versionsKey]: [selected],
        [indexKey]: 0,
      } as Partial<ConsumerDesignState>;
    }),
  setPhaseResult: (phase, image, products) =>
    set((s) =>
      appendPhaseVersion(s, phase, {
        id: `pv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        image,
        products,
        timestamp: Date.now(),
      }),
    ),
  setPhasedAllProductLinks: (links) => set({ phasedAllProductLinks: links }),
  setPhasedAllProductIds: (ids) => set({ phasedAllProductIds: ids }),
  setPhasedFinalViews: (views) => set({ phasedFinalViews: views }),
  clearPhasedFinalViews: () => set({ phasedFinalViews: [] }),
  removePhasedFinalView: (id) =>
    set((s) => {
      const next = s.phasedFinalViews.filter((v) => v.id !== id);
      if (next.length === 0 || next.length === s.phasedFinalViews.length) return s;
      const removed = s.phasedFinalViews.find((v) => v.id === id);
      const wasActive = removed?.base64 === s.generatedImageBase64;
      return {
        phasedFinalViews: next,
        ...(wasActive
          ? {
              generatedImageBase64: next[0]!.base64,
              generatedImageMimeType: next[0]!.mimeType,
            }
          : {}),
      };
    }),
  setViewpointTrackResult: (trackId, phase, version) =>
    set((s) => {
      const fieldMap = { base: "phase1", furniture: "phase2", decor: "phase3" } as const;
      const prefix = fieldMap[phase];
      const vKey = `${prefix}Versions` as const;
      const iKey = `${prefix}SelectedIndex` as const;
      const existing = s.viewpointTracks[trackId] ?? {
        phase1Versions: [], phase1SelectedIndex: 0,
        phase2Versions: [], phase2SelectedIndex: 0,
        phase3Versions: [], phase3SelectedIndex: 0,
      };
      const nextVersions = [...existing[vKey], version];
      return {
        viewpointTracks: {
          ...s.viewpointTracks,
          [trackId]: {
            ...existing,
            [vKey]: nextVersions,
            [iKey]: nextVersions.length - 1,
          },
        },
      };
    }),
  setPhasedError: (error) => set({ phasedError: error, phasedStatus: error ? "error" : "idle" }),
  resetPhasedDesign: () =>
    set({
      phasedDesignActive: false,
      phasedCurrentPhase: "idle",
      phasedStatus: "idle",
      phasedRetryCount: 0,
      phase1Versions: [],
      phase1SelectedIndex: 0,
      phase2Versions: [],
      phase2SelectedIndex: 0,
      phase3Versions: [],
      phase3SelectedIndex: 0,
      phasedAllProductLinks: [],
      phasedAllProductIds: [],
      phasedFinalViews: [],
      viewpointTracks: {},
      phasedError: null,
    }),

  // --- Project mode actions ---
  setVistaMode: (mode) => set({ vistaMode: mode }),
  setProjectStep: (step) => set({ projectStep: step, projectError: step === "upload" ? null : undefined }),
  setFloorPlan: (base64, mimeType) => set({ floorPlanBase64: base64, floorPlanMimeType: mimeType }),

  addRoomPhoto: (base64, mimeType, label, opts) => {
    const photo: UploadedRoomPhoto = {
      id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      base64,
      mimeType,
      label: label ?? "",
      matchedRoomId: opts?.matchedRoomId ?? null,
      matchConfidence: opts?.matchedRoomId ? "high" : null,
    };
    set((s) => {
      if (s.roomPhotos.length >= 35) return s;
      return { roomPhotos: [...s.roomPhotos, photo] };
    });
    return photo.id;
  },

  removeRoomPhoto: (id) =>
    set((s) => ({ roomPhotos: s.roomPhotos.filter((p) => p.id !== id) })),

  updateRoomPhotoLabel: (id, label) =>
    set((s) => ({
      roomPhotos: s.roomPhotos.map((p) => (p.id === id ? { ...p, label } : p)),
    })),

  setPhotoRoomMatch: (photoId, roomId) =>
    set((s) => ({
      roomPhotos: s.roomPhotos.map((p) =>
        p.id === photoId
          ? {
              ...p,
              matchedRoomId: roomId,
              matchConfidence: "high",
              // Dropping a photo from its room clears a now-meaningless viewpoint.
              viewpoint: roomId ? p.viewpoint : undefined,
            }
          : p,
      ),
    })),

  setPhotoStructuralLineMap: (photoId, lineMap) =>
    set((s) => ({
      roomPhotos: s.roomPhotos.map((p) =>
        p.id === photoId ? { ...p, structuralLineMap: lineMap ?? undefined } : p,
      ),
    })),

  setPhotoObjectRemovalMask: (photoId, mask) =>
    set((s) => ({
      roomPhotos: s.roomPhotos.map((p) =>
        p.id === photoId ? { ...p, objectRemovalMask: mask ?? undefined } : p,
      ),
    })),

  setPhotoOpeningAnalysis: (photoId, analysis) =>
    set((s) => ({
      roomPhotos: s.roomPhotos.map((p) =>
        p.id === photoId ? { ...p, openingAnalysis: analysis ?? undefined } : p,
      ),
    })),

  setPhotoViewpoint: (photoId, viewpoint) =>
    set((s) => ({
      roomPhotos: s.roomPhotos.map((p) =>
        p.id === photoId ? { ...p, viewpoint: viewpoint ?? undefined } : p,
      ),
    })),

  setProjectPreferences: (prefs) =>
    set((s) => ({
      projectPreferences: {
        ...s.projectPreferences,
        ...prefs,
        ...(prefs.designMode !== undefined
          ? { designMode: resolveDesignMode(prefs.designMode) }
          : {}),
      },
    })),

  setProjectData: (data) =>
    // Merge: only overwrite fields the caller actually provided, so a partial
    // update (e.g. concept-only after "Start Designing") doesn't wipe the
    // existing analysis/rooms and strand the rooms hub on an endless loader.
    set({
      projectId: data.id,
      projectError: data.error ?? null,
      ...(data.analysis !== undefined ? { projectAnalysis: data.analysis } : {}),
      ...(data.concept !== undefined ? { projectConcept: data.concept } : {}),
      ...(data.rooms !== undefined ? { projectRooms: data.rooms } : {}),
      ...(data.currentRoomIndex !== undefined ? { currentProjectRoomIndex: data.currentRoomIndex } : {}),
      ...(data.hasPdf !== undefined ? { hasPdf: data.hasPdf } : {}),
      ...(data.suggestedRoomOrder !== undefined ? { projectSuggestedRoomOrder: data.suggestedRoomOrder } : {}),
      ...(data.utilityEntryPoints !== undefined
        ? { projectUtilityEntryPoints: data.utilityEntryPoints }
        : {}),
    }),

  setProjectRooms: (rooms) =>
    set((state) => ({
      projectRooms:
        typeof rooms === "function" ? rooms(state.projectRooms) : rooms,
    })),
  setCurrentProjectRoomIndex: (index) => set({ currentProjectRoomIndex: index }),
  setProjectLoading: (loading) => set({ projectLoading: loading }),
  setProjectError: (error) => set({ projectError: error }),
  setHasPdf: (has) => set({ hasPdf: has }),
  setProjectAnalysis: (analysis) => set({ projectAnalysis: analysis }),
  setSelectedFloorPlanRoomId: (roomId) => set({ selectedFloorPlanRoomId: roomId }),
  setProjectSuggestedRoomOrder: (order) => set({ projectSuggestedRoomOrder: order }),
  setProjectHubView: (view) => set({ projectHubView: view }),
  setActiveDesignRoomId: (roomId) => set({ activeDesignRoomId: roomId }),
  setProjectAnalysisProgress: (progress, message) =>
    set({
      projectAnalysisProgress: progress,
      ...(message !== undefined ? { projectAnalysisMessage: message } : {}),
    }),

  setProjectUtilityEntryPoints: (points) => set({ projectUtilityEntryPoints: points }),
  setProjectDraftRooms: (rooms) => set({ projectDraftRooms: rooms }),

  resetProject: () => {
    if (typeof window !== "undefined") {
      clearSession();
      void clearSessionBlobs();
    }
    set({
      projectStep: "upload",
      floorPlanBase64: null,
      floorPlanMimeType: null,
      roomPhotos: [],
      projectPreferences: {
        style: "modern-neutral",
        familyMembers: 2,
        budgetTier: "mid" as BudgetTier,
        wishes: "",
        designMode: "custom",
      },
      projectId: null,
      projectAnalysis: null,
      projectConcept: null,
      projectRooms: [],
      currentProjectRoomIndex: 0,
      projectLoading: false,
      projectError: null,
      hasPdf: false,
      projectSuggestedRoomOrder: [],
      selectedFloorPlanRoomId: null,
      projectHubView: "floorPlan",
      activeDesignRoomId: null,
      projectAnalysisProgress: 0,
      projectAnalysisMessage: "",
      projectUtilityEntryPoints: [],
      projectDraftRooms: [],
    });
  },

  reset: () => set(initialState),
}));

export { subscribeToProjectSession } from "@/lib/project/projectSessionSync";
