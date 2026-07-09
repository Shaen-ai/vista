"use client";

import { useCallback } from "react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import type { ProjectStep, ProjectConceptSummary } from "@/app/store";
import type { FloorPlanAnalysis, RoomResult } from "@/lib/project/types";
import {
  getFinalizeRequiredRoomIds,
  getPendingFinalizeRoomIds,
} from "@/lib/project/roomOrder";

type ProjectFetchData = {
  rooms?: RoomResult[];
  analysis?: FloorPlanAnalysis | null;
  concept?: ProjectConceptSummary | null;
  suggestedRoomOrder?: string[];
  canFinalize?: boolean;
  pendingRoomIds?: string[];
  hasPdf?: boolean;
};

export function useProjectFinalize(opts: {
  projectId: string | null;
  concept: ProjectConceptSummary | null;
  analysis: FloorPlanAnalysis | null;
  rooms: RoomResult[];
  suggestedOrder: string[];
  setProjectStep: (step: ProjectStep) => void;
  setProjectLoading: (loading: boolean) => void;
  setProjectError: (error: string | null) => void;
  setHasPdf: (has: boolean) => void;
  setRooms?: (rooms: RoomResult[]) => void;
}) {
  const { locale, t } = useTranslation();
  const {
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
  } = opts;

  return useCallback(async () => {
    if (!projectId) return;
    setProjectLoading(true);
    setProjectError(null);

    try {
      const syncRes = await fetch(`/api/project/${projectId}`, { cache: "no-store" });
      const syncJson = await syncRes.json();
      const serverData = syncJson.data as ProjectFetchData | undefined;

      if (syncRes.ok && serverData?.rooms) {
        setRooms?.(serverData.rooms);
      }

      const syncedRooms = serverData?.rooms ?? rooms;
      const syncedAnalysis = serverData?.analysis ?? analysis;
      const syncedConcept = serverData?.concept ?? concept;
      const syncedOrder = serverData?.suggestedRoomOrder ?? suggestedOrder;

      const requiredIds = getFinalizeRequiredRoomIds(
        syncedAnalysis,
        syncedConcept,
        syncedOrder,
        syncedRooms,
      );
      const pendingIds =
        serverData?.pendingRoomIds ??
        getPendingFinalizeRoomIds(requiredIds, syncedRooms);
      const canFinalize =
        serverData?.canFinalize ??
        (requiredIds.length > 0 && pendingIds.length === 0);

      if (!canFinalize) {
        const pendingNames = pendingIds
          .map((id) => syncedConcept?.roomNames?.find((rn) => rn.id === id)?.name ?? id)
          .filter(Boolean);
        throw new Error(
          pendingNames.length > 0
            ? t("project.finalizePendingRooms", { rooms: pendingNames.join(", ") })
            : t("project.finalizeNotReady"),
        );
      }

      setProjectStep("finalizing");
      const res = await fetch(`/api/project/${projectId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        const pendingNames = (json.pendingRoomNames as string[] | undefined)?.join(", ");
        throw new Error(
          pendingNames
            ? t("project.finalizePendingRooms", { rooms: pendingNames })
            : (json.error as string) || t("project.finalizationFailed"),
        );
      }
      setHasPdf(json.data?.hasPdf ?? false);
      setProjectStep("complete");
    } catch (err) {
      setProjectStep("rooms");
      setProjectError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setProjectLoading(false);
    }
  }, [
    projectId,
    concept,
    analysis,
    rooms,
    suggestedOrder,
    locale,
    setProjectStep,
    setProjectLoading,
    setProjectError,
    setHasPdf,
    setRooms,
    t,
  ]);
}
