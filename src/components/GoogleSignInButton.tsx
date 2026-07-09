"use client";

import { getGoogleOAuthRedirectUrl } from "@/lib/publicEnv";
import { getStoredReferralCode } from "@/lib/vistaTokens";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

type Props = {
  label?: string;
  className?: string;
};

export function GoogleSignInButton({ label, className = "" }: Props) {
  const { t } = useTranslation();
  const buttonLabel = label ?? t("auth.continueWithGoogle");

  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = getGoogleOAuthRedirectUrl(getStoredReferralCode());
      }}
      className={`flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] cursor-pointer ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.083 36 24 36c-5.522 0-10-4.478-10-10s4.478-10 10-10c2.761 0 5.246 1.127 7.045 2.955l5.657-5.657C34.046 10.053 29.268 8 24 8 14.059 8 6 16.059 6 26s8.059 18 18 18 18-8.059 18-18c0-1.341-.138-2.65-.389-3.917z" />
        <path fill="#FF3D00" d="M6 26c0-1.657.284-3.247.795-4.735L14.045 28.3C15.404 31.798 19.262 34 24 34c2.761 0 5.246-1.127 7.045-2.955l5.657 5.657C34.046 41.947 29.268 44 24 44 14.059 44 6 35.941 6 26z" />
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-7.27 5.625C7.488 39.556 15.062 44 24 44z" />
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
      </svg>
      {buttonLabel}
    </button>
  );
}
