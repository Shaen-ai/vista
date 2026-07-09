/**
 * Compute suggested room design order — hallway/entrance first, then concept order.
 */

import type { FloorPlanAnalysis, MasterDesignConcept } from "./types";

export function computeSuggestedRoomOrder(
  analysis: FloorPlanAnalysis,
  concept?: MasterDesignConcept | null,
): string[] {
  const allIds = analysis.rooms.map((r) => r.id);
  const hallwayIds = analysis.rooms
    .filter((r) => r.type === "hallway" || /hall|entrance|entry|foyer/i.test(r.name))
    .map((r) => r.id);

  const ordered: string[] = [...hallwayIds];

  if (concept) {
    for (const brief of concept.rooms) {
      if (!ordered.includes(brief.roomId)) ordered.push(brief.roomId);
    }
  }

  for (const id of allIds) {
    if (!ordered.includes(id)) ordered.push(id);
  }

  const displayable = getDisplayableAnalysisRoomIds(analysis);
  if (displayable.length > 0) {
    const displaySet = new Set(displayable);
    return ordered.filter((id) => displaySet.has(id));
  }

  return ordered;
}

/** Rooms rendered on the floor-plan hub (polygon with at least 3 vertices). */
export function getDisplayableAnalysisRoomIds(
  analysis: { rooms: { id: string; polygon?: [number, number][] }[] } | null | undefined,
): string[] {
  if (!analysis?.rooms?.length) return [];
  return analysis.rooms
    .filter((r) => r.polygon && r.polygon.length >= 3)
    .map((r) => r.id);
}

function applyDebugMaxRooms(roomIds: string[]): string[] {
  const maxRooms = parseInt(process.env.NEXT_PUBLIC_DEBUG_MAX_ROOMS || "0", 10);
  return maxRooms > 0 ? roomIds.slice(0, maxRooms) : roomIds;
}

/**
 * Rooms the user can design and approve — intersection of concept and drawable floor-plan rooms.
 */
export function getDesignableRoomIds(
  analysis: { rooms: { id: string; polygon?: [number, number][] }[] } | null | undefined,
  concept:
    | { rooms?: { roomId: string }[]; roomNames?: { id: string }[] }
    | null,
  suggestedOrder: string[] = [],
): string[] {
  const displayable = getDisplayableAnalysisRoomIds(analysis);
  const displaySet = new Set(displayable);

  let conceptIds: string[] = [];
  if (concept?.rooms?.length) conceptIds = concept.rooms.map((r) => r.roomId);
  else if (concept?.roomNames?.length) conceptIds = concept.roomNames.map((r) => r.id);

  let result: string[];
  if (displaySet.size > 0 && conceptIds.length > 0) {
    const filtered = conceptIds.filter((id) => displaySet.has(id));
    if (filtered.length > 0) result = filtered;
    else if (displayable.length > 0) result = displayable;
    else if (conceptIds.length > 0) result = conceptIds;
    else result = suggestedOrder;
  } else if (displayable.length > 0) result = displayable;
  else if (conceptIds.length > 0) result = conceptIds;
  else result = suggestedOrder;

  return applyDebugMaxRooms(result);
}

/**
 * After refresh or an aborted SSE run the server may still mark rooms as generating.
 * Normalize so the design hub can start or reopen room design.
 * Skip rooms the client is actively tracking — server may still be working.
 */
export function normalizeStaleGeneratingRooms<
  T extends {
    roomId: string;
    status: string;
    renders?: unknown[];
    phases?: { base?: { versions: unknown[] } };
  },
>(rooms: T[], trackedRoomIds?: ReadonlySet<string>): T[] {
  return rooms.map((room) => {
    if (room.status !== "generating") return room;
    if (trackedRoomIds?.has(room.roomId)) return room;
    const hasWork =
      (room.renders?.length ?? 0) > 0 ||
      (room.phases?.base?.versions.length ?? 0) > 0;
    return { ...room, status: hasWork ? "review" : "pending" };
  });
}

const IN_FLIGHT_GENERATION_STEPS = new Set(["workspace", "prep", "upload", "staging", "validate"]);

/** Rooms with an active server-side generation job (for session re-attach after refresh). */
export function detectInFlightRoomIds(
  rooms: { roomId: string; status: string; generationStep?: string }[],
): string[] {
  return rooms
    .filter(
      (r) =>
        r.status === "generating" ||
        (r.generationStep != null && IN_FLIGHT_GENERATION_STEPS.has(r.generationStep)),
    )
    .map((r) => r.roomId);
}

