/** Match `next.config.ts` / marketplace proxy defaults — use loopback IPv4 so Node fetch reaches `php artisan serve`. */
const DEFAULT_DEV_API = "http://127.0.0.1:8000/api";
const DEFAULT_DEV_SITE = "http://localhost:3001";

function withoutTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

/** Laravel `/api` base URL, e.g. `https://api.tunzone.com/api` in production, localhost in dev. */
export function getPublicApiUrl(): string {
  return withoutTrailingSlashes(process.env.NEXT_PUBLIC_API_URL || DEFAULT_DEV_API);
}

/**
 * Base URL for **browser** marketplace HTTP routes (`/api/marketplace/*`).
 * Always same-origin so requests hit `app/api/marketplace/[[...path]]/route.ts`, which proxies to
 * Laravel (see `getServerLaravelOrigin()`). That avoids CORS when `NEXT_PUBLIC_API_URL` points at
 * another host (e.g. `http://localhost:8000`) and preserves `X-Forwarded-For` for geo detection.
 *
 * On the server (`window` undefined), returns an absolute URL when `NEXT_PUBLIC_API_URL` is set
 * for callers that run outside a browser context.
 */
export function getMarketplaceApiBase(): string {
  if (typeof window !== "undefined") {
    return "/api/marketplace";
  }
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (raw) {
    const origin = withoutTrailingSlashes(raw).replace(/\/api\/?$/, "");
    return `${origin}/api/marketplace`;
  }
  return "/api/marketplace";
}

/**
 * Laravel origin for Route Handlers / server code (never use browser-relative `/api/...`).
 * Prefer `LARAVEL_API_ORIGIN` when the public browser URL differs from where Node can reach PHP (Docker, etc.).
 * Must be like `http://127.0.0.1:8000` (no trailing slash, no `/api` suffix).
 */
export function getServerLaravelOrigin(): string {
  const internal = process.env.LARAVEL_API_ORIGIN?.trim();
  if (internal) {
    return withoutTrailingSlashes(internal).replace(/\/api\/?$/, "").replace(/\/+$/, "");
  }
  return (
    (process.env.NEXT_PUBLIC_API_URL || "")
      .trim()
      .replace(/\/api\/?$/, "")
      .replace(/\/+$/, "") || "http://127.0.0.1:8000"
  );
}

/** Absolute `.../api/marketplace` base for server-side `fetch` (same target as `app/api/marketplace/[[...path]]/route.ts`). */
export function getServerMarketplaceApiBaseUrl(): string {
  return `${getServerLaravelOrigin()}/api/marketplace`;
}

export const publicApiUrl = getPublicApiUrl();

export function getPublishedSiteUrl(): string {
  return withoutTrailingSlashes(process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_DEV_SITE);
}

export const publishedSiteUrl = getPublishedSiteUrl();

const DEFAULT_SUPPORT_EMAIL = "support@tunzone.com";

/** Mailto target for “Contact” / support in the storefront footer. Override with NEXT_PUBLIC_CONTACT_SUPPORT_EMAIL. */
export function getContactSupportEmail(): string {
  return (
    process.env.NEXT_PUBLIC_CONTACT_SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL
  );
}

export const contactSupportEmail = getContactSupportEmail();

/** Laravel origin for browser OAuth redirects (no `/api` suffix). */
export function getLaravelOAuthOrigin(): string {
  return getServerLaravelOrigin();
}

/** Full URL to start Google OAuth from Vista. */
export function getGoogleOAuthRedirectUrl(referralCode?: string | null): string {
  const params = new URLSearchParams({ intent: "vista" });
  const ref = referralCode?.trim();
  if (ref) params.set("ref", ref);
  return `${getLaravelOAuthOrigin()}/auth/social/google/redirect?${params.toString()}`;
}
