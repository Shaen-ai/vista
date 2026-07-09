"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { fetchCurrentUser, registerConsumer } from "@/lib/authApi";
import { track } from "@/lib/analytics";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

export default function SignupPage() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchCurrentUser()
      .then((user) => {
        if (user) router.replace("/");
      })
      .finally(() => setChecking(false));
  }, [router]);

  if (checking) {
    return (
      <div className="cd-page flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await registerConsumer({ name, email, password, language: locale });
      track("auth_signed_up", { method: "password" });
      setInfo(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.signUpFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cd-page flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">{t("auth.signUpTitle")}</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t("auth.signUpSubtitle")}</p>

        {!info && (
          <>
            <div className="mt-6 space-y-3">
              <GoogleSignInButton label={t("auth.signUpWithGoogle")} />
            </div>

            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-xs text-[var(--muted-foreground)]">{t("common.or")}</span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>
          </>
        )}

        {info ? (
          <div className="mt-6 space-y-4">
            <p className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm">{info}</p>
            <Link href="/login" className="inline-block text-sm font-medium text-[var(--primary)] hover:underline">
              {t("auth.backToSignIn")}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block text-sm font-medium">
              {t("auth.name")}
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"
              />
            </label>
            <label className="block text-sm font-medium">
              {t("auth.email")}
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"
              />
            </label>
            <label className="block text-sm font-medium">
              {t("auth.password")}
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--primary)]"
              />
            </label>
            {error && <p className="rounded-lg bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60 cursor-pointer"
            >
              {loading ? t("auth.creatingAccount") : t("auth.signUp")}
            </button>
          </form>
        )}

        {!info && (
          <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
            {t("auth.alreadyHaveAccount")}{" "}
            <Link href="/login" className="font-medium text-[var(--primary)] hover:underline">
              {t("auth.signIn")}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
