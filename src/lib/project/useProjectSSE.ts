"use client";

import type { ProgressEvent, EditAnnotation } from "@/lib/project/types";
import { pipelineLog, userFlowLog } from "@/lib/pipelineLog";
import { dispatchSpendUpdate } from "@/lib/devSpendClient";
import { throwIfAiServiceUnavailable } from "@/lib/aiServiceError";
import { consumeSSE } from "@/lib/sseClient";
import { sanitizeUserFacingMessage } from "@/lib/userFacingMessages";
import { track } from "@/lib/analytics";
import { authContextForApi } from "@/lib/vistaTokens";

const DEFAULT_GENERATE_ROOM_SSE_TIMEOUT_MS = 360_000;

let activeRoomGenerationAbort: AbortController | null = null;

export class TokenInsufficientError extends Error {
  readonly balance: number;
  readonly required: number;

  constructor(message: string, balance: number, required: number) {
    super(message);
    this.name = "TokenInsufficientError";
    this.balance = balance;
    this.required = required;
  }
}

export function balanceFromProgressEvent(event: ProgressEvent | null | undefined): number | undefined {
  const data = event?.data;
  if (typeof data === "object" && data !== null && "balance" in data) {
    const balance = (data as { balance?: unknown }).balance;
    if (typeof balance === "number") return balance;
  }
  return undefined;
}

/** Abort the in-flight client SSE fetch for room generation, if any. */
export function cancelActiveRoomGeneration(): void {
  activeRoomGenerationAbort?.abort("user-cancel");
  activeRoomGenerationAbort = null;
}

function generateRoomSseTimeoutMs(): number {
  const raw = (process.env.NEXT_PUBLIC_VISTA_SSE_CLIENT_TIMEOUT_MS ?? "").trim();
  if (!raw) return DEFAULT_GENERATE_ROOM_SSE_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_GENERATE_ROOM_SSE_TIMEOUT_MS;
}

