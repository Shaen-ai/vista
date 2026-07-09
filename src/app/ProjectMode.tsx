"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import {
  Upload,
  X,
  Plus,
  Sparkles,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Check,
  RefreshCw,
  Pencil,
  Download,
  FileText,
  Home,
  Camera,
  Package,
  ExternalLink,
  Maximize2,
  ChevronDown,
  ChevronLeft,
  AppWindow,
  DoorOpen,
  PenTool,
  Paintbrush,
} from "lucide-react";
import { TOKEN_COSTS } from "@/lib/vistaTokens";
import { resolveProjectTokenAction } from "@/lib/project/projectTokenAction";
import {
  balanceFromProgressEvent,
  TokenInsufficientError,
} from "@/lib/project/useProjectSSE";
import {
  RoomRenderGalleryCard,
  RoomRenderGalleryGrid,
  RoomRenderGalleryPendingCard,
} from "@/components/RoomRenderGallery";
import { UTILITY_ICONS } from "@/lib/project/utilityIcons";
import { sanitizeUserFacingMessage, translateProgressMessage } from "@/lib/userFacingMessages";

const MAX_PARALLEL_ROOM_GENERATIONS = 2;
const GENERATION_STALE_TIMEOUT_MS = 10 * 60 * 1000;

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

function tokenCostForProjectAction(action: string, opts?: { redo?: boolean }): number | null {
  const tokenAction = resolveProjectTokenAction(action, opts);
  if (!tokenAction) return null;
  return TOKEN_COSTS[tokenAction];
}

function hasInsufficientTokens(balance: number | null, cost: number): boolean {
  return balance !== null && balance < cost;
}

function formatInsufficientTokenError(t: TranslateFn, cost: number, balance: number | null): string {
  return t("tokens.insufficientBalance", {
    cost: String(cost),
    balance: String(balance ?? 0),
  });
}

function applyPostRenderBalance(
  event: ProgressEvent | undefined | void,
  setTokenBalance: (balance: number) => void,
): void {
  const balance = balanceFromProgressEvent(event ?? null);
  if (typeof balance === "number") {
    setTokenBalance(balance);
  }
}

function handleTokenBillingClientError(
  err: unknown,
  setTokenBalance: (balance: number) => void,
  setProjectError: (error: string | null) => void,
  t: TranslateFn,
): boolean {
  if (err instanceof TokenInsufficientError) {
    setTokenBalance(err.balance);
    setProjectError(formatInsufficientTokenError(t, err.required, err.balance));
    return true;
  }
  return false;
}

function assertSufficientTokensForAction(
  action: string,
  tokenBalance: number | null,
  setProjectError: (error: string | null) => void,
  t: TranslateFn,
  opts?: { redo?: boolean },
): boolean {
  const cost = tokenCostForProjectAction(action, opts);
  if (cost === null) return true;
  if (hasInsufficientTokens(tokenBalance, cost)) {
    setProjectError(formatInsufficientTokenError(t, cost, tokenBalance));
    return false;
  }
  return true;
}

function userFacingError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) {
    return sanitizeUserFacingMessage(err.message);
  }
  return fallback;
}

function isRoomGenerationAlreadyRunningError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message === ROOM_GENERATION_ALREADY_IN_PROGRESS ||
    err.message.includes("already in progress")
  );
}

function isGenerationCancelledError(err: unknown): boolean {
  return err instanceof Error && err.message === "Generation cancelled";
}

function patchLiveProgress(
  setter: Dispatch<SetStateAction<Map<string, LiveGenProgress>>>,
  roomId: string,
  ev: {
    progress?: number;
    message?: string;
    generationStep?: string;
    viewIndex?: number;
    viewTotal?: number;
  },
): void {
  setter((prev) => {
    const next = new Map(prev);
    const existing = next.get(roomId);
    next.set(roomId, {
      progress: ev.progress ?? existing?.progress ?? 0,
      message: ev.message ?? existing?.message ?? "",
      generationStep: ev.generationStep ?? existing?.generationStep,
      viewIndex: ev.viewIndex ?? existing?.viewIndex,
      viewTotal: ev.viewTotal ?? existing?.viewTotal,
      updatedAt: Date.now(),
    });
    return next;
  });
}

const StructuralBoundaryCanvas = dynamic(
  () => import("@/components/StructuralBoundaryCanvas"),
  { ssr: false },
);
import type { StructuralLineExport } from "@/components/StructuralBoundaryCanvas";
import type {
  UploadedRoomPhoto,
  ProjectConceptSummary,
  ProjectStep,
  InspirationProduct,
} from "./store";
import { MAX_STYLE_REFERENCE_PHOTOS } from "./store";
import type { RoomResult, UserPreferences, FloorPlanAnalysis, PlanColumn, UtilityEntryPoint, UtilityPointType, DesignPhase, DetectedRoom, ProgressEvent } from "@/lib/project/types";

type StructuralLineMapValue = { base64: string; mimeType: string; strokeOnly?: boolean };
type ObjectRemovalMaskValue = { base64: string; mimeType: string };

function applyStructuralCanvasExport(
  photoId: string,
  result: StructuralLineExport,
  setPhotoStructuralLineMap: (photoId: string, lineMap: StructuralLineMapValue | null) => void,
  setPhotoObjectRemovalMask: (photoId: string, mask: ObjectRemovalMaskValue | null) => void,
) {
  if (result.hasStructuralLines) {
    setPhotoStructuralLineMap(photoId, {
      base64: result.strokeMapBase64,
      mimeType: result.strokeMapMimeType,
      strokeOnly: true,
    });
  } else {
    setPhotoStructuralLineMap(photoId, null);
  }
  if (result.hasRemovalMask && result.removalMaskBase64) {
    setPhotoObjectRemovalMask(photoId, {
      base64: result.removalMaskBase64,
      mimeType: result.removalMaskMimeType ?? "image/png",
    });
  } else {
    setPhotoObjectRemovalMask(photoId, null);
  }
}

function clearStructuralCanvasMarks(
  photoId: string,
  setPhotoStructuralLineMap: (photoId: string, lineMap: StructuralLineMapValue | null) => void,
  setPhotoObjectRemovalMask: (photoId: string, mask: ObjectRemovalMaskValue | null) => void,
  setPhotoOpeningAnalysis: (
    photoId: string,
    analysis: UploadedRoomPhoto["openingAnalysis"] | null,
  ) => void,
) {
  setPhotoStructuralLineMap(photoId, null);
  setPhotoObjectRemovalMask(photoId, null);
  setPhotoOpeningAnalysis(photoId, null);
}

function photoHasGeometryMarks(photo: {
  structuralLineMap?: StructuralLineMapValue;
  objectRemovalMask?: ObjectRemovalMaskValue;
  openingAnalysis?: UploadedRoomPhoto["openingAnalysis"];
}): boolean {
  const hasOpenings =
    (photo.openingAnalysis?.window_boxes?.length ?? 0) > 0 ||
    (photo.openingAnalysis?.door_boxes?.length ?? 0) > 0;
  return !!(photo.structuralLineMap?.base64 || photo.objectRemovalMask?.base64 || hasOpenings);
}
import { emptyRoomPhases } from "@/lib/project/types";
import {
  computeSharedWalls,
  deriveWallSegments,
  dimensionsFromPolygon,
  edgeLengthMm,
  polygonArea,
  sanitizePolygon,
  setEdgeLength,
  type Point,
} from "@/lib/project/floorPlanGeometry";
import { cornerLabel } from "@/lib/roomShapePolygon";
import { renderFloorPlanImage } from "@/lib/project/renderFloorPlanImage";
import { defaultViewpointForRoom } from "@/lib/project/defaultViewpoint";
import {
  DesignPhaseStepper,
  PhaseApprovalBar,
  PhaseVersionNav,
  type PhaseStatus,
} from "@/components/DesignPhaseStepper";
import { STYLE_PRESETS } from "@/lib/project/stylePresets";
import { compressImageFile } from "@/lib/compressImageClient";
import { pipelineLog, summarizeRoomParams, userFlowLog } from "@/lib/pipelineLog";
import {
  isCustomDesignMode,
  resolveDesignMode,
  SHOW_MADE_DESIGN_MODE,
} from "@/lib/designModeConfig";
import { CameraCapture } from "@/components/CameraCapture";
import DrawingCanvas from "@/components/DrawingCanvas";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { useCatalogLabels } from "@/i18n/catalogLabels";
import { useProjectPersistence } from "@/hooks/useProjectPersistence";
import { inspirationProductsToPatchPayload } from "@/lib/inspirationPersistence";
import { useConsumerDesignStore } from "./store";
import { useProjectSSE, cancelActiveRoomGeneration } from "@/lib/project/useProjectSSE";
import { handleAiServiceUnavailableClientError } from "@/lib/aiServiceError";
import FloorPlanHub, { roomHubStatusLabel } from "@/components/project/FloorPlanHub";
import FloorPlanEditor from "@/components/project/FloorPlanEditor";
import { ProjectFinalizeCard } from "@/components/project/ProjectFinalizeCard";
import RoomGenerationProgress from "@/components/project/RoomGenerationProgress";
import RoomGenerationBanner, {
  type RoomGenOutcome,
} from "@/components/project/RoomGenerationBanner";
import {
  getApprovalProgress,
  getFinalizeRequiredRoomIds,
  getOrderedDesignableRoomIds,
  detectInFlightRoomIds,
  isRoomGenerationSettled,
  isRoomRenderInFlight,
  nextHubRoomId,
  mergePolledRenders,
  normalizeStaleGeneratingRooms,
  resolveRoomGenerationDisplay,
  roomGenerationProgressLabel,
  ROOM_GENERATION_ALREADY_IN_PROGRESS,
  shouldClearGeneratingRoomId,
  type LiveGenProgress,
} from "@/lib/project/roomOrder";
import { useProjectFinalize } from "@/lib/project/useProjectFinalize";
import {
  canRedoIndividualView,
  resolvePhotoIdForRenderIndex,
  sortRoomPhotoIds,
} from "@/lib/project/photoRenderMap";
import type { RenderResult } from "@/lib/project/types";

