import * as cheerio from "cheerio";

import type { AmRetailLiveRow } from "@/lib/amRetail/types";

const DEFAULT_BASE = "https://vega.am";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "text/html,application/xhtml+xml",
} as const;

export function parseVegaSearchHtml(html: string, baseUrl: string): AmRetailLiveRow[] {
  const $ = cheerio.load(html);
  const out: AmRetailLiveRow[] = [];

  $(".product-layout, .product-thumb").each((_, el) => {
    try {
      const node = $(el);
      const nameEl = node.find(".caption a, .product-name a, h4 a").first();
      const name = nameEl.text().trim();
      const href = nameEl.attr("href");
      if (!name || !href) return;

      const productUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;

      const priceText = node.find(".price-new, .price").first().text() || "0";
      const price = parseFloat(priceText.replace(/[^\d.]/g, "")) || 0;

      let old_price: number | null = null;
      const oldText = node.find(".price-old").first().text();
      if (oldText) {
        const o = parseFloat(oldText.replace(/[^\d.]/g, ""));
        old_price = o > price ? o : null;
      }

      const img = node.find("img").first();
      let image_url: string | null = null;
      if (img.length) {
        const src = img.attr("data-src") ?? img.attr("src") ?? null;
        if (src) {
          image_url = src.startsWith("http") ? src : `${baseUrl}${src.startsWith("/") ? "" : "/"}${src}`;
        }
      }

      out.push({
        name,
        price,
        currency: "AMD",
        old_price,
        product_url: productUrl,
        image_url,
        source_marketplace: "Vega",
        source_key: "vega",
        in_stock: true,
        brand: null,
        category: null,
        rating: null,
        review_count: null,
        width_cm: null,
        depth_cm: null,
        height_cm: null,
      });
    } catch {
      /* skip malformed */
    }
  });

  return out;
}

export async function scrapeVegaSearch(query: string, baseUrl = DEFAULT_BASE): Promise<AmRetailLiveRow[]> {
  const qs = new URLSearchParams({ search: query, limit: "20" });
  // Armenian storefront search (matches e.g. …/am/search-am/?search=divan)
  const res = await fetch(`${baseUrl}/am/search-am/?${qs.toString()}`, {
    headers: { ...FETCH_HEADERS },
    next: { revalidate: 0 },
  });

  if (!res.ok) return [];
  const html = await res.text();
  return parseVegaSearchHtml(html, baseUrl);
}
