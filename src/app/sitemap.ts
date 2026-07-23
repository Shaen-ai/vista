import type { MetadataRoute } from "next";
import { VISTA_SITE_URL } from "@/lib/siteUrl";
import { getBlogPosts } from "@/lib/blog";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date().toISOString();

  const staticPages: MetadataRoute.Sitemap = [
    { url: VISTA_SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${VISTA_SITE_URL}/features`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${VISTA_SITE_URL}/for-designers`, lastModified: now, changeFrequency: "monthly", priority: 0.85 },
    { url: `${VISTA_SITE_URL}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${VISTA_SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${VISTA_SITE_URL}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${VISTA_SITE_URL}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  const posts = getBlogPosts();
  const blogPages: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${VISTA_SITE_URL}/blog/${post.slug}`,
    lastModified: post.date,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...blogPages];
}
