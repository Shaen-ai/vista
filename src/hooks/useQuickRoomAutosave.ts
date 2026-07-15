"use client";

import { useCallback, useEffect, useRef } from "react";
import { useConsumerDesignStore, type DesignBriefResult } from "@/app/store";
import { useProjectPersistence } from "@/hooks/useProjectPersistence";
import { CloudflareSecurityChallengeError } from "@/lib/cloudflareChallenge";
import { compressDataUrl } from "@/lib/compressImageClient";
import { styleInspirationsToPatchPayload } from "@/lib/inspirationPersistence";
import {
  buildQuickRoomOptionsFromStore,
  buildQuickRoomPhasedStateFromStore,
} from "@/lib/quickRoom/quickRoomPreferences";

const DEBOUNCE_MS = 800;
const VERSION_UPLOAD_MAX_EDGE = 1600;
const VERSION_UPLOAD_QUALITY = 0.82;

// Shared across hook instances so remounts / Strict Mode cannot double-POST create.
let ensureProjectPromise: Promise<string | null> | null = null;

export type PersistGeneratedVersionParams = {
  base64: string;
  mimeType?: string;
  prompt?: string | null;
  feedback?: string | null;
  designBrief?: DesignBriefResult | Record<string, unknown> | null;
  productsUsed?: unknown[] | null;
  roomGeometry?: Record<string, unknown> | null;
  type?: "generated" | "edited" | "regenerated" | "phased" | "viewpoint";
  phase?: string | null;
  viewpointId?: string | null;
};

export type PersistGeneratedVersionResult =
  | { ok: true; versionId: string }
  | {
      ok: false;
      reason: "not_authenticated" | "create_failed" | "version_failed";
      status?: number;
      message?: string;
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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncImagesPromiseRef = useRef<Promise<void> | null>(null);
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

    if (ensureProjectPromise) return ensureProjectPromise;

    ensureProjectPromise = (async () => {
      const created = await createProject({
        mode: "quick_room",
        title: state.textPrompt.trim().slice(0, 80) || "Untitled Design",
        style: state.selectedStyle,
        ...(state.roomImageBase64
          ? {
              roomImageBase64: state.roomImageBase64,
              roomImageMime: state.roomImageMimeType ?? "image/jpeg",
            }
          : {}),
        roomAnalysis: (state.quickRoomAnalysis ?? undefined) as Record<string, unknown> | undefined,
        roomGeometry: (state.lastRoomGeometry ?? undefined) as Record<string, unknown> | undefined,
        preferences: {
          draftPrompt: state.textPrompt.trim(),
          quickRoomOptions: buildQuickRoomOptionsFromStore(),
        },
      });
      if (!created.ok) {
        if (created.error.code === "cloudflare_challenge") {
          throw new CloudflareSecurityChallengeError();
        }
        console.warn("[vista:persist] create_failed", {
          status: created.error.status,
          message: created.error.message,
        });
        return null;
      }
      await loadProjects({ mode: "quick_room" });
      return created.id;
    })();

    try {
      return await ensureProjectPromise;
    } finally {
      ensureProjectPromise = null;
    }
  }, [createProject, isAuthenticated, loadProjects]);

  const syncImages = useCallback(async () => {
    if (!enabled || !isAuthenticated()) return;
    if (syncImagesPromiseRef.current) {
      await syncImagesPromiseRef.current;
      return;
    }

    const run = (async () => {
      const state = useConsumerDesignStore.getState();

      let projectId = state.currentProjectDbId;
      if (!projectId) {
        if (!state.roomImageBase64) return;
        projectId = await ensureProject();
        if (!projectId) return;
      }

      const roomKey = state.roomImageBase64 ?? "";
      if (roomKey && roomKey !== lastSyncedRef.current.roomImage) {
        const ok = await saveRoomImage(projectId, roomKey, state.roomImageMimeType ?? "image/jpeg");
        if (ok) {
          lastSyncedRef.current.roomImage = roomKey;
          void loadProjects({ mode: "quick_room" });
        }
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
    })();

    syncImagesPromiseRef.current = run;
    try {
      await run;
    } finally {
      if (syncImagesPromiseRef.current === run) {
        syncImagesPromiseRef.current = null;
      }
    }
  }, [
    enabled,
    ensureProject,
    isAuthenticated,
    loadProjects,
    saveInspirationImages,
    savePlacementImages,
    saveRoomExtras,
    saveRoomImage,
  ]);

  const syncPreferences = useCallback(async () => {
    if (!enabled || !isAuthenticated()) return;
    const state = useConsumerDesignStore.getState();
    const projectId = state.currentProjectDbId;
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
  }, [enabled, isAuthenticated, patchProject, saveQuickRoomPreferences]);

  const persistGeneratedVersion = useCallback(async (
    params: PersistGeneratedVersionParams,
  ): Promise<PersistGeneratedVersionResult> => {
    if (!isAuthenticated()) return { ok: false, reason: "not_authenticated" };
    const projectId = await ensureProject();
    if (!projectId) {
      return { ok: false, reason: "create_failed" };
    }

    await syncImages();
    await syncPreferences();

    const state = useConsumerDesignStore.getState();
    const projectPatch: Record<string, unknown> = {};
    if (params.roomGeometry) projectPatch.room_geometry = params.roomGeometry;
    if (state.quickRoomAnalysis) projectPatch.room_analysis = state.quickRoomAnalysis;
    if (Object.keys(projectPatch).length > 0) {
      await patchProject(projectId, projectPatch);
    }

    let uploadBase64 = params.base64;
    let uploadMime = params.mimeType ?? "image/png";
    try {
      const dataUrl = `data:${uploadMime};base64,${params.base64}`;
      const compressed = await compressDataUrl(dataUrl, {
        maxEdge: VERSION_UPLOAD_MAX_EDGE,
        quality: VERSION_UPLOAD_QUALITY,
      });
      uploadBase64 = compressed.base64;
      uploadMime = compressed.mimeType;
    } catch (compressErr) {
      console.warn("[vista:persist] version compress failed, uploading original", compressErr);
    }

    const versionResult = await addVersion({
      projectId,
      base64: uploadBase64,
      mimeType: uploadMime,
      promptUsed: params.prompt ?? null,
      feedback: params.feedback ?? null,
      designBrief: params.designBrief ?? null,
      productsUsed: params.productsUsed ?? null,
      roomGeometry: params.roomGeometry ?? null,
      type: params.type ?? "generated",
      phase: params.phase ?? null,
      viewpointId: params.viewpointId ?? null,
    });

    if (!versionResult.ok) {
      console.warn("[vista:persist] version_failed", {
        status: versionResult.error.status,
        message: versionResult.error.message,
      });
      return {
        ok: false,
        reason: "version_failed",
        status: versionResult.error.status,
        message: versionResult.error.message,
      };
    }

    if (params.prompt?.trim()) {
      await addMessage({
        role: "user",
        contentType: "text",
        text: params.prompt.trim(),
        versionId: versionResult.id,
      });
    }

    await loadProjects({ mode: "quick_room" });
    return { ok: true, versionId: versionResult.id };
  }, [addMessage, addVersion, ensureProject, isAuthenticated, loadProjects, patchProject, syncImages, syncPreferences]);

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
        if (state.currentProjectDbId) {
          void syncImages();
        } else if (state.roomImageBase64) {
          void ensureProject().then(() => syncImages());
        }
      }

      if (prefsChanged && state.currentProjectDbId) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          void syncPreferences();
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
