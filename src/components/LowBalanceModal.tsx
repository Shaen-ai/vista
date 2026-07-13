"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Loader2, Plus, X } from "lucide-react";
import { getAuthToken, fetchReferralLink } from "@/lib/authApi";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { InviteShareButtons } from "@/components/inviteShare";
import {
  markLowBalanceInviteSeen,
  type LowBalanceVariant,
} from "@/lib/lowBalancePrompt";
import { startTokenTopUpCheckout } from "@/lib/vistaTokens";
import { useConsumerDesignStore } from "@/app/store";
import { track } from "@/lib/analytics";

type ReferralLink = {
  code: string;
  url: string;
  referralTokensEarned: number;
  referralEarningsCap: number;
};

type LowBalanceModalProps = {
  open: boolean;
  variant: LowBalanceVariant;
  balance: number | null;
  onClose: () => void;
  onBalanceChange: (balance: number) => void;
};

function loginNextPath(): string {
  if (typeof window === "undefined") return "/";
  const path = window.location.pathname + window.location.search;
  return path && path !== "/" ? path : "/";
}

export function LowBalanceModal({
  open,
  variant,
  balance,
  onClose,
  onBalanceChange,
}: LowBalanceModalProps) {
  const { t, locale } = useTranslation();
  const selectedCountry = useConsumerDesignStore((s) => s.selectedCountry);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [link, setLink] = useState<ReferralLink | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const [pasteTip, setPasteTip] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpMessage, setTopUpMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(Boolean(getAuthToken()));
  }, [open]);

  useEffect(() => {
    if (!open || variant !== "invite" || loggedIn !== true) return;
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
  }, [open, variant, loggedIn]);

  useEffect(() => {
    if (!open) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; balance?: number; tokensAdded?: number } | null;
      if (data?.type !== "vista-topup-complete") return;
      if (typeof data.balance === "number") onBalanceChange(data.balance);
      if (typeof data.tokensAdded === "number" && data.tokensAdded > 0) {
        setTopUpMessage(t("tokens.addedToBalance", { count: data.tokensAdded }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, onBalanceChange, t]);

  const markInviteSeenIfNeeded = useCallback(() => {
    if (variant === "invite" || variant === "invite-guest") {
      markLowBalanceInviteSeen();
    }
  }, [variant]);

  const handleClose = useCallback(() => {
    markInviteSeenIfNeeded();
    onClose();
  }, [markInviteSeenIfNeeded, onClose]);

  const handleCopy = useCallback(async () => {
    if (!link) return;
    markInviteSeenIfNeeded();
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      track("low_balance_invite_copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [link, markInviteSeenIfNeeded]);

  const handleCopyThenOpen = useCallback(() => {
    markInviteSeenIfNeeded();
    setPasteTip(true);
    setTimeout(() => setPasteTip(false), 2000);
  }, [markInviteSeenIfNeeded]);

  const handleShare = useCallback(() => {
    markInviteSeenIfNeeded();
    track("low_balance_invite_shared");
  }, [markInviteSeenIfNeeded]);

  const handleTopUp = useCallback(async () => {
    setTopUpMessage(null);
    setTopUpLoading(true);
    track("tokens_topup_started", { source: "low_balance_modal" });
    try {
      const url = await startTokenTopUpCheckout(locale, selectedCountry);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        throw new Error(t("tokens.popupBlocked"));
      }
      setTopUpMessage(t("tokens.completePaymentInTab"));
    } catch (err) {
      setTopUpMessage(err instanceof Error ? err.message : t("tokens.couldNotStartCheckout"));
    } finally {
      setTopUpLoading(false);
    }
  }, [locale, selectedCountry, t]);

  if (!open) return null;

  const loginHref = `/login?next=${encodeURIComponent(loginNextPath())}`;
  const shareMessage = link ? t("referral.shareMessage", { url: link.url }) : "";
  const title =
    variant === "topup" ? t("lowBalance.topUpTitle") : t("common.invite").toUpperCase();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm bg-black/40"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="low-balance-modal-title"
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
          aria-label={t("common.close")}
        >
          <X size={18} />
        </button>

        <h3
          id="low-balance-modal-title"
          className="text-sm font-bold tracking-wide text-[var(--muted-foreground)] mb-2 pr-8 uppercase"
        >
          {title}
        </h3>

        {variant === "topup" ? (
          <>
            <p className="text-sm text-[var(--foreground)] mb-1 leading-relaxed">
              {t("lowBalance.topUpDescription")}
            </p>
            {balance !== null && (
              <p className="text-xs text-[var(--muted-foreground)] mb-5">
                {t("lowBalance.currentBalance", { balance })}
              </p>
            )}
            <div className="flex flex-col gap-3">
              {loggedIn ? (
                <button
                  type="button"
                  onClick={handleTopUp}
                  disabled={topUpLoading}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold bg-[var(--primary)] text-white hover:brightness-110 transition-all disabled:opacity-60"
                >
                  {topUpLoading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Plus size={18} />
                  )}
                  {t("tokens.fillBalance")}
                </button>
              ) : (
                <Link
                  href={loginHref}
                  onClick={markInviteSeenIfNeeded}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold bg-[var(--primary)] text-white hover:brightness-110 transition-all"
                >
                  <Plus size={18} />
                  {t("tokens.fillBalance")}
                </Link>
              )}
              {topUpMessage && (
                <p className="text-xs text-[var(--muted-foreground)] text-center">{topUpMessage}</p>
              )}
            </div>
          </>
        ) : variant === "invite-guest" ? (
          <>
            <p className="text-sm text-[var(--foreground)] mb-5 leading-relaxed">
              {t("referral.shareToEarn")}
            </p>
            <p className="text-sm text-[var(--muted-foreground)] mb-5 leading-relaxed">
              {t("lowBalance.guestInviteBody")}
            </p>
            <Link
              href={loginHref}
              onClick={() => {
                markInviteSeenIfNeeded();
                track("low_balance_invite_sign_in");
              }}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold bg-[var(--primary)] text-white hover:brightness-110 transition-all"
            >
              {t("lowBalance.signInToInvite")}
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--foreground)] mb-4 leading-relaxed">
              {t("referral.shareToEarn")}
            </p>
            {loadState === "error" && (
              <p className="text-xs text-[var(--muted-foreground)] mb-3">{t("referral.loadError")}</p>
            )}
            {link && (
              <>
                <p className="text-base sm:text-lg font-bold font-mono text-[var(--primary)] break-all mb-3">
                  {link.url}
                </p>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:brightness-110 transition-all mb-4 cursor-pointer"
                >
                  {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                  {copied ? t("common.copied") : t("referral.copyLink")}
                </button>
                <div onClick={markInviteSeenIfNeeded} role="presentation">
                  <InviteShareButtons
                    url={link.url}
                    message={shareMessage}
                    layout="inline"
                    t={t}
                    onCopyThenOpen={() => {
                      handleCopyThenOpen();
                      handleShare();
                    }}
                  />
                </div>
                {pasteTip && (
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">{t("referral.pasteInChat")}</p>
                )}
              </>
            )}
            {loadState === "loading" && (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
