import type { Metadata } from "next";
import Link from "next/link";
import { localeFromRequest } from "@/lib/localeFromRequest";
import { translate } from "@/i18n/translate";
import { VISTA_SITE_URL } from "@/lib/siteUrl";
import { BeforeAfterSlider } from "@/components/marketing/BeforeAfterSlider";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await localeFromRequest();
  return {
    title: translate(locale, "marketing.forDesigners.title") + " — Vista",
    description: translate(locale, "marketing.forDesigners.metaDescription"),
    alternates: { canonical: `${VISTA_SITE_URL}/for-designers` },
  };
}

export default async function ForDesignersPage() {
  const locale = await localeFromRequest();
  const t = (key: string) => translate(locale, key);

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="text-sm font-semibold tracking-wide text-[var(--primary)] uppercase">
        {t("marketing.forDesigners.eyebrow")}
      </p>
      <h1 className="mt-3 max-w-2xl text-4xl font-bold italic leading-tight text-[var(--foreground)] sm:text-5xl">
        {t("marketing.forDesigners.headline")}
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-[var(--muted-foreground)]">
        {t("marketing.forDesigners.subtitle")}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="inline-block rounded-full bg-[var(--foreground)] px-7 py-3 text-sm font-semibold text-[var(--background)] hover:opacity-90"
        >
          {t("marketing.forDesigners.ctaPrimary")}
        </Link>
        <a
          href="mailto:support@tunzone.com?subject=Vista%20Early%20Designer%20Program"
          className="inline-block rounded-full border border-[var(--border)] px-7 py-3 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]"
        >
          {t("marketing.forDesigners.ctaSecondary")}
        </a>
      </div>

      <section className="mt-16">
        <h2 className="text-xl font-semibold text-[var(--foreground)]">
          {t("marketing.forDesigners.shot1Title")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {t("marketing.forDesigners.shot1Desc")}
        </p>
        <div className="mt-5">
          <BeforeAfterSlider
            beforeSrc="/for-designers/room-before.jpg"
            afterSrc="/for-designers/room-after.jpg"
            beforeAlt={t("marketing.forDesigners.shot1BeforeAlt")}
            afterAlt={t("marketing.forDesigners.shot1AfterAlt")}
            beforeLabel={t("marketing.forDesigners.before")}
            afterLabel={t("marketing.forDesigners.after")}
          />
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-xl font-semibold text-[var(--foreground)]">
          {t("marketing.forDesigners.shot2Title")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {t("marketing.forDesigners.shot2Desc")}
        </p>
        <div className="mt-5">
          <BeforeAfterSlider
            beforeSrc="/for-designers/project-before.jpg"
            afterSrc="/for-designers/project-after.jpg"
            beforeAlt={t("marketing.forDesigners.shot2BeforeAlt")}
            afterAlt={t("marketing.forDesigners.shot2AfterAlt")}
            beforeLabel={t("marketing.forDesigners.before")}
            afterLabel={t("marketing.forDesigners.after")}
          />
        </div>
      </section>

      <section className="mt-20 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-10 text-center sm:px-10">
        <h2 className="text-2xl font-bold italic text-[var(--foreground)]">
          {t("marketing.forDesigners.closeTitle")}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
          {t("marketing.forDesigners.closeDesc")}
        </p>
        <Link
          href="/signup"
          className="mt-6 inline-block rounded-full bg-[var(--primary)] px-8 py-3 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90"
        >
          {t("marketing.forDesigners.ctaPrimary")}
        </Link>
      </section>
    </div>
  );
}
