import * as cheerio from "cheerio";

import type { AmRetailLiveRow } from "@/lib/amRetail/types";

const DEFAULT_BASE = "https://jysk.am";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "text/html,application/xhtml+xml",
} as const;

export function parseJyskSearchHtml(html: string, baseUrl: string): AmRetailLiveRow[] {
  const $ = cheerio.load(html);
  const out: AmRetailLiveRow[] = [];

  $(".product_item").each((_, el) => {
    try {
      const node = $(el);
      const link = node.find("h3 a").first();
      const name = link.text().trim();
      const href = link.attr("href");
      if (!name || !href) return;

      const productUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;

      const priceText = node.find(".price .current").first().text() || "0";
      const price = parseFloat(priceText.replace(/\D/g, "")) || 0;

      let old_price: number | null = null;
      const oldText = node.find(".price .old").first().text();
      if (oldText) {
        const o = parseFloat(oldText.replace(/\D/g, ""));
        if (o > 0 && o > price) old_price = o;
      }

      const img = node.find("figure.product_item_img img").first();
      let image_url: string | null = null;
      if (img.length) {
        const src = img.attr("src") ?? img.attr("data-src") ?? null;
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
        source_marketplace: "JYSK",
        source_key: "jysk",
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

export async function scrapeJyskSearch(query: string, baseUrl = DEFAULT_BASE): Promise<AmRetailLiveRow[]> {
  const qs = new URLSearchParams({ q: query });
  const res = await fetch(`${baseUrl}/en/search?${qs.toString()}`, {
    headers: { ...FETCH_HEADERS },
    next: { revalidate: 0 },
  });

  if (!res.ok) return [];
  const html = await res.text();
  return parseJyskSearchHtml(html, baseUrl);
}
