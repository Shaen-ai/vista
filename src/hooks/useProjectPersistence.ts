"use client";

import { useCallback, useRef } from "react";
import { useConsumerDesignStore, type DesignBriefResult, type SavedProjectSummary } from "@/app/store";
import { getAuthToken, authJsonHeaders } from "@/lib/authApi";

const API_BASE = "/api/vista/projects";

export type ShareStatus = {
  enabled: boolean;
  share_url: string | null;
  share_enabled_at: string | null;
};

export type PersistApiError = {
  status?: number;
  message: string;
};

export type CreateProjectResult =
  | { ok: true; id: string }
  | { ok: false; error: PersistApiError };

export type AddVersionResult =
  | { ok: true; id: string }
  | { ok: false; error: PersistApiError };

async function readTruncatedResponseBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    return "";
  }
}

function logPersistFailure(scope: string, status: number | undefined, body: string): void {
  console.warn(`[vista:persist] ${scope} failed`, { status, body: body || "(empty)" });
}

export interface VistaProjectApi {
  createProject: (params: {
    mode: "quick_room" | "project";
    title?: string;
    style?: string | null;
    roomImageBase64?: string | null;
    roomImageMime?: string | null;
    floorPlanBase64?: string | null;
    floorPlanMime?: string | null;
    roomAnalysis?: Record<string, unknown> | null;
    roomGeometry?: Record<string, unknown> | null;
    preferences?: Record<string, unknown> | null;
  }) => Promise<CreateProjectResult>;

  addVersion: (params: {
    projectId: string;
    base64: string;
    mimeType?: string;
    promptUsed?: string | null;
    feedback?: string | null;
    designBrief?: DesignBriefResult | Record<string, unknown> | null;
    productsUsed?: unknown[] | null;
    roomGeometry?: Record<string, unknown> | null;
    type?: "generated" | "edited" | "regenerated" | "phased" | "viewpoint";
    roomId?: string | null;
    angleIndex?: number;
    phase?: string | null;
    viewpointId?: string | null;
  }) => Promise<AddVersionResult>;

  addMessage: (params: {
    role: "user" | "assistant" | "system";
    contentType?: "text" | "image_upload" | "generation" | "action";
    text?: string | null;
    versionId?: string | null;
    attachmentBase64?: string | null;
    attachmentMime?: string | null;
  }) => Promise<void>;

  renameProject: (projectId: string, title: string) => Promise<boolean>;
  deleteProject: (projectId: string) => Promise<boolean>;
  patchProject: (projectId: string, patch: Record<string, unknown>) => Promise<boolean>;
  saveInspirationImages: (
    projectId: string,
    items: Array<{ base64: string; mime: string; label?: string }>,
  ) => Promise<boolean>;
  saveRoomExtras: (
    projectId: string,
    items: Array<{ base64: string; mime: string; id?: string }>,
  ) => Promise<boolean>;
  savePlacementImages: (
    projectId: string,
    items: Array<{ base64: string; mime: string; label?: string; id?: string }>,
  ) => Promise<boolean>;
  saveRoomImage: (
    projectId: string,
    base64: string,
    mime: string,
  ) => Promise<boolean>;
  saveQuickRoomPreferences: (
    projectId: string,
    prefs: import("@/lib/quickRoom/quickRoomPreferences").QuickRoomPreferencesPatch,
  ) => Promise<boolean>;
  fetchProjectPreferences: (projectId: string) => Promise<Record<string, unknown>>;
  syncOrchestratorId: (orchestratorProjectId: string) => Promise<void>;
  loadProjects: (options?: { mode?: "quick_room" | "project" }) => Promise<void>;
  getShareStatus: (projectId: string) => Promise<ShareStatus | null>;
  enableShare: (projectId: string) => Promise<ShareStatus | null>;
  disableShare: (projectId: string) => Promise<ShareStatus | null>;
  isAuthenticated: () => boolean;
}

