"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { getAuthToken } from "@/lib/authApi";
import { useConsumerDesignStore } from "@/app/store";
import {
  fetchTokenBalance,
  startTokenTopUpCheckout,
  verifyTokenTopUp,
} from "@/lib/vistaTokens";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { track } from "@/lib/analytics";

type FillBalanceButtonProps = {
  balance: number | null;
  onBalanceChange: (balance: number) => void;
  compact?: boolean;
  /** Header bar: show only the balance pill (mobile toolbar). */
  balanceOnly?: boolean;
  /** Sheet panel: editorial list row. */
  layout?: "inline" | "sheet";
};

type TopUpCompleteMessage = {
  type: "vista-topup-complete";
  balance: number;
  tokensAdded: number;
};

function notifyOpenerTopUpComplete(balance: number, tokensAdded: number): void {
  if (typeof window === "undefined" || !window.opener || window.opener.closed) return;
  try {
    const msg: TopUpCompleteMessage = { type: "vista-topup-complete", balance, tokensAdded };
    window.opener.postMessage(msg, window.location.origin);
  } catch {
    /* ignore */
  }
}

function TokenBalancePill({
  balance,
  compact,
}: {
  balance: number | null;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const className = `flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[var(--muted)] tabular-nums ${
    compact ? "text-xs" : "text-sm"
  }`;

  return (
    <div className={className} title={t("common.wallet")}>
      <Coins size={compact ? 13 : 15} className="text-[var(--primary)]" />
      <span className="font-semibold inline-block min-w-[3ch] text-right">{balance ?? "…"}</span>
      {!compact && <span className="text-[var(--muted-foreground)]">{t("common.tokens")}</span>}
    </div>
  );
}

export function FillBalanceButton({
  balance,
  onBalanceChange,
  compact = false,
  balanceOnly = false,
  layout = "inline",
}: FillBalanceButtonProps) {
  const { t, locale } = useTranslation();
  const selectedCountry = useConsumerDesignStore((s) => s.selectedCountry);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(Boolean(getAuthToken()));
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as Partial<TopUpCompleteMessage> | null;
      if (data?.type !== "vista-topup-complete") return;
      if (typeof data.balance === "number") onBalanceChange(data.balance);
      if (typeof data.tokensAdded === "number" && data.tokensAdded > 0) {
        setMessage(t("tokens.addedToBalance", { count: data.tokensAdded }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onBalanceChange, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const topup = params.get("topup");
    const sessionId = params.get("session_id");

    if (topup === "canceled") {
      setMessage(t("tokens.topUpCanceled"));
      params.delete("topup");
      params.delete("session_id");
      const next = params.toString();
      window.history.replaceState({}, "", next ? `/?${next}` : "/");
      return;
    }

    if (topup !== "success" || !sessionId) return;

    let cancelled = false;
    setLoading(true);

    verifyTokenTopUp(sessionId)
      .then(async (result) => {
        if (cancelled) return;
        onBalanceChange(result.balance);
        notifyOpenerTopUpComplete(result.balance, result.tokensAdded);
        if (result.tokensAdded > 0) {
          track("tokens_topup_completed", { tokens_added: result.tokensAdded });
          setMessage(t("tokens.addedToBalance", { count: result.tokensAdded }));
        } else if (result.alreadyCredited) {
          setMessage(t("tokens.balanceAlreadyUpdated"));
        } else {
          const fresh = await fetchTokenBalance();
          onBalanceChange(fresh.balance);
          notifyOpenerTopUpComplete(fresh.balance, 0);
          setMessage(t("tokens.paymentReceived"));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMessage(err instanceof Error ? err.message : t("tokens.couldNotConfirmPayment"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
        params.delete("topup");
        params.delete("session_id");
        const next = params.toString();
        window.history.replaceState({}, "", next ? `/?${next}` : "/");
      });

    return () => {
      cancelled = true;
    };
  }, [onBalanceChange, t]);

  const handleTopUp = useCallback(async () => {
    setMessage(null);
    setLoading(true);
    track("tokens_topup_started");
    try {
      const url = await startTokenTopUpCheckout(locale, selectedCountry);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        throw new Error(t("tokens.popupBlocked"));
      }
      setMessage(t("tokens.completePaymentInTab"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("tokens.couldNotStartCheckout"));
    } finally {
      setLoading(false);
    }
  }, [locale, selectedCountry, t]);

  const fillBalanceClass = `cd-surface-btn cd-surface-btn--pill shrink-0 ${
    compact ? "text-xs" : "text-xs sm:text-sm"
  }`;

  const topUpControl = loggedIn ? (
    <button
      type="button"
      onClick={handleTopUp}
      disabled={loading}
      className={fillBalanceClass}
      title={t("tokens.topUpStripe")}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin cd-surface-btn__icon" />
      ) : (
        <Plus size={14} className="cd-surface-btn__icon" aria-hidden />
      )}
      {t("tokens.fillBalance")}
    </button>
  ) : (
    <Link href="/login?next=/" className={fillBalanceClass}>
      <Plus size={14} className="cd-surface-btn__icon" aria-hidden />
      {t("tokens.fillBalance")}
    </Link>
  );

  const sheetTopUpControl = loggedIn ? (
    <button
      type="button"
      onClick={handleTopUp}
      disabled={loading}
      className="cd-header-sheet-row cd-header-sheet-row--accent"
      title={t("tokens.topUpStripe")}
    >
      {loading ? (
        <Loader2 size={16} className="cd-header-sheet-row-icon animate-spin" />
      ) : (
        <Plus size={16} className="cd-header-sheet-row-icon" aria-hidden />
      )}
      {t("tokens.fillBalance")}
    </button>
  ) : (
    <Link href="/login?next=/" className="cd-header-sheet-row">
      <Plus size={16} className="cd-header-sheet-row-icon" aria-hidden />
      {t("tokens.fillBalance")}
    </Link>
  );

  if (loggedIn === null) {
    if (layout === "sheet") return null;
    return (
      <div className="relative shrink-0">
        <TokenBalancePill balance={balance} compact={compact} />
      </div>
    );
  }

  if (balanceOnly) {
    return (
      <div className="relative shrink-0">
        <TokenBalancePill balance={balance} compact={compact} />
      </div>
    );
  }

  if (layout === "sheet") {
    return (
      <>
        {sheetTopUpControl}
        {message && (
          <p className="cd-header-sheet-note" title={message}>
            {message}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 min-w-0">
      <TokenBalancePill balance={balance} compact={compact} />
      {topUpControl}
      {message && (
        <span className="hidden sm:inline text-xs text-[var(--muted-foreground)] max-w-[min(220px,40vw)] truncate" title={message}>
          {message}
        </span>
      )}
    </div>
  );
}
