"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  PenTool,
  RefreshCw,
  Share2,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { TOKEN_COSTS } from "@/lib/vistaTokens";

export function ResultActionsMenu({
  isGenerating,
  markerMode,
  tokenBalance,
  canShare,
  onDownload,
  onRegenerate,
  onMark,
  onShare,
}: {
  isGenerating: boolean;
  markerMode: boolean;
  tokenBalance: number | null;
  canShare: boolean;
  onDownload: () => void;
  onRegenerate: () => void;
  onMark: () => void;
  onShare: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const regenerateDisabled =
    isGenerating || (tokenBalance !== null && tokenBalance < TOKEN_COSTS.regenerate);

  const closeAndRun = (action: () => void) => {
    action();
    setExpanded(false);
  };

  return (
    <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        disabled={isGenerating}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--muted)]/40 transition-colors cursor-pointer disabled:opacity-50"
      >
        <span className="text-sm font-bold flex items-center gap-2 min-w-0">
          <SlidersHorizontal size={16} className="text-[var(--primary)] shrink-0" aria-hidden />
          <span className="truncate">{t("page.moreActions")}</span>
        </span>
        {expanded ? (
          <ChevronUp size={18} className="text-[var(--muted-foreground)] shrink-0" aria-hidden />
        ) : (
          <ChevronDown size={18} className="text-[var(--muted-foreground)] shrink-0" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] px-2 py-1">
          <button
            type="button"
            onClick={() => closeAndRun(onDownload)}
            disabled={isGenerating}
            className="cd-result-action-row disabled:opacity-50"
          >
            <span className="cd-result-action-icon" aria-hidden>
              <Download size={18} />
            </span>
            <span className="cd-result-action-label">{t("page.downloadDesign")}</span>
          </button>

          <button
            type="button"
            onClick={() => closeAndRun(onRegenerate)}
            disabled={regenerateDisabled}
            className="cd-result-action-row disabled:opacity-50"
          >
            <span className="cd-result-action-icon" aria-hidden>
              <RefreshCw size={18} />
            </span>
            <span className="cd-result-action-label">{t("tokens.regenerate")}</span>
          </button>

          <button
            type="button"
            onClick={() => closeAndRun(onMark)}
            disabled={isGenerating}
            className={`cd-result-action-row disabled:opacity-50 ${markerMode ? "cd-result-action-row--active" : ""}`}
          >
            <span className="cd-result-action-icon" aria-hidden>
              <PenTool size={18} />
            </span>
            <span className="cd-result-action-label">{t("common.mark")}</span>
          </button>

          {canShare && (
            <button
              type="button"
              onClick={() => closeAndRun(onShare)}
              disabled={isGenerating}
              className="cd-result-action-row disabled:opacity-50"
            >
              <span className="cd-result-action-icon" aria-hidden>
                <Share2 size={18} />
              </span>
              <span className="cd-result-action-label">{t("share.title")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
