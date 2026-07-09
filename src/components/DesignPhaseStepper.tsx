"use client";

import { CheckCircle2, Circle, Loader2, AlertCircle, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import type { DesignPhase } from "@/lib/phaseRouter";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

export type PhaseStatus = "idle" | "selecting" | "generating" | "validating" | "retrying" | "done" | "error";

interface PhaseStep {
  phase: DesignPhase;
  label: string;
  sublabel: string;
}

const PHASE_STEPS: PhaseStep[] = [
  { phase: "base", label: "Materials & Lighting", sublabel: "Flooring, lighting, curtains" },
  { phase: "furniture", label: "Furniture", sublabel: "Sofa, table, chairs, carpet" },
  { phase: "decor", label: "Decor", sublabel: "Decorative items (optional)" },
];

function getStepState(
  stepPhase: DesignPhase,
  currentPhase: DesignPhase | "idle" | "complete",
  status: PhaseStatus,
): "pending" | "active" | "done" | "error" {
  const order: Record<string, number> = { base: 0, furniture: 1, decor: 2 };
  const stepIdx = order[stepPhase] ?? 0;
  const currentIdx = currentPhase === "idle" ? -1 : currentPhase === "complete" ? 3 : (order[currentPhase] ?? 0);

  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) {
    if (status === "done") return "done";
    if (status === "error") return "error";
    return "active";
  }
  return "pending";
}

function StatusIcon({ state, status }: { state: "pending" | "active" | "done" | "error"; status: PhaseStatus }) {
  if (state === "done") return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
  if (state === "error") return <AlertCircle className="w-5 h-5 text-red-500" />;
  if (state === "active") {
    if (status === "retrying") return <RotateCcw className="w-5 h-5 text-amber-500 animate-spin" />;
    if (status === "generating" || status === "validating" || status === "selecting") {
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    }
    return <Circle className="w-5 h-5 text-blue-500 fill-blue-100" />;
  }
  return <Circle className="w-5 h-5 text-gray-300" />;
}

function statusLabel(status: PhaseStatus): string {
  switch (status) {
    case "selecting": return "Selecting products...";
    case "generating": return "Generating...";
    case "validating": return "Validating products...";
    case "retrying": return "Retrying...";
    case "done": return "Complete";
    case "error": return "Failed";
    default: return "";
  }
}

interface DesignPhaseStepperProps {
  currentPhase: DesignPhase | "idle" | "complete";
  status: PhaseStatus;
  retryCount: number;
  onSkipDecor?: () => void;
  showSkipDecor?: boolean;
}

