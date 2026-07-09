import type { MetadataRoute } from "next";
import { VISTA_SITE_URL } from "@/lib/siteUrl";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: "/api/",
      },
    ],
    sitemap: `${VISTA_SITE_URL}/sitemap.xml`,
    host: VISTA_SITE_URL,
  };
}
