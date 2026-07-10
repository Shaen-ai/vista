export const PWA_DISMISS_KEY = "vista-pwa-install-dismissed";

export function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;

  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

/** iOS phone/tablet, including iPadOS desktop UA. */
export function isIosMobile(): boolean {
  if (typeof window === "undefined") return false;

  const { platform, maxTouchPoints, userAgent } = window.navigator;
  const iosPlatform =
    platform === "iPhone" || platform === "iPad" || platform === "iPod";
  const ipadOsDesktop = platform === "MacIntel" && maxTouchPoints > 1;
  const iosUa = /iPhone|iPad|iPod/i.test(userAgent);

  return iosPlatform || ipadOsDesktop || iosUa;
}

export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

export function isPwaDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PWA_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissPwaInstall(): void {
  try {
    localStorage.setItem(PWA_DISMISS_KEY, "1");
  } catch {
    // ignore quota / private mode
  }
}
