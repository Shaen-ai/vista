"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LOCALE, type VistaLocale } from "./locales";
import { persistVistaLocale, resolveClientLocale } from "./vistaLocale";
import { translate } from "./translate";

type VistaLocaleContextValue = {
  locale: VistaLocale;
  setLocale: (locale: VistaLocale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const VistaLocaleContext = createContext<VistaLocaleContextValue | null>(null);

const listeners = new Set<() => void>();

function notifyLocaleListeners() {
  listeners.forEach((fn) => fn());
}

export function VistaLocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: VistaLocale;
}) {
  const [locale, setLocaleState] = useState<VistaLocale>(initialLocale);

  useEffect(() => {
    setLocaleState(resolveClientLocale(initialLocale));
  }, [initialLocale]);

  useEffect(() => {
    const handler = () => setLocaleState(resolveClientLocale(initialLocale));
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [initialLocale]);

  const setLocale = useCallback((next: VistaLocale) => {
    persistVistaLocale(next);
    setLocaleState(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
    notifyLocaleListeners();
    void syncUserLanguage(next);
  }, []);

async function syncUserLanguage(locale: VistaLocale): Promise<void> {
  try {
    const { getAuthToken } = await import("@/lib/authApi");
    const { getPublicApiUrl } = await import("@/lib/publicEnv");
    const token = getAuthToken();
    if (!token) return;
    await fetch(`${getPublicApiUrl().replace(/\/$/, "")}/auth/me`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ language: locale }),
    });
  } catch {
    /* ignore profile sync failures */
  }
}

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <VistaLocaleContext.Provider value={value}>{children}</VistaLocaleContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(VistaLocaleContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within VistaLocaleProvider");
  }
  return ctx;
}
