"use client";

import type { ReactNode } from "react";

export type InviteSharePlatform = "messenger" | "facebook" | "telegram" | "whatsapp" | "instagram";

export type InviteShareTarget =
  | { id: InviteSharePlatform; labelKey: string; kind: "link"; href: string }
  | { id: InviteSharePlatform; labelKey: string; kind: "copyThenOpen"; openUrl: string; mobileOpenUrl?: string };

function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function buildInviteShareTargets(url: string, message: string): InviteShareTarget[] {
  const encodedUrl = encodeURIComponent(url);
  const encodedMessage = encodeURIComponent(message);

  return [
    {
      id: "messenger",
      labelKey: "referral.shareMessenger",
      kind: "copyThenOpen",
      openUrl: "https://www.messenger.com/",
      mobileOpenUrl: `fb-messenger://share/?link=${encodedUrl}`,
    },
    {
      id: "facebook",
      labelKey: "referral.shareFacebook",
      kind: "link",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      id: "telegram",
      labelKey: "referral.shareTelegram",
      kind: "link",
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedMessage}`,
    },
    {
      id: "whatsapp",
      labelKey: "referral.shareWhatsApp",
      kind: "link",
      href: `https://wa.me/?text=${encodedMessage}`,
    },
    {
      id: "instagram",
      labelKey: "referral.shareInstagram",
      kind: "copyThenOpen",
      openUrl: "https://www.instagram.com/direct/inbox/",
      mobileOpenUrl: "instagram://direct-inbox",
    },
  ];
}

export function resolveShareOpenUrl(target: Extract<InviteShareTarget, { kind: "copyThenOpen" }>): string {
  if (isMobileUserAgent() && target.mobileOpenUrl) return target.mobileOpenUrl;
  return target.openUrl;
}

function ShareIconBase({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden>
      {children}
    </svg>
  );
}

export function InviteShareIcon({ platform }: { platform: InviteSharePlatform }) {
  switch (platform) {
    case "messenger":
      return (
        <ShareIconBase>
          <path d="M12 2C6.48 2 2 6.03 2 10.9c0 2.84 1.4 5.37 3.59 7.02L4.5 21.5l3.86-1.14A10.8 10.8 0 0 0 12 19.8c5.52 0 10-4.03 10-8.9S17.52 2 12 2zm1.08 11.9-2.6-2.77-5.08 2.77 5.6-5.94 2.67 2.77 5.01-2.77-5.6 5.94z" />
        </ShareIconBase>
      );
    case "facebook":
      return (
        <ShareIconBase>
          <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.95h-1.51c-1.49 0-1.95.93-1.95 1.88v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z" />
        </ShareIconBase>
      );
    case "telegram":
      return (
        <ShareIconBase>
          <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.57 8.16-2.13 10.03c-.16.72-.58.9-1.18.56l-3.26-2.4-1.57 1.51c-.17.17-.32.32-.66.32l.23-3.28 6.04-5.46c.26-.23-.06-.36-.4-.13L7.7 13.8l-3.17-1c-.69-.22-.7-.69.14-1.02l12.4-4.78c.58-.21 1.08.13.9 1.16z" />
        </ShareIconBase>
      );
    case "whatsapp":
      return (
        <ShareIconBase>
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.33 4.95L2 22l5.25-1.38a10.9 10.9 0 0 0 4.79 1.12h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 18.16h-.01a9.1 9.1 0 0 1-4.65-1.27l-.33-.2-3.12.82.83-3.04-.22-.31a9.09 9.09 0 0 1-1.39-4.85c0-5.04 4.1-9.14 9.15-9.14 2.44 0 4.73.95 6.45 2.67a9.06 9.06 0 0 1 2.68 6.45c0 5.05-4.1 9.15-9.14 9.15zm5.01-6.84c-.28-.14-1.65-.81-1.9-.9-.25-.1-.43-.14-.61.14-.18.28-.7.9-.86 1.08-.16.18-.32.2-.6.07-.28-.14-1.18-.43-2.25-1.37-.83-.74-1.39-1.65-1.55-1.93-.16-.28-.02-.43.12-.57.12-.12.28-.32.42-.48.14-.16.18-.28.28-.46.1-.18.05-.36-.02-.5-.07-.14-.61-1.47-.84-2.01-.22-.53-.45-.46-.61-.47h-.52c-.18 0-.5.07-.76.36-.26.28-1 1-1 2.43 0 1.43 1.03 2.81 1.18 3 .15.18 2.03 3.1 4.93 4.35.69.3 1.23.48 1.65.61.69.22 1.32.19 1.82.12.56-.08 1.65-.67 1.88-1.32.23-.65.23-1.2.16-1.32-.07-.12-.25-.18-.53-.32z" />
        </ShareIconBase>
      );
    case "instagram":
      return (
        <ShareIconBase>
          <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.43.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.43.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.74 3.74 0 0 1-1.38-.9 3.74 3.74 0 0 1-.9-1.38c-.16-.43-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.43-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.78.3-1.44.7-2.1 1.36C1.38 2.65.98 3.31.68 4.09c-.3.76-.5 1.64-.56 2.91C.06 8.28.05 8.69.05 12c0 3.31.01 3.72.07 5 .06 1.27.26 2.15.56 2.91.3.78.7 1.44 1.36 2.1.66.66 1.32 1.06 2.1 1.36.76.3 1.64.5 2.91.56 1.27.06 1.68.07 5 .07s3.73-.01 5-.07c1.27-.06 2.15-.26 2.91-.56.78-.3 1.44-.7 2.1-1.36.66-.66 1.06-1.32 1.36-2.1.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-5s-.01-3.73-.07-5c-.06-1.27-.26-2.15-.56-2.91a5.86 5.86 0 0 0-1.36-2.1A5.86 5.86 0 0 0 19.91.63c-.76-.3-1.64-.5-2.91-.56C15.73.01 15.32 0 12 0zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4zm6.41-11.85a1.44 1.44 0 1 0-1.44 1.44 1.44 1.44 0 0 0 1.44-1.44z" />
        </ShareIconBase>
      );
  }
}

type InviteShareButtonsProps = {
  url: string;
  message: string;
  layout: "inline" | "sheet";
  t: (key: string) => string;
  onCopyThenOpen: () => void;
};

export function InviteShareButtons({ url, message, layout, t, onCopyThenOpen }: InviteShareButtonsProps) {
  const targets = buildInviteShareTargets(url, message);

  async function handleCopyThenOpen(target: Extract<InviteShareTarget, { kind: "copyThenOpen" }>) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard unavailable — still try to open */
    }
    onCopyThenOpen();
    const openUrl = resolveShareOpenUrl(target);
    window.open(openUrl, "_blank", "noopener,noreferrer");
  }

  function handleLinkShare(href: string) {
    window.open(href, "_blank", "noopener,noreferrer");
  }

  const rowClassName =
    layout === "sheet"
      ? "cd-header-sheet-row cd-header-sheet-row--accent flex items-center justify-between gap-1 px-2 py-2"
      : "flex items-center justify-between gap-1 px-3 py-2";

  const buttonClassName =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer";

  return (
    <div className={rowClassName} role="group" aria-label={t("referral.shareVia")}>
      {targets.map((target) => (
        <button
          key={target.id}
          type="button"
          className={buttonClassName}
          aria-label={t(target.labelKey)}
          title={t(target.labelKey)}
          onClick={() => {
            if (target.kind === "link") {
              handleLinkShare(target.href);
              return;
            }
            void handleCopyThenOpen(target);
          }}
        >
          <InviteShareIcon platform={target.id} />
        </button>
      ))}
    </div>
  );
}
