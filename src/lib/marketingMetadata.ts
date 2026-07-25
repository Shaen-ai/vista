import type { Metadata } from "next";
import { VISTA_SITE_URL } from "@/lib/siteUrl";

const DEFAULT_OG_IMAGE = {
  url: "/landing/landing-quick-room.jpg",
  width: 1536,
  height: 1024,
  alt: "Vista — Interior Design",
} as const;

export function buildMarketingMetadata(opts: {
  path: `/${string}`;
  title: string;
  description: string;
}): Metadata {
  const canonical = `${VISTA_SITE_URL}${opts.path}`;
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: "Vista",
      title: opts.title,
      description: opts.description,
      images: [DEFAULT_OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: [DEFAULT_OG_IMAGE.url],
    },
  };
}
