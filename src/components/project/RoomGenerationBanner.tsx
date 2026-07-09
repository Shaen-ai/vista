"use client";

import { Check, X } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import type { RoomGenerationDisplay } from "@/lib/project/roomOrder";
import RoomGenerationProgress from "./RoomGenerationProgress";

export type RoomGenBannerItem = {
  roomId: string;
  roomName: string;
  display: RoomGenerationDisplay;
};

export type RoomGenOutcome = {
  kind: "success" | "error";
  message: string;
  roomId: string;
  /** When > 0, show Generate next view CTA on success banner. */
  partialViewsRemaining?: number;
  /** 1-based view index for the next generate CTA label. */
  nextViewNumber?: number;
};

type RoomGenerationBannerProps = {
  inFlight: RoomGenBannerItem[];
  outcome: RoomGenOutcome | null;
  onDismissOutcome: () => void;
  onViewDesign: (roomId: string) => void;
  onCancelGeneration?: (roomId: string) => void;
  onGenerateNextView?: (roomId: string) => void;
};

export default function RoomGenerationBanner({
  inFlight,
  outcome,
  onDismissOutcome,
  onViewDesign,
  onCancelGeneration,
  onGenerateNextView,
}: RoomGenerationBannerProps) {
  const { t } = useTranslation();

  if (inFlight.length === 0 && !outcome) return null;

  return (
    <div className="sticky top-0 z-20 flex flex-col gap-2 -mx-1 px-1 pb-2">
      {inFlight.map(({ roomId, roomName, display }) => (
        <div
          key={roomId}
          className="rounded-xl border border-[var(--primary)]/30 bg-[var(--card)] shadow-sm px-4 py-3"
        >
          <p className="text-xs font-semibold text-[var(--foreground)] mb-2">{roomName}</p>
          <RoomGenerationProgress
            compact
            showWaitHint
            {...display}
            onCancel={onCancelGeneration ? () => onCancelGeneration(roomId) : undefined}
          />
        </div>
      ))}

      {outcome && (
        <div
          className={`rounded-xl border px-4 py-3 flex items-start justify-between gap-3 ${
            outcome.kind === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-800 dark:text-green-300"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
          }`}
          role="status"
        >
          <div className="flex items-start gap-2 min-w-0">
            {outcome.kind === "success" && <Check size={18} className="shrink-0 mt-0.5" />}
            <p className="text-sm">{outcome.message}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {outcome.kind === "success" && (outcome.partialViewsRemaining ?? 0) > 0 && onGenerateNextView && (
              <button
                type="button"
                onClick={() => onGenerateNextView(outcome.roomId)}
                className="text-xs px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white font-medium hover:brightness-110 cursor-pointer"
              >
                {t("project.generateNextView", {
                  n: String(outcome.nextViewNumber ?? 2),
                })}
              </button>
            )}
            {outcome.kind === "success" && (
              <button
                type="button"
                onClick={() => onViewDesign(outcome.roomId)}
                className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:brightness-110 cursor-pointer"
              >
                {t("project.viewDesign")}
              </button>
            )}
            <button
              type="button"
              onClick={onDismissOutcome}
              className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              aria-label={t("common.close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
