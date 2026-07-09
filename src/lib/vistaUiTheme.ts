export type UiTheme = "light" | "dark";

export const VISTA_UI_THEME_STORAGE_KEY = "vista-ui-theme";

/** HttpOnly-safe cookie name; mirrors localStorage so SSR can match the user's choice. */
export const VISTA_UI_THEME_COOKIE = "vista_ui_theme";

/** Same daytime window as the boot script in `layout.tsx` and `resolveClientUiTheme()`. */
export function defaultThemeByLocalHours(now = new Date()): UiTheme {
  const h = now.getHours();
  return h >= 7 && h < 19 ? "light" : "dark";
}

export function themeFromRequestCookie(value: string | undefined): UiTheme {
  if (value === "light" || value === "dark") return value;
  return defaultThemeByLocalHours();
}

/** Browser: explicit storage, then time-of-day. */
export function resolveClientUiTheme(): UiTheme {
  if (typeof window === "undefined") return "dark";
  try {
    const v = localStorage.getItem(VISTA_UI_THEME_STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return defaultThemeByLocalHours();
}

export function setVistaThemeCookie(theme: UiTheme): void {
  if (typeof document === "undefined") return;
  document.cookie = `${VISTA_UI_THEME_COOKIE}=${theme};path=/;max-age=31536000;SameSite=Lax`;
}
