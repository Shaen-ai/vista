import { NextRequest, NextResponse } from "next/server";
import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";
import {
  buildQuickDesignScrapedAllowlistIds,
} from "@/lib/scrapedAllowlist";
import { checkTokensServer, consumeTokensServer, type TokenAction } from "@/lib/serverVistaTokens";
import { getAnthropicApiKey, getGoogleGenerativeAiApiKey } from "@/lib/serverAiKeys";
import { PUBLIC_AI_GENERIC_ERROR } from "@/lib/tunzoneAi";
import {
  buildAiIncidentResponse,
  buildMissingKeyResponse,
  isOverloadedAiError,
  reportOverloadedIncident,
} from "@/lib/aiIncident";
import { type DesignPhase } from "@/lib/phaseRouter";
import {
  DESIGN_STYLES,
  normalizeRoomAnalysisOpenings,
  normalizeRoomTypeValue,
  type DesignStyleId,
  type RoomAnalysis,
} from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import { StepTimer } from "@/lib/generationDebug";
import { resolveRenderProvider } from "@/lib/roomImageRenderer";
import {
  generatePhasedRoom,
  generateFinalViewpointRender,
  type GeminiPart,
  type InspirationItem,
} from "@/lib/phasedRoomEngine";
import { runWithLogContext } from "@/lib/logSink";
import { buildSpendResponse, isDevSpendEnabled } from "@/lib/aiSpend";

export const maxDuration = 180;

// Room/base input image is downscaled more aggressively than product references:
// it's the largest payload and does not need to stay sharp for product fidelity.
const ROOM_IMAGE_MAX_EDGE = 1024;
const ROOM_IMAGE_QUALITY = 65;

// Token charging for extra-viewpoint ("finalview") renders is deferred — they are
// free/bundled for now. Flip this to "regenerate" (5) or "edit" (3) to start
// billing; the check/consume gate below activates automatically when non-null.
const FINALVIEW_TOKEN_ACTION: TokenAction | null = null;

function parseNumericIdListFromForm(formData: FormData, field: string): number[] {
  const raw = formData.get(field);
  if (!raw || typeof raw !== "string") return [];
  const t = raw.trim();
  if (!t) return [];
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) {
      return arr.map((x) => Number(x)).filter((n) => !isNaN(n) && n > 0);
    }
  } catch { /* ignore */ }
  return t.split(/[\s,;]+/).map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
}

function parseDesignBoardProductIds(formData: FormData): number[] {
  return parseNumericIdListFromForm(formData, "designBoardProductIds");
}

async function parseInspirationProducts(formData: FormData): Promise<InspirationItem[]> {
  const items: InspirationItem[] = [];
  const labels = formData.getAll("inspirationLabels") as string[];
  const files = formData.getAll("inspirationImages") as File[];
  const urls = formData.getAll("inspirationUrls") as string[];
  let labelIdx = 0;

  for (const file of files) {
    if (items.length >= 10) break;
    try {
      const bytes = await file.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes));
      items.push({ base64: optimized.base64, mimeType: optimized.mimeType, label: labels[labelIdx] || "" });
    } catch { /* skip */ }
    labelIdx++;
  }

  for (const url of urls) {
    if (items.length >= 10) break;
    if (!/^https?:\/\//i.test(url)) { labelIdx++; continue; }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (!res.ok) { labelIdx++; continue; }
      const arr = await res.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(arr));
      items.push({ base64: optimized.base64, mimeType: optimized.mimeType, label: labels[labelIdx] || "" });
    } catch { /* skip */ }
    labelIdx++;
  }
  return items;
}

async function parseStyleInspirationParts(formData: FormData): Promise<GeminiPart[]> {
  const files = formData.getAll("styleInspirationImages") as File[];
  const images: Array<{ base64: string; mimeType: string }> = [];
  for (const file of files) {
    if (images.length >= 4) break;
    try {
      const bytes = await file.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes));
      images.push({ base64: optimized.base64, mimeType: optimized.mimeType });
    } catch { /* skip */ }
  }
  if (images.length === 0) return [];

  const parts: GeminiPart[] = [
    {
      text: `STYLE INSPIRATION IMAGES (${images.length}) — replicate this design aesthetic, color palette, materials, and spatial mood using ONLY the real catalog products referenced below.`,
    },
  ];
  for (const item of images) {
    parts.push({ inlineData: { mimeType: item.mimeType, data: item.base64 } });
  }
  return parts;
}

