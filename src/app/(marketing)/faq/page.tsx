import type { Metadata } from "next";
import { localeFromRequest } from "@/lib/localeFromRequest";
import { translate } from "@/i18n/translate";
import { VISTA_SITE_URL } from "@/lib/siteUrl";
import { JsonLdScript } from "@/components/marketing/JsonLdScript";
import { buildFaqJsonLd } from "@/lib/jsonLd";
import { FaqAccordion } from "./FaqAccordion";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await localeFromRequest();
  return {
    title: translate(locale, "marketing.faq.title") + " — Vista",
    description: translate(locale, "marketing.faq.metaDescription"),
    alternates: { canonical: `${VISTA_SITE_URL}/faq` },
  };
}

const FAQ_INDICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export default async function FaqPage() {
  const locale = await localeFromRequest();
  const t = (key: string) => translate(locale, key);

  const questions = FAQ_INDICES.map((i) => ({
    question: t(`marketing.faq.q${i}`),
    answer: t(`marketing.faq.a${i}`),
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <JsonLdScript data={buildFaqJsonLd(questions)} />

      <h1 className="text-center text-4xl font-bold italic text-[var(--foreground)] sm:text-5xl">
        {t("marketing.faq.title")}
      </h1>
      <p className="mt-4 text-center text-[var(--muted-foreground)]">
        {t("marketing.faq.subtitle")}
      </p>

      <div className="mt-14">
        <FaqAccordion questions={questions} />
      </div>

      <div className="mt-16 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">
          {t("marketing.faq.stillHave")}
        </h3>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {t("marketing.faq.stillHaveDesc")}
        </p>
        <a
          href="mailto:support@tunzone.com"
          className="mt-4 inline-block rounded-full border border-[var(--border)] px-5 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]"
        >
          {t("marketing.faq.contactUs")}
        </a>
      </div>
    </div>
  );
}
