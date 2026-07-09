"use client";

import { useCallback, useRef } from "react";
import { useConsumerDesignStore, type SavedProjectSummary } from "@/app/store";
import { getAuthToken, authJsonHeaders } from "@/lib/authApi";

const API_BASE = "/api/vista/projects";

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
  }) => Promise<string | null>;

  addVersion: (params: {
    base64: string;
    mimeType?: string;
    promptUsed?: string | null;
    feedback?: string | null;
    designBrief?: Record<string, unknown> | null;
    productsUsed?: unknown[] | null;
    roomGeometry?: Record<string, unknown> | null;
    type?: "generated" | "edited" | "regenerated";
    roomId?: string | null;
    angleIndex?: number;
  }) => Promise<string | null>;

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
  syncOrchestratorId: (orchestratorProjectId: string) => Promise<void>;
  loadProjects: (options?: { mode?: "quick_room" | "project" }) => Promise<void>;
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
  }): Promise<string | null> => {
    if (!isAuthenticated()) return null;

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

      if (!res.ok) return null;
      const json = await res.json();
      const id = json.data?.id as string | undefined;
      if (id) {
        setCurrentProjectDbId(id);
        projectIdRef.current = id;
      }
      return id ?? null;
    } catch {
      return null;
    }
  }, [isAuthenticated, setCurrentProjectDbId]);

  const addVersion = useCallback(async (params: {
    base64: string;
    mimeType?: string;
    promptUsed?: string | null;
    feedback?: string | null;
    designBrief?: Record<string, unknown> | null;
    productsUsed?: unknown[] | null;
    roomGeometry?: Record<string, unknown> | null;
    type?: "generated" | "edited" | "regenerated";
    roomId?: string | null;
    angleIndex?: number;
  }): Promise<string | null> => {
    const pid = projectIdRef.current;
    if (!pid || !isAuthenticated()) return null;

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

      const res = await fetch(`${API_BASE}/${pid}/versions`, {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) return null;
      const json = await res.json();
      return (json.data?.id as string) ?? null;
    } catch {
      return null;
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

  return {
    createProject,
    addVersion,
    addMessage,
    renameProject,
    deleteProject,
    patchProject,
    saveInspirationImages,
    syncOrchestratorId,
    loadProjects,
    isAuthenticated,
  };
}
