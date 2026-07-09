"use client";

import { Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

const STEP_KEYS = [
  { id: "prep" as const, match: new Set(["workspace", "prep"]) },
  { id: "render" as const, match: new Set(["upload", "staging"]) },
  { id: "validate" as const, match: new Set(["validate"]) },
  { id: "done" as const, match: new Set(["complete"]) },
];

const STEP_LABELS: Record<(typeof STEP_KEYS)[number]["id"], string> = {
  prep: "project.generationStepPrep",
  render: "project.generationStepRender",
  validate: "project.generationStepValidate",
  done: "project.generationStepDone",
};

export type RoomGenerationProgressProps = {
  message: string;
  progress: number;
  generationStep?: string;
  viewIndex?: number;
  viewTotal?: number;
  isStaleStaging?: boolean;
  compact?: boolean;
  showWaitHint?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
};

function activeStepIndex(generationStep?: string): number {
  if (!generationStep) return 0;
  const idx = STEP_KEYS.findIndex((s) => s.match.has(generationStep));
  return idx >= 0 ? idx : 0;
}

export default function RoomGenerationProgress({
  message,
  progress,
  generationStep,
  viewIndex,
  viewTotal,
  isStaleStaging = false,
  compact = false,
  showWaitHint = true,
  onCancel,
  cancelLabel,
}: RoomGenerationProgressProps) {
  const { t } = useTranslation();
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const currentStep = activeStepIndex(generationStep);
  const spinnerSize = compact ? 16 : 40;
  const viewHint =
    viewTotal && viewTotal > 1 && viewIndex
      ? t("project.generationViewProgress", {
          current: String(viewIndex),
          total: String(viewTotal),
        })
      : null;

  return (
    <div
      className={`flex flex-col items-center w-full ${compact ? "gap-2" : "gap-3 py-8"}`}
      role="status"
      aria-live="polite"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`flex items-center gap-2 text-sm text-[var(--muted-foreground)] ${compact ? "" : "flex-col"}`}>
        <Loader2 size={spinnerSize} className="animate-spin text-[var(--primary)] shrink-0" />
        <p className={`text-center ${compact ? "text-sm" : "text-sm max-w-md"}`}>{message}</p>
      </div>

      {viewHint && (
        <p className="text-xs font-medium text-[var(--primary)] tabular-nums">{viewHint}</p>
      )}

      <div className={`w-full ${compact ? "max-w-sm" : "max-w-md"} h-2 rounded-full bg-[var(--muted)] overflow-hidden`}>
        <div
          className={`h-full bg-[var(--primary)] transition-all duration-500 ${
            isStaleStaging ? "animate-pulse" : ""
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-xs text-[var(--muted-foreground)] tabular-nums">{pct}%</p>

      <div className="flex gap-1.5 flex-wrap justify-center mt-1">
        {STEP_KEYS.map((step, i) => {
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          return (
            <span
              key={step.id}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                isActive
                  ? "bg-[var(--primary)] text-white"
                  : isDone
                    ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                    : "bg-[var(--muted)] text-[var(--muted-foreground)]"
              }`}
            >
              {t(STEP_LABELS[step.id])}
            </span>
          );
        })}
      </div>

      {showWaitHint && (
        <p className={`text-xs text-[var(--muted-foreground)] text-center ${compact ? "max-w-sm" : "max-w-md"}`}>
          {t("project.generationWaitHint")}
        </p>
      )}

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className={`text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline cursor-pointer ${
            compact ? "mt-0.5" : "mt-1"
          }`}
        >
          {cancelLabel ?? t("project.generationCancel")}
        </button>
      )}
    </div>
  );
}
