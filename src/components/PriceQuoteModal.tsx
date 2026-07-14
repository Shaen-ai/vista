"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Send, X } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { fetchCurrentUser, type AuthUser } from "@/lib/authApi";
import { getPublicApiUrl } from "@/lib/publicEnv";
import { track } from "@/lib/analytics";

type PriceQuoteModalProps = {
  open: boolean;
  onClose: () => void;
  roomType?: string;
  style?: string;
  projectId?: string | null;
};

type ModalPhase = "form" | "submitting" | "success" | "error";

function buildQuoteMessage(input: {
  inquiry: string;
  roomType?: string;
  style?: string;
  projectId?: string | null;
}): string {
  const lines = [input.inquiry.trim()];
  if (input.roomType?.trim()) lines.push(`Room type: ${input.roomType.trim()}`);
  if (input.style?.trim()) lines.push(`Style: ${input.style.trim()}`);
  if (input.projectId?.trim()) lines.push(`Project ID: ${input.projectId.trim()}`);
  return lines.join("\n");
}

export function PriceQuoteModal({
  open,
  onClose,
  roomType,
  style,
  projectId,
}: PriceQuoteModalProps) {
  const { t } = useTranslation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<ModalPhase>("form");

  useEffect(() => {
    if (!open) return;

    setPhase("form");
    setPhone("");
    setLoadingUser(true);
    fetchCurrentUser()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoadingUser(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const userEmail = user?.email ?? "";

  async function handleSubmit() {
    if (!user?.email || !user.name) return;

    setPhase("submitting");
    const message = buildQuoteMessage({
      inquiry: t("page.customResultInquiryMessage"),
      roomType,
      style,
      projectId,
    });
    const phoneTrimmed = phone.trim();

    try {
      const res = await fetch(`${getPublicApiUrl()}/contact`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: user.name,
          email: user.email,
          message,
          ...(phoneTrimmed ? { phone: phoneTrimmed } : {}),
          source: "vista_price_quote",
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setPhase("error");
        return;
      }
      track("price_quote_requested", {
        has_phone: !!phoneTrimmed,
        project_id: projectId ?? undefined,
      });
      setPhase("success");
    } catch {
      setPhase("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="price-quote-modal-title"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
          <h2 id="price-quote-modal-title" className="text-lg font-bold text-[var(--foreground)]">
            {phase === "success" ? t("priceQuote.successTitle") : t("priceQuote.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            aria-label={t("common.close")}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="px-5 pb-5 pt-3 sm:px-6 sm:pb-6">
          {loadingUser ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" aria-hidden />
              <span className="sr-only">{t("priceQuote.loading")}</span>
            </div>
          ) : phase === "success" ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 p-4">
                <Check size={20} className="mt-0.5 shrink-0 text-[var(--primary)]" aria-hidden />
                <p className="text-sm leading-relaxed text-[var(--foreground)]">
                  {t("priceQuote.successBody", { email: userEmail })}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-[var(--primary)] py-3 text-sm font-bold text-white transition-all hover:brightness-110"
              >
                {t("common.close")}
              </button>
            </div>
          ) : !user?.email ? (
            <p className="text-sm text-[var(--muted-foreground)]">{t("priceQuote.error")}</p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSubmit();
              }}
            >
              <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                {t("priceQuote.description", { email: userEmail })}
              </p>

              <div>
                <label
                  htmlFor="price-quote-phone"
                  className="mb-1.5 block text-xs font-semibold text-[var(--foreground)]"
                >
                  {t("priceQuote.phoneLabel")}
                </label>
                <input
                  id="price-quote-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("priceQuote.phonePlaceholder")}
                  disabled={phase === "submitting"}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50"
                />
              </div>

              {phase === "error" && (
                <p className="text-sm text-red-600">{t("priceQuote.error")}</p>
              )}

              <button
                type="submit"
                disabled={phase === "submitting"}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-60"
              >
                {phase === "submitting" ? (
                  <>
                    <Loader2 size={18} className="animate-spin" aria-hidden />
                    {t("priceQuote.submitting")}
                  </>
                ) : (
                  <>
                    <Send size={18} aria-hidden />
                    {t("priceQuote.submit")}
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
