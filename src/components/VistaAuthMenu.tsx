"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut, User, UserPlus } from "lucide-react";
import { fetchCurrentUser, getAuthToken, logout, type AuthUser } from "@/lib/authApi";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

type VistaAuthMenuProps = {
  layout?: "inline" | "sheet";
  onNavigate?: () => void;
};

export function VistaAuthMenu({ layout = "inline", onNavigate }: VistaAuthMenuProps) {
  const { t } = useTranslation();
  const [user, setUser] = useState<AuthUser | null>(null);
  // `mounted` defers token-derived markup to after first paint so SSR and the
  // first client render agree (no hydration mismatch); the token is read from
  // localStorage synchronously (no network), so the correct shape appears
  // immediately on mount instead of after `/auth/me` resolves.
  const [mounted, setMounted] = useState(false);
  const hasTokenRef = useRef(false);

  useEffect(() => {
    hasTokenRef.current = Boolean(getAuthToken());
    setMounted(true);
    fetchCurrentUser().then(setUser).catch(() => {});
  }, []);

  const hasToken = mounted && hasTokenRef.current;
  const displayName = user?.name || user?.email || "";

  if (layout === "sheet") {
    if (!hasToken) {
      return (
        <>
          <Link href="/signup" onClick={onNavigate} className="cd-header-sheet-row cd-header-sheet-row--accent">
            <UserPlus size={16} className="cd-header-sheet-row-icon" aria-hidden />
            {t("auth.signUp")}
          </Link>
          <Link href="/login" onClick={onNavigate} className="cd-header-sheet-row">
            <LogIn size={16} className="cd-header-sheet-row-icon" aria-hidden />
            {t("auth.logIn")}
          </Link>
        </>
      );
    }

    return (
      <>
        <div className="cd-header-sheet-user">
          <User size={16} className="shrink-0 text-[var(--primary)]" aria-hidden />
          <span className="cd-header-sheet-user-name">{displayName}</span>
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            setUser(null);
            onNavigate?.();
            window.location.href = "/";
          }}
          className="cd-header-sheet-row cd-header-sheet-row--muted"
          aria-label={t("auth.logOut")}
        >
          <LogOut size={16} className="cd-header-sheet-row-icon" aria-hidden />
          {t("auth.logOut")}
        </button>
      </>
    );
  }

  if (!hasToken) {
    return (
      <div className="flex items-center gap-1 sm:gap-2 shrink-0 min-w-0">
        <Link
          href="/login"
          className="flex items-center justify-center rounded-full h-9 w-9 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] sm:text-sm"
          aria-label={t("auth.logIn")}
          title={t("auth.logIn")}
        >
          <LogIn size={16} className="sm:hidden" aria-hidden />
          <span className="hidden sm:inline">{t("auth.logIn")}</span>
        </Link>
        <Link
          href="/signup"
          className="rounded-full border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] sm:px-3 sm:text-sm whitespace-nowrap"
        >
          {t("auth.signUp")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 shrink-0 min-w-0">
      <div className="hidden sm:flex items-center gap-1.5 max-w-[140px] min-w-0 px-2.5 py-1.5 rounded-full bg-[var(--muted)] text-xs text-[var(--foreground)]">
        <User size={14} className="shrink-0 text-[var(--primary)]" />
        <span className="truncate font-medium min-w-[60px]">{displayName}</span>
      </div>
      <button
        type="button"
        onClick={async () => {
          await logout();
          setUser(null);
          window.location.href = "/";
        }}
        className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer sm:text-sm"
        aria-label={t("auth.logOut")}
      >
        <LogOut size={14} />
        <span className="hidden sm:inline">{t("auth.logOut")}</span>
      </button>
    </div>
  );
}
