"use client";

import { useEffect, useState } from "react";
import { useConsumerDesignStore } from "@/app/store";
import type { ProjectConceptSummary, UploadedRoomPhoto } from "@/app/store";
import type {
  FloorPlanAnalysis,
  PhotoViewpoint,
  RoomResult,
  UserPreferences,
  UtilityEntryPoint,
} from "@/lib/project/types";
import {
  applyInspirationProductsToStore,
  fetchLaravelInspirationImages,
  hydrateInspirationProductsFromLaravel,
  type OrchestratorInspirationUpload,
} from "@/lib/inspirationPersistence";
import { getAuthToken } from "@/lib/authApi";
import {
  loadSessionBlobs,
  loadSessionMeta,
  normalizeRestoredStep,
  stepFromServerState,
  stepNeedsServerRestore,
} from "@/lib/project/sessionStorage";
import { normalizeStaleGeneratingRooms } from "@/lib/project/roomOrder";
import { consumeJustHydratedFromHub } from "@/lib/projectHydrationSkip";

interface ProjectApiUploadedPhoto {
  id: string;
  label: string;
  base64?: string;
  mimeType?: string;
  roomId?: string;
  confidence?: "high" | "medium" | "low";
  viewpoint?: PhotoViewpoint;
  structuralLineMap?: { base64: string; mimeType: string; strokeOnly?: boolean } | null;
  objectRemovalMask?: { base64: string; mimeType: string } | null;
  openingAnalysis?: {
    window_boxes: Array<{ x: number; y: number; w: number; h: number }>;
    door_boxes: Array<{ x: number; y: number; w: number; h: number }>;
  } | null;
}

interface ProjectApiResponse {
  id: string;
  status: string;
  preferences: unknown;
  analysis: FloorPlanAnalysis | null;
  concept: ProjectConceptSummary | null;
  rooms: RoomResult[];
  currentRoomIndex: number;
  hasPdf: boolean;
  suggestedRoomOrder: string[];
  floorPlanConfirmed: boolean;
  utilityEntryPoints?: UtilityEntryPoint[];
  floorPlanBase64?: string;
  floorPlanMimeType?: string;
  uploadedPhotos: ProjectApiUploadedPhoto[];
  inspirationUploads?: OrchestratorInspirationUpload[];
  error: string | null;
}

function mapUploadedPhotosToRoomPhotos(photos: ProjectApiUploadedPhoto[]): UploadedRoomPhoto[] {
  return photos
    .filter((p) => p.base64 && p.mimeType)
    .map((p) => ({
      id: p.id,
      base64: p.base64!,
      mimeType: p.mimeType!,
      label: p.label,
      matchedRoomId: p.roomId ?? null,
      matchConfidence: p.confidence ?? null,
      viewpoint: p.viewpoint,
      structuralLineMap: p.structuralLineMap ?? undefined,
      objectRemovalMask: p.objectRemovalMask ?? undefined,
      openingAnalysis: p.openingAnalysis ?? undefined,
    }));
}

