"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { getPublicApiUrl } from "@/lib/publicEnv";
import { setStoredReferralCode } from "@/lib/vistaTokens";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

type ReferralInfo = {
  referrerFirstName: string;
  inviteeBonus: number;
};

export default function InviteLandingPage() {
  const params = useParams();
  const { t } = useTranslation();
  const code = typeof params.code === "string" ? params.code : "";
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) {
      setInvalid(true);
      setLoading(false);
      return;
    }
    setStoredReferralCode(code);
    const base = getPublicApiUrl().replace(/\/$/, "");
    fetch(`${base}/public/referral/${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (!res.ok) {
          setInvalid(true);
          return;
        }
        const json = (await res.json()) as { data?: ReferralInfo };
        setInfo(json.data ?? null);
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [code]);

  return (
    <div className="cd-page flex min-h-screen flex-col items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-8 shadow-sm">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
          </div>
        ) : invalid ? (
          <>
            <h1 className="text-xl font-bold">{t("invite.invalidTitle")}</h1>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t("invite.invalidDescription")}</p>
            <Link href="/signup" className="mt-6 inline-block text-sm font-semibold text-[var(--primary)] hover:underline">
              {t("auth.signUp")}
            </Link>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 text-[var(--primary)]">
              <Gift size={28} />
              <h1 className="text-2xl font-bold text-[var(--foreground)]">{t("invite.invitedTitle")}</h1>
            </div>
            <p className="mt-4 text-base font-semibold text-[var(--foreground)]">
              {(info?.inviteeBonus ?? 0) > 0
                ? t("invite.friendGaveYouWithBonus", {
                    name: info?.referrerFirstName ? ` ${info.referrerFirstName}` : "",
                    count: info!.inviteeBonus,
                  })
                : t("invite.friendGaveYou", {
                    name: info?.referrerFirstName ? ` ${info.referrerFirstName}` : "",
                  })}
            </p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t("invite.claimBonus")}</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="flex-1 rounded-xl bg-[var(--primary)] py-3 text-center text-sm font-semibold text-white hover:brightness-110"
              >
                {t("invite.createAccount")}
              </Link>
              <Link
                href="/login"
                className="flex-1 rounded-xl border border-[var(--border)] py-3 text-center text-sm font-semibold hover:bg-[var(--muted)]"
              >
                {t("invite.signIn")}
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