export function DesignPhaseStepper({
  currentPhase,
  status,
  retryCount,
  onSkipDecor,
  showSkipDecor,
}: DesignPhaseStepperProps) {
  return (
    <div className="flex flex-col gap-1 py-3">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 px-1">
        Design Progress
      </div>
      {PHASE_STEPS.map((step, idx) => {
        const state = getStepState(step.phase, currentPhase, status);
        const isLast = idx === PHASE_STEPS.length - 1;
        const isActive = state === "active";

        return (
          <div key={step.phase} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <StatusIcon state={state} status={isActive ? status : "idle"} />
              {!isLast && (
                <div
                  className={`w-px h-8 mt-1 ${
                    state === "done" ? "bg-emerald-300" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
            <div className="flex-1 min-w-0 pb-2">
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-medium ${
                    state === "active"
                      ? "text-blue-700"
                      : state === "done"
                        ? "text-emerald-700"
                        : state === "error"
                          ? "text-red-700"
                          : "text-gray-400"
                  }`}
                >
                  {step.label}
                </span>
                {isActive && status !== "idle" && status !== "done" && (
                  <span className="text-xs text-blue-500">
                    {statusLabel(status)}
                    {status === "retrying" && retryCount > 0 && ` (${retryCount}/3)`}
                  </span>
                )}
              </div>
              <p className={`text-xs ${state === "pending" ? "text-gray-300" : "text-gray-500"}`}>
                {step.sublabel}
              </p>
              {isLast && showSkipDecor && state === "pending" && onSkipDecor && (
                <button
                  onClick={onSkipDecor}
                  className="mt-1 text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  Skip decor
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface PhaseVersionNavProps {
  selectedIndex: number;
  totalVersions: number;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}

export function PhaseVersionNav({
  selectedIndex,
  totalVersions,
  onPrevious,
  onNext,
  disabled,
}: PhaseVersionNavProps) {
  if (totalVersions <= 1) return null;

  const atStart = selectedIndex <= 0;
  const atEnd = selectedIndex >= totalVersions - 1;

  return (
    <div className="flex items-center justify-center gap-3 py-2">
      <button
        type="button"
        onClick={onPrevious}
        disabled={disabled || atStart}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-[var(--foreground)] bg-[var(--muted)] rounded-lg hover:bg-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous version"
      >
        <ChevronLeft className="w-4 h-4" />
        Previous
      </button>
      <span className="text-sm text-[var(--muted-foreground)] tabular-nums min-w-[7rem] text-center">
        Version {selectedIndex + 1} of {totalVersions}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={disabled || atEnd}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-[var(--foreground)] bg-[var(--muted)] rounded-lg hover:bg-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        aria-label="Next version"
      >
        Next
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

interface PhaseApprovalBarProps {
  currentPhase: DesignPhase;
  onApprove: () => void;
  onRedo: () => void;
  onEditPrompt: () => void;
  onSkip?: () => void;
  /** Full redo: clears locked base and re-runs both render stages. */
  onFullRedo?: () => void;
  isLoading?: boolean;
  /** Single-phase (Custom design) mode: one render, approve = finish, no phase chaining. */
  singlePhase?: boolean;
  approveDisabled?: boolean;
  approveDisabledReason?: string;
  secondaryAction?: { label: string; onClick: () => void };
  approveLabel?: string;
  /** When true, the room has a cached geometry-locked base (fal two-stage). */
  hasLockedBase?: boolean;
}

export function PhaseApprovalBar({
  currentPhase,
  onApprove,
  onRedo,
  onEditPrompt,
  onSkip,
  onFullRedo,
  isLoading,
  singlePhase,
  approveDisabled,
  approveDisabledReason,
  secondaryAction,
  approveLabel,
  hasLockedBase,
}: PhaseApprovalBarProps) {
  const { t } = useTranslation();
  const nextLabel = currentPhase === "base"
    ? "Add Furniture"
    : currentPhase === "furniture"
      ? "Add Decor"
      : "Finish";

  const defaultApproveLabel =
    singlePhase || currentPhase === "decor" ? "Approve Design" : `Approve & ${nextLabel}`;

  return (
    <div className="flex flex-col gap-2 py-3 px-1">
      {isLoading && (
        <div
          className="flex items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]"
          role="status"
          aria-live="polite"
        >
          <Loader2 size={18} className="animate-spin text-[var(--primary)] shrink-0" />
          <span>{t("project.workingOnDesign")}</span>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
      {secondaryAction && approveDisabled && (
        <button
          type="button"
          onClick={secondaryAction.onClick}
          disabled={isLoading}
          className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:brightness-110 disabled:opacity-50 transition-colors"
        >
          {secondaryAction.label}
        </button>
      )}
      <button
        onClick={onApprove}
        disabled={isLoading || approveDisabled}
        title={approveDisabled && approveDisabledReason ? approveDisabledReason : undefined}
        className="px-4 py-2 text-sm font-medium text-white bg-[var(--primary)] rounded-lg hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {approveLabel ?? defaultApproveLabel}
      </button>
      <button
        onClick={onRedo}
        disabled={isLoading}
        className="px-3 py-2 text-sm font-medium text-[var(--foreground)] bg-[var(--muted)] rounded-lg hover:bg-[var(--border)] disabled:opacity-50 transition-colors"
        title={hasLockedBase ? "Re-apply design styling only (faster)" : "Regenerate the render"}
      >
        {hasLockedBase ? "Restyle" : "Redo"}
      </button>
      {hasLockedBase && onFullRedo && (
        <button
          onClick={onFullRedo}
          disabled={isLoading}
          className="px-3 py-2 text-sm font-medium text-[var(--foreground)] bg-[var(--muted)] rounded-lg hover:bg-[var(--border)] disabled:opacity-50 transition-colors"
          title="Re-analyze room geometry and re-apply design from scratch"
        >
          Full Redo
        </button>
      )}
      <button
        onClick={onEditPrompt}
        disabled={isLoading}
        className="px-3 py-2 text-sm font-medium text-[var(--foreground)] bg-[var(--muted)] rounded-lg hover:bg-[var(--border)] disabled:opacity-50 transition-colors"
      >
        Edit
      </button>
      {onSkip && currentPhase === "furniture" && (
        <button
          onClick={onSkip}
          disabled={isLoading}
          className="sm:ml-auto px-3 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline disabled:opacity-50"
        >
          Skip decor &amp; finish
        </button>
      )}
      </div>
      {approveDisabled && approveDisabledReason && (
        <p className="text-xs text-[var(--muted-foreground)]">{approveDisabledReason}</p>
      )}
    </div>
  );
}
