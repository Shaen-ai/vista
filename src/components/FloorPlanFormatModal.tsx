"use client";

import { ImageIcon, X } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

interface FloorPlanFormatModalProps {
  open: boolean;
  onClose: () => void;
}

export function FloorPlanFormatModal({ open, onClose }: FloorPlanFormatModalProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="floor-plan-format-modal-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          aria-label={t("common.close")}
        >
          <X size={18} />
        </button>

        <div className="w-12 h-12 rounded-2xl bg-[var(--primary)]/10 border border-[var(--primary)]/25 flex items-center justify-center mb-4">
          <ImageIcon size={22} className="text-[var(--primary)]" />
        </div>

        <h3 id="floor-plan-format-modal-title" className="text-base font-bold mb-2 pr-8">
          {t("project.floorPlanImageOnlyTitle")}
        </h3>
        <p className="text-sm text-[var(--muted-foreground)] mb-5 leading-relaxed">
          {t("project.floorPlanImageOnlyBody")}
        </p>

        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold bg-[var(--primary)] text-white hover:brightness-110 transition-all"
        >
          <ImageIcon size={18} />
          {t("project.floorPlanImageOnlyCta")}
        </button>
      </div>
    </div>
  );
}
