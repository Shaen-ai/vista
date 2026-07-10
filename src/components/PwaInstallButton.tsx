"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import {
  dismissPwaInstall,
  isPwaDismissed,
} from "@/lib/pwaPlatform";
import { usePwaInstall } from "@/components/PwaInstallProvider";

type PwaInstallButtonProps = {
  className?: string;
  variant?: "header" | "nav";
};

export function PwaInstallButton({ className = "", variant = "header" }: PwaInstallButtonProps) {
  const { t } = useTranslation();
  const { deferredPrompt, isStandalone, isIosMobile, promptInstall } = usePwaInstall();
  const [mobileViewport, setMobileViewport] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [iosSheetOpen, setIosSheetOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => {
      setMobileViewport(mq.matches);
      setDismissed(isPwaDismissed());
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const canShowAndroid = Boolean(deferredPrompt);
  const canShowIos = isIosMobile && !deferredPrompt;
  const visible = mobileViewport && !isStandalone && !dismissed && (canShowAndroid || canShowIos);

  if (!visible) return null;

  const handleInstall = async () => {
    if (canShowAndroid) {
      await promptInstall();
      return;
    }
    setIosSheetOpen(true);
  };

  const handleDismiss = () => {
    dismissPwaInstall();
    setDismissed(true);
  };

  const buttonClass =
    variant === "nav"
      ? "rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors inline-flex items-center gap-1.5"
      : "cd-pwa-install-btn inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors touch-manipulation shrink-0";

  return (
    <>
      <div className={`flex items-center gap-1 ${className}`}>
        <button type="button" onClick={handleInstall} className={buttonClass}>
          <Download size={14} aria-hidden />
          <span>{t("pwa.install")}</span>
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors touch-manipulation shrink-0"
          aria-label={t("pwa.dismiss")}
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      {iosSheetOpen && (
        <>
          <div
            className="cd-header-sheet-backdrop"
            aria-hidden
            onClick={() => setIosSheetOpen(false)}
          />
          <div
            className="cd-pwa-ios-sheet"
            role="dialog"
            aria-label={t("pwa.iosTitle")}
          >
            <div className="cd-header-sheet">
              <div className="cd-header-sheet-head">
                <p className="cd-header-sheet-title">{t("pwa.iosTitle")}</p>
              </div>
              <div className="cd-header-sheet-section">
                <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
                  {t("pwa.iosSteps")}
                </p>
                <div className="mt-4 flex items-center gap-2 text-sm text-[var(--foreground)]">
                  <Share size={16} className="text-[var(--primary)]" aria-hidden />
                  <span>{t("pwa.iosShareHint")}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIosSheetOpen(false)}
                className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
