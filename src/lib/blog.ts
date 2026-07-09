import "server-only";

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  body: string;
}

const BLOG_DIR = join(process.cwd(), "content", "blog");

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2] };
}

export function getBlogPosts(): BlogPost[] {
  if (!existsSync(BLOG_DIR)) return [];
  const files = readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));
  const posts: BlogPost[] = files.map((file) => {
    const raw = readFileSync(join(BLOG_DIR, file), "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    return {
      slug: meta.slug || file.replace(/\.md$/, ""),
      title: meta.title || "Untitled",
      description: meta.description || "",
      date: meta.date || "2026-01-01",
      body,
    };
  });
  return posts.sort((a, b) => (a.date > b.date ? -1 : 1));
}

export function getBlogPost(slug: string): BlogPost | undefined {
  return getBlogPosts().find((p) => p.slug === slug);
}
