import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { AmRetailLiveRow, AmRetailSourceRow } from "@/lib/amRetail/types";
import { scrapeDomusSearch } from "@/lib/amRetail/domusSearch";
import { scrapeJyskSearch } from "@/lib/amRetail/jyskSearch";
import { scrapeVegaSearch } from "@/lib/amRetail/vegaSearch";

export const dynamic = "force-dynamic";

const MAX_PER_SITE = 20;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 200) {
    return NextResponse.json(
      { message: "Query must be between 2 and 200 characters." },
      { status: 400 }
    );
  }

  let vegaRows: AmRetailLiveRow[] = [];
  let domusRows: AmRetailLiveRow[] = [];
  let jyskRows: AmRetailLiveRow[] = [];
  const sources: AmRetailSourceRow[] = [];

  const tVega = Date.now();
  try {
    vegaRows = (await scrapeVegaSearch(q)).slice(0, MAX_PER_SITE);
    sources.push({
      key: "vega",
      name: "Vega",
      logo: null,
      count: vegaRows.length,
      elapsed_ms: Date.now() - tVega,
      status: "ok",
    });
  } catch (err) {
    sources.push({
      key: "vega",
      name: "Vega",
      logo: null,
      count: 0,
      elapsed_ms: Date.now() - tVega,
      status: "error",
      error: err instanceof Error ? err.message : "Vega fetch failed",
    });
  }

  const tDomus = Date.now();
  try {
    domusRows = (await scrapeDomusSearch(q)).slice(0, MAX_PER_SITE);
    sources.push({
      key: "domus",
      name: "Domus",
      logo: null,
      count: domusRows.length,
      elapsed_ms: Date.now() - tDomus,
      status: "ok",
    });
  } catch (err) {
    sources.push({
      key: "domus",
      name: "Domus",
      logo: null,
      count: 0,
      elapsed_ms: Date.now() - tDomus,
      status: "error",
      error: err instanceof Error ? err.message : "Domus fetch failed",
    });
  }

  const tJysk = Date.now();
  try {
    jyskRows = (await scrapeJyskSearch(q)).slice(0, MAX_PER_SITE);
    sources.push({
      key: "jysk",
      name: "JYSK",
      logo: null,
      count: jyskRows.length,
      elapsed_ms: Date.now() - tJysk,
      status: "ok",
    });
  } catch (err) {
    sources.push({
      key: "jysk",
      name: "JYSK",
      logo: null,
      count: 0,
      elapsed_ms: Date.now() - tJysk,
      status: "error",
      error: err instanceof Error ? err.message : "JYSK fetch failed",
    });
  }

  const results = [...vegaRows, ...domusRows, ...jyskRows];

  return NextResponse.json({
    results,
    sources,
    meta: {
      via: "vista-retail-proxy",
      retailers: ["vega.am", "domus.am", "jysk.am"],
    },
  });
}