function PhotoStructuralEditPanel({
  photo,
  onExport,
  onSkip,
  onFinish,
}: {
  photo: UploadedRoomPhoto;
  onExport: (result: StructuralLineExport) => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  return (
    <StructuralBoundaryCanvas
      imageSrc={`data:${photo.mimeType};base64,${photo.base64}`}
      onExport={onExport}
      onSkip={onSkip}
      onFinish={onFinish}
      variant="removeOnly"
    />
  );
}

function roomGenerationSuccessMessage(
  room: RoomResult,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  const target = room.viewpointTargetCount ?? 0;
  if (target > 1 && room.renders.length > 0 && room.renders.length < target) {
    return t("project.generationSuccessPartial", {
      room: room.brief.roomName,
      remaining: String(target - room.renders.length),
    });
  }
  return t("project.generationSuccess", { room: room.brief.roomName });
}

function buildRoomGenSuccessOutcome(
  room: RoomResult,
  t: (key: string, params?: Record<string, string>) => string,
): RoomGenOutcome {
  const target = room.viewpointTargetCount ?? 0;
  const remaining = target > 1 ? Math.max(0, target - room.renders.length) : 0;
  return {
    kind: "success",
    message: roomGenerationSuccessMessage(room, t),
    roomId: room.roomId,
    partialViewsRemaining: remaining > 0 ? remaining : undefined,
    nextViewNumber: remaining > 0 ? room.renders.length + 1 : undefined,
  };
}

const MAX_ROOM_PHOTOS = 35;

const BUDGET_TIER_KEYS = {
  economy: "project.budgetEconomy",
  mid: "project.budgetMid",
  premium: "project.budgetPremium",
  luxury: "project.budgetLuxury",
} as const;

export interface ProjectModeProps {
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
  inspirationProducts: InspirationProduct[];
  setProjectStep: (step: ProjectStep) => void;
  setFloorPlan: (base64: string | null, mimeType: string | null) => void;
  addRoomPhoto: (base64: string, mimeType: string, label?: string, opts?: { matchedRoomId?: string }) => string;
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
  setProjectRooms: (rooms: RoomResult[] | ((prev: RoomResult[]) => RoomResult[])) => void;
  setCurrentProjectRoomIndex: (index: number) => void;
  setProjectLoading: (loading: boolean) => void;
  setProjectError: (error: string | null) => void;
  setHasPdf: (has: boolean) => void;
  addInspirationProduct: (product: Omit<InspirationProduct, "id">) => void;
  removeInspirationProduct: (id: string) => void;
  updateInspirationProductLabel: (id: string, label: string) => void;
  resetProject: () => void;
  setLightboxSrc: (src: string | null) => void;
  /** Header country/search mode — passed into project-create preferences for scraped-only AM+Local */
  catalogCountryCode: string;
  catalogSearchMode: string;
  isMobile?: boolean;
  onAiServiceUnavailable?: () => void;
}

export default function ProjectModeContent(props: ProjectModeProps) {
  const {
    projectStep, floorPlanBase64, floorPlanMimeType, roomPhotos,
    projectPreferences, projectId, projectAnalysis, projectConcept,
    projectRooms, currentProjectRoomIndex, projectLoading, projectError,
    hasPdf, inspirationProducts, setProjectStep, setFloorPlan, addRoomPhoto, removeRoomPhoto,
    updateRoomPhotoLabel, setPhotoRoomMatch, setPhotoStructuralLineMap, setPhotoObjectRemovalMask,
    setPhotoOpeningAnalysis,
    setProjectPreferences, setProjectData, setProjectRooms,
    setCurrentProjectRoomIndex, setProjectLoading, setProjectError,
    setHasPdf, addInspirationProduct, removeInspirationProduct,
    updateInspirationProductLabel,
    resetProject,
    setLightboxSrc,
    catalogCountryCode,
    catalogSearchMode,
    isMobile = false,
    onAiServiceUnavailable = () => {},
  } = props;

  const { t } = useTranslation();

  // The banner sits at the top of a tall scrollable step; when an error lands
  // while the user is at the bottom (e.g. the confirm button), bring it on-screen.
  const errorBannerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (projectError) errorBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [projectError]);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className={`${projectStep === "floorPlanReview" ? "max-w-3xl lg:max-w-6xl" : "max-w-3xl"} mx-auto w-full ${isMobile ? "p-4" : "p-6"} flex flex-col gap-6`}>
        <div className="cd-step-label">
          <span className="cd-step-label-line" />
          <span className="cd-step-label-text">{t("landing.projectCardBadge")}</span>
          <span className="cd-step-label-line" />
        </div>

        {projectError &&
          projectStep !== "analyzingFloorPlan" &&
          projectStep !== "creatingConcept" && (
          <div
            ref={errorBannerRef}
            className={`px-4 py-3 rounded-xl text-sm border ${
              projectError === t("project.generationAlreadyRunning")
                ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}
          >
            {projectError}
          </div>
        )}

        {projectStep === "upload" && (
          <ProjectUploadStep
            isMobile={isMobile}
            floorPlanBase64={floorPlanBase64}
            floorPlanMimeType={floorPlanMimeType}
            roomPhotos={roomPhotos}
            preferences={projectPreferences}
            setPreferences={setProjectPreferences}
            setFloorPlan={setFloorPlan}
            addRoomPhoto={addRoomPhoto}
            removeRoomPhoto={removeRoomPhoto}
            updateRoomPhotoLabel={updateRoomPhotoLabel}
            setPhotoRoomMatch={setPhotoRoomMatch}
            setPhotoStructuralLineMap={setPhotoStructuralLineMap}
            setPhotoObjectRemovalMask={setPhotoObjectRemovalMask}
            setPhotoOpeningAnalysis={setPhotoOpeningAnalysis}
            setProjectStep={setProjectStep}
            setProjectData={setProjectData}
            setProjectLoading={setProjectLoading}
            setProjectError={setProjectError}
            projectLoading={projectLoading}
            catalogCountryCode={catalogCountryCode}
            catalogSearchMode={catalogSearchMode}
            onAiServiceUnavailable={onAiServiceUnavailable}
          />
        )}

        {projectStep === "designBrief" && (
          <ProjectDesignBriefStep
            isMobile={isMobile}
            preferences={projectPreferences}
            setPreferences={setProjectPreferences}
            projectId={projectId}
            inspirationProducts={inspirationProducts}
            addInspirationProduct={addInspirationProduct}
            removeInspirationProduct={removeInspirationProduct}
            updateInspirationProductLabel={updateInspirationProductLabel}
            onBack={() => setProjectStep("floorPlanReview")}
            setProjectStep={setProjectStep}
            setProjectData={setProjectData}
            setProjectRooms={setProjectRooms}
            setProjectLoading={setProjectLoading}
            setProjectError={setProjectError}
            projectLoading={projectLoading}
            catalogCountryCode={catalogCountryCode}
            catalogSearchMode={catalogSearchMode}
            analysis={projectAnalysis}
            onAiServiceUnavailable={onAiServiceUnavailable}
          />
        )}

        {(projectStep === "analyzingFloorPlan" || projectStep === "creatingConcept") && (
          <ProjectAnalyzingStep
            phase={projectStep === "creatingConcept" ? "concept" : "floorPlan"}
            error={projectError}
            onRetry={() => {
              setProjectError(null);
              setProjectStep("upload");
            }}
            onStartOver={resetProject}
          />
        )}

        {projectStep === "floorPlanReview" && (
          <ProjectFloorPlanReviewStep
            isMobile={isMobile}
            analysis={projectAnalysis}
            floorPlanBase64={floorPlanBase64}
            floorPlanMimeType={floorPlanMimeType}
            roomPhotos={roomPhotos}
            projectId={projectId}
            addRoomPhoto={addRoomPhoto}
            setPhotoRoomMatch={setPhotoRoomMatch}
            setPhotoStructuralLineMap={setPhotoStructuralLineMap}
            setPhotoObjectRemovalMask={setPhotoObjectRemovalMask}
            setPhotoOpeningAnalysis={setPhotoOpeningAnalysis}
            setProjectStep={setProjectStep}
            setProjectLoading={setProjectLoading}
            setProjectError={setProjectError}
            projectLoading={projectLoading}
            setLightboxSrc={setLightboxSrc}
            onAiServiceUnavailable={onAiServiceUnavailable}
          />
        )}

        {projectStep === "rooms" && (
          <ProjectDesignHubStep
            isMobile={isMobile}
            rooms={projectRooms}
            projectId={projectId}
            concept={projectConcept}
            analysis={projectAnalysis}
            floorPlanBase64={floorPlanBase64}
            floorPlanMimeType={floorPlanMimeType}
            setRooms={setProjectRooms}
            setProjectStep={setProjectStep}
            setProjectLoading={setProjectLoading}
            setProjectError={setProjectError}
            setHasPdf={setHasPdf}
            projectLoading={projectLoading}
            setLightboxSrc={setLightboxSrc}
            onAiServiceUnavailable={onAiServiceUnavailable}
          />
        )}

        {projectStep === "finalizing" && (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <Loader2 size={48} className="animate-spin text-[var(--primary)]" />
            <h2 className="cd-step-title">{t("project.finalizingTitle")}</h2>
            <p className="cd-step-subtitle max-w-md">{t("project.finalizingSubtitle")}</p>
          </div>
        )}

        {projectStep === "complete" && (
          <ProjectCompleteStep
            projectId={projectId}
            concept={projectConcept}
            rooms={projectRooms}
            analysis={projectAnalysis}
            hasPdf={hasPdf}
            resetProject={resetProject}
            setProjectStep={setProjectStep}
            setLightboxSrc={setLightboxSrc}
          />
        )}
      </div>
    </div>
  );
}

// --- Upload Step ---

function ProjectUploadStep({
  isMobile = false,
  floorPlanBase64, floorPlanMimeType, roomPhotos,
  preferences, setPreferences,
  setFloorPlan, addRoomPhoto, removeRoomPhoto, updateRoomPhotoLabel, setPhotoRoomMatch,
  setPhotoStructuralLineMap,
  setPhotoObjectRemovalMask,
  setPhotoOpeningAnalysis,
  setProjectStep, setProjectData, setProjectLoading, setProjectError, projectLoading,
  catalogCountryCode, catalogSearchMode, onAiServiceUnavailable,
}: {
  isMobile?: boolean;
  floorPlanBase64: string | null;
  floorPlanMimeType: string | null;
  roomPhotos: UploadedRoomPhoto[];
  preferences: UserPreferences;
  setPreferences: (prefs: Partial<UserPreferences>) => void;
  setFloorPlan: (base64: string | null, mimeType: string | null) => void;
  addRoomPhoto: (base64: string, mimeType: string, label?: string, opts?: { matchedRoomId?: string }) => string;
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
  setProjectStep: (step: ProjectStep) => void;
  setProjectData: ProjectModeProps["setProjectData"];
  setProjectLoading: (loading: boolean) => void;
  setProjectError: (error: string | null) => void;
  projectLoading: boolean;
  catalogCountryCode: string;
  catalogSearchMode: string;
  onAiServiceUnavailable: () => void;
}) {
  const { t } = useTranslation();
  const { projectRoomTypeLabel } = useCatalogLabels();
  const { createProject: streamCreateProject } = useProjectSSE();
  const { syncOrchestratorId } = useProjectPersistence();
  const setProjectAnalysisProgress = useConsumerDesignStore((s) => s.setProjectAnalysisProgress);
  const setProjectSuggestedRoomOrder = useConsumerDesignStore((s) => s.setProjectSuggestedRoomOrder);
  const setSelectedFloorPlanRoomId = useConsumerDesignStore((s) => s.setSelectedFloorPlanRoomId);
  const floorPlanRef = useRef<HTMLInputElement>(null);
  const roomPhotosRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<"floorPlan" | "room" | null>(null);
  const [structuralEditPhotoId, setStructuralEditPhotoId] = useState<string | null>(null);

  // Optional manual floor-plan drawing (seeds the analysis when the user draws rooms).
  // Persisted in the store so it survives navigating forward and back (and page reloads).
  const draftRooms = useConsumerDesignStore((s) => s.projectDraftRooms);
  const setDraftRooms = useConsumerDesignStore((s) => s.setProjectDraftRooms);
  const [showDraw, setShowDraw] = useState(draftRooms.length > 0);
  const [draftSelectedRoomId, setDraftSelectedRoomId] = useState<string | null>(null);
  const [imageAspect, setImageAspect] = useState(4 / 3);
  // Problems that must be fixed before leaving the planning page for "Analyzing".
  const [planIssues, setPlanIssues] = useState<string[]>([]);
  const draftAnalysis: FloorPlanAnalysis = {
    totalArea: 0,
    ceilingHeight: 2.7,
    rooms: draftRooms,
    wallSegments: [],
    overallShape: "custom",
    notes: "User-drawn plan",
  };
  // Stable drawing canvas matched to the uploaded plan's aspect ratio, sized so traced
  // rooms get realistic metre dimensions (derived from total area when provided).
  const canvasWidthMm = Math.min(
    22000,
    Math.max(8000, preferences.totalArea ? Math.round(Math.sqrt(preferences.totalArea) * 1.15) * 1000 : 12000),
  );
  const canvasExtentMm = { width: canvasWidthMm, height: Math.round(canvasWidthMm / imageAspect) };
  // Drawing the plan is optional. With at least one traced room the drawing is
  // authoritative; with none, submitting runs the Gemini auto-detect path on the
  // raw upload. Either way, a floor plan must be uploaded to continue.
  const drawnRooms = draftRooms.filter((r) => (r.polygon?.length ?? 0) >= 3);
  const drawnRoomCount = drawnRooms.length;
  const canContinue = Boolean(floorPlanBase64);

  const handleAnalyze = useCallback(async () => {
    if (!floorPlanBase64 || !floorPlanMimeType) return;

    const drawn = draftRooms.filter((r) => (r.polygon?.length ?? 0) >= 3);
    if (drawn.length > 0) {
      const issues: string[] = [];
      for (const r of drawn) {
        if (r.doors.filter((d) => d.edgeIndex !== undefined).length === 0) {
          issues.push(t("project.issueRoomNoDoor", { room: r.name }));
        }
      }
      if (issues.length > 0) {
        setPlanIssues(issues);
        setShowDraw(true);
        const firstNoDoor = drawn.find(
          (r) => r.doors.filter((d) => d.edgeIndex !== undefined).length === 0,
        );
        if (firstNoDoor) setDraftSelectedRoomId(firstNoDoor.id);
        return;
      }
    }
    setPlanIssues([]);

    setProjectLoading(true);
    setProjectError(null);
    setProjectStep("analyzingFloorPlan");
    setProjectAnalysisProgress(0);

    // STEP 1 → 2 — client submits the plan + photos to the server to analyze.
    pipelineLog("UPLOAD", "submitting floor plan to server (photos deferred to review confirm)", {
      roomPhotosDeferred: roomPhotos.length,
      drawnRooms: draftRooms.filter((r) => (r.polygon?.length ?? 0) >= 3).length,
      totalArea: preferences.totalArea,
    });
    userFlowLog(2, "analyze clicked — submitting floor plan only", {
      roomPhotosDeferred: roomPhotos.length,
      drawnRooms: drawnRooms.length,
      totalArea: preferences.totalArea,
      photoLabels: roomPhotos.map((p) => ({ id: p.id, label: p.label, matchedRoomId: p.matchedRoomId })),
    }, "A");

    try {
      const form = new FormData();
      const blob = await fetch(`data:${floorPlanMimeType};base64,${floorPlanBase64}`).then((r) => r.blob());
      form.set("floorPlan", blob, "floorplan.jpg");
      form.set(
        "preferences",
        JSON.stringify({
          style: preferences.style || "modern-neutral",
          familyMembers: preferences.familyMembers,
          budgetTier: preferences.budgetTier,
          wishes: "",
          totalArea: preferences.totalArea,
          countryCode: catalogCountryCode,
          searchMode: catalogSearchMode,
        }),
      );

      // Room photos stay in the browser until floor-plan review confirm — uploading
      // up to 20 images here only bloated the multipart request; OpenAI never saw them.

      // Optional manual trace — when present, geometry is authoritative over AI.
      if (drawn.length > 0) {
        const polys = drawn.map((r) => r.polygon ?? []).filter((p) => p.length >= 3) as Point[][];
        const totalArea =
          Math.round((polys.reduce((sum, p) => sum + polygonArea(p), 0) / 1_000_000) * 10) / 10;
        const ceilingHeight =
          draftRooms.reduce((h, r) => Math.max(h, r.dimensions.height || 0), 0) || 2.7;
        const manualAnalysis: FloorPlanAnalysis = {
          totalArea,
          ceilingHeight,
          rooms: draftRooms,
          wallSegments: deriveWallSegments(polys),
          overallShape: "custom",
          notes: "User-drawn plan",
          imageFrame: canvasExtentMm,
        };
        form.set("manualAnalysis", JSON.stringify(manualAnalysis));
      }

      const completeEvent = await streamCreateProject(form, (event) => {
        setProjectAnalysisProgress(event.progress ?? 0, event.message);
        console.log("[vista][floor-plan] event", event.phase, event);
        if (event.phase === "complete" && event.data) {
          const a = (event.data as { analysis?: FloorPlanAnalysis }).analysis;
          console.log("[vista][floor-plan] FULL analysis (object)", event.data);
          console.log("[vista][floor-plan] FULL analysis (json)\n" + JSON.stringify(a ?? event.data, null, 2));
        }
      });

      const data = completeEvent.data as {
        projectId: string;
        analysis: FloorPlanAnalysis;
      };

      setProjectData({
        id: data.projectId,
        analysis: data.analysis,
        concept: null,
        rooms: [],
        suggestedRoomOrder: [],
        utilityEntryPoints: data.analysis?.utilityPoints ?? [],
      });
      void syncOrchestratorId(data.projectId);
      useConsumerDesignStore.getState().setProjectUtilityEntryPoints(data.analysis?.utilityPoints ?? []);
      setProjectSuggestedRoomOrder([]);
      setSelectedFloorPlanRoomId(data.analysis?.rooms?.[0]?.id ?? null);
      setProjectStep("floorPlanReview");
      userFlowLog(2, "floor plan analysis complete", {
        projectId: data.projectId,
        roomCount: data.analysis?.rooms?.length ?? 0,
        rooms: (data.analysis?.rooms ?? []).map((r) => summarizeRoomParams(r)),
      }, "A");
    } catch (err) {
      if (handleAiServiceUnavailableClientError(err, onAiServiceUnavailable)) {
        setProjectError(null);
        setProjectStep("upload");
      } else {
        setProjectError(userFacingError(err, t("common.error")));
        setProjectStep("analyzingFloorPlan");
      }
    } finally {
      setProjectLoading(false);
    }
  }, [
    floorPlanBase64,
    floorPlanMimeType,
    preferences,
    roomPhotos,
    draftRooms,
    catalogCountryCode,
    catalogSearchMode,
    setProjectStep,
    setProjectData,
    setProjectLoading,
    setProjectError,
    streamCreateProject,
    syncOrchestratorId,
    setProjectAnalysisProgress,
    setProjectSuggestedRoomOrder,
    setSelectedFloorPlanRoomId,
    onAiServiceUnavailable,
    t,
  ]);

  const handleFloorPlanFile = useCallback(
    async (file: File) => {
      const isImage = file.type.startsWith("image/");
      const isPdf = file.type === "application/pdf";
      if (!isImage && !isPdf) return;
      // STEP 1 — user picked a floor-plan file.
      pipelineLog("UPLOAD", "floor plan selected", {
        fileName: file.name,
        type: isImage ? "image" : "pdf",
        sizeKB: Math.round(file.size / 1024),
      });
      userFlowLog(1, "floor plan uploaded", {
        fileName: file.name,
        type: isImage ? "image" : "pdf",
        sizeKB: Math.round(file.size / 1024),
      });
      try {
        if (isImage) {
          // Normalize to JPEG so Claude always gets a supported image type
          // (fixes HEIC / oversized plans). Floor plans keep a higher
          // resolution/quality than room photos: door swing arcs and window
          // lines are thin features that the 1200px photo default blurs away,
          // which makes opening detection miss them.
          const { base64, mimeType } = await compressImageFile(file, { maxEdge: 2200, quality: 0.92 });
          setFloorPlan(base64, mimeType);
        } else {
          // PDF: keep as-is; analyzed server-side via a document block.
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsDataURL(file);
          });
          const [meta, base64] = dataUrl.split(",");
          const mime = meta?.match(/:(.*?);/)?.[1] ?? "application/pdf";
          setFloorPlan(base64!, mime);
        }
        // Manual trace is optional — AI auto-detect runs on the raw upload by default.
        if (draftRooms.length === 0) setShowDraw(false);
      } catch {
        setProjectError(t("project.floorPlanReadError"));
      }
    },
    [setFloorPlan, setProjectError, t],
  );

  const handleRoomPhotoFiles = useCallback((files: FileList | File[]) => {
    // STEP 1 — user added room photos.
    pipelineLog("UPLOAD", "room photos selected", { count: Array.from(files).length });
    userFlowLog(1, "room photos selected", { count: Array.from(files).length }, "B");
    void (async () => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        try {
          const { base64, mimeType } = await compressImageFile(file);
          const label = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
          addRoomPhoto(base64, mimeType, label);
        } catch {
          /* skip */
        }
      }
    })();
  }, [addRoomPhoto]);

  const handleWebCameraCapture = useCallback(
    (file: File) => {
      if (cameraTarget === "floorPlan") void handleFloorPlanFile(file);
      else if (cameraTarget === "room") handleRoomPhotoFiles([file]);
    },
    [cameraTarget, handleFloorPlanFile, handleRoomPhotoFiles]
  );

  const floorPlanPreview = floorPlanBase64 && floorPlanMimeType
    ? `data:${floorPlanMimeType};base64,${floorPlanBase64}`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="cd-step-title">{t("project.uploadTitle")}</h2>
        <p className="cd-step-subtitle">{t("project.uploadSubtitle")}</p>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">
          {t("project.floorPlanRequired")} <span className="text-red-400">*</span>
        </label>
        {!floorPlanPreview ? (
          <div
            className={`w-full ${isMobile ? "min-h-[9rem]" : "min-h-[11rem] sm:min-h-[13rem]"} rounded-2xl border-2 border-dashed ${isMobile ? "py-4 px-4" : "py-6 px-5"} flex flex-col justify-center sm:flex-row sm:items-center gap-4 sm:gap-8 cursor-pointer transition-all ${
              isDragging
                ? "border-[var(--primary)] bg-[var(--primary)]/5"
                : "border-[var(--border)] hover:border-[var(--primary)]/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) void handleFloorPlanFile(f); }}
            onClick={() => floorPlanRef.current?.click()}
          >
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-[var(--muted)] border border-[var(--border)] flex items-center justify-center shrink-0">
                <Upload size={22} className="text-[var(--muted-foreground)]" />
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="text-base font-semibold leading-snug">{t("project.dropFloorPlan")}</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1.5 leading-relaxed max-w-md">
                  {t("project.floorPlanFormats")}
                </p>
              </div>
            </div>
            <div
              className="flex shrink-0 gap-2.5 justify-center sm:flex-col sm:justify-center sm:min-w-[9.5rem]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => floorPlanRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm font-medium text-[var(--foreground)] hover:border-[var(--primary)]/40 active:scale-[0.98] transition-all sm:w-full"
              >
                <Upload size={16} />
                {t("project.browse")}
              </button>
              <button
                type="button"
                onClick={() => setCameraTarget("floorPlan")}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm font-medium text-[var(--foreground)] hover:border-[var(--primary)]/40 active:scale-[0.98] transition-all sm:w-full"
              >
                <Camera size={16} />
                {t("project.camera")}
              </button>
            </div>
            <input
              ref={floorPlanRef}
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFloorPlanFile(f);
                e.target.value = "";
              }}
              className="hidden"
            />
          </div>
        ) : (
          <div className="relative rounded-2xl overflow-hidden border border-[var(--border)]">
            <img
              src={floorPlanPreview}
              alt={t("project.floorPlanAlt")}
              className="w-full object-contain max-h-[300px]"
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setImageAspect(img.naturalWidth / img.naturalHeight);
                }
              }}
            />
            <button
              onClick={() => setFloorPlan(null, null)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {floorPlanPreview && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowDraw((v) => !v)}
            className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] text-sm font-medium hover:border-[var(--primary)]/40 transition-all cursor-pointer"
          >
            <Pencil size={16} />
            {showDraw ? t("project.drawPlanHide") : t("project.drawPlanCta")}
          </button>
          {showDraw && (
            <>
              <p className="text-xs text-[var(--muted-foreground)]">{t("project.drawPlanHintOptional")}</p>
              <FloorPlanEditor
                analysis={draftAnalysis}
                floorPlanImageSrc={floorPlanPreview}
                selectedRoomId={draftSelectedRoomId}
                onRoomSelect={setDraftSelectedRoomId}
                onRoomsChange={setDraftRooms}
                roomTypeLabel={projectRoomTypeLabel}
                canvasExtentMm={canvasExtentMm}
              />
            </>
          )}
        </div>
      )}

      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">
          {t("project.roomPhotosCount", { count: roomPhotos.length, max: MAX_ROOM_PHOTOS })}
        </label>
        <input
          ref={roomPhotosRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => { if (e.target.files) handleRoomPhotoFiles(e.target.files); e.target.value = ""; }}
          className="hidden"
        />

        {roomPhotos.length === 0 ? (
          <div
            className={`w-full ${isMobile ? "min-h-[9rem]" : "min-h-[11rem] sm:min-h-[13rem]"} rounded-2xl border-2 border-dashed border-[var(--border)] ${isMobile ? "py-4 px-4" : "py-6 px-5"} flex flex-col justify-center sm:flex-row sm:items-center gap-4 sm:gap-8 cursor-pointer hover:border-[var(--primary)]/50 transition-all`}
            onClick={() => roomPhotosRef.current?.click()}
          >
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-[var(--muted)] flex items-center justify-center shrink-0">
                <Camera size={22} className="text-[var(--muted-foreground)]" />
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="text-base font-semibold text-[var(--foreground)] leading-snug">
                  {t("project.roomPhotosOptionalTitle")}
                </p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1.5 leading-relaxed max-w-md">
                  {t("project.roomPhotosFileTip", { max: MAX_ROOM_PHOTOS })}
                </p>
              </div>
            </div>
            <div
              className="flex shrink-0 gap-2.5 justify-center sm:flex-col sm:justify-center sm:min-w-[9.5rem]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => roomPhotosRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm font-medium text-[var(--foreground)] hover:border-[var(--primary)]/40 active:scale-[0.98] transition-all sm:w-full"
              >
                <Upload size={16} />
                {t("project.browse")}
              </button>
              <button
                type="button"
                onClick={() => setCameraTarget("room")}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm font-medium text-[var(--foreground)] hover:border-[var(--primary)]/40 active:scale-[0.98] transition-all sm:w-full"
              >
                <Camera size={16} />
                {t("project.camera")}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {roomPhotos.map((photo) => {
              const assignedRoomValid =
                photo.matchedRoomId != null && drawnRooms.some((r) => r.id === photo.matchedRoomId);
              return (
              <div
                key={photo.id}
                className={`relative group rounded-xl overflow-hidden border ${
                  drawnRoomCount > 0 && !assignedRoomValid
                    ? "border-amber-500/60"
                    : "border-[var(--border)]"
                }`}
              >
                <img
                  src={`data:${photo.mimeType};base64,${photo.base64}`}
                  alt={photo.label || t("project.roomPhotoAlt")}
                  className="w-full aspect-[4/3] object-cover"
                />
                <button
                  onClick={() => removeRoomPhoto(photo.id)}
                  className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
                <div className="p-2 flex flex-col gap-1.5">
                  <input
                    type="text"
                    value={photo.label}
                    onChange={(e) => updateRoomPhotoLabel(photo.id, e.target.value)}
                    placeholder={t("project.labelPlaceholder")}
                    className="w-full px-2 py-1 text-[11px] rounded-md bg-[var(--muted)] border border-[var(--border)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/50"
                  />
                  {drawnRoomCount > 0 && (
                    <select
                      value={assignedRoomValid ? photo.matchedRoomId! : ""}
                      onChange={(e) => setPhotoRoomMatch(photo.id, e.target.value || null)}
                      className={`w-full px-2 py-1 text-[11px] rounded-md bg-[var(--muted)] border cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/50 ${
                        assignedRoomValid ? "border-[var(--border)]" : "border-amber-500/60 text-amber-600"
                      }`}
                    >
                      <option value="">{t("project.assignToRoom")}</option>
                      {drawnRooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => setStructuralEditPhotoId(photo.id)}
                    className="w-full px-2 py-1 text-[10px] font-medium rounded-md border border-[var(--border)] hover:border-[var(--primary)]/50 cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Paintbrush size={10} />
                    {photoHasGeometryMarks(photo)
                      ? t("project.removeItemsDone")
                      : t("project.removeItemsOpen")}
                  </button>
                </div>
              </div>
              );
            })}
            {structuralEditPhotoId && (() => {
              const editPhoto = roomPhotos.find((p) => p.id === structuralEditPhotoId);
              if (!editPhoto) return null;
              return (
                <div className="col-span-3 rounded-xl border border-[var(--primary)]/40 p-3 bg-[var(--muted)]/30">
                  <PhotoStructuralEditPanel
                    photo={editPhoto}
                    onExport={(result) => {
                      applyStructuralCanvasExport(
                        editPhoto.id,
                        result,
                        setPhotoStructuralLineMap,
                        setPhotoObjectRemovalMask,
                      );
                      setStructuralEditPhotoId(null);
                    }}
                    onSkip={() => {
                      clearStructuralCanvasMarks(
                        editPhoto.id,
                        setPhotoStructuralLineMap,
                        setPhotoObjectRemovalMask,
                        setPhotoOpeningAnalysis,
                      );
                      setStructuralEditPhotoId(null);
                    }}
                    onFinish={() => setStructuralEditPhotoId(null)}
                  />
                </div>
              );
            })()}
            {roomPhotos.length < MAX_ROOM_PHOTOS && (
              <div
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] aspect-[4/3] cursor-pointer hover:border-[var(--primary)]/50 transition-all p-3"
                onClick={() => roomPhotosRef.current?.click()}
              >
                <Plus size={22} className="text-[var(--muted-foreground)]" />
                <span className="text-[11px] font-medium text-[var(--muted-foreground)] text-center leading-tight">
                  {t("project.addPhoto")}
                </span>
                <div className="flex gap-1.5 w-full justify-center mt-auto" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => roomPhotosRef.current?.click()}
                    className="flex-1 max-w-[5.5rem] py-1.5 text-[10px] font-semibold rounded-md bg-[var(--muted)] border border-[var(--border)] hover:border-[var(--primary)]/40 transition-colors"
                  >
                    {t("project.browse")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCameraTarget("room")}
                    className="flex-1 max-w-[5.5rem] py-1.5 text-[10px] font-semibold rounded-md bg-[var(--muted)] border border-[var(--border)] hover:border-[var(--primary)]/40 transition-colors"
                  >
                    {t("project.camera")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">
          {t("project.totalAreaOptional")}
        </label>
        <input
          type="number"
          value={preferences.totalArea ?? ""}
          onChange={(e) => setPreferences({ totalArea: e.target.value ? Number(e.target.value) : undefined })}
          placeholder={t("project.totalAreaPlaceholder")}
          className="w-full px-4 py-2.5 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50"
        />
      </div>

      {planIssues.length > 0 && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <p className="font-semibold mb-1">{t("project.fixIssuesTitle")}</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {planIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={isMobile ? "cd-generate-sticky-wrap sticky bottom-0 z-10 pt-2" : ""}>
      <button
        type="button"
        onClick={() => void handleAnalyze()}
        disabled={!canContinue || projectLoading}
        className={`w-full py-3.5 rounded-xl text-base font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
          canContinue && !projectLoading
            ? "bg-[var(--primary)] text-white hover:brightness-110"
            : "bg-[var(--muted)] text-[var(--muted-foreground)] cursor-not-allowed"
        }`}
      >
        {projectLoading ? (
          <><Loader2 size={20} className="animate-spin" /> {t("project.analyzingShort")}</>
        ) : !floorPlanBase64 ? (
          <><Upload size={20} /> {t("project.analyzePlanCta")}</>
        ) : (
          <><ArrowRight size={20} /> {t("project.analyzePlanCta")}</>
        )}
      </button>
      </div>

      <CameraCapture
        open={cameraTarget !== null}
        onClose={() => setCameraTarget(null)}
        onCapture={handleWebCameraCapture}
      />
    </div>
  );
}

// --- Design Brief Step ---

function ProjectDesignBriefStep({
  isMobile = false,
  preferences, setPreferences, projectId,
  inspirationProducts, addInspirationProduct,
  removeInspirationProduct, updateInspirationProductLabel,
  onBack, setProjectStep, setProjectData, setProjectRooms,
  setProjectLoading, setProjectError, projectLoading,
  catalogCountryCode,
  catalogSearchMode,
  analysis,
  onAiServiceUnavailable,
}: {
  isMobile?: boolean;
  preferences: UserPreferences;
  setPreferences: (prefs: Partial<UserPreferences>) => void;
  projectId: string | null;
  inspirationProducts: InspirationProduct[];
  addInspirationProduct: (product: Omit<InspirationProduct, "id">) => void;
  removeInspirationProduct: (id: string) => void;
  updateInspirationProductLabel: (id: string, label: string) => void;
  onBack: () => void;
  setProjectStep: (step: ProjectStep) => void;
  setProjectData: ProjectModeProps["setProjectData"];
  setProjectRooms: (rooms: RoomResult[] | ((prev: RoomResult[]) => RoomResult[])) => void;
  setProjectLoading: (loading: boolean) => void;
  setProjectError: (error: string | null) => void;
  projectLoading: boolean;
  catalogCountryCode: string;
  catalogSearchMode: string;
  analysis: FloorPlanAnalysis | null;
  onAiServiceUnavailable: () => void;
}) {
  const { t } = useTranslation();
  const { stylePresetLabel, stylePresetDescription } = useCatalogLabels();
  const {
    createProject: createProjectDb,
    loadProjects,
    syncOrchestratorId,
    saveInspirationImages,
    isAuthenticated: isPersistenceAuthenticated,
  } = useProjectPersistence();
  const { createConcept: streamCreateConcept, generateRoom: streamGenerateRoom } = useProjectSSE();
  const setProjectAnalysisProgress = useConsumerDesignStore((s) => s.setProjectAnalysisProgress);
  const setProjectSuggestedRoomOrder = useConsumerDesignStore((s) => s.setProjectSuggestedRoomOrder);
  const setSelectedFloorPlanRoomId = useConsumerDesignStore((s) => s.setSelectedFloorPlanRoomId);

  const handleStartDesign = useCallback(async () => {
    if (!projectId) return;
    userFlowLog(4, "design preferences submitted", {
      projectId,
      style: preferences.style,
      familyMembers: preferences.familyMembers,
      budgetTier: preferences.budgetTier,
      designMode: resolveDesignMode(preferences.designMode),
      inspirationProducts: inspirationProducts.length,
    });
    setProjectLoading(true);
    setProjectError(null);
    setProjectStep("creatingConcept");
    setProjectAnalysisProgress(0);

    try {
      if (isPersistenceAuthenticated()) {
        if (!useConsumerDesignStore.getState().currentProjectDbId) {
          const snap = useConsumerDesignStore.getState();
          await createProjectDb({
            mode: "project",
            title: preferences.style
              ? stylePresetLabel(preferences.style)
              : "Full Project",
            style: preferences.style || null,
            floorPlanBase64: snap.floorPlanBase64,
            floorPlanMime: snap.floorPlanMimeType,
            preferences: {
              ...(preferences as unknown as Record<string, unknown>),
              orchestratorProjectId: projectId,
            },
          });
          await loadProjects({ mode: "project" });
        }
        void syncOrchestratorId(projectId);
      }

      const projectDbId = useConsumerDesignStore.getState().currentProjectDbId;
      const inspirationPayload = inspirationProductsToPatchPayload(inspirationProducts);
      if (projectDbId && isPersistenceAuthenticated() && inspirationPayload.length > 0) {
        void saveInspirationImages(projectDbId, inspirationPayload);
      }

      // Drop wishes for rooms deleted in the plan editor + empty entries.
      const validRoomIds = new Set((analysis?.rooms ?? []).map((r) => r.id));
      const roomWishes = Object.fromEntries(
        Object.entries(preferences.roomWishes ?? {}).filter(
          ([roomId, wish]) => validRoomIds.has(roomId) && wish.trim(),
        ),
      );

      const form = new FormData();
      form.set(
        "preferences",
        JSON.stringify({
          ...preferences,
          roomWishes: Object.keys(roomWishes).length > 0 ? roomWishes : undefined,
          countryCode: catalogCountryCode,
          searchMode: catalogSearchMode,
        }),
      );

      for (const ip of inspirationProducts) {
        if (ip.base64 && ip.mimeType) {
          const ipBlob = await fetch(`data:${ip.mimeType};base64,${ip.base64}`).then((r) => r.blob());
          form.append("inspirationImages", ipBlob, "inspiration.jpg");
          form.append("inspirationLabels", ip.label || "");
        }
      }
      for (const ip of inspirationProducts) {
        if (!ip.base64 && ip.url) {
          form.append("inspirationUrls", ip.url);
          form.append("inspirationLabels", ip.label || "");
        }
      }

      const completeEvent = await streamCreateConcept(projectId, form, (event) => {
        setProjectAnalysisProgress(event.progress ?? 0, event.message);
      });

      const data = completeEvent.data as {
        concept: ProjectConceptSummary;
        suggestedRoomOrder?: string[];
      };

      setProjectData({
        id: projectId,
        concept: data.concept,
        suggestedRoomOrder: data.suggestedRoomOrder ?? [],
        rooms: [],
        hasPdf: false,
        currentRoomIndex: 0,
      });
      void syncOrchestratorId(projectId);
      setProjectSuggestedRoomOrder(data.suggestedRoomOrder ?? []);
      const firstRoomId = data.concept?.roomNames?.[0]?.id ?? null;
      setSelectedFloorPlanRoomId(firstRoomId);
      useConsumerDesignStore.getState().setActiveDesignRoomId(null);
      useConsumerDesignStore.getState().setProjectHubView("floorPlan");

      userFlowLog(4, "design concept ready", {
        projectId,
        suggestedRoomOrder: data.suggestedRoomOrder ?? [],
        roomNames: data.concept?.roomNames?.map((r) => ({ id: r.id, name: r.name, type: r.type })),
      });

      useConsumerDesignStore.getState().setActiveDesignRoomId(null);
      useConsumerDesignStore.getState().setProjectHubView("floorPlan");
      setProjectStep("rooms");
    } catch (err) {
      if (handleAiServiceUnavailableClientError(err, onAiServiceUnavailable)) {
        setProjectError(null);
      } else {
        setProjectError(userFacingError(err, t("common.error")));
      }
      setProjectStep("designBrief");
    } finally {
      setProjectLoading(false);
    }
  }, [
    projectId,
    preferences,
    analysis,
    inspirationProducts,
    catalogCountryCode,
    catalogSearchMode,
    setProjectStep,
    setProjectData,
    setProjectLoading,
    setProjectError,
    streamCreateConcept,
    createProjectDb,
    loadProjects,
    syncOrchestratorId,
    saveInspirationImages,
    isPersistenceAuthenticated,
    stylePresetLabel,
    setProjectAnalysisProgress,
    setProjectSuggestedRoomOrder,
    setSelectedFloorPlanRoomId,
    onAiServiceUnavailable,
    t,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="cd-step-title">{t("project.designBriefTitle")}</h2>
        <p className="cd-step-subtitle">{t("project.designBriefSubtitle")}</p>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">{t("page.style")}</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {STYLE_PRESETS.map((s) => (
            <button
              key={s.id}
              onClick={() => setPreferences({ style: s.id })}
              className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                preferences.style === s.id
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-[var(--border)] hover:border-[var(--primary)]/50"
              }`}
            >
              <p className="text-sm font-semibold">{stylePresetLabel(s.id)}</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{stylePresetDescription(s.id)}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">
          {t("project.familyMembers", { count: preferences.familyMembers })}
        </label>
        <input
          type="range" min={1} max={8}
          value={preferences.familyMembers}
          onChange={(e) => setPreferences({ familyMembers: Number(e.target.value) })}
          className="w-full"
        />
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">{t("project.budgetLevel")}</label>
        <div className="flex gap-2">
          {(["economy", "mid", "premium", "luxury"] as const).map((tier) => (
            <button
              key={tier}
              onClick={() => setPreferences({ budgetTier: tier })}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all cursor-pointer capitalize ${
                preferences.budgetTier === tier
                  ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--foreground)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50"
              }`}
            >
              {t(BUDGET_TIER_KEYS[tier])}
            </button>
          ))}
        </div>
      </div>

      {SHOW_MADE_DESIGN_MODE && (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">
            {t("project.designMode")}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(["made", "custom"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPreferences({ designMode: mode })}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  resolveDesignMode(preferences.designMode) === mode
                    ? "border-[var(--primary)] bg-[var(--primary)]/5"
                    : "border-[var(--border)] hover:border-[var(--primary)]/50"
                }`}
              >
                <p className="text-sm font-semibold">
                  {mode === "made" ? t("project.designModeMade") : t("project.designModeCustom")}
                </p>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {mode === "made" ? t("project.designModeMadeHint") : t("project.designModeCustomHint")}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <ProjectInspirationProducts
        products={inspirationProducts}
        addProduct={addInspirationProduct}
        removeProduct={removeInspirationProduct}
        updateLabel={updateInspirationProductLabel}
      />

      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">
          {t("project.additionalWishes")}
        </label>
        <textarea
          value={preferences.wishes ?? ""}
          onChange={(e) => setPreferences({ wishes: e.target.value })}
          placeholder={t("project.wishesPlaceholder")}
          rows={3}
          className="w-full px-4 py-3 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 resize-none"
        />
      </div>

      {analysis && analysis.rooms.length > 0 && (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1 block">
            {t("project.roomWishesTitle")}
          </label>
          <p className="text-xs text-[var(--muted-foreground)] mb-2">
            {t("project.roomWishesHint")}
          </p>
          <div className="flex flex-col gap-2">
            {analysis.rooms.map((room) => (
              <div key={room.id}>
                <label className="text-xs font-medium mb-1 block">
                  {room.name}
                </label>
                <textarea
                  value={preferences.roomWishes?.[room.id] ?? ""}
                  onChange={(e) => {
                    const next = { ...(preferences.roomWishes ?? {}) };
                    if (e.target.value === "") delete next[room.id];
                    else next[room.id] = e.target.value;
                    setPreferences({ roomWishes: next });
                  }}
                  placeholder={t("project.roomWishesPlaceholder")}
                  rows={2}
                  className="w-full px-4 py-2.5 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 resize-none"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`flex gap-3 ${isMobile ? "cd-generate-sticky-wrap sticky bottom-0 z-10 pt-2 flex-col sm:flex-row" : ""}`}>
        <button
          onClick={onBack}
          className={`${isMobile ? "w-full" : ""} px-6 py-3 rounded-xl border border-[var(--border)] font-semibold flex items-center justify-center gap-2 cursor-pointer hover:bg-[var(--muted)] transition-all`}
        >
          <ArrowLeft size={18} /> {t("common.back")}
        </button>
        <button
          type="button"
          onClick={() => void handleStartDesign()}
          disabled={projectLoading || !projectId}
          className={`flex-1 py-3 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50 ${isMobile ? "w-full" : ""}`}
        >
          {projectLoading ? (
            <><Loader2 size={20} className="animate-spin" /> {t("project.creatingProject")}</>
          ) : (
            <><Sparkles size={20} /> {t("project.createDesignConcept")}</>
          )}
        </button>
      </div>
    </div>
  );
}

// --- Inspiration Products (Project Mode) ---

function ProjectInspirationProducts({
  products,
  addProduct,
  removeProduct,
  updateLabel,
}: {
  products: InspirationProduct[];
  addProduct: (product: Omit<InspirationProduct, "id">) => void;
  removeProduct: (id: string) => void;
  updateLabel: (id: string, label: string) => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const isFull = products.length >= MAX_STYLE_REFERENCE_PHOTOS;

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      void (async () => {
        for (const file of Array.from(files)) {
          if (!file.type.startsWith("image/")) continue;
          try {
            const { base64, mimeType } = await compressImageFile(file);
            addProduct({ base64, mimeType, url: null, label: "", thumbnailUrl: null });
          } catch {
            /* skip */
          }
        }
      })();
    },
    [addProduct],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {t("project.myProducts", { count: products.length, max: MAX_STYLE_REFERENCE_PHOTOS })}
        </label>
        {!isFull && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-xs font-semibold text-[var(--primary)] hover:underline cursor-pointer flex items-center gap-1"
          >
            <Upload size={12} /> {t("project.addImage")}
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
      />

      {products.length === 0 ? (
        <div
          className="w-full py-6 rounded-xl border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[var(--primary)]/50 transition-all"
          onClick={() => fileRef.current?.click()}
        >
          <Package size={24} className="text-[var(--muted-foreground)] opacity-50" />
          <p className="text-[10px] text-[var(--muted-foreground)]">{t("project.inspirationHint")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-2">
          {products.map((product) => {
            const src = product.base64
              ? `data:${product.mimeType};base64,${product.base64}`
              : product.thumbnailUrl || product.url;
            return (
              <div key={product.id} className="relative group rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--muted)]">
                <div className="aspect-square overflow-hidden">
                  {src ? (
                    <img src={src} alt={product.label || t("project.productAlt")} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--muted-foreground)]">
                      <Package size={20} />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeProduct(product.id)}
                  className="absolute top-1 right-1 p-0.5 rounded-full bg-black/70 text-white hover:bg-black/90 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
                <input
                  type="text"
                  value={product.label}
                  onChange={(e) => updateLabel(product.id, e.target.value)}
                  placeholder={t("components.productLabel")}
                  className="w-full px-1.5 py-1 text-[10px] bg-transparent border-t border-[var(--border)] focus:outline-none focus:bg-[var(--muted)] placeholder:text-[var(--muted-foreground)]"
                />
              </div>
            );
          })}
          {!isFull && (
            <div
              className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--border)] aspect-square cursor-pointer hover:border-[var(--primary)]/50 transition-all"
              onClick={() => fileRef.current?.click()}
            >
              <Plus size={16} className="text-[var(--muted-foreground)]" />
              <span className="text-[9px] text-[var(--muted-foreground)]">{t("common.add")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Analyzing Step (SSE progress) ---

type AnalyzingPhase = "floorPlan" | "concept";

const ANALYZING_STALL_HINT_MS = 4 * 60 * 1000;

function ProjectAnalyzingStep({
  phase,
  error,
  onRetry,
  onStartOver,
}: {
  phase: AnalyzingPhase;
  error?: string | null;
  onRetry?: () => void;
  onStartOver?: () => void;
}) {
  const { t } = useTranslation();
  const progress = useConsumerDesignStore((s) => s.projectAnalysisProgress);
  const message = useConsumerDesignStore((s) => s.projectAnalysisMessage);
  const projectId = useConsumerDesignStore((s) => s.projectId);
  const projectAnalysis = useConsumerDesignStore((s) => s.projectAnalysis);
  const setProjectAnalysis = useConsumerDesignStore((s) => s.setProjectAnalysis);
  const [showStallHint, setShowStallHint] = useState(false);

  useEffect(() => {
    setShowStallHint(false);
    const timer = setTimeout(() => setShowStallHint(true), ANALYZING_STALL_HINT_MS);
    return () => clearTimeout(timer);
  }, [phase, projectId]);

  // Re-hydrate analysis after hot reload so titles and downstream steps stay accurate.
  useEffect(() => {
    if (!projectId || projectAnalysis) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/project/${projectId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { data?: { analysis?: FloorPlanAnalysis | null } };
        if (json.data?.analysis && !cancelled) {
          setProjectAnalysis(json.data.analysis);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, projectAnalysis, setProjectAnalysis]);

  const defaultTitle =
    phase === "concept" ? t("project.savingPlanTitle") : t("project.analyzingTitle");
  const defaultSubtitle =
    phase === "concept" ? t("project.savingPlanSubtitle") : t("project.analyzingSubtitle");

  const liveMessage = message?.trim() ? translateProgressMessage(message, t) : "";
  const title =
    phase === "floorPlan" ? t("project.analyzingTitle") : liveMessage || defaultTitle;
  const subtitle = defaultSubtitle;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-5 py-16 max-w-md mx-auto w-full text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
          <X size={24} className="text-red-500" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="cd-step-title">{t("project.analysisFailedTitle")}</h2>
          <p className="cd-step-subtitle">{sanitizeUserFacingMessage(error)}</p>
        </div>
        <div className="flex gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-bold hover:brightness-110 transition-all cursor-pointer"
            >
              <RefreshCw size={18} /> {t("project.analysisFailedRetry")}
            </button>
          )}
          {onStartOver && (
            <button
              type="button"
              onClick={onStartOver}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-[var(--border)] font-semibold hover:bg-[var(--muted)] cursor-pointer"
            >
              {t("project.startOver")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 max-w-md mx-auto w-full">
      <Loader2 size={48} className="animate-spin text-[var(--primary)]" />
      <h2 className="cd-step-title">{title}</h2>
      <p className="cd-step-subtitle text-center">{subtitle}</p>
      <div className="w-full h-2.5 rounded-full bg-[var(--muted)] overflow-hidden border border-[var(--border)]">
        <div
          className="h-full bg-[var(--primary)] transition-all duration-500 ease-out"
          style={{ width: `${Math.round(Math.min(100, Math.max(0, progress * 100)))}%` }}
        />
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{Math.round(progress * 100)}%</p>
      {showStallHint && (
        <p className="text-xs text-[var(--muted-foreground)] text-center max-w-sm">
          {t("project.analyzingStallHint")}
        </p>
      )}
    </div>
  );
}

// --- Floor Plan Review Step ---

const UTILITY_TYPES: UtilityPointType[] = [
  "water_inlet",
  "water_drain_stack",
  "electrical_panel",
  "gas_inlet",
];

function utilityTypeLabel(type: UtilityPointType, t: (key: string) => string): string {
  switch (type) {
    case "water_inlet":
      return t("project.waterInlet");
    case "water_drain_stack":
      return t("project.waterDrainStack");
    case "electrical_panel":
      return t("project.electricalPanel");
    case "gas_inlet":
      return t("project.gasInlet");
    default:
      return type;
  }
}

function UtilityTypeIcon({ type, size = 16 }: { type: UtilityPointType; size?: number }) {
  const Icon = UTILITY_ICONS[type];
  return Icon ? <Icon size={size} /> : null;
}

/**
 * Photo picker for assigning a photo to the selected room. Lists every photo not
 * already in this room (unassigned + photos in other rooms) with a thumbnail
 * preview, so the user can pick visually; selecting one moves it into this room.
 */
function AssignPhotoDropdown({
  photos,
  roomName,
  onSelect,
}: {
  photos: UploadedRoomPhoto[];
  roomName: (roomId: string) => string | undefined;
  onSelect: (photoId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 w-full text-xs px-2 py-1.5 rounded-lg bg-[var(--muted)] border border-[var(--border)] cursor-pointer hover:bg-[var(--muted)]/80"
      >
        <span>{t("project.assignPhoto")}</span>
        <ChevronDown size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg p-1">
          {photos.map((p) => {
            const inRoom = p.matchedRoomId ? roomName(p.matchedRoomId) : null;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onSelect(p.id);
                  setOpen(false);
                }}
                className="flex items-center gap-2 w-full p-1.5 rounded-md hover:bg-[var(--muted)] cursor-pointer text-left"
              >
                <img
                  src={`data:${p.mimeType};base64,${p.base64}`}
                  alt={p.label}
                  className="w-16 h-12 rounded-md object-cover shrink-0"
                />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs truncate">{p.label || p.id.slice(0, 12)}</span>
                  {inRoom && (
                    <span className="text-[10px] text-[var(--muted-foreground)] truncate">
                      {t("project.photoInRoom", { room: inRoom })}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectFloorPlanReviewStep({
  isMobile = false,
  analysis,
  floorPlanBase64,
  floorPlanMimeType,
  roomPhotos,
  projectId,
  addRoomPhoto,
  setPhotoRoomMatch,
  setPhotoStructuralLineMap,
  setPhotoObjectRemovalMask,
  setPhotoOpeningAnalysis,
  setProjectStep,
  setProjectLoading,
  setProjectError,
  projectLoading,
  setLightboxSrc,
  onAiServiceUnavailable,
}: {
  isMobile?: boolean;
  analysis: FloorPlanAnalysis | null;
  floorPlanBase64: string | null;
  floorPlanMimeType: string | null;
  roomPhotos: UploadedRoomPhoto[];
  projectId: string | null;
  addRoomPhoto: (base64: string, mimeType: string, label?: string, opts?: { matchedRoomId?: string }) => string;
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
  setProjectStep: (step: ProjectStep) => void;
  setProjectLoading: (loading: boolean) => void;
  setProjectError: (error: string | null) => void;
  projectLoading: boolean;
  setLightboxSrc: (src: string | null) => void;
  onAiServiceUnavailable: () => void;
}) {
  const { t } = useTranslation();
  const { projectRoomTypeLabel } = useCatalogLabels();
  const selectedRoomId = useConsumerDesignStore((s) => s.selectedFloorPlanRoomId);
  const setSelectedFloorPlanRoomId = useConsumerDesignStore((s) => s.setSelectedFloorPlanRoomId);
  const utilityPoints = useConsumerDesignStore((s) => s.projectUtilityEntryPoints);
  const setProjectUtilityEntryPoints = useConsumerDesignStore((s) => s.setProjectUtilityEntryPoints);
  const setProjectAnalysis = useConsumerDesignStore((s) => s.setProjectAnalysis);
  const setPhotoViewpoint = useConsumerDesignStore((s) => s.setPhotoViewpoint);
  // Raw text drafts for the numeric dimension fields, keyed e.g. `${roomId}:w2`
  // (wall edge 2) or `${roomId}:height`. Lets the user type freely (decimals,
  // empty) while we commit parseable values straight into the analysis store.
  const [dimDraft, setDimDraft] = useState<Record<string, string>>({});
  const [activePlacementType, setActivePlacementType] = useState<UtilityPointType | null>(null);
  const [editMode, setEditMode] = useState(false);
  // Guided room-by-room opening confirmation (inside editMode).
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [confirmedRoomIds, setConfirmedRoomIds] = useState<Set<string>>(new Set());
  const [viewpointPhotoId, setViewpointPhotoId] = useState<string | null>(null);
  const [structuralEditPhotoId, setStructuralEditPhotoId] = useState<string | null>(null);
  const utilitiesSeededRef = useRef(false);

  // Switching rooms cancels any in-progress placement so the new room starts
  // clean and a stray click can't move the previous room's viewpoint/utility.
  const handleRoomSelect = useCallback(
    (roomId: string) => {
      setSelectedFloorPlanRoomId(roomId);
      setViewpointPhotoId(null);
      setActivePlacementType(null);
    },
    [setSelectedFloorPlanRoomId],
  );

  useEffect(() => {
    if (!analysis || utilitiesSeededRef.current) return;
    utilitiesSeededRef.current = true;
    if (utilityPoints.length > 0) return;
    const suggested = analysis.utilityPoints ?? [];
    if (suggested.length > 0) {
      setProjectUtilityEntryPoints(suggested);
    }
  }, [analysis, utilityPoints.length, setProjectUtilityEntryPoints]);

  // Seed a default camera viewpoint for every room-assigned photo that lacks one,
  // so continuing never blocks on manual placement; the user can still reposition
  // or clear it. Keyed by photo+room so a "Clear viewpoint" is respected (no
  // re-seed for that room) while reassigning the photo to another room seeds anew.
  const seededViewpointKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!analysis) return;
    const perRoomIndex = new Map<string, number>();
    for (const photo of roomPhotos) {
      if (!photo.matchedRoomId) continue;
      const indexInRoom = perRoomIndex.get(photo.matchedRoomId) ?? 0;
      perRoomIndex.set(photo.matchedRoomId, indexInRoom + 1);
      const key = `${photo.id}:${photo.matchedRoomId}`;
      if (photo.viewpoint) {
        seededViewpointKeysRef.current.add(key);
        continue;
      }
      if (seededViewpointKeysRef.current.has(key)) continue;
      seededViewpointKeysRef.current.add(key);
      const room = analysis.rooms.find((r) => r.id === photo.matchedRoomId);
      if (!room) continue;
      const vp = defaultViewpointForRoom(room, indexInRoom);
      if (!vp) continue;
      setPhotoViewpoint(photo.id, vp);
      pipelineLog("ASSIGN_PHOTOS_VIEWPOINTS", "default viewpoint seeded (client)", {
        photoId: photo.id,
        roomId: room.id,
        viewpoint: vp,
      });
    }
  }, [analysis, roomPhotos, setPhotoViewpoint]);

  // Safety: if the active room was removed (undo/edit), clamp to the first room.
  useEffect(() => {
    if (!editMode || !analysis || !activeRoomId) return;
    if (!analysis.rooms.some((r) => r.id === activeRoomId)) {
      const first = analysis.rooms[0];
      if (first) {
        setActiveRoomId(first.id);
        setSelectedFloorPlanRoomId(first.id);
      } else {
        setEditMode(false);
      }
    }
  }, [editMode, analysis, activeRoomId, setSelectedFloorPlanRoomId]);

  const floorPlanSrc =
    floorPlanBase64 && floorPlanMimeType
      ? `data:${floorPlanMimeType};base64,${floorPlanBase64}`
      : "";

  const selectedRoom = analysis?.rooms.find((r) => r.id === selectedRoomId) ?? null;
  const matchedPhotos = selectedRoomId
    ? roomPhotos.filter((p) => p.matchedRoomId === selectedRoomId)
    : [];
  // Only photos not yet assigned to any room can be picked here. Once a photo is
  // matched to a room it leaves the pool; to reassign it, remove it from its
  // current room first (which returns it to the unassigned pool).
  const assignablePhotos = roomPhotos.filter((p) => !p.matchedRoomId);

  const viewpointMarkers = roomPhotos
    .filter((p) => p.viewpoint)
    .map((p) => ({
      photoId: p.id,
      x: p.viewpoint!.x,
      y: p.viewpoint!.y,
      angleDeg: p.viewpoint!.angleDeg,
    }));

  // Persist rooms + walls re-derived from the (edited) polygons so the FloorPlanHub
  // in "Match Photos" reflects edits immediately, not just at final confirm. The hub
  // draws analysis.wallSegments as the prominent wall lines; without this they'd stay
  // on the old layout until handleConfirm re-derived them after this screen.
  const applyEditedRooms = useCallback(
    (rooms: DetectedRoom[]) => {
      if (!analysis) return;
      setProjectAnalysis({
        ...analysis,
        rooms,
        wallSegments: deriveWallSegments(
          rooms.map((r) => r.polygon ?? []).filter((p) => p.length >= 3),
        ),
      });
    },
    [analysis, setProjectAnalysis],
  );

  const handleColumnsChange = useCallback(
    (columns: PlanColumn[]) => {
      if (!analysis) return;
      setProjectAnalysis({ ...analysis, columns });
    },
    [analysis, setProjectAnalysis],
  );

  const handleMoveColumn = useCallback(
    (id: string, x: number, y: number) => {
      if (!analysis?.columns?.length) return;
      handleColumnsChange(
        analysis.columns.map((c) => (c.id === id ? { ...c, x, y } : c)),
      );
    },
    [analysis, handleColumnsChange],
  );

  const handleRemoveColumn = useCallback(
    (id: string) => {
      if (!analysis?.columns?.length) return;
      handleColumnsChange(analysis.columns.filter((c) => c.id !== id));
    },
    [analysis, handleColumnsChange],
  );

  const handleRoomsChange = useCallback(
    (rooms: DetectedRoom[]) => {
      applyEditedRooms(rooms);
    },
    [applyEditedRooms],
  );

  const handlePlaceViewpoint = useCallback(
    (x: number, y: number) => {
      if (!viewpointPhotoId) return;
      const existing = roomPhotos.find((p) => p.id === viewpointPhotoId)?.viewpoint;
      setPhotoViewpoint(viewpointPhotoId, { x, y, angleDeg: existing?.angleDeg ?? 90 });
      // STEP 4 — user placed a camera viewpoint on the plan for this photo.
      pipelineLog("ASSIGN_PHOTOS_VIEWPOINTS", "viewpoint placed (client)", {
        photoId: viewpointPhotoId,
        x: Math.round(x),
        y: Math.round(y),
      });
      userFlowLog(3, "viewpoint placed on plan", {
        photoId: viewpointPhotoId,
        x: Math.round(x),
        y: Math.round(y),
        angleDeg: existing?.angleDeg ?? 90,
        photoLabel: roomPhotos.find((p) => p.id === viewpointPhotoId)?.label,
        matchedRoomId: roomPhotos.find((p) => p.id === viewpointPhotoId)?.matchedRoomId,
      }, "C");
    },
    [viewpointPhotoId, roomPhotos, setPhotoViewpoint],
  );

  const handleAddPhotos = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) return;
      void (async () => {
        for (const file of Array.from(files)) {
          if (!file.type.startsWith("image/")) continue;
          try {
            const { base64, mimeType } = await compressImageFile(file);
            const label = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
            const photoId = addRoomPhoto(
              base64,
              mimeType,
              label,
              selectedRoomId ? { matchedRoomId: selectedRoomId } : undefined,
            );
            if (selectedRoomId) setStructuralEditPhotoId(photoId);
          } catch {
            /* skip */
          }
        }
      })();
      e.target.value = "";
    },
    [addRoomPhoto, selectedRoomId],
  );

  const handleAssignPhotoToRoom = useCallback(
    (photoId: string) => {
      if (!selectedRoom) return;
      setPhotoRoomMatch(photoId, selectedRoom.id);
      const photo = roomPhotos.find((p) => p.id === photoId);
      if (!photoHasGeometryMarks(photo ?? {})) {
        setStructuralEditPhotoId(photoId);
        setViewpointPhotoId(null);
      }
    },
    [selectedRoom, setPhotoRoomMatch, roomPhotos],
  );

  const getDims = (roomId: string) => {
    const room = analysis?.rooms.find((r) => r.id === roomId);
    return room?.dimensions ?? { width: 0, depth: 0, height: 2.7 };
  };

  // Update a single scalar dimension (used for height, and for width/depth on
  // rooms with no polygon to drive a per-wall edit).
  const handleDimChange = useCallback(
    (roomId: string, key: "width" | "depth" | "height", meters: number) => {
      if (!analysis) return;
      const rooms = analysis.rooms.map((r) =>
        r.id === roomId
          ? { ...r, dimensions: { ...r.dimensions, [key]: meters } }
          : r,
      );
      applyEditedRooms(rooms);
    },
    [analysis, applyEditedRooms],
  );

  // Set wall (edge) `edgeIndex` of a room to `meters` by moving its end vertex
  // along the wall direction, then refresh the bbox width/depth from the new
  // polygon. Live-updates the FloorPlanHub shape + corner letters.
  const handleWallLengthChange = useCallback(
    (roomId: string, edgeIndex: number, meters: number) => {
      if (!analysis) return;
      const room = analysis.rooms.find((r) => r.id === roomId);
      const poly = room?.polygon;
      if (!poly || poly.length < 3 || !Number.isFinite(meters) || meters <= 0) return;
      const next = setEdgeLength(poly, edgeIndex, meters * 1000);
      const rooms = analysis.rooms.map((r) =>
        r.id === roomId
          ? { ...r, polygon: next, dimensions: dimensionsFromPolygon(next, r.dimensions?.height ?? 2.7) }
          : r,
      );
      applyEditedRooms(rooms);
    },
    [analysis, applyEditedRooms],
  );

  // Draft-aware field helpers so typing decimals / clearing the field is smooth
  // even though the committed value is derived from the polygon in the store.
  const fieldValue = (key: string, derived: number) =>
    dimDraft[key] ?? String(Math.round(derived * 100) / 100);
  const handleFieldInput = (key: string, raw: string, commit: (n: number) => void) => {
    setDimDraft((d) => ({ ...d, [key]: raw }));
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) commit(n);
  };
  const handleFieldBlur = (key: string) =>
    setDimDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  const handlePlaceUtility = useCallback(
    (type: UtilityPointType, x: number, y: number) => {
      const point: UtilityEntryPoint = {
        id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        x,
        y,
        label: utilityTypeLabel(type, t),
      };
      const next = [...utilityPoints, point];
      setProjectUtilityEntryPoints(next);
      setActivePlacementType(null);
    },
    [utilityPoints, setProjectUtilityEntryPoints, t],
  );

  const handleRemoveUtility = useCallback(
    (id: string) => {
      setProjectUtilityEntryPoints(utilityPoints.filter((p) => p.id !== id));
    },
    [utilityPoints, setProjectUtilityEntryPoints],
  );

  const togglePlacementType = (type: UtilityPointType) => {
    if (activePlacementType === type) {
      setActivePlacementType(null);
      return;
    }
    setActivePlacementType(type);
    setViewpointPhotoId(null);
    setSelectedFloorPlanRoomId(null);
  };

  const handleConfirm = useCallback(async () => {
    if (!projectId || !analysis) return;
    setProjectLoading(true);
    setProjectError(null);

    try {
      // Apply any height/dimension overrides onto the (possibly edited) rooms.
      const editedRooms = analysis.rooms.map((room) => ({
        ...room,
        dimensions: getDims(room.id),
      }));
      const roomsPayload = editedRooms.map((room) => ({
        roomId: room.id,
        dimensions: room.dimensions,
        photoIds: roomPhotos.filter((p) => p.matchedRoomId === room.id).map((p) => p.id),
      }));

      // Persist corrected geometry: rooms + walls re-derived from polygon edges
      // (shared edges deduped) so the SVG and technical-drawing PDF stay consistent.
      const editedAnalysis: FloorPlanAnalysis = {
        ...analysis,
        rooms: editedRooms,
        wallSegments: deriveWallSegments(
          editedRooms.map((r) => r.polygon ?? []).filter((p) => p.length >= 3),
        ),
        sharedWalls: computeSharedWalls(editedRooms),
      };

      const viewpoints = roomPhotos
        .filter((p) => p.viewpoint)
        .map((p) => ({ photoId: p.id, viewpoint: p.viewpoint! }));

      // Send the full photo blobs, not just ids. Photos added in this editor
      // (after the initial analysis upload) live only in the browser, so the
      // server can't resolve `photoIds`/`viewpoints` references unless we ship
      // the base64 here for it to persist.
      const photos = roomPhotos.map((p) => ({
        id: p.id,
        base64: p.base64,
        mimeType: p.mimeType,
        label: p.label,
        structuralLineMap: p.structuralLineMap ?? null,
        objectRemovalMask: p.objectRemovalMask ?? null,
        openingAnalysis: p.openingAnalysis ?? null,
      }));

      // STEP 4 — client confirms photo→room assignments + viewpoints to the server.
      pipelineLog("ASSIGN_PHOTOS_VIEWPOINTS", "client confirming plan", {
        projectId,
        rooms: roomsPayload.length,
        photosAssigned: roomsPayload.reduce((n, r) => n + r.photoIds.length, 0),
        viewpointsSet: viewpoints.length,
      });
      userFlowLog(3, "floor plan review confirmed", {
        projectId,
        rooms: editedRooms.map((r) => ({
          ...summarizeRoomParams(r),
          photoIds: roomPhotos.filter((p) => p.matchedRoomId === r.id).map((p) => p.id),
          viewpoints: roomPhotos
            .filter((p) => p.matchedRoomId === r.id && p.viewpoint)
            .map((p) => ({ photoId: p.id, label: p.label, viewpoint: p.viewpoint })),
        })),
      }, "B");

      const res = await fetch(`/api/project/${projectId}/confirm-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis: editedAnalysis,
          rooms: roomsPayload,
          viewpoints,
          photos,
          utilityEntryPoints: utilityPoints,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || t("project.actionFailed"));

      useConsumerDesignStore.getState().setProjectSuggestedRoomOrder(json.data.suggestedRoomOrder ?? []);
      setProjectStep("designBrief");
    } catch (err) {
      if (handleAiServiceUnavailableClientError(err, onAiServiceUnavailable)) {
        setProjectError(null);
      } else {
        setProjectError(userFacingError(err, t("common.error")));
      }
    } finally {
      setProjectLoading(false);
    }
  }, [projectId, analysis, roomPhotos, utilityPoints, setProjectLoading, setProjectError, setProjectStep, onAiServiceUnavailable, t]);

  // Enter the guided room-by-room opening review at the first room.
  const startRoomReview = useCallback(() => {
    if (!analysis) return;
    setConfirmedRoomIds(new Set());
    const first = analysis.rooms[0];
    setActiveRoomId(first?.id ?? null);
    if (first) setSelectedFloorPlanRoomId(first.id);
    setEditMode(true);
  }, [analysis, setSelectedFloorPlanRoomId]);

  const goToRoomById = useCallback(
    (roomId: string) => {
      const rooms = useConsumerDesignStore.getState().projectAnalysis?.rooms ?? analysis?.rooms;
      if (!rooms?.some((r) => r.id === roomId)) return;
      setActiveRoomId(roomId);
      setSelectedFloorPlanRoomId(roomId);
    },
    [analysis, setSelectedFloorPlanRoomId],
  );

  const goToRoom = useCallback(
    (index: number) => {
      if (!analysis) return;
      const room = analysis.rooms[index];
      if (!room) return;
      goToRoomById(room.id);
    },
    [analysis, goToRoomById],
  );

  const handleGuidedRoomSelect = useCallback(
    (roomId: string | null) => {
      if (!roomId) return;
      goToRoomById(roomId);
    },
    [goToRoomById],
  );

  // Confirm the active room: mark its openings authoritative (solid glyphs +
  // `EXACTLY N` lock downstream) and advance; the last room returns to the
  // review screen where photos/viewpoints are assigned before final Approve.
  const confirmActiveRoom = useCallback(() => {
    if (!analysis || !activeRoomId) return;
    const activeRoomIndex = analysis.rooms.findIndex((r) => r.id === activeRoomId);
    if (activeRoomIndex < 0) return;
    const room = analysis.rooms[activeRoomIndex];
    const rooms = analysis.rooms.map((r) =>
      r.id === room.id
        ? {
            ...r,
            windows: r.windows.map((w) => ({ ...w, confirmed: true })),
            doors: r.doors.map((d) => ({ ...d, confirmed: true })),
          }
        : r,
    );
    applyEditedRooms(rooms);
    setConfirmedRoomIds((prev) => new Set(prev).add(room.id));
    userFlowLog(3, "room openings confirmed in guided edit", {
      roomId: room.id,
      roomName: room.name,
      windows: room.windows.length,
      doors: room.doors.length,
      ...summarizeRoomParams(room),
    }, "D");
    if (activeRoomIndex >= analysis.rooms.length - 1) {
      setEditMode(false);
    } else {
      goToRoom(activeRoomIndex + 1);
    }
  }, [analysis, activeRoomId, applyEditedRooms, goToRoom]);

  if (!analysis || !floorPlanSrc) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 max-w-md mx-auto w-full text-center">
        <h2 className="cd-step-title">{t("project.reviewDataMissingTitle")}</h2>
        <p className="cd-step-subtitle">{t("project.reviewDataMissingBody")}</p>
        <button
          type="button"
          onClick={() => useConsumerDesignStore.getState().resetProject()}
          className="mt-2 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-bold hover:brightness-110 transition-all cursor-pointer"
        >
          <RefreshCw size={18} /> {t("project.startOver")}
        </button>
      </div>
    );
  }

  if (editMode) {
    const total = analysis.rooms.length;
    const activeRoomIndex = analysis.rooms.findIndex((r) => r.id === activeRoomId);
    const clampedIndex = activeRoomIndex >= 0 ? activeRoomIndex : 0;
    const activeRoom = analysis.rooms[clampedIndex] ?? null;
    const winCount = activeRoom?.windows.length ?? 0;
    const doorCount = activeRoom?.doors.length ?? 0;
    const isLast = clampedIndex >= total - 1;
    return (
      <div className="flex flex-col gap-5 pb-24">
        {/* Header: progress dots + active room. */}
        <div className="flex flex-col items-center gap-2">
          <h2 className="cd-step-title">{t("project.confirmRoomsTitle")}</h2>
          <div className="flex items-center gap-1.5">
            {analysis.rooms.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => goToRoomById(r.id)}
                aria-label={t("project.confirmRoomProgress", { current: i + 1, total, name: r.name })}
                aria-current={r.id === activeRoomId}
                title={r.name}
                className={`h-2.5 rounded-full transition-all cursor-pointer hover:opacity-80 ${
                  r.id === activeRoomId
                    ? "w-5 bg-[var(--primary)]"
                    : confirmedRoomIds.has(r.id)
                      ? "w-2.5 bg-[var(--primary)]/60"
                      : "w-2.5 bg-[var(--border)]"
                }`}
              />
            ))}
          </div>
          <p className="cd-step-subtitle">
            {t("project.confirmRoomProgress", {
              current: clampedIndex + 1,
              total,
              name: activeRoom?.name ?? "",
            })}
          </p>
        </div>

        {/* Count chips + hint for the active room. */}
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-600 font-medium">
            <AppWindow size={13} /> {t("project.windowCount", { count: winCount })}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 font-medium">
            <DoorOpen size={13} /> {t("project.doorCount", { count: doorCount })}
          </span>
          <span className="text-[var(--muted-foreground)]">· {t("project.confirmRoomHint")}</span>
        </div>

        <FloorPlanEditor
          key={activeRoomId}
          analysis={analysis}
          floorPlanImageSrc={floorPlanSrc}
          selectedRoomId={selectedRoomId}
          onRoomSelect={handleGuidedRoomSelect}
          onRoomsChange={handleRoomsChange}
          onColumnsChange={handleColumnsChange}
          roomTypeLabel={projectRoomTypeLabel}
          focusRoomId={activeRoomId}
          isMobile={isMobile}
        />

        {/* Sticky action bar: Back / Confirm room. */}
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-[var(--background)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--background)]/80">
          <div className="max-w-3xl mx-auto w-full flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => (clampedIndex === 0 ? setEditMode(false) : goToRoom(clampedIndex - 1))}
              className="inline-flex items-center gap-1.5 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] text-sm font-medium hover:bg-[var(--muted)]/80 cursor-pointer"
            >
              <ChevronLeft size={18} /> {t("common.back")}
            </button>
            <button
              type="button"
              onClick={confirmActiveRoom}
              className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-bold hover:brightness-110 cursor-pointer min-h-[48px]"
            >
              <Check size={18} />{" "}
              {isLast ? t("project.confirmRoomDone") : t("project.confirmRoomNext")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="cd-step-title">{t("project.matchingTitle")}</h2>
        <p className="cd-step-subtitle">{t("project.matchingDetectedRooms", { count: analysis.rooms.length })}</p>
        <button
          type="button"
          onClick={startRoomReview}
          className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] text-sm font-medium hover:bg-[var(--muted)]/80 cursor-pointer"
        >
          <Pencil size={15} /> {t("project.editPlanCta")}
        </button>
      </div>

      <div className={`grid gap-6 ${isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
        <FloorPlanHub
          analysis={analysis}
          floorPlanImageSrc={floorPlanSrc}
          rooms={[]}
          selectedRoomId={selectedRoomId}
          suggestedNextRoomId={null}
          onRoomSelect={handleRoomSelect}
          mode="review"
          utilityPoints={utilityPoints}
          activePlacementType={activePlacementType}
          onPlaceUtility={handlePlaceUtility}
          onRemoveUtility={handleRemoveUtility}
          viewpointMarkers={viewpointMarkers}
          activeViewpointPhotoId={viewpointPhotoId}
          onPlaceViewpoint={handlePlaceViewpoint}
          onMoveColumn={handleMoveColumn}
          onRemoveColumn={handleRemoveColumn}
        />

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 p-4 rounded-xl border border-[var(--border)] bg-[var(--card)] min-h-[200px]">
            {!selectedRoom ? (
              <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
                {t("project.assignPhoto")}
              </p>
            ) : (
            <>
              <div>
                <h3 className="text-lg font-bold">{selectedRoom.name}</h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {projectRoomTypeLabel(selectedRoom.type)} · ~{selectedRoom.estimatedArea}m²
                </p>
              </div>

              {(() => {
                const poly = sanitizePolygon(selectedRoom.polygon);
                const dims = getDims(selectedRoom.id);
                const inputCls =
                  "w-full px-2 py-1.5 rounded-lg bg-[var(--muted)] border border-[var(--border)] text-sm";
                // Rooms with a real polygon (the normal case) edit by wall length so
                // L-shaped / non-rectangular rooms are correct, not just a bbox.
                if (poly && poly.length >= 3) {
                  const n = poly.length;
                  const hKey = `${selectedRoom.id}:height`;
                  return (
                    <div className="flex flex-col gap-2">
                      <div>
                        <label className="text-[10px] uppercase text-[var(--muted-foreground)]">
                          {t("project.dimHeight")}
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          value={fieldValue(hKey, dims.height)}
                          onChange={(e) =>
                            handleFieldInput(hKey, e.target.value, (v) =>
                              handleDimChange(selectedRoom.id, "height", v),
                            )
                          }
                          onBlur={() => handleFieldBlur(hKey)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-[var(--muted-foreground)] mb-1">
                          {t("project.dimWalls")}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {poly.map((_, i) => {
                            const wKey = `${selectedRoom.id}:w${i}`;
                            return (
                              <label key={i} className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold w-10 tabular-nums shrink-0">
                                  {cornerLabel(i)}-{cornerLabel((i + 1) % n)}
                                </span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  value={fieldValue(wKey, edgeLengthMm(poly, i) / 1000)}
                                  onChange={(e) =>
                                    handleFieldInput(wKey, e.target.value, (v) =>
                                      handleWallLengthChange(selectedRoom.id, i, v),
                                    )
                                  }
                                  onBlur={() => handleFieldBlur(wKey)}
                                  className={inputCls}
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                }
                // Fallback: no polygon — keep simple width/depth/height inputs.
                return (
                  <div className="grid grid-cols-3 gap-2">
                    {(["width", "depth", "height"] as const).map((key) => {
                      const fKey = `${selectedRoom.id}:${key}`;
                      return (
                        <div key={key}>
                          <label className="text-[10px] uppercase text-[var(--muted-foreground)]">{key} (m)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={fieldValue(fKey, dims[key])}
                            onChange={(e) =>
                              handleFieldInput(fKey, e.target.value, (v) =>
                                handleDimChange(selectedRoom.id, key, v),
                              )
                            }
                            onBlur={() => handleFieldBlur(fKey)}
                            className={inputCls}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              <div>
                <p className="text-xs font-semibold mb-2">{t("project.roomPhotosCount", { count: matchedPhotos.length, max: 35 })}</p>
                <div className="flex flex-col gap-2">
                  {matchedPhotos.map((photo) => {
                    const placing = viewpointPhotoId === photo.id;
                    const structuralEditing = structuralEditPhotoId === photo.id;
                    const hasVp = Boolean(photo.viewpoint);
                    return (
                      <div key={photo.id} className="flex flex-col gap-1.5 p-2 rounded-lg border border-green-500/30 bg-[var(--muted)]/40">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setLightboxSrc(`data:${photo.mimeType};base64,${photo.base64}`)}
                            className="relative w-16 h-12 rounded-md overflow-hidden shrink-0 cursor-zoom-in group"
                            title={t("project.viewPhotoFull")}
                          >
                            <img src={`data:${photo.mimeType};base64,${photo.base64}`} alt={photo.label} className="w-full h-full object-cover" />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                              <Maximize2 size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </span>
                          </button>
                          <span className="text-xs truncate flex-1">{photo.label || photo.id.slice(0, 10)}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setStructuralEditPhotoId(structuralEditing ? null : photo.id);
                              if (!structuralEditing) {
                                setViewpointPhotoId(null);
                                setActivePlacementType(null);
                              }
                            }}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border cursor-pointer shrink-0 ${
                              structuralEditing
                                ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                                : photoHasGeometryMarks(photo)
                                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600"
                                  : "border-[var(--border)] bg-[var(--card)]"
                            }`}
                          >
                            <Paintbrush size={12} />
                            {photoHasGeometryMarks(photo)
                              ? t("project.removeItemsDone")
                              : t("project.removeItemsOpen")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setViewpointPhotoId(placing ? null : photo.id);
                              if (!placing) {
                                setActivePlacementType(null);
                                setStructuralEditPhotoId(null);
                              }
                            }}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border cursor-pointer shrink-0 ${
                              placing
                                ? "border-purple-500 bg-purple-500/10 text-purple-600"
                                : hasVp
                                  ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-600"
                                  : "border-[var(--border)] bg-[var(--card)]"
                            }`}
                          >
                            <Camera size={12} /> {hasVp ? t("project.viewpointEdit") : t("project.viewpointSet")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (placing) setViewpointPhotoId(null);
                              if (structuralEditing) setStructuralEditPhotoId(null);
                              setPhotoRoomMatch(photo.id, null);
                            }}
                            className="p-1 rounded-full bg-black/60 text-white cursor-pointer shrink-0"
                            aria-label={t("common.cancel")}
                          >
                            <X size={11} />
                          </button>
                        </div>
                        {structuralEditing && (
                          <PhotoStructuralEditPanel
                            photo={photo}
                            onExport={(result) => {
                              applyStructuralCanvasExport(
                                photo.id,
                                result,
                                setPhotoStructuralLineMap,
                                setPhotoObjectRemovalMask,
                              );
                              setStructuralEditPhotoId(null);
                            }}
                            onSkip={() => {
                              clearStructuralCanvasMarks(
                                photo.id,
                                setPhotoStructuralLineMap,
                                setPhotoObjectRemovalMask,
                                setPhotoOpeningAnalysis,
                              );
                              setStructuralEditPhotoId(null);
                            }}
                            onFinish={() => setStructuralEditPhotoId(null)}
                          />
                        )}
                        {placing && (
                          <div className="flex flex-col gap-1">
                            <p className="text-[11px] text-[var(--muted-foreground)]">
                              {hasVp ? t("project.viewpointAdjustHint") : t("project.viewpointPlaceHint")}
                            </p>
                            {hasVp && (
                              <label className="flex items-center gap-2 text-[11px]">
                                <span className="text-[var(--muted-foreground)] shrink-0">{t("project.viewpointDirection")}</span>
                                <input
                                  type="range"
                                  min={0}
                                  max={359}
                                  value={photo.viewpoint!.angleDeg}
                                  onChange={(e) =>
                                    setPhotoViewpoint(photo.id, {
                                      ...photo.viewpoint!,
                                      angleDeg: Number(e.target.value),
                                    })
                                  }
                                  className="flex-1 cursor-pointer"
                                />
                                <span className="w-9 text-right tabular-nums">{photo.viewpoint!.angleDeg}°</span>
                              </label>
                            )}
                            {hasVp && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPhotoViewpoint(photo.id, null);
                                  setViewpointPhotoId(null);
                                }}
                                className="self-start text-[11px] text-red-500 hover:underline cursor-pointer"
                              >
                                {t("project.viewpointClear")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {assignablePhotos.length > 0 && (
                  <AssignPhotoDropdown
                    photos={assignablePhotos}
                    roomName={(roomId) => analysis.rooms.find((r) => r.id === roomId)?.name}
                    onSelect={handleAssignPhotoToRoom}
                  />
                )}
                {roomPhotos.length < MAX_ROOM_PHOTOS && (
                  <label className="mt-2 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-dashed border-[var(--border)] cursor-pointer hover:bg-[var(--muted)]">
                    <Plus size={14} /> {t("project.addPhoto")}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      onChange={handleAddPhotos}
                    />
                  </label>
                )}
              </div>
            </>
          )}
          </div>

          <div className="flex flex-col gap-3 p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <div>
              <h3 className="text-sm font-bold">{t("project.utilityEntryPoints")}</h3>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                {t("project.utilityInstruction")}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {UTILITY_TYPES.map((type) => {
                const active = activePlacementType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => togglePlacementType(type)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--muted)]/80"
                    }`}
                  >
                    <UtilityTypeIcon type={type} size={20} />
                    {utilityTypeLabel(type, t)}
                  </button>
                );
              })}
            </div>

            {utilityPoints.length > 0 && (
              <ul className="flex flex-col gap-2">
                {utilityPoints.map((point) => (
                  <li
                    key={point.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--muted)] text-xs"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <UtilityTypeIcon type={point.type} size={18} />
                      <span className="truncate">{point.label || utilityTypeLabel(point.type, t)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveUtility(point.id)}
                      className="p-1 rounded-full hover:bg-black/10 cursor-pointer shrink-0"
                      aria-label={t("common.cancel")}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className={`flex gap-3 ${isMobile ? "flex-col" : ""}`}>
        <button
          type="button"
          onClick={() => setProjectStep("upload")}
          className="px-6 py-3 rounded-xl border border-[var(--border)] font-semibold flex items-center justify-center gap-2 cursor-pointer hover:bg-[var(--muted)]"
        >
          <ArrowLeft size={18} /> {t("common.back")}
        </button>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={projectLoading}
          className="flex-1 py-3 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-50 cursor-pointer"
        >
          {projectLoading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
          {t("project.confirmLayoutContinue")}
        </button>
      </div>
    </div>
  );
}

// --- Design Hub Step ---

function ProjectDesignHubStep({
  isMobile = false,
  rooms: roomsProp,
  projectId,
  concept,
  analysis,
  floorPlanBase64,
  floorPlanMimeType,
  setRooms,
  setProjectStep,
  setProjectLoading,
  setProjectError,
  setHasPdf,
  projectLoading,
  setLightboxSrc,
  onAiServiceUnavailable,
}: {
  isMobile?: boolean;
  rooms: RoomResult[];
  projectId: string | null;
  concept: ProjectConceptSummary | null;
  analysis: FloorPlanAnalysis | null;
  floorPlanBase64: string | null;
  floorPlanMimeType: string | null;
  setRooms: (rooms: RoomResult[] | ((prev: RoomResult[]) => RoomResult[])) => void;
  setProjectStep: (step: ProjectStep) => void;
  setProjectLoading: (loading: boolean) => void;
  setProjectError: (error: string | null) => void;
  setHasPdf: (has: boolean) => void;
  projectLoading: boolean;
  setLightboxSrc: (src: string | null) => void;
  onAiServiceUnavailable: () => void;
}) {
  const rooms = Array.isArray(roomsProp) ? roomsProp : [];
  const { t } = useTranslation();
  const { generateRoom: streamGenerateRoom } = useProjectSSE();
  const {
    addVersion,
    patchProject,
    loadProjects,
    isAuthenticated: isPersistenceAuthenticated,
  } = useProjectPersistence();
  const hubView = useConsumerDesignStore((s) => s.projectHubView);
  const activeRoomId = useConsumerDesignStore((s) => s.activeDesignRoomId);
  const selectedHubRoomId = useConsumerDesignStore((s) => s.selectedFloorPlanRoomId);
  const setSelectedFloorPlanRoomId = useConsumerDesignStore((s) => s.setSelectedFloorPlanRoomId);
  const roomPhotos = useConsumerDesignStore((s) => s.roomPhotos);
  const tokenBalance = useConsumerDesignStore((s) => s.tokenBalance);
  const setTokenBalance = useConsumerDesignStore((s) => s.setTokenBalance);
  const suggestedOrder = useConsumerDesignStore((s) => s.projectSuggestedRoomOrder);
  const hasPdf = useConsumerDesignStore((s) => s.hasPdf);
  const setHubView = useConsumerDesignStore((s) => s.setProjectHubView);
  const setActiveRoomId = useConsumerDesignStore((s) => s.setActiveDesignRoomId);
  const [liveProgressByRoom, setLiveProgressByRoom] = useState<Map<string, LiveGenProgress>>(() => new Map());
  const [generatingRoomIds, setGeneratingRoomIds] = useState<Set<string>>(() => new Set());
  const [generationOutcome, setGenerationOutcome] = useState<RoomGenOutcome | null>(null);
  const [serverCanFinalize, setServerCanFinalize] = useState<boolean | null>(null);
  const generatingProgressRef = useRef(
    new Map<string, { startedAt: number; lastStep?: string; lastStepAt: number }>(),
  );
  const generatingRoomIdsRef = useRef(generatingRoomIds);
  generatingRoomIdsRef.current = generatingRoomIds;
  const hubPanelRef = useRef<HTMLDivElement>(null);
  const [pendingGenerateRoomId, setPendingGenerateRoomId] = useState<string | null>(null);
  const [selectionFlashRoomId, setSelectionFlashRoomId] = useState<string | null>(null);

  const trackRoomGenerationStart = useCallback((roomId: string) => {
    setGeneratingRoomIds((prev) => new Set(prev).add(roomId));
    generatingProgressRef.current.set(roomId, {
      startedAt: Date.now(),
      lastStepAt: Date.now(),
    });
    patchLiveProgress(setLiveProgressByRoom, roomId, {
      progress: 0.03,
      message: t("project.generationStarting"),
    });
  }, [t]);

  const trackRoomGenerationEnd = useCallback((roomId: string) => {
    generatingProgressRef.current.delete(roomId);
    setGeneratingRoomIds((prev) => {
      const next = new Set(prev);
      next.delete(roomId);
      return next;
    });
    setLiveProgressByRoom((prev) => {
      const next = new Map(prev);
      next.delete(roomId);
      return next;
    });
  }, []);

  const handleCancelRoomGeneration = useCallback(
    async (roomId: string) => {
      if (!projectId) return;
      cancelActiveRoomGeneration();
      try {
        const res = await fetch(
          `/api/project/${projectId}/cancel-generation/${encodeURIComponent(roomId)}`,
          { method: "POST" },
        );
        const json = (await res.json().catch(() => ({}))) as {
          data?: { room?: RoomResult };
        };
        if (json.data?.room) {
          setRooms((prev) =>
            prev.map((r) => (r.roomId === roomId ? { ...r, ...json.data!.room! } : r)),
          );
        } else {
          const refresh = await fetch(`/api/project/${projectId}?status=1`, { cache: "no-store" });
          const refreshJson = await refresh.json();
          if (refreshJson.data?.rooms) {
            setRooms(refreshJson.data.rooms as RoomResult[]);
          }
        }
      } catch {
        /* ignore */
      }
      trackRoomGenerationEnd(roomId);
      setProjectError(null);
    },
    [projectId, setRooms, trackRoomGenerationEnd, setProjectError],
  );

  const trackRoomGenerationProgress = useCallback(
    (roomId: string, ev: { progress?: number; message?: string; data?: unknown }) => {
      const data = ev.data as
        | { generationStep?: string; viewIndex?: number; viewTotal?: number }
        | undefined;
      patchLiveProgress(setLiveProgressByRoom, roomId, {
        progress: ev.progress,
        message: ev.message,
        generationStep: data?.generationStep,
        viewIndex: data?.viewIndex,
        viewTotal: data?.viewTotal,
      });
      if (data?.generationStep) {
        setRooms((prev) =>
          prev.map((r) =>
            r.roomId === roomId
              ? {
                  ...r,
                  generationStep: data.generationStep as RoomResult["generationStep"],
                }
              : r,
          ),
        );
      }
    },
    [setRooms],
  );

  const floorPlanSrc =
    floorPlanBase64 && floorPlanMimeType
      ? `data:${floorPlanMimeType};base64,${floorPlanBase64}`
      : "";

  const roomIds = getFinalizeRequiredRoomIds(analysis, concept, suggestedOrder, rooms);
  const orderedDesignable = getOrderedDesignableRoomIds(analysis, concept, suggestedOrder);
  const { approved, total, allApproved } = getApprovalProgress(roomIds, rooms);

  const showPdfReadyCard = allApproved && !hasPdf && serverCanFinalize !== false;

  useEffect(() => {
    if (!projectId || Array.isArray(roomsProp)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/project/${projectId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (json.data?.rooms && Array.isArray(json.data.rooms)) {
          setRooms(json.data.rooms);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, roomsProp, setRooms]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/project/${projectId}?status=1`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const data = json.data as {
          rooms?: RoomResult[];
          canFinalize?: boolean;
        };
        if (data?.rooms) {
          const inFlight = detectInFlightRoomIds(data.rooms);
          if (inFlight.length > 0) {
            setGeneratingRoomIds((prev) => {
              const next = new Set(prev);
              for (const id of inFlight) next.add(id);
              return next;
            });
            for (const id of inFlight) {
              if (!generatingProgressRef.current.has(id)) {
                generatingProgressRef.current.set(id, {
                  startedAt: Date.now(),
                  lastStepAt: Date.now(),
                });
              }
            }
          }
          const normalized = normalizeStaleGeneratingRooms(data.rooms, new Set(inFlight));
          setRooms((prev) =>
            prev.map((r) => {
              const polled = normalized.find((p) => p.roomId === r.roomId);
              if (!polled) return r;
              const polledRenders = polled.renders ?? [];
              const mergedRenders = mergePolledRenders(
                r.renders,
                polledRenders,
                r.generationAttempt,
                polled.generationAttempt,
              );
              return {
                ...r,
                status: polled.status,
                generationStep: polled.generationStep,
                generationError: polled.generationError,
                generationFailedAt: polled.generationFailedAt,
                generationAttempt: polled.generationAttempt,
                viewpointTargetCount: polled.viewpointTargetCount,
                gallerySyncComplete: polled.gallerySyncComplete,
                viewpointErrors: polled.viewpointErrors,
                photoRenderMap: polled.photoRenderMap ?? r.photoRenderMap,
                renders: mergedRenders,
              };
            }),
          );
        }
        if (!cancelled) setServerCanFinalize(data?.canFinalize ?? null);
      } catch {
        if (!cancelled) setServerCanFinalize(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, setRooms, approved, total]);

  useEffect(() => {
    if (!projectId || generatingRoomIds.size === 0) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/project/${projectId}?status=1`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const data = json.data as { rooms?: RoomResult[] };
        if (data?.rooms) {
          const tracked = generatingRoomIdsRef.current;
          const normalized = normalizeStaleGeneratingRooms(data.rooms, tracked);
          setRooms((prev) =>
            prev.map((r) => {
              const polled = normalized.find((p) => p.roomId === r.roomId);
              if (!polled) return r;
              const polledRenders = polled.renders ?? [];
              const mergedRenders = mergePolledRenders(
                r.renders,
                polledRenders,
                r.generationAttempt,
                polled.generationAttempt,
              );
              return {
                ...r,
                status: polled.status,
                generationStep: polled.generationStep,
                generationError: polled.generationError,
                generationFailedAt: polled.generationFailedAt,
                generationAttempt: polled.generationAttempt,
                viewpointTargetCount: polled.viewpointTargetCount,
                gallerySyncComplete: polled.gallerySyncComplete,
                viewpointErrors: polled.viewpointErrors,
                photoRenderMap: polled.photoRenderMap ?? r.photoRenderMap,
                renders: mergedRenders,
              };
            }),
          );

          const nextTracked = new Set(tracked);
          const clearedOutcomes: RoomGenOutcome[] = [];
          const staleRoomIds: string[] = [];

          for (const id of tracked) {
            const raw = data.rooms.find((r) => r.roomId === id);
            const norm = normalized.find((r) => r.roomId === id);
            if (shouldClearGeneratingRoomId(raw, norm)) {
              nextTracked.delete(id);
              generatingProgressRef.current.delete(id);
              const roomName = raw?.brief?.roomName ?? norm?.brief?.roomName ?? id;
              if ((raw?.renders?.length ?? 0) > 0) {
                const roomForMsg = raw ?? norm!;
                clearedOutcomes.push(buildRoomGenSuccessOutcome(roomForMsg, t));
              } else if (raw?.generationError || norm?.generationError) {
                clearedOutcomes.push({
                  kind: "error",
                  message: t("project.generationFailed", {
                    message: raw?.generationError ?? norm?.generationError ?? t("common.error"),
                  }),
                  roomId: id,
                });
              }
              continue;
            }

            const step = norm?.generationStep ?? raw?.generationStep;
            const trackedMeta = generatingProgressRef.current.get(id);
            if (trackedMeta) {
              const now = Date.now();
              if (step && step !== trackedMeta.lastStep) {
                trackedMeta.lastStep = step;
                trackedMeta.lastStepAt = now;
              } else if (now - trackedMeta.lastStepAt > GENERATION_STALE_TIMEOUT_MS) {
                nextTracked.delete(id);
                generatingProgressRef.current.delete(id);
                staleRoomIds.push(id);
              }
            }

            if (step) {
              patchLiveProgress(setLiveProgressByRoom, id, {
                message: roomGenerationProgressLabel(norm ?? raw, t),
              });
            }
          }

          setGeneratingRoomIds(nextTracked);

          if (clearedOutcomes.length > 0) {
            const last = clearedOutcomes[clearedOutcomes.length - 1]!;
            setGenerationOutcome(last);
            if (last.kind === "success") {
              setHubView("roomDesign");
              setActiveRoomId(last.roomId);
            }
          }

          setLiveProgressByRoom((prev) => {
            const next = new Map(prev);
            for (const id of prev.keys()) {
              if (!nextTracked.has(id)) next.delete(id);
            }
            return next;
          });

          if (staleRoomIds.length > 0) {
            setProjectError(t("project.generationTimedOut"));
          }
        }
      } catch {
        /* ignore poll errors */
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [projectId, generatingRoomIds.size, setRooms, setProjectError, t]);
  const finalizeProject = useProjectFinalize({
    projectId,
    concept,
    analysis,
    rooms,
    suggestedOrder,
    setProjectStep,
    setProjectLoading,
    setProjectError,
    setHasPdf,
    setRooms,
  });

  const hubInsufficientForGenerate = hasInsufficientTokens(tokenBalance, TOKEN_COSTS.generate);
  const hubInsufficientForRegenerate = hasInsufficientTokens(tokenBalance, TOKEN_COSTS.regenerate);

  const roomHasPhotos = useCallback(
    (roomId: string) => roomPhotos.some((p) => p.matchedRoomId === roomId),
    [roomPhotos],
  );

  const startRoomGeneration = useCallback(
    async (roomId: string, opts?: { regenerate?: boolean; background?: boolean }) => {
      if (!projectId) return;
      if (generatingRoomIds.has(roomId)) {
        setProjectError(t("project.generationAlreadyRunning"));
        return;
      }
      if (generatingRoomIds.size >= MAX_PARALLEL_ROOM_GENERATIONS) {
        setProjectError(
          t("project.maxParallelGenerations", {
            max: String(MAX_PARALLEL_ROOM_GENERATIONS),
          }),
        );
        return;
      }
      if (
        !assertSufficientTokensForAction(
          opts?.regenerate ? "regenerate" : "generate",
          tokenBalance,
          setProjectError,
          t,
        )
      ) {
        return;
      }
      userFlowLog(5, "manual room generation", { projectId, roomId, background: !!opts?.background }, "F");
      setProjectError(null);
      setGenerationOutcome(null);
      setPendingGenerateRoomId(roomId);
      trackRoomGenerationStart(roomId);

      const background = opts?.background ?? false;
      if (!background) {
        setHubView("roomDesign");
        setActiveRoomId(roomId);
      } else {
        requestAnimationFrame(() => {
          hubPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }

      let keepGenerating = false;
      try {
        const event = await streamGenerateRoom(
          projectId,
          roomId,
          (ev) => {
            trackRoomGenerationProgress(roomId, ev);
          },
          { action: opts?.regenerate ? "regenerate" : "generate" },
        );
        const data = event.data as { room?: RoomResult };
        let roomResult: RoomResult | undefined = data?.room;
        if (roomResult) {
          setRooms(
            rooms.some((r) => r.roomId === roomId)
              ? rooms.map((r) => (r.roomId === roomId ? roomResult! : r))
              : [...rooms, roomResult],
          );
        } else {
          const res = await fetch(`/api/project/${projectId}`);
          const json = await res.json();
          if (json.data?.rooms) {
            setRooms(normalizeStaleGeneratingRooms(json.data.rooms, generatingRoomIdsRef.current));
            roomResult = (json.data.rooms as RoomResult[]).find((r) => r.roomId === roomId);
          }
        }

        const roomName = roomResult?.brief?.roomName ?? rooms.find((r) => r.roomId === roomId)?.brief?.roomName ?? roomId;
        if (roomResult && (roomResult.renders?.length ?? 0) > 0) {
          setGenerationOutcome(buildRoomGenSuccessOutcome(roomResult, t));
          setHubView("roomDesign");
          setActiveRoomId(roomId);
        }

        applyPostRenderBalance(event, setTokenBalance);

        if (isPersistenceAuthenticated() && roomResult) {
          const store = useConsumerDesignStore.getState();
          const dbId = store.currentProjectDbId;
          const summary = store.savedProjects.find((p) => p.id === dbId);
          const primaryRender = roomResult.renders[0];
          if (dbId && summary && summary.versionCount === 0 && primaryRender?.base64) {
            await addVersion({
              base64: primaryRender.base64,
              mimeType: primaryRender.mimeType,
              roomId,
              angleIndex: primaryRender.angleIndex ?? 0,
            });
            void loadProjects({ mode: "project" });
          } else if (dbId && !summary?.coverImageUrl && !primaryRender?.base64 && store.floorPlanBase64) {
            void patchProject(dbId, {
              floor_plan_base64: store.floorPlanBase64,
              floor_plan_mime: store.floorPlanMimeType ?? "image/jpeg",
            });
          }
        }
      } catch (err) {
        if (isRoomGenerationAlreadyRunningError(err)) {
          keepGenerating = true;
          setProjectError(t("project.generationAlreadyRunning"));
        } else if (isGenerationCancelledError(err)) {
          setProjectError(null);
          setGenerationOutcome(null);
          void fetch(`/api/project/${projectId}?status=1`)
            .then((r) => r.json())
            .then((json) => {
              if (json.data?.rooms) {
                setRooms(json.data.rooms as RoomResult[]);
              }
            })
            .catch(() => {});
        } else if (handleAiServiceUnavailableClientError(err, onAiServiceUnavailable)) {
          setProjectError(null);
          setGenerationOutcome(null);
        } else if (handleTokenBillingClientError(err, setTokenBalance, setProjectError, t)) {
          setGenerationOutcome(null);
        } else {
          const errMsg = userFacingError(err, t("common.error"));
          setProjectError(errMsg);
          setGenerationOutcome({
            kind: "error",
            message: t("project.generationFailed", { message: errMsg }),
            roomId,
          });
          if (!background) {
            setHubView("floorPlan");
            setActiveRoomId(null);
          }
          void fetch(`/api/project/${projectId}`)
            .then((r) => r.json())
            .then((json) => {
              if (json.data?.rooms) {
                setRooms(normalizeStaleGeneratingRooms(json.data.rooms, generatingRoomIdsRef.current));
              }
            })
            .catch(() => {});
        }
      } finally {
        setPendingGenerateRoomId((prev) => (prev === roomId ? null : prev));
        if (!keepGenerating) {
          trackRoomGenerationEnd(roomId);
        }
      }
    },
    [
      projectId,
      generatingRoomIds,
      rooms,
      setRooms,
      setProjectError,
      setHubView,
      setActiveRoomId,
      streamGenerateRoom,
      addVersion,
      patchProject,
      loadProjects,
      isPersistenceAuthenticated,
      tokenBalance,
      setTokenBalance,
      trackRoomGenerationStart,
      trackRoomGenerationEnd,
      trackRoomGenerationProgress,
      onAiServiceUnavailable,
      t,
    ],
  );

  const startNextViewGeneration = useCallback(
    async (roomId: string, opts?: { openRoom?: boolean }) => {
      if (!projectId) return;
      if (generatingRoomIds.has(roomId)) {
        setProjectError(t("project.generationAlreadyRunning"));
        return;
      }
      if (generatingRoomIds.size >= MAX_PARALLEL_ROOM_GENERATIONS) {
        setProjectError(
          t("project.maxParallelGenerations", {
            max: String(MAX_PARALLEL_ROOM_GENERATIONS),
          }),
        );
        return;
      }
      if (!assertSufficientTokensForAction("next-viewpoint", tokenBalance, setProjectError, t)) {
        return;
      }
      userFlowLog(5, "generate next view", { projectId, roomId }, "F");
      setProjectError(null);
      setGenerationOutcome(null);
      trackRoomGenerationStart(roomId);
      if (opts?.openRoom !== false) {
        setHubView("roomDesign");
        setActiveRoomId(roomId);
      }
      let keepGenerating = false;
      try {
        const event = await streamGenerateRoom(
          projectId,
          roomId,
          (ev) => trackRoomGenerationProgress(roomId, ev),
          { action: "next-viewpoint" },
        );
        applyPostRenderBalance(event, setTokenBalance);
        const res = await fetch(`/api/project/${projectId}`, { cache: "no-store" });
        const json = await res.json();
        if (json.data?.rooms) {
          setRooms(normalizeStaleGeneratingRooms(json.data.rooms, generatingRoomIdsRef.current));
          const roomResult = (json.data.rooms as RoomResult[]).find((r) => r.roomId === roomId);
          if (roomResult && (roomResult.renders?.length ?? 0) > 0) {
            setGenerationOutcome(buildRoomGenSuccessOutcome(roomResult, t));
          }
        }
      } catch (err) {
        if (isRoomGenerationAlreadyRunningError(err)) {
          keepGenerating = true;
          setProjectError(t("project.generationAlreadyRunning"));
        } else if (isGenerationCancelledError(err)) {
          setProjectError(null);
          setGenerationOutcome(null);
        } else if (handleAiServiceUnavailableClientError(err, onAiServiceUnavailable)) {
          setProjectError(null);
          setGenerationOutcome(null);
        } else if (handleTokenBillingClientError(err, setTokenBalance, setProjectError, t)) {
          setGenerationOutcome(null);
        } else {
          const errMsg = userFacingError(err, t("common.error"));
          setProjectError(errMsg);
          setGenerationOutcome({
            kind: "error",
            message: t("project.generationFailed", { message: errMsg }),
            roomId,
          });
        }
      } finally {
        if (!keepGenerating) {
          trackRoomGenerationEnd(roomId);
        }
      }
    },
    [
      projectId,
      generatingRoomIds,
      setRooms,
      setProjectError,
      setHubView,
      setActiveRoomId,
      streamGenerateRoom,
      setTokenBalance,
      tokenBalance,
      trackRoomGenerationStart,
      trackRoomGenerationEnd,
      trackRoomGenerationProgress,
      onAiServiceUnavailable,
      t,
    ],
  );

  const getRoomGenerationDisplay = useCallback(
    (roomId: string) => {
      const room = rooms.find((r) => r.roomId === roomId);
      return resolveRoomGenerationDisplay(room, t, liveProgressByRoom.get(roomId));
    },
    [rooms, t, liveProgressByRoom],
  );

  const bannerInFlight = useMemo(
    () =>
      [...generatingRoomIds].map((roomId) => {
        const room = rooms.find((r) => r.roomId === roomId);
        return {
          roomId,
          roomName: room?.brief?.roomName ?? roomId,
          display: getRoomGenerationDisplay(roomId),
        };
      }),
    [generatingRoomIds, rooms, getRoomGenerationDisplay],
  );

  const handleViewDesignFromBanner = useCallback(
    (roomId: string) => {
      setGenerationOutcome(null);
      setActiveRoomId(roomId);
      setHubView("roomDesign");
    },
    [setActiveRoomId, setHubView],
  );

  const handleRoomSelect = useCallback(
    (roomId: string) => {
      setSelectedFloorPlanRoomId(roomId);
      setSelectionFlashRoomId(roomId);
      window.setTimeout(() => {
        setSelectionFlashRoomId((prev) => (prev === roomId ? null : prev));
      }, 700);
      const existing = rooms.find((r) => r.roomId === roomId);
      const isGenerating = generatingRoomIds.has(roomId);
      const hasPhaseWork =
        existing?.phases &&
        (existing.phases.base.versions.length > 0 ||
          existing.phases.furniture.versions.length > 0 ||
          existing.phases.decor.versions.length > 0);
      if (
        existing &&
        !isGenerating &&
        (hasPhaseWork || existing.renders.length > 0 || existing.status === "approved")
      ) {
        userFlowLog(5, "opened room design review", {
          roomId,
          status: existing.status,
          renderCount: existing.renders.length,
        }, "F");
        setActiveRoomId(roomId);
        setHubView("roomDesign");
      }
    },
    [rooms, setActiveRoomId, setHubView, setSelectedFloorPlanRoomId, generatingRoomIds],
  );

  if (hubView === "roomDesign" && activeRoomId) {
    const roomIndex = rooms.findIndex((r) => r.roomId === activeRoomId);
    // Only swap to the room-level progress panel for the initial generation
    // (no renders yet). Once renders exist, keep the review step mounted so
    // its per-view progress (placeholder cards, redo overlays) can show.
    const activeRoom = roomIndex >= 0 ? rooms[roomIndex] : undefined;
    const showInitialGenerationPanel =
      generatingRoomIds.has(activeRoomId) && (activeRoom?.renders.length ?? 0) === 0;
    return (
      <div className="flex flex-col gap-4">
        <RoomGenerationBanner
          inFlight={bannerInFlight}
          outcome={generationOutcome}
          onDismissOutcome={() => setGenerationOutcome(null)}
          onViewDesign={handleViewDesignFromBanner}
          onCancelGeneration={handleCancelRoomGeneration}
          onGenerateNextView={(roomId) => void startNextViewGeneration(roomId)}
        />
        <button
          type="button"
          onClick={() => {
            setHubView("floorPlan");
            setActiveRoomId(null);
          }}
          className="self-start px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--muted)] cursor-pointer flex items-center gap-2"
        >
          <ArrowLeft size={16} /> {t("common.back")}
        </button>
        {showInitialGenerationPanel ? (
          <RoomGenerationProgress
            {...getRoomGenerationDisplay(activeRoomId)}
            onCancel={() => void handleCancelRoomGeneration(activeRoomId)}
          />
        ) : (
          <ProjectRoomReviewStep
            isMobile={isMobile}
            rooms={rooms}
            currentRoomIndex={Math.max(0, roomIndex)}
            projectId={projectId}
            concept={concept}
            analysis={analysis}
            roomPhotos={roomPhotos}
            setRooms={setRooms}
            setCurrentRoomIndex={() => {}}
            setProjectStep={setProjectStep}
            setProjectLoading={setProjectLoading}
            setProjectError={setProjectError}
            setHasPdf={setHasPdf}
            projectLoading={projectLoading}
            setLightboxSrc={setLightboxSrc}
            onBackToHub={() => {
              setHubView("floorPlan");
              setActiveRoomId(null);
            }}
            onTrackGenerationStart={trackRoomGenerationStart}
            onTrackGenerationEnd={trackRoomGenerationEnd}
            onTrackGenerationProgress={trackRoomGenerationProgress}
            onCancelRoomGeneration={handleCancelRoomGeneration}
            onAiServiceUnavailable={onAiServiceUnavailable}
          />
        )}
      </div>
    );
  }

  if (!analysis || !floorPlanSrc) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={40} className="animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <RoomGenerationBanner
        inFlight={bannerInFlight}
        outcome={generationOutcome}
        onDismissOutcome={() => setGenerationOutcome(null)}
        onViewDesign={handleViewDesignFromBanner}
        onCancelGeneration={handleCancelRoomGeneration}
        onGenerateNextView={(roomId) => void startNextViewGeneration(roomId)}
      />
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="cd-step-title">{concept?.projectName || t("page.modeFullProject")}</h2>
        {total > 0 && (
          <p className="text-sm font-medium text-[var(--muted-foreground)]">
            {showPdfReadyCard
              ? t("project.hubAllApprovedHint")
              : t("project.hubProgress", { approved, total })}
          </p>
        )}
        <p className="cd-step-subtitle">
          {allApproved
            ? t("project.hubAllApprovedHint")
            : t("project.hubSubtitleDesignRooms")}
        </p>
        {generatingRoomIds.size > 0 && (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("project.parallelGenerating", {
              count: String(generatingRoomIds.size),
              max: String(MAX_PARALLEL_ROOM_GENERATIONS),
            })}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setProjectStep("designBrief")}
          className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--muted)] cursor-pointer flex items-center gap-2"
        >
          <ArrowLeft size={16} /> {t("common.back")}
        </button>
      </div>
      {showPdfReadyCard && (
        <ProjectFinalizeCard
          variant="ready"
          loading={projectLoading}
          onBuildPdf={() => void finalizeProject()}
        />
      )}
      {allApproved && !hasPdf && serverCanFinalize === false && (
        <p className="text-sm text-center text-amber-600 dark:text-amber-400 px-4">
          {t("project.finalizeNotReady")}
        </p>
      )}
      {hasPdf && projectId && (
        <ProjectFinalizeCard
          variant="complete"
          projectName={concept?.projectName}
          downloadHref={`/api/project/${projectId}/pdf`}
        />
      )}
      {(() => {
        const suggestedNextRoomId = nextHubRoomId(
          orderedDesignable,
          rooms,
          generatingRoomIds,
          selectedHubRoomId,
        );
        return (
          <FloorPlanHub
            analysis={analysis}
            floorPlanImageSrc={floorPlanSrc}
            rooms={rooms.map((r) =>
              generatingRoomIds.has(r.roomId) && !isRoomGenerationSettled(r)
                ? { ...r, status: "generating" as const }
                : r,
            )}
            selectedRoomId={selectedHubRoomId}
            suggestedNextRoomId={suggestedNextRoomId}
            onRoomSelect={handleRoomSelect}
            onNextRoom={() => {
              if (suggestedNextRoomId) handleRoomSelect(suggestedNextRoomId);
            }}
            mode="design"
            selectionFlashRoomId={selectionFlashRoomId}
          />
        );
      })()}
      {selectedHubRoomId && hubView === "floorPlan" && (() => {
        const selectedRoom = analysis.rooms.find((r) => r.id === selectedHubRoomId);
        const roomResult = rooms.find((r) => r.roomId === selectedHubRoomId);
        const isGenerating = generatingRoomIds.has(selectedHubRoomId);
        const isPendingStart = pendingGenerateRoomId === selectedHubRoomId;
        const hasPhotos = roomHasPhotos(selectedHubRoomId);
        const statusLabel = roomHubStatusLabel(selectedHubRoomId, rooms, t);
        const roomPhotosForRoom = roomPhotos.filter((p) => p.matchedRoomId === selectedHubRoomId);
        const primaryRender = roomResult?.renders?.[0];
        const viewsTarget = roomResult?.viewpointTargetCount ?? roomPhotosForRoom.length;
        const viewsRendered = roomResult?.renders?.length ?? 0;
        const viewsRemaining = Math.max(0, viewsTarget - viewsRendered);
        const showCompletion =
          !isGenerating &&
          !isPendingStart &&
          !!primaryRender?.base64 &&
          (roomResult?.status === "review" || roomResult?.status === "pending" || viewsRendered > 0);
        return (
          <div
            ref={hubPanelRef}
            className={`flex flex-col items-center gap-3 p-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] w-full max-w-lg mx-auto transition-shadow ${
              selectionFlashRoomId === selectedHubRoomId ? "ring-2 ring-[var(--primary)]/60 shadow-md" : ""
            }`}
          >
            <p className="text-sm font-semibold">{selectedRoom?.name ?? selectedHubRoomId}</p>
            <span className="text-xs px-2 py-1 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
              {statusLabel}
            </span>
            {roomResult?.generationError && roomResult.renders.length === 0 && (
              <p className="text-xs text-red-600 dark:text-red-400 text-center max-w-md">
                {sanitizeUserFacingMessage(roomResult.generationError)}
              </p>
            )}
            {!hasPhotos ? (
              <p className="text-xs text-[var(--muted-foreground)]">{t("project.noPhotoAssigned")}</p>
            ) : isGenerating || isPendingStart ? (
              <RoomGenerationProgress
                {...getRoomGenerationDisplay(selectedHubRoomId)}
                onCancel={() => void handleCancelRoomGeneration(selectedHubRoomId)}
              />
            ) : showCompletion ? (
              <div className="flex flex-col items-center gap-3 w-full">
                <button
                  type="button"
                  onClick={() => handleViewDesignFromBanner(selectedHubRoomId)}
                  className="rounded-xl overflow-hidden border border-[var(--border)] hover:brightness-105 transition-all cursor-pointer max-w-full"
                >
                  <img
                    src={`data:${primaryRender.mimeType};base64,${primaryRender.base64}`}
                    alt={selectedRoom?.name ?? selectedHubRoomId}
                    className="max-h-48 w-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => handleViewDesignFromBanner(selectedHubRoomId)}
                  className="px-5 py-2.5 rounded-xl border border-[var(--border)] text-sm font-semibold hover:bg-[var(--muted)] transition-all cursor-pointer"
                >
                  {t("project.viewDesign")}
                </button>
                {viewsRemaining > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => void startNextViewGeneration(selectedHubRoomId)}
                      disabled={
                        generatingRoomIds.size >= MAX_PARALLEL_ROOM_GENERATIONS ||
                        hubInsufficientForGenerate
                      }
                      className="px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white text-sm font-semibold hover:brightness-110 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                    >
                      <Sparkles size={16} />
                      {t("project.generateNextView", { n: String(viewsRendered + 1) })}
                    </button>
                    <p className="text-xs text-[var(--muted-foreground)] text-center max-w-md">
                      {t("project.viewsRenderedPartial", {
                        done: String(viewsRendered),
                        total: String(viewsTarget),
                      })}
                    </p>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void startRoomGeneration(selectedHubRoomId, { regenerate: true, background: true })}
                  disabled={
                    generatingRoomIds.size >= MAX_PARALLEL_ROOM_GENERATIONS ||
                    hubInsufficientForRegenerate
                  }
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline cursor-pointer disabled:opacity-50"
                >
                  {t("project.regenerateRoom")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void startRoomGeneration(selectedHubRoomId, {
                  regenerate: !!roomResult?.generationError,
                  background: true,
                })}
                disabled={
                  isPendingStart ||
                  (generatingRoomIds.size >= MAX_PARALLEL_ROOM_GENERATIONS && !isGenerating) ||
                  (roomResult?.generationError || roomResult?.renders.length
                    ? hubInsufficientForRegenerate
                    : hubInsufficientForGenerate)
                }
                className="px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white text-sm font-semibold hover:brightness-110 transition-all cursor-pointer disabled:opacity-60 flex items-center gap-2"
              >
                {isPendingStart && <Loader2 size={16} className="animate-spin" />}
                {roomResult?.generationError
                  ? t("common.retry")
                  : roomResult?.renders.length
                    ? t("project.regenerateRoom")
                    : t("project.generateDesign")}
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// --- Room Review Step ---

function RenderOverlayBadges({
  viewLabel,
  notConfirmed,
  notConfirmedLabel,
}: {
  viewLabel?: string;
  notConfirmed?: boolean;
  notConfirmedLabel: string;
}) {
  if (!viewLabel && !notConfirmed) return null;
  return (
    <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-0.5rem)] z-[1]">
      {viewLabel != null && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--primary)] text-white">
          {viewLabel}
        </span>
      )}
      {notConfirmed && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500 text-white">
          {notConfirmedLabel}
        </span>
      )}
    </div>
  );
}

function ProjectRoomReviewStep({
  isMobile = false,
  rooms, currentRoomIndex, projectId, concept, analysis, roomPhotos,
  setRooms, setProjectStep,
  setProjectLoading, setProjectError, setHasPdf,
  projectLoading, setLightboxSrc, onBackToHub,
  onTrackGenerationStart,
  onTrackGenerationEnd,
  onTrackGenerationProgress,
  onCancelRoomGeneration,
  onAiServiceUnavailable,
}: {
  isMobile?: boolean;
  rooms: RoomResult[];
  currentRoomIndex: number;
  projectId: string | null;
  concept: ProjectConceptSummary | null;
  analysis: FloorPlanAnalysis | null;
  roomPhotos: UploadedRoomPhoto[];
  setRooms: (rooms: RoomResult[] | ((prev: RoomResult[]) => RoomResult[])) => void;
  setCurrentRoomIndex: (index: number) => void;
  setProjectStep: (step: ProjectStep) => void;
  setProjectLoading: (loading: boolean) => void;
  setProjectError: (error: string | null) => void;
  setHasPdf: (has: boolean) => void;
  projectLoading: boolean;
  setLightboxSrc: (src: string | null) => void;
  onBackToHub?: () => void;
  onTrackGenerationStart?: (roomId: string) => void;
  onTrackGenerationEnd?: (roomId: string) => void;
  onTrackGenerationProgress?: (roomId: string, ev: { progress?: number; message?: string }) => void;
  onCancelRoomGeneration?: (roomId: string) => void | Promise<void>;
  onAiServiceUnavailable: () => void;
}) {
  const { t } = useTranslation();
  const [editText, setEditText] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [markerMode, setMarkerMode] = useState(false);
  const [markerRenderIndex, setMarkerRenderIndex] = useState(0);
  const [annotatedBase64, setAnnotatedBase64] = useState<string | null>(null);
  const [annotatedMimeType, setAnnotatedMimeType] = useState<string | null>(null);
  const [phaseBusy, setPhaseBusy] = useState(false);
  const [phaseMsg, setPhaseMsg] = useState("");
  const [phaseProgress, setPhaseProgress] = useState(0);
  const [phaseLiveUpdatedAt, setPhaseLiveUpdatedAt] = useState<number | undefined>();
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [inFlightPhotoId, setInFlightPhotoId] = useState<string | null>(null);
  const [syncText, setSyncText] = useState("");
  const [editPanelPos, setEditPanelPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const editPanelDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const { generateRoom: streamGenerateRoom } = useProjectSSE();
  const tokenBalance = useConsumerDesignStore((s) => s.tokenBalance);
  const setTokenBalance = useConsumerDesignStore((s) => s.setTokenBalance);
  const currentRoom = rooms[currentRoomIndex];
  const designMode = useConsumerDesignStore((s) =>
    resolveDesignMode(s.projectPreferences.designMode),
  );
  const isCustom = isCustomDesignMode(designMode);
  const suggestedOrder = useConsumerDesignStore((s) => s.projectSuggestedRoomOrder);
  const hasPdf = useConsumerDesignStore((s) => s.hasPdf);
  const roomIds = getFinalizeRequiredRoomIds(analysis, concept, suggestedOrder, rooms);
  const designableIdSet = new Set(roomIds);
  const allRoomNames = (concept?.roomNames ?? []).filter((rn) => designableIdSet.has(rn.id));
  const { allApproved } = getApprovalProgress(roomIds, rooms);
  const finalizeProject = useProjectFinalize({
    projectId,
    concept,
    analysis,
    rooms,
    suggestedOrder,
    setProjectStep,
    setProjectLoading,
    setProjectError,
    setHasPdf,
    setRooms,
  });

  const refreshRooms = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/project/${projectId}`, { cache: "no-store" });
      const json = await res.json();
      if (json.data?.rooms) setRooms(json.data.rooms);
      if (json.data?.hasPdf) setHasPdf(true);
    } catch {
      /* ignore */
    }
  }, [projectId, setRooms, setHasPdf]);

  // Poll while this client is generating, or while a multi-view room still has
  // pending views rendering server-side (e.g. after a reload / another client).
  const pendingViewsInFlight =
    (currentRoom?.viewpointTargetCount ?? 1) > 1 &&
    (currentRoom?.renders.length ?? 0) < (currentRoom?.viewpointTargetCount ?? 1) &&
    isRoomRenderInFlight(currentRoom);

  useEffect(() => {
    if ((!phaseBusy && !pendingViewsInFlight) || !projectId) return;
    const id = window.setInterval(() => void refreshRooms(), 3000);
    return () => window.clearInterval(id);
  }, [phaseBusy, pendingViewsInFlight, projectId, refreshRooms]);

  const callPhase = useCallback(
    async (opts: {
      phase?: DesignPhase;
      action?: "generate" | "regenerate" | "edit" | "approve" | "approve-room" | "select" | "finish" | "next-viewpoint" | "approve-viewpoint" | "sync-gallery" | "remove-render";
      editFeedback?: string;
      editAnnotation?: { base64: string; mimeType: string; renderIndex?: number };
      index?: number;
      redo?: boolean;
      photoId?: string;
      renderIndex?: number;
    }): Promise<ProgressEvent | undefined> => {
      if (!projectId || !currentRoom) return;
      const mode = resolveDesignMode(
        useConsumerDesignStore.getState().projectPreferences.designMode,
      );
      return streamGenerateRoom(
        projectId,
        currentRoom.roomId,
        (ev) => {
          if (ev.message) setPhaseMsg(ev.message);
          if (typeof ev.progress === "number") setPhaseProgress(ev.progress);
          setPhaseLiveUpdatedAt(Date.now());
          onTrackGenerationProgress?.(currentRoom.roomId, ev);
        },
        { ...opts, designMode: mode },
      );
    },
    [projectId, currentRoom, streamGenerateRoom, onTrackGenerationProgress],
  );

  const resetEditUi = useCallback(() => {
    setShowEdit(false);
    setEditText("");
    setMarkerMode(false);
    setAnnotatedBase64(null);
    setAnnotatedMimeType(null);
    setMarkerRenderIndex(0);
    setEditPanelPos({ x: 0, y: 0 });
  }, []);

  const onEditPanelDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientX = "touches" in e ? e.touches[0]!.clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0]!.clientY : e.clientY;
    editPanelDragRef.current = { startX: clientX, startY: clientY, origX: editPanelPos.x, origY: editPanelPos.y };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!editPanelDragRef.current) return;
      const cx = "touches" in ev ? ev.touches[0]!.clientX : ev.clientX;
      const cy = "touches" in ev ? ev.touches[0]!.clientY : ev.clientY;
      setEditPanelPos({
        x: editPanelDragRef.current.origX + (cx - editPanelDragRef.current.startX),
        y: editPanelDragRef.current.origY + (cy - editPanelDragRef.current.startY),
      });
    };
    const onUp = () => {
      editPanelDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove);
    document.addEventListener("touchend", onUp);
  }, [editPanelPos]);

  const runPhaseFlow = useCallback(
    async (
      steps: () => Promise<ProgressEvent | undefined | void>,
      billing?: { action: string; redo?: boolean },
    ) => {
      if (!projectId || !currentRoom || phaseBusy) return;
      if (
        billing &&
        !assertSufficientTokensForAction(billing.action, tokenBalance, setProjectError, t, {
          redo: billing.redo,
        })
      ) {
        return;
      }
      setPhaseBusy(true);
      setPhaseProgress(0.03);
      setPhaseMsg(t("project.generationStarting"));
      setPhaseLiveUpdatedAt(Date.now());
      setProjectError(null);
      onTrackGenerationStart?.(currentRoom.roomId);
      let keepPhaseBusy = false;
      try {
        const event = await steps();
        applyPostRenderBalance(event, setTokenBalance);
        const roomFromSse = (event?.data as { room?: RoomResult } | undefined)?.room;
        if (roomFromSse) {
          setRooms((prev) =>
            prev.map((r) => (r.roomId === roomFromSse.roomId ? { ...r, ...roomFromSse } : r)),
          );
        }
        await refreshRooms();
        resetEditUi();
      } catch (err) {
        if (isRoomGenerationAlreadyRunningError(err)) {
          keepPhaseBusy = true;
          setProjectError(t("project.generationAlreadyRunning"));
        } else if (isGenerationCancelledError(err)) {
          setProjectError(null);
          await refreshRooms();
        } else if (handleAiServiceUnavailableClientError(err, onAiServiceUnavailable)) {
          setProjectError(null);
        } else if (handleTokenBillingClientError(err, setTokenBalance, setProjectError, t)) {
          /* balance + message already set */
        } else {
          setProjectError(userFacingError(err, t("common.error")));
        }
      } finally {
        if (!keepPhaseBusy) {
          onTrackGenerationEnd?.(currentRoom.roomId);
          setPhaseBusy(false);
          setPhaseMsg("");
          setPhaseProgress(0);
          setPhaseLiveUpdatedAt(undefined);
        }
      }
    },
    [
      projectId,
      currentRoom,
      phaseBusy,
      refreshRooms,
      resetEditUi,
      setProjectError,
      setRooms,
      setTokenBalance,
      tokenBalance,
      onTrackGenerationStart,
      onTrackGenerationEnd,
      onAiServiceUnavailable,
      t,
    ],
  );

  const handleCancelForRoom = useCallback(() => {
    if (!currentRoom) return;
    void onCancelRoomGeneration?.(currentRoom.roomId);
    setPhaseBusy(false);
    setPhaseMsg("");
    setPhaseProgress(0);
    setPhaseLiveUpdatedAt(undefined);
  }, [currentRoom, onCancelRoomGeneration]);

  if (!currentRoom) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 size={48} className="animate-spin text-[var(--primary)]" />
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">{t("project.preparingRoom")}</p>
      </div>
    );
  }

  const PHASE_LABELS: Record<DesignPhase, string> = {
    base: "Materials & Lighting",
    furniture: "Furniture",
    decor: "Decor",
  };

  const phases = currentRoom.phases ?? emptyRoomPhases();
  const roomDone = currentRoom.status === "approved";
  // Custom mode is single-pass: one fully-designed render lives on the `base`
  // phase (no furniture/decor steps). The catalog "made" mode still walks the
  // base → furniture → decor pipeline.
  const activePhase: DesignPhase = isCustom
    ? "base"
    : phases.base.status !== "approved"
      ? "base"
      : phases.furniture.status !== "approved"
        ? "furniture"
        : "decor";
  const activeState = phases[activePhase];
  const hasVersions = activeState.versions.length > 0;
  const selIdx = Math.min(activeState.selectedIndex, Math.max(0, activeState.versions.length - 1));
  const selectedRender = hasVersions ? activeState.versions[selIdx] : undefined;

  const masterPhotoId =
    currentRoom.primaryPhotoId ??
    Object.entries(currentRoom.photoRenderMap ?? {}).find(([, idx]) => idx === 0)?.[0];

  const onGenerate = () => {
    if (isMultiViewCustom && resolvedActivePhotoId) {
      return runPhaseFlow(
        () => callPhase({ phase: activePhase, action: "generate", photoId: resolvedActivePhotoId }),
        { action: "generate" },
      );
    }
    return runPhaseFlow(() => callPhase({ phase: activePhase, action: "generate" }), { action: "generate" });
  };
  const onRedo = () => {
    if (isCustom && currentRoom.renders.length > 1) {
      return runPhaseFlow(
        () => callPhase({ action: "next-viewpoint", redo: true }),
        { action: "next-viewpoint", redo: true },
      );
    }
    if (isMultiViewCustom && currentRoom.renders.length === 1 && masterPhotoId) {
      setInFlightPhotoId(masterPhotoId);
      return runPhaseFlow(
        () => callPhase({ phase: activePhase, action: "regenerate", photoId: masterPhotoId }),
        { action: "regenerate" },
      ).finally(() => setInFlightPhotoId(null));
    }
    return runPhaseFlow(() => callPhase({ phase: activePhase, action: "regenerate" }), { action: "regenerate" });
  };
  const onFullRedo = () => {
    return runPhaseFlow(
      () =>
        callPhase({ phase: activePhase, action: "edit", editFeedback: "Full redo — regenerate from scratch" }),
      { action: "edit" },
    );
  };
  const onEditSubmit = () => {
    const fb = editText.trim();
    if (!fb) return;
    const targetRenderIndex =
      showMultiViewReview || showSequentialPartial ? markerRenderIndex : selIdx;
    const annotation =
      annotatedBase64 && annotatedMimeType
        ? {
            base64: annotatedBase64,
            mimeType: annotatedMimeType,
            renderIndex: targetRenderIndex,
          }
        : undefined;
    const roomPhotoIdsForEdit = sortRoomPhotoIds(
      roomPhotos
        .filter((p) => p.matchedRoomId === currentRoom.roomId)
        .map((p) => ({ id: p.id, viewpoint: p.viewpoint })),
    );
    const photoId = resolvePhotoIdForRenderIndex(
      currentRoom,
      targetRenderIndex,
      roomPhotoIdsForEdit,
    );
    resetEditUi();
    void runPhaseFlow(
      () =>
        callPhase({
          phase: activePhase,
          action: "edit",
          editFeedback: fb,
          editAnnotation: annotation,
          photoId: photoId ?? undefined,
        }),
      { action: "edit" },
    );
  };
  const onSelect = (index: number) =>
    runPhaseFlow(() => callPhase({ phase: activePhase, action: "select", index }));
  const onSkipDecorFinish = () =>
    runPhaseFlow(async () => {
      if (activePhase === "furniture") await callPhase({ phase: "furniture", action: "approve" });
      await callPhase({ action: "finish" });
    });

  const handleRedoView = (photoId: string) => {
    const isMasterRedo =
      viewpointTargetCount > 1 && !!masterPhotoId && photoId === masterPhotoId;
    if (isMasterRedo && !window.confirm(t("project.masterRedoConfirm"))) return;
    setInFlightPhotoId(photoId);
    void runPhaseFlow(() => callPhase({ phase: "base", action: "regenerate", photoId }), {
      action: "regenerate",
    }).finally(() => setInFlightPhotoId(null));
  };

  const openEditForView = (renderIndex: number) => {
    setMarkerRenderIndex(renderIndex);
    setShowEdit(true);
    setMarkerMode(false);
    setAnnotatedBase64(null);
    setAnnotatedMimeType(null);
    setEditText("");
  };

  const handleRemoveRender = (renderIndex: number) => {
    if (!projectId || !currentRoom || phaseBusy || currentRoom.renders.length <= 1) return;
    void (async () => {
      setProjectError(null);
      try {
        await streamGenerateRoom(projectId, currentRoom.roomId, () => {}, {
          action: "remove-render",
          renderIndex,
        });
        const res = await fetch(`/api/project/${projectId}`, { cache: "no-store" });
        const json = await res.json();
        if (json.data?.rooms) {
          setRooms(json.data.rooms);
          const updatedRoom = (json.data.rooms as RoomResult[]).find(
            (r) => r.roomId === currentRoom.roomId,
          );
          setMarkerRenderIndex((prev) =>
            Math.min(prev, Math.max(0, (updatedRoom?.renders.length ?? 1) - 1)),
          );
        }
        if (json.data?.hasPdf) setHasPdf(true);
      } catch (err) {
        if (handleAiServiceUnavailableClientError(err, onAiServiceUnavailable)) {
          setProjectError(null);
        } else {
          setProjectError(userFacingError(err, t("common.error")));
        }
      }
    })();
  };

  const onGenerateNextView = () =>
    runPhaseFlow(() => callPhase({ action: "next-viewpoint" }), { action: "next-viewpoint" });

  const insufficientForGenerate =
    hasInsufficientTokens(tokenBalance, TOKEN_COSTS.generate);
  const insufficientForRegenerate =
    hasInsufficientTokens(tokenBalance, TOKEN_COSTS.regenerate);
  const insufficientForEdit = hasInsufficientTokens(tokenBalance, TOKEN_COSTS.edit);

  const stepperStatus: PhaseStatus = phaseBusy ? "generating" : "idle";
  const stepperCurrent: DesignPhase | "complete" = roomDone ? "complete" : activePhase;
  const viewpointTargetCount = currentRoom.viewpointTargetCount ?? 1;
  const isMultiViewCustom = isCustom && viewpointTargetCount > 1;

  // Per-viewpoint derived state.
  const viewpointPhotoIds = currentRoom.viewpointPhases
    ? Object.keys(currentRoom.viewpointPhases)
    : [];
  const allViewpointsApproved = isMultiViewCustom && viewpointPhotoIds.length >= viewpointTargetCount &&
    viewpointPhotoIds.every((pid) => currentRoom.viewpointPhases?.[pid]?.base.status === "approved");
  const gallerySyncDone = !!currentRoom.gallerySyncComplete;

  // Determine which photo tab is active — default to first non-approved or first.
  const resolvedActivePhotoId = (() => {
    if (!isMultiViewCustom) return null;
    if (activePhotoId && viewpointPhotoIds.includes(activePhotoId)) return activePhotoId;
    const firstPending = viewpointPhotoIds.find(
      (pid) => currentRoom.viewpointPhases?.[pid]?.base.status !== "approved",
    );
    return firstPending ?? viewpointPhotoIds[0] ?? null;
  })();

  const activeViewpointTrack = resolvedActivePhotoId
    ? currentRoom.viewpointPhases?.[resolvedActivePhotoId]?.base
    : undefined;
  const activeVpHasVersions = (activeViewpointTrack?.versions.length ?? 0) > 0;
  const activeVpSelIdx = activeViewpointTrack
    ? Math.min(activeViewpointTrack.selectedIndex, Math.max(0, activeViewpointTrack.versions.length - 1))
    : 0;
  const activeVpRender = activeViewpointTrack?.versions[activeVpSelIdx];
  const activeVpApproved = activeViewpointTrack?.status === "approved";

  // Check ordering gate: all previous viewpoints must be approved.
  const activeVpIndex = resolvedActivePhotoId ? viewpointPhotoIds.indexOf(resolvedActivePhotoId) : 0;
  const previousViewpointsApproved = viewpointPhotoIds.slice(0, activeVpIndex).every(
    (pid) => currentRoom.viewpointPhases?.[pid]?.base.status === "approved",
  );

  const allViewsReady =
    currentRoom.renders.length >= viewpointTargetCount ||
    (viewpointTargetCount <= 1 && hasVersions);
  const hasMoreViewpoints =
    isCustom && viewpointTargetCount > 1 && currentRoom.renders.length < viewpointTargetCount;

  const onApprove = () =>
    runPhaseFlow(async () => {
      // Per-viewpoint approval only when the per-view stepper UI is active (sequential
      // one-at-a-time review). Gallery review (all views rendered) approves the room
      // in one click and returns to the floor plan hub.
      if (showPerViewStepper && isMultiViewCustom && resolvedActivePhotoId && !allViewpointsApproved) {
        await callPhase({ action: "approve-viewpoint", photoId: resolvedActivePhotoId });
        const nextIdx = activeVpIndex + 1;
        if (nextIdx < viewpointPhotoIds.length) setActivePhotoId(viewpointPhotoIds[nextIdx]!);
        return;
      }
      if (isCustom) {
        await callPhase({ action: "approve-room" });
        onBackToHub?.();
        return;
      }
      await callPhase({ phase: activePhase, action: "approve" });
      if (activePhase === "base") await callPhase({ phase: "furniture", action: "generate" });
      else if (activePhase === "furniture") await callPhase({ phase: "decor", action: "generate" });
      else await callPhase({ action: "finish" });
    });

  const onSyncGallery = () =>
    runPhaseFlow(async () => {
      await callPhase({ action: "sync-gallery", editFeedback: syncText.trim() || undefined });
      setSyncText("");
    }, { action: "sync-gallery" });

  const showSequentialPartial =
    isMultiViewCustom && !roomDone && currentRoom.renders.length > 0 && hasMoreViewpoints;
  const showMultiViewReview =
    isMultiViewCustom && !roomDone && currentRoom.renders.length > 0 && !hasMoreViewpoints;
  const showPerViewStepper = false;
  const showSyncPanel = false;
  const editMarkRender = showMultiViewReview || showSequentialPartial
    ? currentRoom.renders[markerRenderIndex] ?? currentRoom.renders[0]
    : selectedRender;

  // Pending secondary views: placeholder cards with per-view progress.
  const pendingViewCount = isMultiViewCustom
    ? Math.max(0, viewpointTargetCount - currentRoom.renders.length)
    : 0;
  const nextViewGenerating =
    (phaseBusy && !inFlightPhotoId) ||
    (!phaseBusy && !inFlightPhotoId && isRoomRenderInFlight(currentRoom));

  const finalizeBar = null;

  const phaseDisplay = resolveRoomGenerationDisplay(currentRoom, t, {
    progress: phaseProgress,
    message: phaseMsg,
    updatedAt: phaseLiveUpdatedAt,
  });
  const wholeDesignBusy = phaseBusy && !inFlightPhotoId;

  const roomPhotoIdsForRoom = sortRoomPhotoIds(
    roomPhotos
      .filter((p) => p.matchedRoomId === currentRoom.roomId)
      .map((p) => ({ id: p.id, viewpoint: p.viewpoint })),
  );
  const showPerViewRedo = canRedoIndividualView(currentRoom);

  const renderGalleryViewSlot = (
    render: RenderResult,
    renderIndex: number,
    opts?: { disableInteractions?: boolean },
  ) => {
    const photoId = resolvePhotoIdForRenderIndex(currentRoom, renderIndex, roomPhotoIdsForRoom);
    const isRedoing = phaseBusy && !!inFlightPhotoId && photoId === inFlightPhotoId;
    const disableInteractions = opts?.disableInteractions ?? false;
    const showViewActions = showPerViewRedo && !!photoId && !disableInteractions && !isRedoing;
    return (
      <div key={`render-slot-${renderIndex}-${currentRoom.generationAttempt ?? 0}`} className="relative">
        <RoomRenderGalleryCard
          src={`data:${render.mimeType};base64,${render.base64}`}
          alt={render.angleDescription}
          viewLabel={`View ${renderIndex + 1}`}
          notConfirmed={render.notConfirmed}
          notConfirmedLabel={t("project.notConfirmed")}
          borderClassName="border-[var(--primary)]"
          onOpen={() => setLightboxSrc(`data:${render.mimeType};base64,${render.base64}`)}
          onRemove={() => handleRemoveRender(renderIndex)}
          canRemove={currentRoom.renders.length > 1 && !disableInteractions && !isRedoing}
          removeLabel={t("page.removeRenderImage")}
          disabled={disableInteractions && !isRedoing}
          overlay={
            isRedoing ? (
              <div className="absolute inset-0 bg-[var(--background)]/75 flex items-center justify-center p-4">
                <RoomGenerationProgress
                  {...phaseDisplay}
                  compact
                  showWaitHint={false}
                  onCancel={handleCancelForRoom}
                />
              </div>
            ) : undefined
          }
        />
        {showViewActions && (
          <div className="absolute bottom-2 right-2 z-[2] flex gap-1.5">
            <button
              type="button"
              aria-label={t("project.redoThisView")}
              title={t("project.redoThisView")}
              disabled={phaseBusy || insufficientForRegenerate}
              onClick={() => handleRedoView(photoId)}
              className="p-1.5 min-h-[28px] min-w-[28px] flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              aria-label={t("project.editThisView")}
              title={t("project.editThisView")}
              disabled={phaseBusy}
              onClick={() => openEditForView(renderIndex)}
              className="p-1.5 min-h-[28px] min-w-[28px] flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <PenTool size={14} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
        {allRoomNames.map((rn) => {
          const roomState = rooms.find((r) => r.roomId === rn.id);
          const isActive = currentRoom.roomId === rn.id;
          const isDone = roomState?.status === "approved";
          return (
            <div
              key={rn.id}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                isActive
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : isDone
                  ? "bg-green-500/10 text-green-500"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]"
              }`}
            >
              {isDone && <Check size={12} />}
              {rn.name}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-1">
        <h2 className="cd-step-title">{currentRoom.brief.roomName}</h2>
        <p className="cd-step-subtitle">
          {roomDone
            ? t("project.roomApprovedBadge")
            : isCustom
              ? t("project.designModeCustomHint")
              : `${PHASE_LABELS[activePhase]} — Step ${["base", "furniture", "decor"].indexOf(activePhase) + 1} of 3`}
        </p>
      </div>

      {currentRoom.lastRenderWarning && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-800 dark:text-amber-200">{currentRoom.lastRenderWarning}</p>
        </div>
      )}

      {!roomDone && !isCustom && SHOW_MADE_DESIGN_MODE && (
        <DesignPhaseStepper currentPhase={stepperCurrent} status={stepperStatus} retryCount={0} />
      )}

      {phaseBusy && (!isMultiViewCustom || currentRoom.renders.length === 0) ? (
        <div className="flex flex-col items-center gap-3">
          <RoomGenerationProgress {...phaseDisplay} onCancel={handleCancelForRoom} />
          {currentRoom.renders.length === 0 &&
            (currentRoom.photoRenderMap || Object.keys(currentRoom.viewpointErrors ?? {}).length > 0) && (
              <div className="flex gap-2 flex-wrap justify-center">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--primary)]/10 text-[var(--primary)]">
                  Hero
                </span>
                {Object.keys(currentRoom.photoRenderMap ?? {}).length > 1 &&
                  Array.from({ length: Object.keys(currentRoom.photoRenderMap!).length - 1 }).map((_, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--muted)] text-[var(--muted-foreground)]"
                    >
                      Pending
                    </span>
                  ))}
              </div>
            )}
        </div>
      ) : roomDone ? (
        <>
          <RoomRenderGalleryGrid>
            {currentRoom.renders.map((r, i) =>
              renderGalleryViewSlot(r, i, { disableInteractions: wholeDesignBusy }),
            )}
          </RoomRenderGalleryGrid>
          {/* Failed viewpoint errors with retry */}
          {Object.keys(currentRoom.viewpointErrors ?? {}).length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 p-3 flex flex-col gap-2">
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                {Object.keys(currentRoom.viewpointErrors!).length} view(s) failed to render
              </p>
              <button
                className="self-start text-xs px-3 py-1 rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900/70 transition-colors"
                onClick={() => runPhaseFlow(() => callPhase({ action: "finish" }))}
                disabled={phaseBusy}
              >
                Retry failed views
              </button>
            </div>
          )}

          {(currentRoom.usedScrapedProducts ?? []).length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-4">
              <p className="text-xs font-semibold flex items-center gap-2 text-[var(--foreground)] mb-3">
                <Package size={14} />
                {t("page.productsInRender")}
              </p>
              <ul className="flex flex-col gap-2">
                {(currentRoom.usedScrapedProducts ?? []).map((p) => (
                  <li key={`${p.marketplaceId}-${p.url}`}>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 text-sm text-[var(--primary)] hover:underline"
                    >
                      <ExternalLink size={14} className="mt-0.5 shrink-0 opacity-80" />
                      <span>
                        <span className="font-medium text-[var(--foreground)]">{p.name}</span>
                        {p.sourceMarketplace && (
                          <span className="text-[var(--muted-foreground)] text-xs ml-1">({p.sourceMarketplace})</span>
                        )}
                        <span className="block text-xs text-[var(--muted-foreground)]">
                          {p.price != null ? `${p.price} ${p.currency}` : ""}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400 font-bold flex items-center justify-center gap-2">
              <Check size={18} /> {t("project.roomApprovedBadge")}
            </div>
            {finalizeBar}
            {onBackToHub && (
              <button
                type="button"
                onClick={onBackToHub}
                className="w-full py-3 rounded-xl border border-[var(--border)] font-medium hover:bg-[var(--muted)] cursor-pointer flex items-center justify-center gap-2"
              >
                <Home size={16} /> {t("common.back")}
              </button>
            )}
          </div>
        </>
      ) : showPerViewStepper ? (
        <div className="flex flex-col gap-4">
          {/* Photo tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {viewpointPhotoIds.map((pid, i) => {
              const track = currentRoom.viewpointPhases?.[pid]?.base;
              const isActive = pid === resolvedActivePhotoId;
              const isApproved = track?.status === "approved";
              const hasRender = (track?.versions.length ?? 0) > 0;
              const hasError = !!currentRoom.viewpointErrors?.[pid];
              return (
                <button
                  key={pid}
                  type="button"
                  onClick={() => setActivePhotoId(pid)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                    isActive
                      ? "bg-[var(--foreground)] text-[var(--background)]"
                      : isApproved
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : hasError
                          ? "bg-red-500/10 text-red-600 dark:text-red-400"
                          : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                  }`}
                >
                  {isApproved && <Check size={10} />}
                  View {i + 1}
                  {hasRender && !isApproved && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                </button>
              );
            })}
          </div>

          {/* Active photo panel */}
          {showSyncPanel ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-green-500/30 bg-green-50 dark:bg-green-950/20 p-4 flex flex-col gap-3">
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  All {viewpointTargetCount} viewpoints approved — sync the gallery for consistency.
                </p>
                <textarea
                  className="w-full min-h-[60px] rounded-lg border border-[var(--border)] bg-[var(--background)] p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  placeholder="Optional: describe style adjustments for the final sync pass…"
                  value={syncText}
                  onChange={(e) => setSyncText(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => void onSyncGallery()}
                  disabled={phaseBusy || insufficientForEdit}
                  className="w-full py-3 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Sparkles size={18} /> Sync All Views
                </button>
              </div>
              {/* Thumbnails of all approved views */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {viewpointPhotoIds.map((pid, i) => {
                  const track = currentRoom.viewpointPhases?.[pid]?.base;
                  const selI = track ? Math.min(track.selectedIndex, Math.max(0, track.versions.length - 1)) : 0;
                  const render = track?.versions[selI];
                  if (!render) return null;
                  return (
                    <div
                      key={pid}
                      className="shrink-0 rounded-lg overflow-hidden border border-green-500/40 cursor-pointer hover:shadow-md transition-shadow relative w-24"
                      onClick={() => setLightboxSrc(`data:${render.mimeType};base64,${render.base64}`)}
                    >
                      <img src={`data:${render.mimeType};base64,${render.base64}`} alt={`View ${i + 1}`} className="w-full h-16 object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-green-500/80 text-white text-[8px] font-semibold text-center py-px">
                        View {i + 1} ✓
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : activeVpHasVersions && activeVpRender ? (
            <div className="flex flex-col gap-3">
              <div
                className={`rounded-xl overflow-hidden border-2 cursor-pointer hover:shadow-lg transition-shadow relative ${
                  activeVpApproved ? "border-green-500/50" : "border-[var(--primary)]"
                }`}
                onClick={() => setLightboxSrc(`data:${activeVpRender.mimeType};base64,${activeVpRender.base64}`)}
              >
                <img src={`data:${activeVpRender.mimeType};base64,${activeVpRender.base64}`} alt={`View ${activeVpIndex + 1}`} className="w-full object-cover" />
                <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  activeVpApproved ? "bg-green-500 text-white" : "bg-[var(--primary)] text-white"
                }`}>
                  View {activeVpIndex + 1} — {activeVpApproved ? "approved" : "reviewing"}
                </span>
              </div>

              {!activeVpApproved && (
                <PhaseApprovalBar
                  currentPhase="base"
                  onApprove={() => void onApprove()}
                  onRedo={() => {
                    const photoId = resolvedActivePhotoId!;
                    setInFlightPhotoId(photoId);
                    void runPhaseFlow(
                      () => callPhase({ phase: "base", action: "regenerate", photoId }),
                      { action: "regenerate" },
                    ).finally(() => setInFlightPhotoId(null));
                  }}
                  onEditPrompt={() => setShowEdit(true)}
                  onFullRedo={currentRoom.lockedBaseUrl ? () => void onFullRedo() : undefined}
                  isLoading={phaseBusy}
                  singlePhase
                  approveDisabled={false}
                  approveLabel={`Approve View ${activeVpIndex + 1}`}
                  hasLockedBase={!!currentRoom.lockedBaseUrl}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-8">
              <p className="text-sm text-[var(--muted-foreground)] text-center max-w-md">
                {!previousViewpointsApproved
                  ? `Approve View ${activeVpIndex} first to unlock this viewpoint.`
                  : `Generate the design for View ${activeVpIndex + 1}.`}
              </p>
              <button
                type="button"
                onClick={() => void onGenerate()}
                disabled={phaseBusy || !previousViewpointsApproved || insufficientForGenerate}
                className="px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
              >
                <Sparkles size={18} /> Generate View {activeVpIndex + 1}
              </button>
            </div>
          )}

          {showEdit && (
            <div
              className="fixed z-50 right-4 top-1/3 w-[340px] max-w-[90vw] bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col gap-3 p-4"
              style={{ transform: `translate(${editPanelPos.x}px, ${editPanelPos.y}px)` }}
            >
              <div
                className="flex items-center justify-between cursor-move select-none pb-2 border-b border-[var(--border)]"
                onMouseDown={onEditPanelDragStart}
                onTouchStart={onEditPanelDragStart}
              >
                <span className="text-xs font-semibold text-[var(--foreground)]">Edit View</span>
                <button type="button" onClick={resetEditUi} className="p-1 rounded-full hover:bg-[var(--muted)] cursor-pointer">
                  <X size={14} />
                </button>
              </div>
              {markerMode && activeVpRender ? (
                <DrawingCanvas
                  imageSrc={`data:${activeVpRender.mimeType};base64,${activeVpRender.base64}`}
                  onAnnotatedImage={(base64, mime) => {
                    setAnnotatedBase64(base64);
                    setAnnotatedMimeType(mime);
                    setMarkerMode(false);
                  }}
                  onFinish={() => setMarkerMode(false)}
                />
              ) : (
                <>
                  <textarea
                    className="w-full min-h-[80px] rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                    placeholder={t("project.editPlaceholder")}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMarkerMode(true)}
                      className="px-3 py-2 rounded-lg border border-[var(--border)] text-xs font-medium hover:bg-[var(--muted)] cursor-pointer"
                    >
                      Mark on image
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const fb = editText.trim();
                        if (!fb) return;
                        const annotation = annotatedBase64 && annotatedMimeType
                          ? { base64: annotatedBase64, mimeType: annotatedMimeType, renderIndex: 0 }
                          : undefined;
                        resetEditUi();
                        void runPhaseFlow(
                          () =>
                            callPhase({
                              phase: "base",
                              action: "edit",
                              editFeedback: fb,
                              editAnnotation: annotation,
                              photoId: resolvedActivePhotoId!,
                            }),
                          { action: "edit" },
                        );
                      }}
                      disabled={phaseBusy || !editText.trim() || insufficientForEdit}
                      className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                    >
                      Apply Edit
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : !hasVersions && !phaseBusy ? (
        <div className="flex flex-col items-center gap-4 py-8">
          <p className="text-sm text-[var(--muted-foreground)] text-center max-w-md">
            {activePhase === "base"
              ? t("project.generatingRenders")
              : `${PHASE_LABELS[activePhase]}`}
          </p>
          <button
            type="button"
            onClick={() => void onGenerate()}
            disabled={phaseBusy || insufficientForGenerate}
            className="px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
          >
            <Sparkles size={18} /> {isCustom && activePhase === "base" ? t("project.generateDesign") : PHASE_LABELS[activePhase]}
          </button>
          {activePhase === "decor" && (
            <button
              type="button"
              onClick={() => void onSkipDecorFinish()}
              className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline"
            >
              Skip decor &amp; finish
            </button>
          )}
        </div>
      ) : (
        <>
          {showSequentialPartial ? (
            <div className="flex flex-col gap-3">
              <RoomRenderGalleryGrid
                className={`transition-opacity ${wholeDesignBusy ? "opacity-50 pointer-events-none" : ""}`}
              >
                {currentRoom.renders.map((r, i) =>
                  renderGalleryViewSlot(r, i, { disableInteractions: wholeDesignBusy }),
                )}
                {Array.from({ length: pendingViewCount }).map((_, p) => {
                  const viewNum = currentRoom.renders.length + p + 1;
                  const isGeneratingCard = p === 0 && nextViewGenerating;
                  const isNextPending = p === 0 && !isGeneratingCard;
                  return (
                    <RoomRenderGalleryPendingCard
                      key={`pending-${viewNum}`}
                      viewLabel={`View ${viewNum}`}
                      onClick={
                        isNextPending && !phaseBusy
                          ? () => void onGenerateNextView()
                          : undefined
                      }
                    >
                      {isGeneratingCard ? (
                        <RoomGenerationProgress
                  {...phaseDisplay}
                  compact
                  showWaitHint={false}
                  onCancel={handleCancelForRoom}
                />
                      ) : (
                        <p className="text-xs text-[var(--muted-foreground)] text-center">
                          {t("project.viewPendingLabel")}
                        </p>
                      )}
                    </RoomRenderGalleryPendingCard>
                  );
                })}
              </RoomRenderGalleryGrid>
              <p className="text-sm text-center text-[var(--muted-foreground)] max-w-md mx-auto">
                {t("project.sequentialViewHint")}
              </p>
              <p className="text-sm text-center text-[var(--muted-foreground)]">
                {t("project.viewsRenderedPartial", {
                  done: String(currentRoom.renders.length),
                  total: String(viewpointTargetCount),
                })}
              </p>
              <button
                type="button"
                onClick={() => void onGenerateNextView()}
                disabled={phaseBusy || nextViewGenerating || insufficientForGenerate}
                className="w-full py-3 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
              >
                <Sparkles size={18} />
                {t("project.generateNextView", { n: String(currentRoom.renders.length + 1) })}
              </button>
            </div>
          ) : showMultiViewReview ? (
            <div className="flex flex-col gap-3">
              {wholeDesignBusy && (
                <RoomGenerationProgress {...phaseDisplay} onCancel={handleCancelForRoom} />
              )}
              <RoomRenderGalleryGrid
                className={wholeDesignBusy ? "opacity-50 pointer-events-none transition-opacity" : "transition-opacity"}
              >
                {currentRoom.renders.map((r, i) =>
                  renderGalleryViewSlot(r, i, { disableInteractions: wholeDesignBusy }),
                )}
              </RoomRenderGalleryGrid>
            </div>
          ) : selectedRender ? (
            <div
              className="rounded-xl overflow-hidden border border-[var(--border)] cursor-pointer hover:shadow-lg transition-shadow relative max-h-[55vh]"
              onClick={() => {
                userFlowLog(5, "opened room render preview", {
                  roomId: currentRoom.roomId,
                  phase: activePhase,
                  versionIndex: selIdx,
                }, "F");
                setLightboxSrc(`data:${selectedRender.mimeType};base64,${selectedRender.base64}`);
              }}
            >
              <img
                src={`data:${selectedRender.mimeType};base64,${selectedRender.base64}`}
                alt={activePhase}
                className="w-full max-h-[55vh] object-contain"
              />
              <RenderOverlayBadges
                notConfirmed={selectedRender.notConfirmed}
                notConfirmedLabel={t("project.notConfirmed")}
              />
            </div>
          ) : null}

          {showMultiViewReview && (
            <p className="text-sm text-center text-[var(--muted-foreground)]">
              {currentRoom.renders.length} view{currentRoom.renders.length === 1 ? "" : "s"} rendered — review and approve the design.
            </p>
          )}

          {!showMultiViewReview && !showSequentialPartial && selectedRender && (
            <PhaseVersionNav
              selectedIndex={selIdx}
              totalVersions={activeState.versions.length}
              onPrevious={() => void onSelect(selIdx - 1)}
              onNext={() => void onSelect(selIdx + 1)}
              disabled={phaseBusy}
            />
          )}

          {activeState.productLinks.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-4">
              <p className="text-xs font-semibold flex items-center gap-2 text-[var(--foreground)] mb-3">
                <Package size={14} />
                {t("page.productsInRender")}
              </p>
              <ul className="flex flex-col gap-2">
                {activeState.productLinks.map((p) => (
                  <li key={`${p.id}-${p.sourceUrl}`}>
                    <a
                      href={p.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 text-sm text-[var(--primary)] hover:underline"
                    >
                      <ExternalLink size={14} className="mt-0.5 shrink-0 opacity-80" />
                      <span>
                        <span className="font-medium text-[var(--foreground)]">{p.name}</span>
                        <span className="block text-xs text-[var(--muted-foreground)]">
                          {p.price ? `${p.price} ${p.currency}` : ""}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <PhaseApprovalBar
            currentPhase={activePhase}
            onApprove={() => void onApprove()}
            onRedo={() => void onRedo()}
            onEditPrompt={() => setShowEdit(true)}
            onSkip={isCustom ? undefined : onSkipDecorFinish}
            onFullRedo={currentRoom.lockedBaseUrl ? () => void onFullRedo() : undefined}
            isLoading={phaseBusy}
            singlePhase={isCustom}
            approveDisabled={hasMoreViewpoints}
            approveDisabledReason={
              hasMoreViewpoints
                ? t("project.viewsRenderedPartial", {
                    done: String(currentRoom.renders.length),
                    total: String(viewpointTargetCount),
                  })
                : undefined
            }
            secondaryAction={
              hasMoreViewpoints
                ? {
                    label: t("project.generateNextView", {
                      n: String(currentRoom.renders.length + 1),
                    }),
                    onClick: () => void onGenerateNextView(),
                  }
                : undefined
            }
            approveLabel={
              isCustom
                ? "Approve Design"
                : undefined
            }
            hasLockedBase={!!currentRoom.lockedBaseUrl}
          />

          {showEdit && (
            <div
              className="fixed z-50 right-4 top-1/3 w-[340px] max-w-[90vw] bg-[var(--background)] border border-[var(--border)] rounded-xl shadow-2xl flex flex-col gap-3 p-4"
              style={{ transform: `translate(${editPanelPos.x}px, ${editPanelPos.y}px)` }}
            >
              <div
                className="flex items-center justify-between cursor-move select-none pb-2 border-b border-[var(--border)]"
                onMouseDown={onEditPanelDragStart}
                onTouchStart={onEditPanelDragStart}
              >
                <span className="text-xs font-semibold text-[var(--foreground)]">Edit Design</span>
                <button type="button" onClick={resetEditUi} className="p-1 rounded-full hover:bg-[var(--muted)] cursor-pointer">
                  <X size={14} />
                </button>
              </div>
              {(showMultiViewReview || showSequentialPartial) && currentRoom.renders.length > 1 && !markerMode && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  <span className="text-xs text-[var(--muted-foreground)] shrink-0">{t("common.mark")}:</span>
                  {currentRoom.renders.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setMarkerRenderIndex(i)}
                      className={`shrink-0 rounded-lg overflow-hidden border-2 transition-all cursor-pointer relative ${
                        markerRenderIndex === i
                          ? "border-[var(--primary)]"
                          : "border-[var(--border)] opacity-80 hover:opacity-100"
                      }`}
                    >
                      <img
                        src={`data:${r.mimeType};base64,${r.base64}`}
                        alt={r.angleDescription}
                        className="w-16 h-12 object-cover"
                      />
                      {r.notConfirmed && (
                        <span
                          className="absolute bottom-0 inset-x-0 bg-amber-500/90 text-white text-[8px] font-semibold text-center leading-tight py-0.5"
                          title={t("project.notConfirmed")}
                        >
                          !
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {markerMode && editMarkRender ? (
                <DrawingCanvas
                  imageSrc={`data:${editMarkRender.mimeType};base64,${editMarkRender.base64}`}
                  onAnnotatedImage={(base64, mime) => {
                    setAnnotatedBase64(base64);
                    setAnnotatedMimeType(mime);
                  }}
                  onFinish={() => setMarkerMode(false)}
                />
              ) : (
                <>
                  {annotatedBase64 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/30">
                      <img
                        src={`data:image/png;base64,${annotatedBase64}`}
                        alt={t("components.attachReference")}
                        className="w-10 h-10 rounded object-cover border border-[var(--primary)]/40 shrink-0"
                      />
                      <p className="text-xs text-[var(--primary)] font-medium flex-1">
                        {t("components.markedAreasSent")}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setAnnotatedBase64(null);
                          setAnnotatedMimeType(null);
                        }}
                        className="p-1 rounded-full hover:bg-[var(--muted)] cursor-pointer shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!editMarkRender) return;
                        setMarkerMode(true);
                      }}
                      disabled={!editMarkRender || phaseBusy}
                      className="px-3 py-2.5 rounded-xl bg-[var(--muted)] border border-[var(--border)] cursor-pointer hover:border-[var(--primary)]/50 disabled:opacity-50"
                      title={t("components.drawOnImage")}
                    >
                      <PenTool size={16} />
                    </button>
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      placeholder={t("project.editRoomPlaceholder")}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm"
                      onKeyDown={(e) => { if (e.key === "Enter") onEditSubmit(); }}
                    />
                    <button
                      onClick={onEditSubmit}
                      disabled={!editText.trim() || phaseBusy}
                      className="px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white text-sm font-semibold cursor-pointer hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      {t("project.applyEdit")}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {finalizeBar && <div className="pt-2">{finalizeBar}</div>}
        </>
      )}
    </div>
  );
}

// --- Complete Step ---

function ProjectCompleteStep({
  projectId, concept, rooms, analysis, hasPdf, resetProject, setProjectStep, setLightboxSrc,
}: {
  projectId: string | null;
  concept: ProjectConceptSummary | null;
  rooms: RoomResult[];
  analysis: FloorPlanAnalysis | null;
  hasPdf: boolean;
  resetProject: () => void;
  setProjectStep: (step: ProjectStep) => void;
  setLightboxSrc: (src: string | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
        <Check size={32} className="text-green-500" />
      </div>
      <h2 className="cd-step-title">{t("project.completeTitle")}</h2>
      <p className="cd-step-subtitle">
        {t("project.completeSubtitle", {
          projectName: concept?.projectName || t("project.designProjectFallback"),
        })}
      </p>

      <div className="grid grid-cols-3 gap-3 w-full">
        {rooms.filter((r) => r.renders.length > 0).map((r) => (
          <div
            key={r.roomId}
            className="rounded-xl overflow-hidden border border-[var(--border)] cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setLightboxSrc(`data:${r.renders[0].mimeType};base64,${r.renders[0].base64}`)}
          >
            <img
              src={`data:${r.renders[0].mimeType};base64,${r.renders[0].base64}`}
              alt={r.brief.roomName}
              className="w-full aspect-[4/3] object-cover"
            />
            <p className="text-xs font-semibold p-2 text-center">{r.brief.roomName}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 w-full flex-wrap">
        {hasPdf && projectId && (
          <a
            href={`/api/project/${projectId}/pdf`}
            download
            className="flex-1 py-3.5 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all"
          >
            <Download size={20} /> {t("project.downloadPdf")}
          </a>
        )}
        <button
          onClick={() => setProjectStep("rooms")}
          className="px-6 py-3.5 rounded-xl border border-[var(--border)] font-semibold flex items-center justify-center gap-2 cursor-pointer hover:bg-[var(--muted)] transition-all"
        >
          <Pencil size={18} /> {t("project.editProject")}
        </button>
        <button
          onClick={resetProject}
          className="px-6 py-3.5 rounded-xl border border-[var(--border)] font-semibold flex items-center justify-center gap-2 cursor-pointer hover:bg-[var(--muted)] transition-all"
        >
          <Home size={18} /> {t("project.newProject")}
        </button>
      </div>
    </div>
  );
}
