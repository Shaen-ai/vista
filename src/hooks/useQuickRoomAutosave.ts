"use client";

import { useCallback, useEffect, useRef } from "react";
import { useConsumerDesignStore } from "@/app/store";
import { useProjectPersistence } from "@/hooks/useProjectPersistence";
import { styleInspirationsToPatchPayload } from "@/lib/inspirationPersistence";
import {
  buildQuickRoomOptionsFromStore,
  buildQuickRoomPhasedStateFromStore,
} from "@/lib/quickRoom/quickRoomPreferences";

const DEBOUNCE_MS = 800;

export type PersistGeneratedVersionParams = {
  base64: string;
  mimeType?: string;
  prompt?: string | null;
  feedback?: string | null;
  designBrief?: Record<string, unknown> | null;
  productsUsed?: unknown[] | null;
  roomGeometry?: Record<string, unknown> | null;
  type?: "generated" | "edited" | "regenerated" | "phased" | "viewpoint";
  phase?: string | null;
  viewpointId?: string | null;
};

export function useQuickRoomAutosave(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;

  const {
    createProject,
    saveRoomImage,
    saveRoomExtras,
    savePlacementImages,
    saveInspirationImages,
    saveQuickRoomPreferences,
    patchProject,
    addVersion,
    addMessage,
    isAuthenticated,
    loadProjects,
  } = useProjectPersistence();

  const ensurePromiseRef = useRef<Promise<string | null> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingImagesRef = useRef(false);
  const lastSyncedRef = useRef({
    roomImage: "",
    extrasKey: "",
    placementKey: "",
    styleKey: "",
    optionsKey: "",
    styleColumn: "",
  });

  const ensureProject = useCallback(async (): Promise<string | null> => {
    if (!isAuthenticated()) return null;
    const state = useConsumerDesignStore.getState();
    if (state.currentProjectDbId) return state.currentProjectDbId;
    if (!state.roomImageBase64) return null;

    if (ensurePromiseRef.current) return ensurePromiseRef.current;

    ensurePromiseRef.current = (async () => {
      const id = await createProject({
        mode: "quick_room",
        title: state.textPrompt.trim().slice(0, 80) || "Untitled Design",
        style: state.selectedStyle,
        roomImageBase64: state.roomImageBase64,
        roomImageMime: state.roomImageMimeType ?? "image/jpeg",
        roomAnalysis: (state.quickRoomAnalysis ?? undefined) as Record<string, unknown> | undefined,
        roomGeometry: (state.lastRoomGeometry ?? undefined) as Record<string, unknown> | undefined,
        preferences: {
          draftPrompt: state.textPrompt.trim(),
          quickRoomOptions: buildQuickRoomOptionsFromStore(),
        },
      });
      if (id) void loadProjects({ mode: "quick_room" });
      return id;
    })();

    try {
      return await ensurePromiseRef.current;
    } finally {
      ensurePromiseRef.current = null;
    }
  }, [createProject, isAuthenticated, loadProjects]);

  const syncImages = useCallback(async () => {
    if (!enabled || !isAuthenticated() || syncingImagesRef.current) return;
    const state = useConsumerDesignStore.getState();
    const projectId = state.currentProjectDbId ?? (await ensureProject());
    if (!projectId) return;

    syncingImagesRef.current = true;
    try {
      const roomKey = state.roomImageBase64 ?? "";
      if (roomKey && roomKey !== lastSyncedRef.current.roomImage) {
        await saveRoomImage(projectId, roomKey, state.roomImageMimeType ?? "image/jpeg");
        lastSyncedRef.current.roomImage = roomKey;
      }

      const extrasKey = JSON.stringify(state.quickRoomExtraPhotos.map((p) => `${p.id}:${p.base64.slice(0, 32)}`));
      if (extrasKey !== lastSyncedRef.current.extrasKey) {
        await saveRoomExtras(
          projectId,
          state.quickRoomExtraPhotos.map((p) => ({
            base64: p.base64,
            mime: p.mimeType,
            id: p.id,
          })),
        );
        lastSyncedRef.current.extrasKey = extrasKey;
      }

      const placementKey = JSON.stringify(
        state.inspirationProducts.map((p) => `${p.id}:${p.base64?.slice(0, 32) ?? p.url ?? ""}`),
      );
      if (placementKey !== lastSyncedRef.current.placementKey) {
        const items = state.inspirationProducts
          .filter((p) => p.base64 && p.mimeType)
          .map((p) => ({
            base64: p.base64!,
            mime: p.mimeType!,
            label: p.label ?? "",
            id: p.id,
          }));
        await savePlacementImages(projectId, items);
        lastSyncedRef.current.placementKey = placementKey;
      }

      const stylePayload = styleInspirationsToPatchPayload(state.styleInspirations);
      const styleKey = JSON.stringify(stylePayload.map((s) => s.base64.slice(0, 32)));
      if (styleKey !== lastSyncedRef.current.styleKey) {
        await saveInspirationImages(projectId, stylePayload);
        lastSyncedRef.current.styleKey = styleKey;
      }
    } finally {
      syncingImagesRef.current = false;
    }
  }, [
    enabled,
    ensureProject,
    isAuthenticated,
    saveInspirationImages,
    savePlacementImages,
    saveRoomExtras,
    saveRoomImage,
  ]);

  const syncPreferences = useCallback(async () => {
    if (!enabled || !isAuthenticated()) return;
    const state = useConsumerDesignStore.getState();
    const projectId = state.currentProjectDbId ?? (await ensureProject());
    if (!projectId) return;

    const optionsKey = JSON.stringify({
      prompt: state.textPrompt,
      options: buildQuickRoomOptionsFromStore(),
      phased: buildQuickRoomPhasedStateFromStore(),
    });
    if (optionsKey === lastSyncedRef.current.optionsKey && state.selectedStyle === lastSyncedRef.current.styleColumn) {
      return;
    }

    await saveQuickRoomPreferences(projectId, {
      draftPrompt: state.textPrompt.trim(),
      quickRoomOptions: buildQuickRoomOptionsFromStore(),
      quickRoomPhasedState: buildQuickRoomPhasedStateFromStore(),
    });

    if (state.selectedStyle !== lastSyncedRef.current.styleColumn) {
      await patchProject(projectId, { style: state.selectedStyle });
      lastSyncedRef.current.styleColumn = state.selectedStyle;
    }

    lastSyncedRef.current.optionsKey = optionsKey;
  }, [enabled, ensureProject, isAuthenticated, patchProject, saveQuickRoomPreferences]);

  const persistGeneratedVersion = useCallback(async (
    params: PersistGeneratedVersionParams,
  ): Promise<string | null> => {
    if (!isAuthenticated()) return null;
    const projectId = await ensureProject();
    if (!projectId) return null;

    await syncImages();
    await syncPreferences();

    const versionId = await addVersion({
      base64: params.base64,
      mimeType: params.mimeType ?? "image/png",
      promptUsed: params.prompt ?? null,
      feedback: params.feedback ?? null,
      designBrief: params.designBrief ?? null,
      productsUsed: params.productsUsed ?? null,
      roomGeometry: params.roomGeometry ?? null,
      type: params.type ?? "generated",
      phase: params.phase ?? null,
      viewpointId: params.viewpointId ?? null,
    });

    if (params.prompt?.trim()) {
      void addMessage({
        role: "user",
        contentType: "text",
        text: params.prompt.trim(),
        versionId: versionId ?? undefined,
      });
    }

    void loadProjects({ mode: "quick_room" });
    return versionId;
  }, [addMessage, addVersion, ensureProject, isAuthenticated, loadProjects, syncImages, syncPreferences]);

  useEffect(() => {
    if (!enabled) return;

    let prev = useConsumerDesignStore.getState();

    const unsub = useConsumerDesignStore.subscribe((state) => {
      const imageChanged =
        state.roomImageBase64 !== prev.roomImageBase64
        || state.quickRoomExtraPhotos !== prev.quickRoomExtraPhotos
        || state.inspirationProducts !== prev.inspirationProducts
        || state.styleInspirations !== prev.styleInspirations;

      const prefsChanged =
        state.textPrompt !== prev.textPrompt
        || state.designMode !== prev.designMode
        || state.placementMode !== prev.placementMode
        || state.searchMode !== prev.searchMode
        || state.selectedCountry !== prev.selectedCountry
        || state.selectedStyle !== prev.selectedStyle
        || state.selectedProducts !== prev.selectedProducts
        || state.phasedDesignActive !== prev.phasedDesignActive
        || state.phasedCurrentPhase !== prev.phasedCurrentPhase
        || state.phase1SelectedIndex !== prev.phase1SelectedIndex
        || state.phase2SelectedIndex !== prev.phase2SelectedIndex
        || state.phase3SelectedIndex !== prev.phase3SelectedIndex;

      if (imageChanged) {
        void ensureProject().then(() => syncImages());
      }

      if (prefsChanged) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          void ensureProject().then(() => syncPreferences());
        }, DEBOUNCE_MS);
      }

      prev = state;
    });

    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, ensureProject, syncImages, syncPreferences]);

  return {
    ensureProject,
    syncImages,
    syncPreferences,
    persistGeneratedVersion,
  };
}
