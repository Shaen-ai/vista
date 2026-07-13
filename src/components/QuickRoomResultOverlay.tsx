"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import {
  QuickRoomGenerationLoader,
  type QuickRoomLoaderPhase,
} from "@/components/QuickRoomGenerationLoader";

export function QuickRoomResultOverlay({
  open,
  onBack,
  backDisabled,
  isLoading,
  loaderPhase,
  error,
  onRetry,
  children,
}: {
  open: boolean;
  onBack: () => void;
  backDisabled?: boolean;
  isLoading: boolean;
  loaderPhase: QuickRoomLoaderPhase;
  error?: string | null;
  onRetry?: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div className="cd-result-overlay" role="dialog" aria-modal="true" aria-label={t("page.resultScreenTitle")}>
      <header className="cd-result-overlay-header">
        <button
          type="button"
          onClick={onBack}
          disabled={backDisabled}
          className="cd-result-back-btn"
        >
          <ArrowLeft size={18} />
          {t("page.backToEdit")}
        </button>
      </header>

      <div className="cd-result-overlay-body custom-scrollbar">
        {error ? (
          <div className="cd-result-error">
            <p>{error}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="cd-result-retry-btn">
                {t("common.retry")}
              </button>
            )}
          </div>
        ) : isLoading && !children ? (
          <QuickRoomGenerationLoader phase={loaderPhase} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
