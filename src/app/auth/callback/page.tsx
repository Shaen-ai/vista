"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { exchangeOAuthCode } from "@/lib/authApi";
import { track } from "@/lib/analytics";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const errorMessages = useMemo(
    () => ({
      oauth_failed: t("auth.oauthFailed"),
      oauth_not_configured: t("auth.oauthNotConfigured"),
      email_required: t("auth.emailRequired"),
      account_conflict: t("auth.accountConflict"),
      disposable_email: t("auth.disposableEmail"),
    }),
    [t],
  );

  useEffect(() => {
    const oauthError = searchParams.get("error");
    if (oauthError) {
      setError(errorMessages[oauthError as keyof typeof errorMessages] ?? t("auth.signInFailedGeneric"));
      return;
    }

    const code = searchParams.get("code");
    if (!code) {
      setError(t("auth.missingSignInCode"));
      return;
    }

    exchangeOAuthCode(code)
      .then(() => {
        track("auth_logged_in", { method: "google" });
        router.replace("/");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("auth.signInFailedGeneric"));
      });
  }, [router, searchParams, t, errorMessages]);

  if (error) {
    return (
      <div className="cd-page flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <p className="max-w-md text-sm text-red-500">{error}</p>
        <Link href="/login" className="text-sm font-medium text-[var(--primary)] hover:underline">
          {t("auth.backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <div className="cd-page flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" aria-label={t("auth.completingSignIn")} />
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="cd-page flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
