"use client";

import Link from "next/link";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

const FOOTER_LINKS = [
  { href: "/features", labelKey: "landing.footer.features" },
  { href: "/for-designers", labelKey: "landing.footer.forDesigners" },
  { href: "/faq", labelKey: "landing.footer.faq" },
  { href: "/blog", labelKey: "landing.footer.blog" },
  { href: "/about", labelKey: "landing.footer.about" },
  { href: "/llms.txt", labelKey: "landing.footer.forAi" },
] as const;

export function VistaMarketingFooter() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[var(--border)] py-10">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-lg font-bold italic text-[var(--foreground)]">
              vista
            </Link>
            <span className="text-xs text-[var(--muted-foreground)]">
              {t("landing.footer.partOf")}{" "}
              <a
                href="https://tunzone.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--foreground)]"
              >
                Tunzone
              </a>
            </span>
          </div>
          <div className="flex items-center gap-5">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {t(link.labelKey)}
              </Link>
            ))}
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-[var(--muted-foreground)] sm:text-left">
          {t("landing.footer.copyright", { year })} ·{" "}
          <a href="mailto:support@tunzone.com" className="hover:underline">
            support@tunzone.com
          </a>
        </p>
      </div>
    </footer>
  );
}
