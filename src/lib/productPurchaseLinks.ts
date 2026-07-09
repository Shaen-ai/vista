import { getServerMarketplaceApiBaseUrl } from "@/lib/publicEnv";

export interface ProductPurchaseLink {
  id: number;
  name: string;
  price: number;
  currency: string;
  sourceUrl: string;
  sourceMarketplace: string;
  imageUrl: string | null;
  dimensions: string | null;
  category: string | null;
}

export async function fetchProductPurchaseLinks(productIds: number[]): Promise<ProductPurchaseLink[]> {
  if (!productIds.length) return [];
  const links: ProductPurchaseLink[] = [];
  const chunkSize = 50;
  try {
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const ids = productIds.slice(i, i + chunkSize).join(",");
      const res = await fetch(
        `${getServerMarketplaceApiBaseUrl()}/products/by-ids?ids=${ids}`,
        { cache: "no-store", headers: { Accept: "application/json" } },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: Record<string, unknown>[] };
      const items = Array.isArray(json.data) ? json.data : [];
      for (const item of items) {
        const dims = [item.width_cm, item.depth_cm, item.height_cm].filter(Boolean);
        const category =
          typeof item.category_en === "string" && item.category_en.trim()
            ? item.category_en
            : typeof item.category === "string" && item.category.trim()
              ? item.category
              : null;
        links.push({
          id: Number(item.id) || 0,
          name: (typeof item.name_en === "string" && item.name_en.trim()) ? item.name_en : String(item.name ?? "Product"),
          price: Number(item.price) || 0,
          currency: typeof item.currency === "string" ? item.currency : "AMD",
          sourceUrl: typeof item.external_url === "string" ? item.external_url : "",
          sourceMarketplace: typeof item.source_marketplace === "string" ? item.source_marketplace : "",
          imageUrl: typeof item.main_image_url === "string" ? item.main_image_url : null,
          dimensions: dims.length ? dims.join(" × ") + " cm" : null,
          category,
        });
      }
    }
    return links;
  } catch {
    return [];
  }
}
