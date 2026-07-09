"use client";

import { Check, FileText, Loader2 } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

type Variant = "ready" | "complete";

export function ProjectFinalizeCard({
  variant,
  loading,
  onBuildPdf,
  downloadHref,
  projectName,
}: {
  variant: Variant;
  loading?: boolean;
  onBuildPdf?: () => void;
  downloadHref?: string;
  projectName?: string;
}) {
  const { t } = useTranslation();

  if (variant === "complete") {
    return (
      <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
            <Check size={22} className="text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-[var(--foreground)]">{t("project.pdfReadyTitle")}</p>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              {t("project.pdfReadySubtitle", { projectName: projectName ?? "" })}
            </p>
          </div>
        </div>
        {downloadHref && (
          <a
            href={downloadHref}
            download
            className="shrink-0 px-6 py-3 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all"
          >
            <FileText size={18} /> {t("project.downloadPdf")}
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-green-500/40 bg-gradient-to-br from-green-500/10 to-[var(--muted)]/50 p-6 flex flex-col gap-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
          <Check size={26} className="text-green-600" />
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--foreground)]">{t("project.allRoomsApprovedTitle")}</p>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">{t("project.allRoomsApprovedSubtitle")}</p>
          <ul className="mt-3 text-xs text-[var(--muted-foreground)] space-y-1 list-disc list-inside">
            <li>{t("project.pdfIncludesRenders")}</li>
            <li>{t("project.pdfIncludesAllAngles")}</li>
          </ul>
        </div>
      </div>
      <button
        type="button"
        onClick={onBuildPdf}
        disabled={loading}
        className="w-full py-4 rounded-xl bg-[var(--primary)] text-white font-bold text-base flex items-center justify-center gap-2 hover:brightness-110 transition-all disabled:opacity-60 cursor-pointer"
      >
        {loading ? <Loader2 size={22} className="animate-spin" /> : <FileText size={22} />}
        {loading ? t("project.buildingPdf") : t("project.buildFullPdf")}
      </button>
    </div>
  );
}
