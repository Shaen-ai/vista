"use client";

import { Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LOCALE_LABELS, VISTA_LOCALES, type VistaLocale } from "./locales";
import { useTranslation } from "./VistaLocaleProvider";

export function LanguageSwitcher({
  className = "",
  layout = "inline",
}: {
  className?: string;
  layout?: "inline" | "menu";
}) {
  const { locale, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const triggerClassName =
    layout === "menu"
      ? "flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer min-w-0"
      : "flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer sm:gap-1.5 sm:px-3 sm:text-sm";

  return (
    <div ref={ref} className={`relative ${layout === "menu" ? "flex-1 min-w-0" : ""} ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={triggerClassName}
        aria-label={t("common.language")}
        title={t("common.language")}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Globe size={14} className="shrink-0" />
        <span className="uppercase">{locale}</span>
      </button>
      {open && (
        <div
          className={`absolute z-50 min-w-[140px] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg py-1 ${
            layout === "menu" ? "left-0 right-0 top-full mt-1" : "right-0 top-full mt-1"
          }`}
          role="listbox"
          aria-label={t("common.language")}
        >
          {VISTA_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                setLocale(code as VistaLocale);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer ${
                code === locale ? "font-semibold text-[var(--primary)]" : "text-[var(--foreground)]"
              }`}
            >
              <span>{LOCALE_LABELS[code]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
