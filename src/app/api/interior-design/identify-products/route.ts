import { NextRequest, NextResponse } from "next/server";
import { fetchMarketplaceProductsAsCatalog } from "@/lib/consumerCatalog";
import { geminiPlanCatalogIds, normalizeMpKey } from "@/lib/placementPlan";
import { fetchProductPurchaseLinks } from "@/lib/productPurchaseLinks";
import { sortProductsForDisplay } from "@/lib/productDisplayOrder";
import { PUBLIC_AI_GENERIC_ERROR } from "@/lib/tunzoneAi";

export const maxDuration = 30;

function mpNumericIdsFromCatalogStrings(ids: string[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of ids) {
    const s = String(raw).trim();
    const m1 = /^mp-(\d+)$/i.exec(s);
    const m2 = m1 ? m1[1] : /^\d+$/.test(s) ? s : null;
    if (!m2) continue;
    const n = Number(m2);
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      candidateMpKeys?: string[];
      pinnedMpKeys?: string[];
      briefSelectedIds?: string[];
      /** Full catalog sent to Gemini for this render (authoritative used-product list). */
      selectedCatalogIds?: string[];
    };

    const pinnedMpKeys = Array.isArray(body.pinnedMpKeys)
      ? body.pinnedMpKeys.filter((k): k is string => typeof k === "string")
      : [];
    const briefSelectedIds = Array.isArray(body.briefSelectedIds)
      ? body.briefSelectedIds.filter((k): k is string => typeof k === "string")
      : [];
    const selectedCatalogIds = Array.isArray(body.selectedCatalogIds)
      ? body.selectedCatalogIds.filter((k): k is string => typeof k === "string")
      : [];
    const candidateFromBody = Array.isArray(body.candidateMpKeys)
      ? body.candidateMpKeys.filter((k): k is string => typeof k === "string")
      : [];

    const planSourceIds =
      selectedCatalogIds.length > 0
        ? selectedCatalogIds
        : candidateFromBody.length > 0
          ? candidateFromBody
          : briefSelectedIds;

    const numericIds = mpNumericIdsFromCatalogStrings([...planSourceIds, ...pinnedMpKeys]);
    const catalogRows = await fetchMarketplaceProductsAsCatalog(numericIds);
    const allowedCatalogKeys = new Set(catalogRows.map((r) => r.id));

    const finalUsedMpKeys = geminiPlanCatalogIds({
      selectedForGemini: planSourceIds,
      pinnedMpKeys,
      allowedCatalogKeys,
    });

    const usedNumericIds = mpNumericIdsFromCatalogStrings(finalUsedMpKeys);
    let usedProducts =
      usedNumericIds.length > 0 ? await fetchProductPurchaseLinks(usedNumericIds) : [];
    usedProducts = sortProductsForDisplay(usedProducts);

    return NextResponse.json({
      data: {
        catalogIds: finalUsedMpKeys,
        visionCatalogIds: [],
        ...(usedProducts.length > 0 ? { usedProducts } : {}),
        ...(pinnedMpKeys.length > 0
          ? { pinnedTotal: pinnedMpKeys.length, pinnedDetectedCount: pinnedMpKeys.filter((p) => finalUsedMpKeys.includes(normalizeMpKey(p) ?? p)).length }
          : {}),
      },
    });
  } catch (error: unknown) {
    console.error("Vista interior design identify-products error:", error);
    return NextResponse.json({ error: PUBLIC_AI_GENERIC_ERROR }, { status: 500 });
  }
}
