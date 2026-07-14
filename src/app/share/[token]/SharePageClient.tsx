"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Calendar,
  ImageIcon,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { DEFAULT_QUICK_ROOM_PROMPT } from "@/lib/quickRoomDefaultPrompt";

export type ShareVersion = {
  id: string;
  version_number: number;
  type: string;
  image_url: string;
  prompt_used: string | null;
  feedback: string | null;
  created_at: string | null;
};

export type SharePromptEntry = {
  role: string;
  text: string;
  created_at: string | null;
};

export type ShareProjectData = {
  title: string;
  style: string | null;
  created_at: string | null;
  draft_prompt: string | null;
  room_image_url: string | null;
  versions: ShareVersion[];
  prompt_history: SharePromptEntry[];
};

type SharePageClientProps = {
  initialData?: ShareProjectData | null;
};

function formatDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function versionTypeLabel(type: string, t: (key: string) => string): string {
  if (type === "edited") return t("sharePage.versionEdited");
  if (type === "regenerated") return t("sharePage.versionRegenerated");
  return t("sharePage.versionGenerated");
}

function isUserVisiblePrompt(text: string | null | undefined): text is string {
  const normalized = text?.trim() ?? "";
  if (!normalized) return false;
  return normalized !== DEFAULT_QUICK_ROOM_PROMPT;
}

