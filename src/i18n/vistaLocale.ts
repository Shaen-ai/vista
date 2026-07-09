import { DEFAULT_LOCALE, isVistaLocale, type VistaLocale } from "./locales";

export const VISTA_LOCALE_STORAGE_KEY = "vista-locale";

/** HttpOnly-safe cookie name; mirrors localStorage so SSR can match the user's choice. */
export const VISTA_LOCALE_COOKIE = "vista_locale";

export function localeFromRequestCookie(value: string | undefined): VistaLocale {
  if (isVistaLocale(value)) return value;
  return DEFAULT_LOCALE;
}

/** True when the visitor has a persisted locale (explicit choice or prior detected default). */
export function hasPersistedVistaLocale(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (isVistaLocale(localStorage.getItem(VISTA_LOCALE_STORAGE_KEY))) return true;
  } catch {
    /* ignore */
  }
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${VISTA_LOCALE_COOKIE}=(hy|en|ru)`));
    if (m?.[1] && isVistaLocale(m[1])) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function resolveClientLocale(fallback: VistaLocale = DEFAULT_LOCALE): VistaLocale {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(VISTA_LOCALE_STORAGE_KEY);
    if (isVistaLocale(stored)) return stored;
  } catch {
    /* ignore */
  }
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${VISTA_LOCALE_COOKIE}=(hy|en|ru)`));
    if (m?.[1] && isVistaLocale(m[1])) return m[1];
  } catch {
    /* ignore */
  }
  return fallback;
}

export function setVistaLocaleCookie(locale: VistaLocale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${VISTA_LOCALE_COOKIE}=${locale};path=/;max-age=31536000;SameSite=Lax`;
}

export function persistVistaLocale(locale: VistaLocale): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VISTA_LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  setVistaLocaleCookie(locale);
}

export function buildVistaLocaleBootScript(): string {
  return `(function(){try{var k='${VISTA_LOCALE_STORAGE_KEY}';var c='${VISTA_LOCALE_COOKIE}';var l=localStorage.getItem(k);if(l!=='hy'&&l!=='en'&&l!=='ru'){var m=document.cookie.match(/(?:^|;\\s*)${VISTA_LOCALE_COOKIE}=(hy|en|ru)/);l=m&&m[1]?m[1]:'${DEFAULT_LOCALE}'}document.documentElement.lang=l;}catch(e){}})();`;
}
