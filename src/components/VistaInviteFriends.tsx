"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import { getAuthToken, fetchReferralLink } from "@/lib/authApi";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { InviteShareButtons } from "@/components/inviteShare";

type ReferralLink = {
  code: string;
  url: string;
  referralTokensEarned: number;
  referralEarningsCap: number;
};

type VistaInviteFriendsProps = {
  compact?: boolean;
  layout?: "inline" | "sheet";
};

export function VistaInviteFriends({ compact = false, layout = "inline" }: VistaInviteFriendsProps) {
  const { t } = useTranslation();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [link, setLink] = useState<ReferralLink | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const [pasteTip, setPasteTip] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoggedIn(Boolean(getAuthToken()));
  }, []);

  useEffect(() => {
    if (loggedIn !== true) return;
    setLoadState("loading");
    fetchReferralLink()
      .then((data) => {
        if (!data) {
          setLoadState("error");
          return;
        }
        setLink(data);
        setLoadState("idle");
      })
      .catch(() => setLoadState("error"));
  }, [loggedIn]);

  useEffect(() => {
    if (layout !== "inline") return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [layout]);

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  function handleCopyThenOpen() {
    setPasteTip(true);
    setTimeout(() => setPasteTip(false), 2000);
  }

  if (loggedIn !== true) return null;

  const shareMessage = link ? t("referral.shareMessage", { url: link.url }) : "";

  const body = (
    <>
      {layout === "inline" && link && (
        <div className="px-3 pb-1">
          <p className="text-sm font-semibold text-[var(--foreground)]">{t("referral.yourLink")}</p>
          <p className="text-xs text-[var(--muted-foreground)]">{t("referral.shareToEarn")}</p>
        </div>
      )}
      {layout === "sheet" && link && (
        <p className="cd-header-sheet-note">{t("referral.shareToEarn")}</p>
      )}
      {loadState === "error" && (
        <p className={layout === "sheet" ? "cd-header-sheet-note" : "text-xs text-[var(--muted-foreground)] px-3 py-2"}>
          {t("referral.loadError")}
        </p>
      )}
      {link && (
        <>
          <div
            className={
              layout === "sheet"
                ? "cd-header-sheet-row cd-header-sheet-row--accent"
                : "flex items-center gap-2 px-3 py-2"
            }
          >
            <span className="flex-1 min-w-0 truncate text-xs sm:text-sm font-mono">{link.url}</span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className={
              layout === "sheet"
                ? "cd-header-sheet-row cd-header-sheet-row--accent"
                : "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--muted)] transition-colors cursor-pointer text-[var(--foreground)]"
            }
          >
            {copied ? (
              <Check size={16} className={layout === "sheet" ? "cd-header-sheet-row-icon" : "shrink-0"} aria-hidden />
            ) : (
              <Copy size={16} className={layout === "sheet" ? "cd-header-sheet-row-icon" : "shrink-0"} aria-hidden />
            )}
            {copied ? t("common.copied") : t("referral.copyLink")}
          </button>
          <InviteShareButtons
            url={link.url}
            message={shareMessage}
            layout={layout}
            t={t}
            onCopyThenOpen={handleCopyThenOpen}
          />
          {pasteTip && (
            <p className={layout === "sheet" ? "cd-header-sheet-note" : "px-3 pb-1 text-xs text-[var(--muted-foreground)]"}>
              {t("referral.pasteInChat")}
            </p>
          )}
          <p className={layout === "sheet" ? "cd-header-sheet-note" : "px-3 pb-2 text-xs text-[var(--muted-foreground)]"}>
            {t("referral.earnedOfCap", {
              earned: link.referralTokensEarned,
              cap: link.referralEarningsCap,
            })}
          </p>
        </>
      )}
    </>
  );

  if (layout === "sheet") {
    return (
      <div className="cd-header-sheet-section">
        <span className="cd-header-sheet-label">{t("common.invite")}</span>
        <div className="cd-header-sheet-list">{body}</div>
      </div>
    );
  }

  const triggerClassName = `cd-surface-btn cd-surface-btn--pill shrink-0 ${compact ? "text-xs" : "text-xs sm:text-sm"}`;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
        aria-label={t("common.invite")}
        title={t("common.invite")}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Gift size={14} className="cd-surface-btn__icon" aria-hidden />
        {t("common.invite")}
      </button>
      {open && (
        <div
          className="absolute z-50 right-0 top-full mt-1 min-w-[260px] rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg py-2"
          role="dialog"
          aria-label={t("referral.yourLink")}
        >
          {body}
        </div>
      )}
    </div>
  );
}
