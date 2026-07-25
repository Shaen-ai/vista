export const VISTA_SITE_URL =
  process.env.NEXT_PUBLIC_VISTA_URL?.trim().replace(/\/+$/, "") ||
  "https://vista.tunzone.com";

const DEFAULT_PRODUCTION_TUNZONE_BASE = "https://tunzone.com";
const DEFAULT_DEV_TUNZONE_BASE = "http://localhost:3002";

/** Marketing site (tunzone.com) origin — no trailing slash. */
export function getTunzoneLandingHref(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_TUNZONE_URL ?? "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return DEFAULT_PRODUCTION_TUNZONE_BASE;
  return DEFAULT_DEV_TUNZONE_BASE;
}