export function useProjectSSE() {
  const createProject = async (
    formData: FormData,
    onProgress: (event: ProgressEvent) => void,
  ): Promise<ProgressEvent> => {
    const res = await fetch("/api/project/create-stream", {
      method: "POST",
      body: formData,
    });

    if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
      const json = await res.json();
      throwIfAiServiceUnavailable(json);
      throw new Error(sanitizeUserFacingMessage(json.error || "Project creation failed"));
    }

    const last = await consumeSSE(res, onProgress);
    if (!last?.data) {
      throw new Error("Project creation did not complete");
    }
    track("project_created");
    dispatchSpendUpdate();
    return last;
  };

  const generateRoomImpl = async (
    projectId: string,
    roomId: string,
    onProgress: (event: ProgressEvent) => void,
    options?: {
      phase?: "base" | "furniture" | "decor";
      action?: "generate" | "regenerate" | "edit" | "approve" | "approve-room" | "select" | "finish" | "next-viewpoint" | "approve-viewpoint" | "sync-gallery" | "remove-render";
      editFeedback?: string;
      editAnnotation?: EditAnnotation;
      index?: number;
      designMode?: "made" | "custom";
      redo?: boolean;
      photoId?: string;
      renderIndex?: number;
    },
  ): Promise<ProgressEvent> => {
    // STEP 6 — client asks the server to design this room (kicks off prompt
    // assembly → Gemini on the server). Watch the server log for steps 5–8 next.
    pipelineLog("ASSEMBLE_PROMPT", "client requested room generation", {
      projectId,
      roomId,
      phase: options?.phase ?? "base",
      action: options?.action ?? "generate",
      designMode: options?.designMode,
    });
    if (options?.action === "approve") {
      userFlowLog(6, "approve clicked — sending to server", {
        projectId,
        roomId,
        phase: options.phase ?? "base",
      }, "F");
    }
    const controller = new AbortController();
    activeRoomGenerationAbort = controller;
    const timeoutMs = generateRoomSseTimeoutMs();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    const { authHeaders } = authContextForApi();
    try {
      res = await fetch(`/api/project/${projectId}/generate-room/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: options ? JSON.stringify(options) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        if (activeRoomGenerationAbort === controller) {
          activeRoomGenerationAbort = null;
        }
        const userCancelled = controller.signal.reason === "user-cancel";
        pipelineLog(
          "GEMINI_GENERATE",
          userCancelled ? "client generation cancelled" : "client generation SSE timed out",
          { projectId, roomId, timeoutMs },
          userCancelled ? "warn" : "error",
        );
        throw new Error(userCancelled ? "Generation cancelled" : "Generation timed out — try Redo");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (activeRoomGenerationAbort === controller) {
        activeRoomGenerationAbort = null;
      }
    }

    if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
      const json = (await res.json()) as {
        error?: string;
        balance?: number;
        required?: number;
      };
      throwIfAiServiceUnavailable(json);
      if (res.status === 402) {
        throw new TokenInsufficientError(
          sanitizeUserFacingMessage(json.error || "Not enough tokens."),
          json.balance ?? 0,
          json.required ?? 0,
        );
      }
      pipelineLog("GEMINI_GENERATE", "client received generation error", { projectId, roomId, error: json.error }, "error");
      throw new Error(sanitizeUserFacingMessage(json.error || "Room generation failed"));
    }

    const last = await consumeSSE(res, onProgress);
    // approve / select / approve-viewpoint / approve-room complete without a full room payload.
    const lightweight =
      options?.action === "approve"
      || options?.action === "select"
      || options?.action === "approve-viewpoint"
      || options?.action === "approve-room";
    if (!lightweight && !last?.data) {
      throw new Error("Room generation did not complete");
    }
    // STEP 7 — client got the finished render back for this room/phase.
    pipelineLog("GEMINI_GENERATE", "client received room render", {
      projectId,
      roomId,
      phase: options?.phase ?? "base",
      finalPhase: last?.phase,
    });
    if (options?.action === "approve") {
      userFlowLog(6, "approve acknowledged by server", {
        projectId,
        roomId,
        phase: options.phase ?? "base",
        finalPhase: last?.phase,
      }, "F");
    }
    dispatchSpendUpdate();
    return last ?? { phase: "complete", message: "" };
  };

  const generateRoom: typeof generateRoomImpl = async (projectId, roomId, onProgress, options) => {
    const action = options?.action ?? "generate";
    const phase = options?.phase ?? "base";
    const isGeneration = action === "generate" || action === "regenerate" || action === "edit";
    if (isGeneration) track("project_room_generate_started", { mode: "project", phase, action, room_id: roomId });
    try {
      const last = await generateRoomImpl(projectId, roomId, onProgress, options);
      if (isGeneration) track("project_room_generate_succeeded", { mode: "project", phase, action, room_id: roomId });
      return last;
    } catch (err) {
      if (isGeneration) {
        track("project_room_generate_failed", {
          mode: "project",
          phase,
          action,
          room_id: roomId,
          error_message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        });
      }
      throw err;
    }
  };

  const createConcept = async (
    projectId: string,
    formData: FormData,
    onProgress: (event: ProgressEvent) => void,
  ): Promise<ProgressEvent> => {
    const res = await fetch(`/api/project/${projectId}/create-concept-stream`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
      const json = await res.json();
      throwIfAiServiceUnavailable(json);
      throw new Error(sanitizeUserFacingMessage(json.error || "Design concept creation failed"));
    }

    const last = await consumeSSE(res, onProgress);
    if (!last?.data) {
      throw new Error("Design concept creation did not complete");
    }
    track("project_concept_created");
    dispatchSpendUpdate();
    return last;
  };

  return { createProject, createConcept, generateRoom, cancelActiveRoomGeneration };
}

export type { ProgressEvent };