function parseStringIdListFromForm(formData: FormData, field: string): string[] {
  const raw = formData.get(field);
  if (!raw || typeof raw !== "string") return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * Renders the completed design onto one EXTRA room photo (a different camera angle
 * of the same room), returning exactly ONE image. The frontend fires one of these
 * per extra uploaded photo after the final phase is approved.
 */
async function handleFinalView(formData: FormData, request: NextRequest, timer: StepTimer) {
  const provider = resolveRenderProvider();
  const googleKey = getGoogleGenerativeAiApiKey();
  if (provider !== "fal" && !googleKey) {
    const isDev = process.env.NODE_ENV === "development";
    if (isDev) {
      return NextResponse.json(
        { error: "GOOGLE_AI_API_KEY missing in vista/.env.local" },
        { status: 503 },
      );
    }
    const missing = buildMissingKeyResponse(
      "/api/interior-design/phased-generate",
      "GOOGLE_AI_API_KEY missing for phased finalview render",
    );
    return NextResponse.json(missing.body, { status: missing.status });
  }

  const extraPhotoFile = formData.get("roomImage") as File | null;
  const primaryDesignFile = formData.get("primaryDesignImage") as File | null;
  if (!extraPhotoFile || !primaryDesignFile) {
    return NextResponse.json(
      { error: "Both roomImage (extra photo) and primaryDesignImage are required for a finalview render." },
      { status: 400 },
    );
  }

  const confirmedProductIds = parseStringIdListFromForm(formData, "confirmedProductIds");
  const styleId = (formData.get("style") as DesignStyleId) || "modern";
  const styleEntry = DESIGN_STYLES.find((s) => s.id === styleId);
  const designStyleLabel = styleEntry?.label ?? styleId;
  const textPrompt = (formData.get("textPrompt") as string) || "";
  const doorDesignRaw = (formData.get("doorDesign") as string | null)?.trim();
  const doorDesign = doorDesignRaw || null;
  const falRenderSeedRaw = formData.get("falRenderSeed") as string | null;
  const falRenderSeedParsed = falRenderSeedRaw ? Number(falRenderSeedRaw) : undefined;
  const falRenderSeed =
    typeof falRenderSeedParsed === "number" && Number.isFinite(falRenderSeedParsed)
      ? falRenderSeedParsed
      : undefined;

  const roomAnalysisRaw = formData.get("roomAnalysis") as string | null;
  let roomAnalysis: RoomAnalysis | null = null;
  if (roomAnalysisRaw?.trim()) {
    try { roomAnalysis = normalizeRoomAnalysisOpenings(JSON.parse(roomAnalysisRaw)); } catch { /* ignore */ }
  }
  const roomGeometryRaw = formData.get("roomGeometry") as string | null;
  let roomGeometry: RoomGeometry | null = null;
  if (roomGeometryRaw?.trim()) {
    try { roomGeometry = JSON.parse(roomGeometryRaw) as RoomGeometry; } catch { /* ignore */ }
  }
  const effectiveRoomType = normalizeRoomTypeValue(roomAnalysis?.room_type || "living room");

  // Deferred billing: only gate when an action is configured.
  if (FINALVIEW_TOKEN_ACTION) {
    const tokenCheck = await checkTokensServer(FINALVIEW_TOKEN_ACTION, request.headers);
    if (!tokenCheck.ok) {
      return NextResponse.json(
        { error: tokenCheck.message, balance: tokenCheck.balance, required: tokenCheck.required },
        { status: tokenCheck.status },
      );
    }
  }

  const roomImageOpts = { maxEdge: ROOM_IMAGE_MAX_EDGE, quality: ROOM_IMAGE_QUALITY };
  const extraPhoto = await optimizeImageBufferForAiWithBuffer(
    Buffer.from(await extraPhotoFile.arrayBuffer()), roomImageOpts);
  const primaryDesignImage = await optimizeImageBufferForAiWithBuffer(
    Buffer.from(await primaryDesignFile.arrayBuffer()), roomImageOpts);
  timer.mark("finalview_inputs_ready", { confirmedCount: confirmedProductIds.length });

  const result = await generateFinalViewpointRender({
    extraPhoto: { base64: extraPhoto.base64, mimeType: extraPhoto.mimeType },
    primaryDesignImage: { base64: primaryDesignImage.base64, mimeType: primaryDesignImage.mimeType },
    confirmedProductIds,
    styleId,
    designStyleLabel,
    roomType: effectiveRoomType,
    textPrompt,
    roomAnalysis,
    roomGeometry,
    googleKey: googleKey ?? "",
    falRenderSeed,
    doorDesign,
  });

  timer.mark("finalview_render", { ok: result.ok });

  if (!result.ok || !result.image) {
    return NextResponse.json({ error: result.error ?? PUBLIC_AI_GENERIC_ERROR }, { status: result.status ?? 500 });
  }

  let balance: number | undefined;
  if (FINALVIEW_TOKEN_ACTION) {
    const tokenGate = await consumeTokensServer(FINALVIEW_TOKEN_ACTION, request.headers);
    if (!tokenGate.ok) {
      return NextResponse.json(
        { error: tokenGate.message, balance: tokenGate.balance, required: tokenGate.required },
        { status: tokenGate.status },
      );
    }
    balance = tokenGate.balance;
  }

  const sessionId = `finalview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return NextResponse.json({
    balance,
    data: {
      sessionId,
      images: [{ id: `${sessionId}-img-0`, base64: result.image.base64, mimeType: result.image.mimeType }],
    },
    debug: timer.finish("finalview", { ok: true }),
    ...(isDevSpendEnabled() ? { spend: buildSpendResponse() } : {}),
  });
}

export async function POST(request: NextRequest) {
  const logId = `phased-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return runWithLogContext(logId, () => handlePhasedPost(request));
}

async function handlePhasedPost(request: NextRequest) {
  const timer = new StepTimer();
  try {
    const formData = await request.formData();
    const designPhase = String(formData.get("designPhase") ?? "").trim() as DesignPhase | "finalview";

    if (designPhase === "finalview") {
      return await handleFinalView(formData, request, timer);
    }

    if (!["base", "furniture", "decor"].includes(designPhase)) {
      return NextResponse.json(
        { error: "Invalid designPhase. Must be 'base', 'furniture', or 'decor'." },
        { status: 400 },
      );
    }

    timer.mark("parse_request", { designPhase });

    const textPrompt = (formData.get("textPrompt") as string) || "";
    const doorDesignRaw = (formData.get("doorDesign") as string | null)?.trim();
    const doorDesign = doorDesignRaw || null;
    const styleId = (formData.get("style") as DesignStyleId) || "modern";
    const roomImage = formData.get("roomImage") as File | null;
    const previousPhaseImage = formData.get("previousPhaseImage") as File | null;
    const previousPhaseProductsRaw = formData.get("previousPhaseProducts") as string | null;
    const roomAnalysisRaw = formData.get("roomAnalysis") as string | null;
    const countryCode = String(formData.get("countryCode") ?? "").trim();
    const searchMode = String(formData.get("searchMode") ?? "").trim();
    void countryCode;
    void searchMode;
    const designBoardProductIds = parseDesignBoardProductIds(formData);
    const clientCatalogAllowlistIds = parseNumericIdListFromForm(formData, "catalogAllowlistIds");
    const inspirationItems = await parseInspirationProducts(formData);
    const styleInspirationParts = await parseStyleInspirationParts(formData);

    const adminSlug =
      ((formData.get("adminSlug") as string) || "").trim() ||
      (process.env.INTERIOR_DESIGN_ADMIN_SLUG || "").trim() ||
      (process.env.NEXT_PUBLIC_INTERIOR_ADMIN_SLUG || "").trim() ||
      "demo";

    const tokenActionRaw = String(formData.get("tokenAction") ?? "generate").trim();
    const tokenAction: TokenAction | "none" =
      tokenActionRaw === "none"
        ? "none"
        : tokenActionRaw === "regenerate" || tokenActionRaw === "edit"
          ? tokenActionRaw
          : "generate";

    const roomGeometryRaw = formData.get("roomGeometry") as string | null;

    const googleKey = getGoogleGenerativeAiApiKey();
    const anthropicKey = getAnthropicApiKey();

    if (!googleKey) {
      const isDev = process.env.NODE_ENV === "development";
      if (isDev) {
        return NextResponse.json(
          { error: "GOOGLE_AI_API_KEY missing in vista/.env.local" },
          { status: 503 },
        );
      }
      const missing = buildMissingKeyResponse(
        "/api/interior-design/phased-generate",
        "GOOGLE_AI_API_KEY missing for phased generation",
      );
      return NextResponse.json(missing.body, { status: missing.status });
    }

    if (tokenAction !== "none") {
      const tokenCheck = await checkTokensServer(tokenAction, request.headers);
      if (!tokenCheck.ok) {
        return NextResponse.json(
          { error: tokenCheck.message, balance: tokenCheck.balance, required: tokenCheck.required },
          { status: tokenCheck.status },
        );
      }
    }

    let roomAnalysis: RoomAnalysis | null = null;
    if (roomAnalysisRaw?.trim()) {
      try { roomAnalysis = normalizeRoomAnalysisOpenings(JSON.parse(roomAnalysisRaw)); } catch { /* ignore */ }
    }

    let roomGeometry: RoomGeometry | null = null;
    if (roomGeometryRaw?.trim()) {
      try { roomGeometry = JSON.parse(roomGeometryRaw) as RoomGeometry; } catch { /* ignore */ }
    }

    const previousPhaseProducts: string[] = (() => {
      if (!previousPhaseProductsRaw) return [];
      try { return JSON.parse(previousPhaseProductsRaw); } catch { return []; }
    })();

    const styleEntry = DESIGN_STYLES.find((s) => s.id === styleId);
    const designStyleLabel = styleEntry?.label ?? styleId;

    // Phased design always uses the scraped catalog: build the allowlist.
    let marketplaceNumericIds = designBoardProductIds;
    const mergedAllowlistIds = await buildQuickDesignScrapedAllowlistIds({
      pinnedProductIds: designBoardProductIds,
      textPrompt,
      roomAnalysis,
      clientCatalogIds: clientCatalogAllowlistIds,
    });
    if (mergedAllowlistIds.length > 0) {
      marketplaceNumericIds = mergedAllowlistIds;
    }

    const effectiveRoomType = normalizeRoomTypeValue(roomAnalysis?.room_type || "living room");

    // Resolve the base input image.
    let baseImage: { base64: string; mimeType: string } | null = null;
    const roomImageOpts = { maxEdge: ROOM_IMAGE_MAX_EDGE, quality: ROOM_IMAGE_QUALITY };
    if (designPhase !== "base" && previousPhaseImage) {
      const bytes = await previousPhaseImage.arrayBuffer();
      baseImage = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes), roomImageOpts);
    } else if (roomImage) {
      const bytes = await roomImage.arrayBuffer();
      baseImage = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes), roomImageOpts);
    } else {
      return NextResponse.json({ error: "Room image is required." }, { status: 400 });
    }

    timer.mark("inputs_ready", {
      productUploadCount: inspirationItems.length,
      styleInspirationParts: styleInspirationParts.length,
    });

    const result = await generatePhasedRoom({
      phase: designPhase,
      baseImage,
      styleId,
      designStyleLabel,
      textPrompt,
      roomType: effectiveRoomType,
      roomAnalysis,
      roomGeometry,
      brief: null,
      marketplaceNumericIds,
      pinnedProductIds: designBoardProductIds,
      previousPhaseProducts,
      inspirationItems,
      styleInspirationParts,
      googleKey,
      anthropicKey: anthropicKey || undefined,
      doorDesign,
    });

    timer.mark("engine_done", {
      ok: result.ok,
      selectedCount: result.selectedCatalogIds.length,
      confirmedCount: result.confirmedCatalogIds.length,
      missingCount: result.missingCatalogIds.length,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? PUBLIC_AI_GENERIC_ERROR }, { status: result.status ?? 500 });
    }

    let balance: number | undefined;
    if (tokenAction !== "none") {
      const tokenGate = await consumeTokensServer(tokenAction, request.headers);
      if (!tokenGate.ok) {
        return NextResponse.json(
          { error: tokenGate.message, balance: tokenGate.balance, required: tokenGate.required },
          { status: tokenGate.status },
        );
      }
      balance = tokenGate.balance;
    }

    const sessionId = `phased-${designPhase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return NextResponse.json({
      balance,
      data: {
        sessionId,
        designPhase,
        selectedCatalogIds: result.selectedCatalogIds,
        confirmedCatalogIds: result.confirmedCatalogIds,
        missingCatalogIds: result.missingCatalogIds,
        previousPhaseProducts,
        allPhaseProductIds: result.allPhaseProductIds,
        imaginedSlots: result.imaginedSlots,
        slotNotices: result.slotNotices,
        images: result.images.map((img, i) => ({
          id: `${sessionId}-img-${i}`,
          base64: img.base64,
          mimeType: img.mimeType,
        })),
        productLinks: result.productLinks,
      },
      adminSlug,
      debug: timer.finish(`phased_${designPhase}`, { ok: true }),
      ...(isDevSpendEnabled() ? { spend: buildSpendResponse() } : {}),
    });
  } catch (error: unknown) {
    console.error("Vista phased interior design error:", error);
    if (isOverloadedAiError(error)) {
      reportOverloadedIncident("/api/interior-design/phased-generate");
      return NextResponse.json(
        { error: "The service is temporarily overloaded. Please wait a moment and try again." },
        { status: 503 },
      );
    }
    const incident = await buildAiIncidentResponse(error, {
      route: "/api/interior-design/phased-generate",
    });
    return NextResponse.json(incident.body, { status: incident.status });
  }
}
