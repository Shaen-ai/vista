import "server-only";

import { cookies, headers } from "next/headers";
import type { VistaLocale } from "@/i18n/locales";
import { isVistaLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import { VISTA_LOCALE_COOKIE } from "@/i18n/vistaLocale";

const BOT_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /yandexbot/i,
  /gptbot/i,
  /oai-searchbot/i,
  /claudebot/i,
  /perplexitybot/i,
  /applebot/i,
  /duckduckbot/i,
  /baiduspider/i,
  /slurp/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
];

function isBot(ua: string): boolean {
  return BOT_PATTERNS.some((p) => p.test(ua));
}

/**
 * Resolve locale for server components (metadata, marketing pages).
 * Priority:
 *   1. Bots → always English (stable SEO signals)
 *   2. Cookie → user's explicit choice
 *   3. DEFAULT_LOCALE fallback (English)
 *
 * Accept-Language is intentionally ignored — Armenian only when geo confirms AM (client).
 */
export async function localeFromRequest(): Promise<VistaLocale> {
  const h = await headers();
  const ua = h.get("user-agent") || "";

  if (isBot(ua)) return "en";

  const cookieStore = await cookies();
  const cookieVal = cookieStore.get(VISTA_LOCALE_COOKIE)?.value;
  if (isVistaLocale(cookieVal)) return cookieVal;

  return DEFAULT_LOCALE;
}
