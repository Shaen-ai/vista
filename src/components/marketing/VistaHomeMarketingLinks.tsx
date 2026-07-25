"use client";

import Link from "next/link";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

const LINKS = [
  { href: "/features", labelKey: "landing.footer.features" },
  { href: "/for-designers", labelKey: "landing.footer.forDesigners" },
  { href: "/faq", labelKey: "landing.footer.faq" },
  { href: "/blog", labelKey: "landing.footer.blog" },
  { href: "/about", labelKey: "landing.footer.about" },
  { href: "/llms.txt", labelKey: "landing.footer.forAi" },
] as const;

export function VistaHomeMarketingLinks() {
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("landing.footer.ariaLabel")}
      className="cd-landing-marketing-links mx-auto mt-10 max-w-3xl border-t border-[var(--border)] pt-8 text-center"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
        {t("landing.footer.heading")}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            {t(link.labelKey)}
          </Link>
        ))}
      </div>
    </nav>
  );
}
