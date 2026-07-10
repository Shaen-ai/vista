"use client";

import { useEffect, useRef, useState } from "react";
import { Folder, Menu, Moon, Sun, X } from "lucide-react";
import { VistaAuthMenu } from "@/components/VistaAuthMenu";
import { VistaInviteFriends } from "@/components/VistaInviteFriends";
import { FillBalanceButton } from "@/components/FillBalanceButton";
import { DevSpendBadge } from "@/components/DevSpendBadge";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { VISTA_LOCALES, type VistaLocale } from "@/i18n/locales";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { PwaInstallButton } from "@/components/PwaInstallButton";

type VistaHeaderActionsProps = {
  tokenBalance: number | null;
  onBalanceChange: (balance: number) => void;
  uiTheme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  showMyProjects?: boolean;
  onOpenMyProjects?: () => void;
  hubPath?: string;
};

export function VistaHeaderActions({
  tokenBalance,
  onBalanceChange,
  uiTheme,
  onThemeChange,
  showMyProjects = false,
  onOpenMyProjects,
  hubPath: _hubPath,
}: VistaHeaderActionsProps) {
  const { t, locale, setLocale } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const themeToggle = (
    <button
      type="button"
      onClick={() => onThemeChange(uiTheme === "light" ? "dark" : "light")}
      className="cd-theme-toggle shrink-0 flex items-center justify-center rounded-full h-9 w-9 transition-colors cursor-pointer touch-manipulation"
      aria-label={uiTheme === "light" ? t("common.switchToDark") : t("common.switchToLight")}
    >
      {uiTheme === "light" ? <Moon size={16} aria-hidden strokeWidth={2} /> : <Sun size={16} aria-hidden strokeWidth={2} />}
    </button>
  );

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      {/* Desktop — full inline toolbar */}
      <div className="hidden md:flex items-center gap-2 min-w-0 shrink-0">
        {showMyProjects && (
          <button
            type="button"
            onClick={() => onOpenMyProjects?.()}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          >
            <Folder size={14} className="text-[var(--primary)]" />
            {t("myProjects.title")}
          </button>
        )}
        <VistaAuthMenu />
        <VistaInviteFriends compact />
        <DevSpendBadge />
        <LanguageSwitcher />
        {themeToggle}
        <FillBalanceButton balance={tokenBalance} onBalanceChange={onBalanceChange} compact />
      </div>

      {/* Mobile — balance + editorial sheet menu */}
      <div ref={menuRef} className="relative flex md:hidden items-center gap-2 min-w-0 shrink-0">
        <PwaInstallButton />
        <FillBalanceButton
          balance={tokenBalance}
          onBalanceChange={onBalanceChange}
          compact
          balanceOnly
        />
        <DevSpendBadge />

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="cd-header-menu-btn flex items-center justify-center h-9 w-9 rounded-full border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer touch-manipulation shrink-0"
          aria-label={t("common.menu")}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
        >
          {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
        </button>

        {menuOpen && (
          <>
            <div className="cd-header-sheet-backdrop" aria-hidden onClick={closeMenu} />
            <div
              className="cd-header-mobile-menu"
              role="dialog"
              aria-label={t("common.menu")}
            >
              <div className="cd-header-sheet">
                <div className="cd-header-sheet-head">
                  <p className="cd-header-sheet-title">{t("common.menu")}</p>
                </div>

                <div className="cd-header-sheet-section">
                  <span className="cd-header-sheet-label">{t("common.account")}</span>
                  <div className="cd-header-sheet-list">
                    {showMyProjects && (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenMyProjects?.();
                          closeMenu();
                        }}
                        className="cd-header-sheet-row cd-header-sheet-row--accent"
                      >
                        <Folder size={16} className="cd-header-sheet-row-icon" aria-hidden />
                        {t("myProjects.title")}
                      </button>
                    )}
                    <VistaAuthMenu layout="sheet" onNavigate={closeMenu} />
                  </div>
                </div>

                <VistaInviteFriends layout="sheet" compact />

                <div className="cd-header-sheet-section">
                  <span className="cd-header-sheet-label">{t("common.wallet")}</span>
                  <div className="cd-header-sheet-list">
                    <FillBalanceButton
                      balance={tokenBalance}
                      onBalanceChange={onBalanceChange}
                      compact
                      layout="sheet"
                    />
                  </div>
                </div>

                <div className="cd-header-sheet-section">
                  <span className="cd-header-sheet-label">{t("common.preferences")}</span>
                  <div className="cd-header-sheet-prefs">
                    <div className="cd-header-sheet-locale" role="group" aria-label={t("common.language")}>
                      {VISTA_LOCALES.map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => setLocale(code as VistaLocale)}
                          className={`cd-header-sheet-locale-btn${code === locale ? " cd-header-sheet-locale-btn--active" : ""}`}
                          aria-pressed={code === locale}
                        >
                          {code}
                        </button>
                      ))}
                    </div>
                    {themeToggle}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