export function SharePageClient({ initialData = null }: SharePageClientProps) {
  const params = useParams();
  const { t, locale } = useTranslation();
  const token = typeof params.token === "string" ? params.token : "";
  const [data, setData] = useState<ShareProjectData | null>(initialData);
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(!initialData);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    if (initialData || !token) {
      if (!token) setInvalid(true);
      setLoading(false);
      return;
    }

    fetch(`/api/public/vista/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          setInvalid(true);
          return;
        }
        const json = (await res.json()) as { data?: ShareProjectData };
        setData(json.data ?? null);
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [token, initialData]);

  const latestVersion = useMemo(() => {
    if (!data?.versions?.length) return null;
    return data.versions[data.versions.length - 1];
  }, [data]);

  const timelineEntries = useMemo(() => {
    if (!data) return [];
    const entries: Array<{ key: string; label: string; text: string; at: string | null }> = [];
    const seen = new Set<string>();

    const addEntry = (
      key: string,
      label: string,
      text: string | null | undefined,
      at: string | null,
    ) => {
      if (!isUserVisiblePrompt(text) || seen.has(text)) return;
      seen.add(text);
      entries.push({ key, label, text, at });
    };

    addEntry("draft", t("sharePage.originalPrompt"), data.draft_prompt, data.created_at);

    for (const v of data.versions) {
      if (isUserVisiblePrompt(v.feedback)) {
        addEntry(
          `v-feedback-${v.id}`,
          `${t("sharePage.feedback")} (${t("sharePage.version")} ${v.version_number})`,
          v.feedback,
          v.created_at,
        );
      } else if (v.type !== "edited") {
        addEntry(`v-prompt-${v.id}`, t("sharePage.you"), v.prompt_used, v.created_at);
      }
    }

    return entries;
  }, [data, t]);

  return (
    <div className="cd-page cd-page--light min-h-screen">
      <header className="cd-editorial-header">
        <Link href="/" className="cd-brand-logo">
          vista
        </Link>
        <LanguageSwitcher />
      </header>

      <main className="cd-hub-inner py-8 sm:py-12">
        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-10 w-10 animate-spin text-[var(--primary)]" aria-hidden />
          </div>
        ) : invalid || !data ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center shadow-sm">
            <ImageIcon className="mx-auto h-10 w-10 text-[var(--muted-foreground)] opacity-50" aria-hidden />
            <h1 className="mt-4 text-xl font-bold text-[var(--foreground)]">{t("sharePage.invalidTitle")}</h1>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t("sharePage.invalidDescription")}</p>
            <Link
              href="/quick/new"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline"
            >
              {t("sharePage.ctaButton")} <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="space-y-10 sm:space-y-14">
            <section className="cd-hub-hero text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                {data.style && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-3 py-1 text-xs font-semibold text-[var(--primary)]">
                    <Sparkles size={12} aria-hidden />
                    {data.style}
                  </span>
                )}
                {data.created_at && (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                    <Calendar size={12} aria-hidden />
                    {formatDate(data.created_at, locale)}
                  </span>
                )}
              </div>
              <h1 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
                {data.title}
              </h1>
            </section>

            {(data.room_image_url || latestVersion) && (
              <section>
                <div className="grid justify-items-center gap-4 sm:grid-cols-2 sm:justify-items-stretch sm:gap-6">
                  {data.room_image_url && (
                    <div className="w-full max-w-[240px] sm:max-w-none">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        {t("sharePage.before")}
                      </p>
                      <button
                        type="button"
                        onClick={() => setLightboxSrc(data.room_image_url)}
                        className="mx-auto block w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-md transition-shadow hover:shadow-lg sm:mx-0"
                      >
                        <img
                          src={data.room_image_url}
                          alt={t("sharePage.before")}
                          className="aspect-[4/3] max-h-[200px] w-full object-cover sm:max-h-none"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </button>
                    </div>
                  )}
                  {latestVersion && (
                    <div className="w-full max-w-[240px] sm:max-w-none">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        {t("sharePage.after")}
                      </p>
                      <button
                        type="button"
                        onClick={() => setLightboxSrc(latestVersion.image_url)}
                        className="mx-auto block w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-md transition-shadow hover:shadow-lg sm:mx-0"
                      >
                        <img
                          src={latestVersion.image_url}
                          alt={t("sharePage.after")}
                          className="aspect-[4/3] max-h-[200px] w-full object-cover sm:max-h-none"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {data.versions.length > 1 && (
              <section>
                <h2 className="mb-4 font-serif text-xl font-semibold text-[var(--foreground)]">
                  {t("sharePage.versions")}
                </h2>
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
                  {data.versions.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setLightboxSrc(v.image_url)}
                      className="group relative w-[min(140px,44vw)] shrink-0 snap-start overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition-shadow hover:shadow-md sm:w-[220px]"
                    >
                      <img
                        src={v.image_url}
                        alt={`${t("sharePage.version")} ${v.version_number}`}
                        className="aspect-[4/3] w-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.opacity = "0.3";
                        }}
                      />
                      <span className="absolute left-2 top-2 rounded-full bg-[var(--background)]/90 px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm">
                        {versionTypeLabel(v.type, t)}
                      </span>
                      <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white">
                        v{v.version_number}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {timelineEntries.length > 0 && (
              <section>
                <h2 className="mb-4 font-serif text-xl font-semibold text-[var(--foreground)]">
                  {t("sharePage.promptHistory")}
                </h2>
                <div className="space-y-3">
                  {timelineEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[var(--foreground)]">{entry.label}</p>
                        {entry.at && (
                          <time className="text-[10px] text-[var(--muted-foreground)]">
                            {formatDate(entry.at, locale)}
                          </time>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--muted-foreground)]">
                        {entry.text}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-center shadow-sm sm:p-8">
              <h2 className="font-serif text-xl font-semibold text-[var(--foreground)]">{t("sharePage.ctaTitle")}</h2>
              <Link
                href="/quick/new"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-6 py-3 text-sm font-bold text-white transition-all hover:brightness-110"
              >
                {t("sharePage.ctaButton")} <ArrowRight size={16} aria-hidden />
              </Link>
            </section>
          </div>
        )}
      </main>

      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxSrc(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setLightboxSrc(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label={t("common.close")}
          >
            <X size={24} aria-hidden />
          </button>
          <img
            src={lightboxSrc}
            alt=""
            className="max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
