import type { AmRetailLiveRow } from "@/lib/amRetail/types";

const DEFAULT_BASE = "https://domus.am";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,hy;q=0.8",
} as const;

/**
 * Domus embeds escaped JSON blobs in CSR HTML. Find product URLs then read title/price from a nearby window.
 */
export function parseDomusSearchHtml(html: string, baseUrl: string): AmRetailLiveRow[] {
  const pathRe = /\/product\/(domus-[a-zA-Z0-9-]+)/g;
  const seen = new Set<string>();
  const rows: AmRetailLiveRow[] = [];

  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(html)) !== null) {
    const slug = m[1];
    const relativePath = `/product/${slug}`;
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);

    const idx = m.index ?? 0;
    const slice = html.slice(Math.max(0, idx - 3200), Math.min(html.length, idx + 3200));

    const titleMatch =
      slice.match(/"title":"((?:[^"\\]|\\.)+)"/)?.[1]?.replace(/\\"/g, '"') ??
      slice.match(/"title":"([^"]{3,400})"/)?.[1];
    const name = titleMatch?.trim() || slug;

    const priceMatch = slice.match(/"price":(\d+)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

    let image_url: string | null = null;
    const thumb = slice.match(/"thumbnail_url":"((?:[^"\\]|\\.)+)"/)?.[1];
    const large = slice.match(/"large_url":"((?:[^"\\]|\\.)+)"/)?.[1];
    const rawImg = thumb || large;
    if (rawImg) {
      const u = rawImg.replace(/\\\//g, "/");
      image_url = u.startsWith("http") ? u : `${baseUrl}${u.startsWith("/") ? "" : "/"}${u}`;
    }

    rows.push({
      name,
      price,
      currency: "AMD",
      old_price: null,
      product_url: `${baseUrl}${relativePath}`,
      image_url,
      source_marketplace: "Domus",
      source_key: "domus",
      in_stock: true,
      brand: null,
      category: null,
      rating: null,
      review_count: null,
      width_cm: null,
      depth_cm: null,
      height_cm: null,
    });

    if (rows.length >= 40) break;
  }

  return rows;
}

export async function scrapeDomusSearch(query: string, baseUrl = DEFAULT_BASE): Promise<AmRetailLiveRow[]> {
  const qs = new URLSearchParams({ q: query });
  const res = await fetch(`${baseUrl}/search?${qs.toString()}`, {
    headers: { ...FETCH_HEADERS },
    next: { revalidate: 0 },
  });

  if (!res.ok) return [];
  const html = await res.text();
  return parseDomusSearchHtml(html, baseUrl);
}
