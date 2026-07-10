import "server-only";

import { getServerLaravelOrigin } from "@/lib/publicEnv";
import { pipelineLog } from "@/lib/pipelineLog";

/**
 * Fetch publicly accessible image URLs for scraped marketplace products.
 *
 * Used by the fal two-stage pipeline (Option B) to pass product cutout images
 * to Kontext's `image_urls` for SKU-aware rendering.
 */
export async function fetchScrapedProductImageUrls(
  marketplaceIds: number[],
  limit = 5,
): Promise<string[]> {
  if (marketplaceIds.length === 0) return [];

  const origin = getServerLaravelOrigin();
  const ids = marketplaceIds.slice(0, limit * 2); // fetch extra in case some lack images

  try {
    const res = await fetch(`${origin}/api/marketplace/products/by-ids?ids=${ids.join(",")}`, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      pipelineLog("PRODUCT_IMAGES", "batch fetch failed", { status: res.status }, "warn");
      return [];
    }

    const json = (await res.json()) as { data?: Array<{ main_image_url?: string | null }> };
    const products = json.data ?? [];

    const urls: string[] = [];
    for (const p of products) {
      if (urls.length >= limit) break;
      const url = p.main_image_url;
      if (url && /^https?:\/\//i.test(url)) {
        urls.push(url);
      }
    }

    return urls;
  } catch (err) {
    pipelineLog("PRODUCT_IMAGES", "batch fetch error", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    }, "warn");
    return [];
  }
}
