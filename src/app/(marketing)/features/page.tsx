import type { Metadata } from "next";
import Link from "next/link";
import { localeFromRequest } from "@/lib/localeFromRequest";
import { translate } from "@/i18n/translate";
import { VISTA_SITE_URL } from "@/lib/siteUrl";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await localeFromRequest();
  return {
    title: translate(locale, "marketing.features.title") + " — Vista",
    description: translate(locale, "marketing.features.metaDescription"),
    alternates: { canonical: `${VISTA_SITE_URL}/features` },
  };
}

const FEATURES = [
  "roomUpload",
  "aiRedesign",
  "realFurniture",
  "quickRoom",
  "fullProject",
  "chatEdit",
  "catalogSearch",
  "payPerDesign",
] as const;

export default async function FeaturesPage() {
  const locale = await localeFromRequest();
  const t = (key: string) => translate(locale, key);

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-24">
      <h1 className="text-4xl font-bold italic text-[var(--foreground)] sm:text-5xl">
        {t("marketing.features.title")}
      </h1>
      <p className="mt-4 text-lg text-[var(--muted-foreground)]">
        {t("marketing.features.subtitle")}
      </p>

      <div className="mt-14 grid gap-10 sm:grid-cols-2">
        {FEATURES.map((key) => (
          <article key={key} className="rounded-xl border border-[var(--border)] p-6">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              {t(`marketing.features.${key}Title`)}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
              {t(`marketing.features.${key}Desc`)}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-16 text-center">
        <Link
          href="/"
          className="inline-block rounded-full bg-[var(--foreground)] px-8 py-3 text-sm font-semibold text-[var(--background)] hover:opacity-90"
        >
          {t("marketing.features.cta")}
        </Link>
      </div>
    </div>
  );
}
