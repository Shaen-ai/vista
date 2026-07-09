export const VISTA_LOCALES = ["hy", "en", "ru"] as const;

export type VistaLocale = (typeof VISTA_LOCALES)[number];

export const DEFAULT_LOCALE: VistaLocale = "hy";

export const LOCALE_LABELS: Record<VistaLocale, string> = {
  hy: "Հայերեն",
  en: "English",
  ru: "Русский",
};

export function isVistaLocale(value: string | undefined | null): value is VistaLocale {
  return value === "hy" || value === "en" || value === "ru";
}

export function normalizeVistaLocale(value: string | undefined | null): VistaLocale {
  if (isVistaLocale(value)) return value;
  return DEFAULT_LOCALE;
}
