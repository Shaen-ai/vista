"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { PwaInstallButton } from "@/components/PwaInstallButton";
import { TunzoneLogoLink } from "@/components/TunzoneLogoLink";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/features", label: "Features" },
  { href: "/for-designers", label: "For designers" },
  { href: "/faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
];

const navLinkClassName =
  "text-sm font-semibold text-[var(--foreground)] transition-colors hover:text-[var(--foreground)]/80";

export function VistaMarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)]/60 bg-[var(--background)]/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-1 sm:px-6 sm:py-1.5 lg:px-8">
        <TunzoneLogoLink priority />

        {/* Desktop */}
        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={navLinkClassName}>
              {link.label}
            </Link>
          ))}
          <Link
            href="/signup"
            className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            Sign up
          </Link>
        </div>

        {/* Mobile toggle */}
        <div className="flex items-center gap-1.5 md:hidden">
          <PwaInstallButton variant="nav" />
          <button
            type="button"
            className="cd-header-menu-btn flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      <div
        className={`overflow-hidden transition-all duration-300 md:hidden ${open ? "max-h-[28rem]" : "max-h-0"}`}
      >
        <div className="flex flex-col gap-2 px-4 pb-5 sm:px-6 sm:pb-6">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-2 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]/80"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/signup"
            onClick={() => setOpen(false)}
            className="rounded-full border border-[var(--border)] px-5 py-2.5 text-center text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
