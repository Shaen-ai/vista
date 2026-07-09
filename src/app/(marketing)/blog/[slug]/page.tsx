import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getBlogPost, getBlogPosts } from "@/lib/blog";
import { VISTA_SITE_URL } from "@/lib/siteUrl";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getBlogPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  return {
    title: `${post.title} — Vista Blog`,
    description: post.description,
    alternates: { canonical: `${VISTA_SITE_URL}/blog/${post.slug}` },
  };
}

function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(.+)$/gm, (line) => {
      if (line.startsWith("<")) return line;
      return line;
    });
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const html = markdownToHtml(post.body);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <Link
        href="/blog"
        className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        &larr; Back to blog
      </Link>

      <article className="mt-8">
        <time className="text-xs text-[var(--muted-foreground)]">{post.date}</time>
        <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)] sm:text-4xl">
          {post.title}
        </h1>
        <div
          className="prose mt-8 max-w-none text-[var(--foreground)] prose-headings:text-[var(--foreground)] prose-a:text-[var(--primary)] prose-strong:text-[var(--foreground)] prose-li:text-[var(--muted-foreground)] prose-p:text-[var(--muted-foreground)]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>
    </div>
  );
}
