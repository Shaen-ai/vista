import type { Metadata } from "next";
import Link from "next/link";
import { getBlogPosts } from "@/lib/blog";
import { VISTA_SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "Blog — Vista",
  description: "Articles about interior design, room redesign tips, and how Vista works.",
  alternates: { canonical: `${VISTA_SITE_URL}/blog` },
};

export default function BlogIndexPage() {
  const posts = getBlogPosts();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <h1 className="text-4xl font-bold italic text-[var(--foreground)] sm:text-5xl">Blog</h1>
      <p className="mt-4 text-[var(--muted-foreground)]">
        Tips, guides, and updates about interior design with Vista.
      </p>

      <div className="mt-12 divide-y divide-[var(--border)]">
        {posts.map((post) => (
          <article key={post.slug} className="py-8">
            <time className="text-xs text-[var(--muted-foreground)]">{post.date}</time>
            <h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
              <Link href={`/blog/${post.slug}`} className="hover:underline">
                {post.title}
              </Link>
            </h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{post.description}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
