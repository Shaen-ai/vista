"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { UiTheme } from "@/lib/vistaUiTheme";
import {
  resolveClientUiTheme,
  setVistaThemeCookie,
  VISTA_UI_THEME_STORAGE_KEY,
} from "@/lib/vistaUiTheme";

export const VISTA_THEME_CHANGE_EVENT = "vista-theme-change";

const VistaSsrThemeContext = createContext<UiTheme>("dark");

function readThemeFromDom(): UiTheme {
  const d = document.documentElement.dataset.vistaTheme;
  if (d === "light" || d === "dark") return d;
  return resolveClientUiTheme();
}

export function applyVistaUiTheme(theme: UiTheme): void {
  document.documentElement.dataset.vistaTheme = theme;
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  setVistaThemeCookie(theme);
  try {
    localStorage.setItem(VISTA_UI_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(VISTA_THEME_CHANGE_EVENT));
}

export function VistaThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: UiTheme;
  children: ReactNode;
}) {
  return <VistaSsrThemeContext.Provider value={initialTheme}>{children}</VistaSsrThemeContext.Provider>;
}

export function useVistaSsrTheme(): UiTheme {
  return useContext(VistaSsrThemeContext);
}

/** Theme from SSR cookie/time, then `data-vista-theme` set by the layout boot script. */
export function useVistaUiTheme(): [UiTheme, (theme: UiTheme) => void] {
  const ssrTheme = useContext(VistaSsrThemeContext);

  const theme = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener(VISTA_THEME_CHANGE_EVENT, onStoreChange);
      return () => window.removeEventListener(VISTA_THEME_CHANGE_EVENT, onStoreChange);
    },
    readThemeFromDom,
    () => ssrTheme,
  );

  const setTheme = useCallback((next: UiTheme) => {
    applyVistaUiTheme(next);
  }, []);

  return [theme, setTheme];
}
