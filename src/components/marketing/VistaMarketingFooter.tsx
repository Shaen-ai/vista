import Link from "next/link";

const FOOTER_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/for-designers", label: "For designers" },
  { href: "/faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
];

export function VistaMarketingFooter() {
  return (
    <footer className="border-t border-[var(--border)] py-10">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-lg font-bold italic text-[var(--foreground)]">
              vista
            </Link>
            <span className="text-xs text-[var(--muted-foreground)]">
              Part of{" "}
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
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-[var(--muted-foreground)] sm:text-left">
          © {new Date().getFullYear()} Tunzone. All rights reserved. ·{" "}
          <a href="mailto:support@tunzone.com" className="hover:underline">
            support@tunzone.com
          </a>
        </p>
      </div>
    </footer>
  );
}
