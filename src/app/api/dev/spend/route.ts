import { NextResponse } from "next/server";
import { buildSpendResponse, getSpendSnapshot, isDevSpendEnabled } from "@/lib/aiSpend";

export async function GET() {
  if (!isDevSpendEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const snapshot = getSpendSnapshot();
  return NextResponse.json({
    totalUsd: snapshot.totalUsd,
    generationUsd: snapshot.sessionUsd,
    sessionId: snapshot.sessionId,
    byModel: snapshot.byModel,
    lastGeneration: snapshot.lastGeneration,
    spend: buildSpendResponse(),
  });
}