export function useProjectSessionRestore(options?: {
  onRestored?: () => void;
  skip?: boolean;
}): { restoring: boolean; restored: boolean } {
  const [restoring, setRestoring] = useState(!options?.skip);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (options?.skip) {
      setRestoring(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        if (consumeJustHydratedFromHub()) {
          setRestored(true);
          options?.onRestored?.();
          return;
        }

        const meta = loadSessionMeta("project");
        if (!meta) {
          return;
        }

        const blobs = await loadSessionBlobs();
        if (cancelled) return;

        const store = useConsumerDesignStore.getState();
        let step = normalizeRestoredStep(meta.projectStep, meta.projectId);
        let projectId = meta.projectId;
        let analysis: FloorPlanAnalysis | null = null;
        let concept: ProjectConceptSummary | null = null;
        let rooms: RoomResult[] = [];
        let suggestedRoomOrder = meta.projectSuggestedRoomOrder ?? [];
        let hasPdf = false;
        let currentRoomIndex = meta.currentProjectRoomIndex ?? 0;
        let utilityEntryPoints = meta.utilityEntryPoints ?? [];
        let inspirationUploads: OrchestratorInspirationUpload[] | undefined;

        let floorPlanBase64 = blobs?.floorPlanBase64 ?? null;
        let floorPlanMimeType = blobs?.floorPlanMimeType ?? null;
        let roomPhotos = blobs?.roomPhotos ?? [];

        store.setProjectPreferences(meta.preferences);
        store.setProjectDraftRooms(meta.projectDraftRooms ?? []);
        if (meta.projectDbId) {
          store.setCurrentProjectDbId(meta.projectDbId);
        }

        if (projectId && stepNeedsServerRestore(meta.projectStep)) {
          try {
            const res = await fetch(`/api/project/${projectId}`, { cache: "no-store" });
            if (res.ok) {
              const json = await res.json();
              const data = json.data as ProjectApiResponse;
              if (data) {
                analysis = data.analysis;
                concept = data.concept;
                rooms = normalizeStaleGeneratingRooms(data.rooms ?? []);
                suggestedRoomOrder = data.suggestedRoomOrder ?? suggestedRoomOrder;
                hasPdf = data.hasPdf ?? false;
                currentRoomIndex = data.currentRoomIndex ?? currentRoomIndex;
                step = stepFromServerState({
                  savedStep: meta.projectStep,
                  floorPlanConfirmed: data.floorPlanConfirmed,
                  hasConcept: Boolean(data.concept),
                  hasAnalysis: Boolean(data.analysis),
                  status: data.status,
                  hasPdf: data.hasPdf,
                });

                if (data.utilityEntryPoints?.length) {
                  utilityEntryPoints = data.utilityEntryPoints;
                } else if (
                  utilityEntryPoints.length === 0 &&
                  data.analysis?.utilityPoints?.length &&
                  !data.floorPlanConfirmed
                ) {
                  // The user authors utility entry points (e.g. gas inlet) on the review
                  // screen and they're saved to localStorage. Only fall back to the
                  // AI-detected seed when nothing was saved locally — otherwise re-seeding
                  // here would wipe the user's added/edited points on refresh.
                  utilityEntryPoints = data.analysis.utilityPoints;
                }

                if (data.floorPlanBase64) {
                  floorPlanBase64 = data.floorPlanBase64;
                  floorPlanMimeType = data.floorPlanMimeType ?? "image/jpeg";
                }

                if (data.uploadedPhotos?.length) {
                  const fromServer = mapUploadedPhotosToRoomPhotos(data.uploadedPhotos);
                  if (fromServer.length > 0) {
                    // Viewpoints and photo→room matches are authored client-side on the
                    // "Match Photos to Rooms" screen and saved to IndexedDB. Before the plan
                    // is confirmed the server holds none of that, so overlay the locally-saved
                    // values (the post-edit truth) onto the server photos so a refresh keeps
                    // the user's work instead of resetting it.
                    const localById = new Map((blobs?.roomPhotos ?? []).map((p) => [p.id, p]));
                    roomPhotos = fromServer.map((p) => {
                      const local = localById.get(p.id);
                      if (!local) return p;
                      return {
                        ...p,
                        matchedRoomId: local.matchedRoomId,
                        viewpoint: local.viewpoint ?? p.viewpoint,
                        structuralLineMap: local.structuralLineMap ?? p.structuralLineMap,
                        objectRemovalMask: local.objectRemovalMask ?? p.objectRemovalMask,
                        openingAnalysis: local.openingAnalysis ?? p.openingAnalysis,
                      };
                    });
                  }
                }

                if (data.preferences && typeof data.preferences === "object") {
                  store.setProjectPreferences(data.preferences as UserPreferences);
                }

                if (data.inspirationUploads?.length) {
                  inspirationUploads = data.inspirationUploads;
                }
              }
            } else if (res.status === 404) {
              step = floorPlanBase64 ? "floorPlanReview" : "upload";
              projectId = null;
            }
          } catch {
            step = floorPlanBase64 ? "floorPlanReview" : "upload";
          }
        }

        if (cancelled) return;

        store.setVistaMode("project");

        if (floorPlanBase64 && floorPlanMimeType) {
          store.setFloorPlan(floorPlanBase64, floorPlanMimeType);
        }

        const projectDbId = useConsumerDesignStore.getState().currentProjectDbId;
        if (inspirationUploads?.length) {
          applyInspirationProductsToStore(inspirationUploads);
        } else if (projectDbId && getAuthToken()) {
          const laravelImages = await fetchLaravelInspirationImages(projectDbId);
          if (!cancelled && laravelImages.length > 0) {
            await hydrateInspirationProductsFromLaravel(laravelImages);
          } else if (!cancelled && blobs?.inspirationProducts?.length) {
            applyInspirationProductsToStore(undefined, undefined, blobs.inspirationProducts);
          }
        } else if (blobs?.inspirationProducts?.length) {
          applyInspirationProductsToStore(undefined, undefined, blobs.inspirationProducts);
        }

        if (roomPhotos.length > 0) {
          useConsumerDesignStore.setState({ roomPhotos });
        }

        if (projectId && (analysis || concept)) {
          store.setProjectData({
            id: projectId,
            analysis,
            concept,
            rooms,
            currentRoomIndex,
            hasPdf,
            suggestedRoomOrder,
            utilityEntryPoints,
          });
        } else if (projectId) {
          useConsumerDesignStore.setState({ projectId });
        }

        store.setProjectUtilityEntryPoints(utilityEntryPoints);

        store.setProjectSuggestedRoomOrder(suggestedRoomOrder);
        if (meta.selectedFloorPlanRoomId) {
          store.setSelectedFloorPlanRoomId(meta.selectedFloorPlanRoomId);
        }
        if (meta.projectHubView) {
          store.setProjectHubView(meta.projectHubView);
        }

        store.setProjectStep(step);
        setRestored(true);
        options?.onRestored?.();
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [options?.onRestored, options?.skip]);

  return { restoring, restored };
}