/** True while a render job is actively running for this room (drives pending view cards + polling). */
export function isRoomRenderInFlight(
  room:
    | { status?: string; generationStep?: string; generationError?: string }
    | undefined,
): boolean {
  if (!room || room.generationError) return false;
  if (room.status === "generating" || room.status === "editing") return true;
  return room.generationStep != null && IN_FLIGHT_GENERATION_STEPS.has(room.generationStep);
}

/** True when client-side generation tracking can stop polling/spinner for a room. */
export function isRoomGenerationSettled(
  room: { status: string; renders?: unknown[]; generationError?: string },
): boolean {
  if ((room.renders?.length ?? 0) > 0) return true;
  if (room.generationError) return true;
  return room.status !== "generating" && room.status !== "editing";
}

export function shouldClearGeneratingRoomId(
  rawRoom: { status: string; renders?: unknown[]; generationError?: string } | undefined,
  normalizedRoom: { status: string; renders?: unknown[]; generationError?: string } | undefined,
): boolean {
  if (!rawRoom) return true;
  const renderCount = Math.max(
    rawRoom.renders?.length ?? 0,
    normalizedRoom?.renders?.length ?? 0,
  );
  if (renderCount > 0) return true;
  if (rawRoom.generationError || normalizedRoom?.generationError) return true;
  return rawRoom.status !== "generating" && rawRoom.status !== "editing";
}

/** Merge status-only poll renders without preserving stale base64 after a new generation attempt. */
export function mergePolledRenders<
  T extends { base64?: string; angleIndex?: number; angleDescription?: string; mimeType?: string },
>(
  prevRenders: T[],
  polledRenders: T[],
  prevAttempt: number | undefined,
  polledAttempt: number | undefined,
): T[] {
  if (polledRenders.length === 0) return prevRenders;
  const attemptAdvanced =
    polledAttempt != null &&
    prevAttempt != null &&
    polledAttempt > prevAttempt;
  return polledRenders.map((rr, i) => ({
    ...(prevRenders[i] ?? rr),
    ...rr,
    base64: rr.base64 || (attemptAdvanced ? "" : prevRenders[i]?.base64) || "",
  }));
}

import { translateProgressMessage } from "@/lib/userFacingMessages";

type ProgressTranslate = (key: string, vars?: Record<string, string | number>) => string;

export type LiveGenProgress = {
  progress?: number;
  message?: string;
  generationStep?: string;
  viewIndex?: number;
  viewTotal?: number;
  updatedAt?: number;
};

export type RoomGenerationDisplay = {
  message: string;
  progress: number;
  generationStep?: string;
  viewIndex?: number;
  viewTotal?: number;
  isStaleStaging: boolean;
};

export const ROOM_GENERATION_ALREADY_IN_PROGRESS =
  "Room generation already in progress — wait or refresh";

function estimateProgressFromStep(
  step: string | undefined,
  renderCount: number,
  viewpointTargetCount: number | undefined,
): number {
  const total = viewpointTargetCount && viewpointTargetCount > 1 ? viewpointTargetCount : 1;
  const viewBlend = renderCount / total;

  switch (step) {
    case "workspace":
      return 0.08;
    case "prep":
      return 0.18;
    case "upload":
      return 0.32;
    case "staging":
      return 0.45;
    case "validate":
      return 0.82 + viewBlend * 0.1;
    case "complete":
      return 1;
    default:
      return Math.max(0.05, viewBlend * 0.5);
  }
}

/** Merge live SSE progress with Redis-persisted generation step for display. */
export function resolveRoomGenerationDisplay(
  room:
    | {
        generationStep?: string;
        renders?: unknown[];
        viewpointTargetCount?: number;
      }
    | undefined,
  t: ProgressTranslate,
  live?: LiveGenProgress,
): RoomGenerationDisplay {
  const stepProgress = estimateProgressFromStep(
    room?.generationStep,
    room?.renders?.length ?? 0,
    room?.viewpointTargetCount,
  );
  const liveProgress =
    typeof live?.progress === "number" && Number.isFinite(live.progress) && live.progress > 0
      ? Math.min(1, live.progress)
      : undefined;
  const progress = liveProgress != null ? Math.max(stepProgress, liveProgress) : stepProgress;

  const message = live?.message?.trim()
    ? translateProgressMessage(live.message, t)
    : roomGenerationProgressLabel(room, t);

  const isStaleStaging =
    (room?.generationStep === "staging" || room?.generationStep === "validate") &&
    live?.updatedAt != null &&
    Date.now() - live.updatedAt > 30_000 &&
    progress < 0.92;

  return {
    message,
    progress: progress >= 1 ? 1 : Math.min(0.99, progress),
    generationStep: live?.generationStep ?? room?.generationStep,
    viewIndex: live?.viewIndex,
    viewTotal: live?.viewTotal ?? (room?.viewpointTargetCount && room.viewpointTargetCount > 1 ? room.viewpointTargetCount : undefined),
    isStaleStaging,
  };
}

