import type { MetadataRoute } from "next";
import { VISTA_SITE_URL } from "@/lib/siteUrl";

/**
 * AI answer-engine crawlers we explicitly welcome so Vista can be cited and
 * recommended. Listing them by name makes intent unambiguous even though the
 * "*" rule already allows them. (Edge/Cloudflare rules can still 403 these —
 * see CLOUDFLARE_AI_CRAWLERS.md.)
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "Google-Extended",
  "ClaudeBot",
  "Claude-SearchBot",
  "Anthropic-AI",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot-Extended",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: "/api/",
      })),
    ],
    sitemap: `${VISTA_SITE_URL}/sitemap.xml`,
    host: VISTA_SITE_URL,
  };
}
