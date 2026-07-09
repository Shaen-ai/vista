import type { ProductIntent } from "@/lib/interiorDesignPrompts";
import { getServerMarketplaceApiBaseUrl } from "@/lib/publicEnv";
import { normalizeMpKey } from "@/lib/placementPlan";

export interface ResolvedIntentRow {
  id: number;
  mpKey: string;
}

/**
 * Resolve Claude product_intents to marketplace numeric ids via Laravel API.
 */
export async function resolveProductIntentsToIds(opts: {
  intents: ProductIntent[];
  pinnedProductIds: number[];
  perIntentLimit?: number;
}): Promise<number[]> {
  const { intents, pinnedProductIds, perIntentLimit = 3 } = opts;
  const base = getServerMarketplaceApiBaseUrl();
  const seen = new Set<number>();
  const out: number[] = [];

  for (const id of pinnedProductIds) {
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  if (!intents.length) return out;

  try {
    const res = await fetch(`${base}/products/resolve-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        intents: intents.map((i) => ({
          family: i.family,
          subtype: i.subtype,
          query: i.query,
          quantity: i.quantity ?? 1,
        })),
        pinnedIds: pinnedProductIds,
        perIntentLimit,
      }),
      cache: "no-store",
    });
    if (!res.ok) return out;
    const json = (await res.json()) as { data?: { ids?: number[]; mpKeys?: string[] } };
    const ids = Array.isArray(json.data?.ids) ? json.data!.ids! : [];
    for (const id of ids) {
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  } catch {
    /* keep pinned only */
  }

  return out;
}

export function mpKeysFromNumericIds(ids: number[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of ids) {
    const k = normalizeMpKey(String(n));
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
