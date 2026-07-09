import type { Metadata } from "next";
import { localeFromRequest } from "@/lib/localeFromRequest";
import { translate } from "@/i18n/translate";
import { VISTA_SITE_URL } from "@/lib/siteUrl";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await localeFromRequest();
  return {
    title: translate(locale, "marketing.about.title") + " — Vista",
    description: translate(locale, "marketing.about.metaDescription"),
    alternates: { canonical: `${VISTA_SITE_URL}/about` },
  };
}

export default async function AboutPage() {
  const locale = await localeFromRequest();
  const t = (key: string) => translate(locale, key);

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-24">
      <h1 className="text-4xl font-bold italic text-[var(--foreground)] sm:text-5xl">
        {t("marketing.about.title")}
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-[var(--muted-foreground)]">
        {t("marketing.about.intro")}
      </p>

      <div className="mt-16 grid gap-10 sm:grid-cols-3">
        {(["value1", "value2", "value3"] as const).map((key) => (
          <div key={key}>
            <h3 className="text-lg font-semibold text-[var(--foreground)]">
              {t(`marketing.about.${key}Title`)}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
              {t(`marketing.about.${key}Desc`)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-16 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8">
        <p className="text-[var(--muted-foreground)]">{t("marketing.about.companyBlock")}</p>
        <a
          href="https://tunzone.com/about"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-sm font-semibold text-[var(--primary)] hover:underline"
        >
          {t("marketing.about.learnAboutTunzone")} &rarr;
        </a>
      </div>

      <div className="mt-16">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">
          {t("marketing.about.contact")}
        </h2>
        <p className="mt-2 text-[var(--muted-foreground)]">
          {t("marketing.about.contactDesc")}
        </p>
        <a
          href="mailto:support@tunzone.com"
          className="mt-4 inline-block rounded-full border border-[var(--border)] px-5 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]"
        >
          support@tunzone.com
        </a>
      </div>
    </div>
  );
}