/** User-facing label for hub / floor-plan panel during background generation. */
export function roomGenerationProgressLabel(
  room:
    | {
        generationStep?: string;
        renders?: unknown[];
        viewpointTargetCount?: number;
      }
    | undefined,
  t: ProgressTranslate,
): string {
  const total = room?.viewpointTargetCount;
  const done = room?.renders?.length ?? 0;
  const photoPrefix = total && total > 1 ? `${Math.min(done + 1, total)}/${total} · ` : "";

  switch (room?.generationStep) {
    case "workspace":
    case "prep":
      return `${photoPrefix}${t("project.preparingRoom")}`;
    case "upload":
      return `${photoPrefix}${t("project.generationRendering")}`;
    case "staging":
      return `${photoPrefix}${t("project.generationRendering")}`;
    case "validate":
      return `${photoPrefix}${t("project.generationValidating")}`;
    case "complete":
      return `${photoPrefix}${t("project.generationStepDone")}`;
    default:
      return t("project.generatingRenders");
  }
}

export function nextHubRoomId(
  suggestedOrder: string[],
  rooms: { roomId: string; status: string }[],
  generatingRoomIds: ReadonlySet<string>,
  currentRoomId: string | null,
): string | null {
  const unapproved = suggestedOrder.filter((id) => {
    const room = rooms.find((r) => r.roomId === id);
    return !room || room.status !== "approved";
  });
  if (unapproved.length === 0) return null;

  let startIdx = 0;
  if (currentRoomId) {
    const idx = unapproved.indexOf(currentRoomId);
    startIdx = idx >= 0 ? (idx + 1) % unapproved.length : 0;
  }

  const rotated: string[] = [];
  for (let i = 0; i < unapproved.length; i++) {
    rotated.push(unapproved[(startIdx + i) % unapproved.length]!);
  }

  const notGenerating = rotated.find((id) => !generatingRoomIds.has(id));
  return notGenerating ?? rotated[0] ?? null;
}

export function nextUnapprovedRoomId(
  suggestedOrder: string[],
  rooms: { roomId: string; status: string }[],
): string | null {
  for (const roomId of suggestedOrder) {
    const room = rooms.find((r) => r.roomId === roomId);
    if (!room || room.status !== "approved") return roomId;
  }
  return null;
}

/** Designable room IDs in walk order (suggested order, then concept order). */
export function getOrderedDesignableRoomIds(
  analysis: { rooms: { id: string; polygon?: [number, number][] }[] } | null | undefined,
  concept:
    | { rooms?: { roomId: string }[]; roomNames?: { id: string }[] }
    | null,
  suggestedOrder: string[] = [],
): string[] {
  const designable = getDesignableRoomIds(analysis, concept, suggestedOrder);
  const designableSet = new Set(designable);
  const ordered = suggestedOrder.filter((id) => designableSet.has(id));
  return ordered.length > 0 ? ordered : designable;
}

/** Room IDs that count toward progress and finalize (matches floor-plan hub). */
export function getProjectRoomIds(
  concept:
    | { rooms?: { roomId: string }[]; roomNames?: { id: string }[] }
    | null,
  suggestedOrder: string[],
  analysis?: { rooms: { id: string; polygon?: [number, number][] }[] } | null,
): string[] {
  return getDesignableRoomIds(analysis, concept, suggestedOrder);
}

/**
 * Rooms that must be approved before PDF finalize (all designable floor-plan rooms).
 */
export function getFinalizeRequiredRoomIds(
  analysis: { rooms: { id: string; polygon?: [number, number][] }[] } | null | undefined,
  concept:
    | { rooms?: { roomId: string }[]; roomNames?: { id: string }[] }
    | null,
  suggestedOrder: string[],
  _roomResults: { roomId: string }[],
): string[] {
  return getDesignableRoomIds(analysis, concept, suggestedOrder);
}

export function getApprovalProgress(
  roomIds: string[],
  rooms: { roomId: string; status: string }[],
): { approved: number; total: number; allApproved: boolean } {
  const roomList = Array.isArray(rooms) ? rooms : [];
  const total = roomIds.length;
  const approved = roomIds.filter((id) =>
    roomList.some((r) => r.roomId === id && r.status === "approved"),
  ).length;
  return { approved, total, allApproved: total > 0 && approved === total };
}

export function getPendingFinalizeRoomIds(
  requiredIds: string[],
  rooms: { roomId: string; status: string }[],
): string[] {
  const roomList = Array.isArray(rooms) ? rooms : [];
  return requiredIds.filter(
    (id) => !roomList.some((r) => r.roomId === id && r.status === "approved"),
  );
}
