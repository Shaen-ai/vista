"use client";

import { useEffect } from "react";
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
  footer,
}: {
  open: boolean;
  onBack: () => void;
  backDisabled?: boolean;
  isLoading: boolean;
  loaderPhase: QuickRoomLoaderPhase;
  error?: string | null;
  onRetry?: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`cd-result-overlay${footer ? " cd-result-overlay--with-footer" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("page.resultScreenTitle")}
    >
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
        ) : children ? (
          children
        ) : (
          <div className="cd-result-error">
            <p>{t("page.resultNotReady")}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="cd-result-retry-btn">
                {t("common.retry")}
              </button>
            )}
          </div>
        )}
      </div>

      {footer ? <div className="cd-result-overlay-footer">{footer}</div> : null}
    </div>
  );
}
