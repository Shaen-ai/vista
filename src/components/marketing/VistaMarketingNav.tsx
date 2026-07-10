"use client";

import Link from "next/link";
import { PwaInstallButton } from "@/components/PwaInstallButton";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
];

export function VistaMarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="text-xl font-bold italic text-[var(--foreground)]">
          vista
        </Link>
        <div className="flex items-center gap-2 md:hidden">
          <PwaInstallButton variant="nav" />
        </div>
        <div className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/signup"
            className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            Sign up
          </Link>
        </div>
      </nav>
    </header>
  );
}
