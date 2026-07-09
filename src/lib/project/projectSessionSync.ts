"use client";

import { useConsumerDesignStore } from "@/app/store";
import { saveSessionBlobs, saveSessionMeta } from "@/lib/project/sessionStorage";
import type { SessionBlobs } from "@/lib/project/sessionStorage";

const BLOB_SAVE_DEBOUNCE_MS = 1000;

let pendingBlobs: SessionBlobs | null = null;
let blobSaveTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingBlobs(): void {
  if (!pendingBlobs) return;
  const blobs = pendingBlobs;
  pendingBlobs = null;
  blobSaveTimer = null;
  void saveSessionBlobs(blobs);
}

function scheduleSaveSessionBlobs(blobs: SessionBlobs): void {
  pendingBlobs = blobs;
  if (blobSaveTimer) clearTimeout(blobSaveTimer);
  blobSaveTimer = setTimeout(flushPendingBlobs, BLOB_SAVE_DEBOUNCE_MS);
}

/**
 * Auto-persist Vista flow state to localStorage + IndexedDB on store changes.
 */
export function subscribeToProjectSession(): () => void {
  return useConsumerDesignStore.subscribe((state, prev) => {
    if (state.vistaMode !== "project" && state.vistaMode !== "quick") return;

    const metaChanged =
      state.projectStep !== prev.projectStep ||
      state.projectId !== prev.projectId ||
      state.projectPreferences !== prev.projectPreferences ||
      state.projectSuggestedRoomOrder !== prev.projectSuggestedRoomOrder ||
      state.selectedFloorPlanRoomId !== prev.selectedFloorPlanRoomId ||
      state.projectHubView !== prev.projectHubView ||
      state.currentProjectRoomIndex !== prev.currentProjectRoomIndex ||
      state.projectUtilityEntryPoints !== prev.projectUtilityEntryPoints ||
      state.projectDraftRooms !== prev.projectDraftRooms ||
      state.currentProjectDbId !== prev.currentProjectDbId;

    if (metaChanged) {
      saveSessionMeta({
        projectId: state.projectId,
        projectStep: state.projectStep,
        vistaMode: state.vistaMode,
        preferences: state.projectPreferences,
        timestamp: Date.now(),
        projectSuggestedRoomOrder: state.projectSuggestedRoomOrder,
        selectedFloorPlanRoomId: state.selectedFloorPlanRoomId,
        projectHubView: state.projectHubView,
        currentProjectRoomIndex: state.currentProjectRoomIndex,
        utilityEntryPoints: state.projectUtilityEntryPoints,
        projectDraftRooms: state.projectDraftRooms,
        projectDbId: state.currentProjectDbId,
      });
    }

    const blobsChanged =
      state.floorPlanBase64 !== prev.floorPlanBase64 ||
      state.floorPlanMimeType !== prev.floorPlanMimeType ||
      state.roomPhotos !== prev.roomPhotos ||
      state.inspirationProducts !== prev.inspirationProducts ||
      state.styleInspirations !== prev.styleInspirations;

    if (blobsChanged) {
      scheduleSaveSessionBlobs({
        floorPlanBase64: state.floorPlanBase64,
        floorPlanMimeType: state.floorPlanMimeType,
        roomPhotos: state.roomPhotos,
        inspirationProducts: state.inspirationProducts,
        styleInspirations: state.styleInspirations,
      });
    }
  });
}