export function useProjectPersistence(): VistaProjectApi {
  const {
    currentProjectDbId,
    setCurrentProjectDbId,
    setSavedProjects,
    setSavedProjectsLoading,
  } = useConsumerDesignStore();

  const projectIdRef = useRef(currentProjectDbId);
  projectIdRef.current = currentProjectDbId;

  const isAuthenticated = useCallback((): boolean => {
    return !!getAuthToken();
  }, []);

  const loadProjects = useCallback(async (options?: { mode?: "quick_room" | "project" }) => {
    if (!isAuthenticated()) return;
    setSavedProjectsLoading(true);
    try {
      const qs = options?.mode ? `?mode=${encodeURIComponent(options.mode)}` : "";
      const res = await fetch(`${API_BASE}${qs}`, { headers: authJsonHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const items: SavedProjectSummary[] = (json.data ?? []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        mode: p.mode as "quick_room" | "project",
        title: p.title as string,
        coverImageUrl: (p.cover_image_url as string) ?? null,
        orchestratorProjectId: (p.orchestrator_project_id as string) ?? null,
        style: (p.style as string) ?? null,
        messageCount: (p.message_count as number) ?? 0,
        versionCount: (p.version_count as number) ?? 0,
        lastInteractionAt: (p.last_interaction_at as string) ?? null,
        createdAt: (p.created_at as string) ?? null,
      }));
      setSavedProjects(items);
    } catch {
      /* ignore */
    } finally {
      setSavedProjectsLoading(false);
    }
  }, [isAuthenticated, setSavedProjects, setSavedProjectsLoading]);

  const createProject = useCallback(async (params: {
    mode: "quick_room" | "project";
    title?: string;
    style?: string | null;
    roomImageBase64?: string | null;
    roomImageMime?: string | null;
    floorPlanBase64?: string | null;
    floorPlanMime?: string | null;
    roomAnalysis?: Record<string, unknown> | null;
    roomGeometry?: Record<string, unknown> | null;
    preferences?: Record<string, unknown> | null;
  }): Promise<CreateProjectResult> => {
    if (!isAuthenticated()) {
      return { ok: false, error: { message: "not authenticated" } };
    }

    try {
      const body: Record<string, unknown> = { mode: params.mode };
      if (params.title) body.title = params.title;
      if (params.style) body.style = params.style;
      if (params.roomImageBase64) {
        body.room_image_base64 = params.roomImageBase64;
        body.room_image_mime = params.roomImageMime ?? "image/jpeg";
      }
      if (params.floorPlanBase64) {
        body.floor_plan_base64 = params.floorPlanBase64;
        body.floor_plan_mime = params.floorPlanMime ?? "image/jpeg";
      }
      if (params.roomAnalysis) body.room_analysis = params.roomAnalysis;
      if (params.roomGeometry) body.room_geometry = params.roomGeometry;
      if (params.preferences) body.preferences = params.preferences;

      const res = await fetch(API_BASE, {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const responseBody = await readTruncatedResponseBody(res);
        logPersistFailure("createProject", res.status, responseBody);
        return {
          ok: false,
          error: { status: res.status, message: responseBody || res.statusText || "create failed" },
        };
      }
      const json = await res.json();
      const id = json.data?.id as string | undefined;
      if (id) {
        setCurrentProjectDbId(id);
        projectIdRef.current = id;
        return { ok: true, id };
      }
      logPersistFailure("createProject", res.status, "missing id in response");
      return { ok: false, error: { status: res.status, message: "missing id in response" } };
    } catch (err) {
      const message = err instanceof Error ? err.message : "create failed";
      logPersistFailure("createProject", undefined, message);
      return { ok: false, error: { message } };
    }
  }, [isAuthenticated, setCurrentProjectDbId]);

  const addVersion = useCallback(async (params: {
    projectId: string;
    base64: string;
    mimeType?: string;
    promptUsed?: string | null;
    feedback?: string | null;
    designBrief?: DesignBriefResult | Record<string, unknown> | null;
    productsUsed?: unknown[] | null;
    roomGeometry?: Record<string, unknown> | null;
    type?: "generated" | "edited" | "regenerated" | "phased" | "viewpoint";
    roomId?: string | null;
    angleIndex?: number;
    phase?: string | null;
    viewpointId?: string | null;
  }): Promise<AddVersionResult> => {
    const pid = params.projectId;
    if (!pid || !isAuthenticated()) {
      return { ok: false, error: { message: "missing project id or not authenticated" } };
    }

    try {
      const body: Record<string, unknown> = { base64: params.base64 };
      if (params.mimeType) body.mime_type = params.mimeType;
      if (params.promptUsed) body.prompt_used = params.promptUsed;
      if (params.feedback) body.feedback = params.feedback;
      if (params.designBrief) body.design_brief = params.designBrief;
      if (params.productsUsed) body.products_used = params.productsUsed;
      if (params.roomGeometry) body.room_geometry = params.roomGeometry;
      if (params.type) body.type = params.type;
      if (params.roomId) body.room_id = params.roomId;
      if (params.angleIndex !== undefined) body.angle_index = params.angleIndex;
      if (params.phase) body.phase = params.phase;
      if (params.viewpointId) body.viewpoint_id = params.viewpointId;

      const res = await fetch(`${API_BASE}/${pid}/versions`, {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const responseBody = await readTruncatedResponseBody(res);
        logPersistFailure("addVersion", res.status, responseBody);
        return {
          ok: false,
          error: { status: res.status, message: responseBody || res.statusText || "version failed" },
        };
      }
      const json = await res.json();
      const id = (json.data?.id as string) ?? null;
      if (!id) {
        logPersistFailure("addVersion", res.status, "missing id in response");
        return { ok: false, error: { status: res.status, message: "missing id in response" } };
      }
      return { ok: true, id };
    } catch (err) {
      const message = err instanceof Error ? err.message : "version failed";
      logPersistFailure("addVersion", undefined, message);
      return { ok: false, error: { message } };
    }
  }, [isAuthenticated]);

  const addMessage = useCallback(async (params: {
    role: "user" | "assistant" | "system";
    contentType?: "text" | "image_upload" | "generation" | "action";
    text?: string | null;
    versionId?: string | null;
    attachmentBase64?: string | null;
    attachmentMime?: string | null;
  }): Promise<void> => {
    const pid = projectIdRef.current;
    if (!pid || !isAuthenticated()) return;

    try {
      const body: Record<string, unknown> = { role: params.role };
      if (params.contentType) body.content_type = params.contentType;
      if (params.text) body.text = params.text;
      if (params.versionId) body.version_id = params.versionId;
      if (params.attachmentBase64) {
        body.attachment_base64 = params.attachmentBase64;
        body.attachment_mime = params.attachmentMime ?? "image/jpeg";
      }

      await fetch(`${API_BASE}/${pid}/messages`, {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify(body),
      });
    } catch {
      /* fire and forget */
    }
  }, [isAuthenticated]);

  const patchProject = useCallback(async (projectId: string, patch: Record<string, unknown>): Promise<boolean> => {
    if (!isAuthenticated()) return false;
    try {
      const res = await fetch(`${API_BASE}/${projectId}`, {
        method: "PATCH",
        headers: authJsonHeaders(),
        body: JSON.stringify(patch),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [isAuthenticated]);

  const saveInspirationImages = useCallback(async (
    projectId: string,
    items: Array<{ base64: string; mime: string; label?: string }>,
  ): Promise<boolean> => {
    return patchProject(projectId, { inspiration_images: items });
  }, [patchProject]);

  const saveRoomExtras = useCallback(async (
    projectId: string,
    items: Array<{ base64: string; mime: string; id?: string }>,
  ): Promise<boolean> => {
    return patchProject(projectId, { room_extra_images: items });
  }, [patchProject]);

  const savePlacementImages = useCallback(async (
    projectId: string,
    items: Array<{ base64: string; mime: string; label?: string; id?: string }>,
  ): Promise<boolean> => {
    return patchProject(projectId, { placement_images: items });
  }, [patchProject]);

  const saveRoomImage = useCallback(async (
    projectId: string,
    base64: string,
    mime: string,
  ): Promise<boolean> => {
    return patchProject(projectId, {
      room_image_base64: base64,
      room_image_mime: mime,
    });
  }, [patchProject]);

  const fetchProjectPreferences = useCallback(async (projectId: string): Promise<Record<string, unknown>> => {
    if (!isAuthenticated()) return {};
    try {
      const res = await fetch(`${API_BASE}/${projectId}`, { headers: authJsonHeaders() });
      if (!res.ok) return {};
      const json = await res.json();
      return (json.data?.preferences ?? {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [isAuthenticated]);

  const saveQuickRoomPreferences = useCallback(async (
    projectId: string,
    prefs: import("@/lib/quickRoom/quickRoomPreferences").QuickRoomPreferencesPatch,
  ): Promise<boolean> => {
    const existing = await fetchProjectPreferences(projectId);
    const merged = { ...existing, ...prefs };
    if (prefs.quickRoomOptions) {
      merged.quickRoomOptions = {
        ...(typeof existing.quickRoomOptions === "object" && existing.quickRoomOptions
          ? existing.quickRoomOptions as Record<string, unknown>
          : {}),
        ...prefs.quickRoomOptions,
      };
    }
    if (prefs.quickRoomPhasedState) {
      merged.quickRoomPhasedState = {
        ...(typeof existing.quickRoomPhasedState === "object" && existing.quickRoomPhasedState
          ? existing.quickRoomPhasedState as Record<string, unknown>
          : {}),
        ...prefs.quickRoomPhasedState,
      };
    }
    return patchProject(projectId, { preferences: merged });
  }, [fetchProjectPreferences, patchProject]);

  const renameProject = useCallback(async (projectId: string, title: string): Promise<boolean> => {
    return patchProject(projectId, { title });
  }, [patchProject]);

  const deleteProject = useCallback(async (projectId: string): Promise<boolean> => {
    if (!isAuthenticated()) return false;
    try {
      const res = await fetch(`${API_BASE}/${projectId}`, {
        method: "DELETE",
        headers: authJsonHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [isAuthenticated]);

  const syncOrchestratorId = useCallback(async (orchestratorProjectId: string) => {
    const pid = projectIdRef.current;
    if (!pid || !isAuthenticated()) return;
    try {
      const res = await fetch(`${API_BASE}/${pid}`, { headers: authJsonHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      const existing = (json.data?.preferences ?? {}) as Record<string, unknown>;
      if (existing.orchestratorProjectId === orchestratorProjectId) return;
      await patchProject(pid, {
        preferences: { ...existing, orchestratorProjectId },
      });
    } catch {
      /* ignore */
    }
  }, [isAuthenticated, patchProject]);

  const parseShareStatus = (json: Record<string, unknown>): ShareStatus => ({
    enabled: Boolean(json.enabled),
    share_url: (json.share_url as string) ?? null,
    share_enabled_at: (json.share_enabled_at as string) ?? null,
  });

  const getShareStatus = useCallback(async (projectId: string): Promise<ShareStatus | null> => {
    if (!isAuthenticated()) return null;
    try {
      const res = await fetch(`${API_BASE}/${projectId}/share`, { headers: authJsonHeaders() });
      if (!res.ok) return null;
      const json = await res.json();
      return parseShareStatus((json.data ?? {}) as Record<string, unknown>);
    } catch {
      return null;
    }
  }, [isAuthenticated]);

  const enableShare = useCallback(async (projectId: string): Promise<ShareStatus | null> => {
    if (!isAuthenticated()) return null;
    try {
      const res = await fetch(`${API_BASE}/${projectId}/share`, {
        method: "POST",
        headers: authJsonHeaders(),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return parseShareStatus((json.data ?? {}) as Record<string, unknown>);
    } catch {
      return null;
    }
  }, [isAuthenticated]);

  const disableShare = useCallback(async (projectId: string): Promise<ShareStatus | null> => {
    if (!isAuthenticated()) return null;
    try {
      const res = await fetch(`${API_BASE}/${projectId}/share`, {
        method: "DELETE",
        headers: authJsonHeaders(),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return parseShareStatus((json.data ?? {}) as Record<string, unknown>);
    } catch {
      return null;
    }
  }, [isAuthenticated]);

  return {
    createProject,
    addVersion,
    addMessage,
    renameProject,
    deleteProject,
    patchProject,
    saveInspirationImages,
    saveRoomExtras,
    savePlacementImages,
    saveRoomImage,
    saveQuickRoomPreferences,
    fetchProjectPreferences,
    syncOrchestratorId,
    loadProjects,
    getShareStatus,
    enableShare,
    disableShare,
    isAuthenticated,
  };
}
