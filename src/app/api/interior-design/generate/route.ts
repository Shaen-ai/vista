import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  DESIGN_STYLES,
  buildCreativeDirectorPrompt,
  normalizeParsedDesignBrief,
  normalizeRoomAnalysisOpenings,
  type DesignStyleId,
  type RoomAnalysis,
  type DesignBrief,
} from "@/lib/interiorDesignPrompts";
import { annotateOpenings } from "@/lib/annotateOpenings";
import { DEFAULT_QUICK_ROOM_PROMPT } from "@/lib/quickRoomDefaultPrompt";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import {
  buildConsumerDesignCatalogContext,
  buildGeminiMerchantFurnitureCatalogBlock,
  fetchMarketplaceProductsAsCatalog,
  type CatalogItemSummary,
} from "@/lib/consumerCatalog";
import { buildGeminiProductVisualParts } from "@/lib/buildGeminiProductVisualParts";
import { runWithLogContext } from "@/lib/logSink";
import { withRequestUploadUser } from "@/lib/uploadUserContext";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import { ANTHROPIC_BRIEF_MODEL } from "@/lib/anthropicModels";
import {
  buildQuickDesignScrapedAllowlistIds,
  isArmeniaLocalScrapedExclusive,
  LOCAL_SCRAPED_CATALOG_EMPTY_CODE,
} from "@/lib/scrapedAllowlist";
import { withRetry } from "@/lib/aiRetry";
import { checkTokensServer, consumeTokensServer } from "@/lib/serverVistaTokens";
import { getAnthropicApiKey, getFalKey, getGoogleGenerativeAiApiKey } from "@/lib/serverAiKeys";
import { resolveRenderProvider } from "@/lib/roomImageRenderer";
import { renderRoomRedesign } from "@/lib/falRoomRenderer";
import { buildFalRedesignPrompt } from "@/lib/falPipelinePrompt";
import { acceptRenderWithPlacementRetry, buildFurnitureLabels } from "@/lib/placementBoxes";
import { buildSpendResponse, isDevSpendEnabled } from "@/lib/aiSpend";
import { normalizeObjectRemovalMask } from "@/lib/normalizeObjectRemovalMask";
import { pipelineLog } from "@/lib/pipelineLog";
import { PUBLIC_AI_SERVICE_UNAVAILABLE } from "@/lib/tunzoneAi";
import {
  buildAiIncidentResponse,
  buildMissingKeyResponse,
  isOverloadedAiError,
  reportOverloadedIncident,
} from "@/lib/aiIncident";
import {
  collectAnthropicTextBlocks,
  parseDesignBriefJsonFromAssistantText,
} from "@/lib/creativeDirectorJson";
import {
  dedupeSingletonCatalogIds,
  orderIdsForGemini,
} from "@/lib/placementPlan";
import { resolveProductIntentsToIds } from "@/lib/resolveProductIntents";
import {
  excludeSlotsCoveredByUploads,
  getRoomSlotTemplate,
  mergeRoomSlots,
} from "@/lib/roomSlotTemplates";
import {
  buildDesignIntentFromBrief,
  constraintsFromRoomAndStyle,
  filterSlotsForRoomType,
  rejectFamilyMismatchIds,
  resolveCatalogSlots,
  vectorConfirmedCatalogIds,
  type ResolvedCatalogSlot,
} from "@/lib/resolveCatalogSlots";
import { buildVisionCandidateMpKeys } from "@/lib/identifyRenderProducts";
import {
  summarizeCatalogIds,
  summarizeResolvedSlots,
  traceCatalogPipeline,
  ProductFunnelTracer,
} from "@/lib/catalogTrace";
import { StepTimer } from "@/lib/generationDebug";
import { optimizeImageBufferForAi } from "@/lib/optimizeImageForAi";
import { verifyProductAvailability } from "@/lib/verifyProductAvailability";
import { orderMerchantBlockIds } from "./_lib/merchantBlock";
import { renderWithEmptyRetry, runRenderVision } from "./_lib/renderPipeline";
import { runQuickRoomRenderPhase } from "./_lib/renderPhaseCore";
import { generateGeminiInteriorImage } from "./_lib/geminiRender";
import { buildRenderProductLinks, extractFlooringSlotIds } from "./_lib/productLinks";
import { type InteriorRenderSession } from "./_lib/renderSession";
import {
  parseDesignBoardProductIds,
  parseInspirationProducts,
  parseNumericIdListFromForm,
  parseObjectRemovalMaskFromForm,
  parseQuickRoomPlacementMode,
  parseStructuralLineMapFromForm,
  parseStyleInspirationImages,
} from "./_lib/formParsers";
import {
  buildSyntheticQuickRoomAnalysis,
  resolveQuickRoomType,
} from "@/lib/quickRoom/syntheticRoomAnalysis";
import { resolveQuickRenderModel } from "@/lib/quickRoom/quickRenderModel";
import { buildQuickRoomRenderSession } from "@/lib/quickRoom/quickRoomStubBrief";
import {
  isQuickRoomGalleryEditRequest,
  parseHasEditAnnotationFlag,
} from "@/lib/quickRoom/quickRoomGalleryEditEligibility";
import {
  parsePriorDesignBriefFromForm,
  stubGalleryEditBrief,
} from "@/lib/quickRoom/galleryEditBrief";
import { extractStyleInspirationBrief } from "@/lib/quickRoom/extractStyleInspirationBrief";
import { buildStyleInspirationPromptBlock } from "@/lib/quickRoom/quickEditPrompt";

export const maxDuration = 180;

const CLAUDE_CATALOG_ROWS_EXCLUSIVE = 36;

function normalizeSkuKey(raw: string): string | null {
  const s = String(raw).trim();
  const m = /^mp-(\d+)$/i.exec(s);
  if (m) return `mp-${m[1]}`;
  if (/^\d+$/.test(s)) return `mp-${s}`;
  return null;
}

export function POST(request: NextRequest) {
  // Key all quick-room pipeline logs to one file for this request so the full,
  // untruncated transcript can be read back from `.vista-logs/`.
  const logId = `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return runWithLogContext(logId, () =>
    withRequestUploadUser(request, () => handleQuickRoomPost(request)),
  );
}

async function handleQuickRoomPost(request: NextRequest) {
  const timer = new StepTimer();
  try {
    const formData = await request.formData();
    const phase = String(formData.get("phase") ?? "full").trim();
    timer.mark("parse_request", { phase });

    // The render phase lives in _lib/renderPhaseCore.ts so the SSE stream
    // route can share it. Delegate before any brief/full parsing work.
    if (phase === "render") {
      const result = await runQuickRoomRenderPhase({
        formData,
        headers: request.headers,
        timer,
      });
      return NextResponse.json(result.body, { status: result.status });
    }

    const textPrompt =
      ((formData.get("textPrompt") as string) || "").trim() || DEFAULT_QUICK_ROOM_PROMPT;
    const editContext = String(formData.get("editContext") ?? "").trim();
    const styleId = (formData.get("style") as DesignStyleId) || "modern";
    const styleEntry = DESIGN_STYLES.find((s) => s.id === styleId);
    const designStyleLabel = styleEntry?.label ?? styleId;
    const roomImage = formData.get("roomImage") as File | null;
    const extraRoomImages = formData.getAll("extraRoomImages") as File[];
    const roomAnalysisRaw = formData.get("roomAnalysis") as string | null;
    const formRoomType = String(formData.get("roomType") ?? "").trim();
    const adminSlug =
      ((formData.get("adminSlug") as string) || "").trim() ||
      (process.env.INTERIOR_DESIGN_ADMIN_SLUG || "").trim() ||
      (process.env.NEXT_PUBLIC_INTERIOR_ADMIN_SLUG || "").trim() ||
      "demo";
    const countryCode = String(formData.get("countryCode") ?? "").trim();
    const searchMode = String(formData.get("searchMode") ?? "").trim();
    const quickRoomModeRaw = String(formData.get("quickRoomMode") ?? "").trim();
    const quickRoomMode = quickRoomModeRaw === "true" || quickRoomModeRaw === "1";
    // "custom" (default) = free imaginary render with NO catalog tie (no product
    // matching, no product cards). "made" keeps the existing real-catalog behavior.
    const isCustomMode = String(formData.get("designMode") ?? "custom").trim() === "custom";
    const placementMode = parseQuickRoomPlacementMode(formData.get("placementMode"));
    const isPlaceOnly = placementMode === "placeOnly";
    const localModeRequested = isArmeniaLocalScrapedExclusive(countryCode, searchMode);
    const dbExclusiveRequested = !isCustomMode && (localModeRequested || quickRoomMode);

    const designBoardProductIds = parseDesignBoardProductIds(formData);
    const clientCatalogAllowlistIds = parseNumericIdListFromForm(formData, "catalogAllowlistIds");
    const inspirationItems = await parseInspirationProducts(formData);
    const styleInspirations = await parseStyleInspirationImages(formData);
    timer.mark("inspiration_products", {
      count: inspirationItems.length,
      styleInspirationCount: styleInspirations.length,
    });

    const tokenActionRaw = String(formData.get("tokenAction") ?? "generate").trim();
    const tokenAction =
      tokenActionRaw === "regenerate" || tokenActionRaw === "edit" ? tokenActionRaw : "generate";

    const keepRoomShapeRaw = formData.get("keepRoomShape");
    const keepRoomShape =
      typeof keepRoomShapeRaw === "string" && keepRoomShapeRaw.trim() === "true";

    const quickRoomGalleryEditRaw = String(formData.get("quickRoomGalleryEdit") ?? "").trim();
    const editFeedback = String(formData.get("editFeedback") ?? "").trim();
    const hasEditAnnotation = parseHasEditAnnotationFlag(formData.get("hasEditAnnotation"));
    const isGalleryEdit = isQuickRoomGalleryEditRequest({
      quickRoomGalleryEditRaw,
      tokenAction,
      editFeedback,
      hasRoomImage: !!roomImage,
    });

    const tokenCheck = await checkTokensServer(tokenAction, request.headers);
    timer.mark("token_check", { ok: tokenCheck.ok });
    if (!tokenCheck.ok) {
      return NextResponse.json(
        {
          error: tokenCheck.message,
          balance: tokenCheck.balance,
          required: tokenCheck.required,
          debug: timer.finish(phase === "brief" ? "brief" : "full", { ok: false }),
        },
        { status: tokenCheck.status },
      );
    }

    if (phase === "brief" && isCustomMode && !isGalleryEdit) {
      timer.mark("stub_brief", { customMode: true });
      return NextResponse.json({
        data: { renderSession: buildQuickRoomRenderSession(formData) },
        debug: timer.finish("brief", { ok: true, stub: true, customMode: true }),
      });
    }

    if (isGalleryEdit && phase === "brief") {
      if (!getFalKey()) {
        return NextResponse.json(
          {
            error: "Gallery edit requires FAL render. Configure FAL_KEY or use a different edit path.",
            debug: timer.finish("brief", { ok: false, galleryEdit: true }),
          },
          { status: 503 },
        );
      }
      const priorBrief = parsePriorDesignBriefFromForm(formData.get("priorDesignBrief"));
      const brief = stubGalleryEditBrief(priorBrief);
      timer.mark("gallery_edit_brief", { editFeedbackChars: editFeedback.length, hasEditAnnotation });
      return NextResponse.json({
        data: {
          renderSession: {
            brief,
            selectedForGemini: [],
            plannedCatalogIds: [],
            scrapedInventoryExclusive: false,
            designBoardProductIds,
            adminSlug,
            designStyleLabel,
            isCustomMode,
            placementMode,
            renderEngine: resolveQuickRenderModel(),
            renderMode: "gallery-edit",
            editFeedback,
            hasEditAnnotation,
          } satisfies InteriorRenderSession,
        },
        debug: timer.finish("brief", {
          ok: true,
          galleryEdit: true,
          hasEditAnnotation,
        }),
      });
    }

    const anthropicKey = getAnthropicApiKey();
    const googleKey = getGoogleGenerativeAiApiKey();

    const roomGeometryRaw = formData.get("roomGeometry") as string | null;
    const geometryExtractionFailedRaw = formData.get("geometryExtractionFailed");
    const geometryExtractionFailed =
      typeof geometryExtractionFailedRaw === "string" &&
      geometryExtractionFailedRaw.trim() === "true";

    const structuralLineMap = parseStructuralLineMapFromForm(formData);

    let roomAnalysis: RoomAnalysis | null = null;
    if (roomAnalysisRaw?.trim()) {
      try {
        roomAnalysis = normalizeRoomAnalysisOpenings(JSON.parse(roomAnalysisRaw) as unknown);
      } catch { /* ignore */ }
    } else if (formRoomType) {
      roomAnalysis = buildSyntheticQuickRoomAnalysis(formRoomType);
    }

    let roomGeometry: RoomGeometry | null = null;
    if (roomGeometryRaw?.trim()) {
      try {
        roomGeometry = JSON.parse(roomGeometryRaw) as RoomGeometry;
      } catch {
        console.warn("Vista interior design generate: invalid roomGeometry JSON, ignoring.");
      }
    }

    const styleDef = styleEntry ?? DESIGN_STYLES[0];

    let marketplaceNumericIds = designBoardProductIds;
    // The render phase resolves products from the saved renderSession, so the
    // allowlist build (a backend round-trip) is only needed for brief/full.
    if (phase !== "render" && dbExclusiveRequested) {
      const mergedAllowlistIds = await buildQuickDesignScrapedAllowlistIds({
        pinnedProductIds: designBoardProductIds,
        textPrompt,
        roomAnalysis,
        clientCatalogIds: clientCatalogAllowlistIds,
      });
      if (mergedAllowlistIds.length > 0) {
        marketplaceNumericIds = mergedAllowlistIds;
      }
    }

    if (!anthropicKey || !googleKey) {
      const isDev = process.env.NODE_ENV === "development";
      if (isDev) {
        return NextResponse.json({ error: PUBLIC_AI_SERVICE_UNAVAILABLE }, { status: 503 });
      }
      const missing = buildMissingKeyResponse(
        "/api/interior-design/generate",
        "Design service keys missing",
      );
      return NextResponse.json(missing.body, { status: missing.status });
    }

    if (roomGeometry?.confidence === "low") {
      console.warn("[roomGeometry] Low confidence — continuing generation.");
    }

    // Custom mode renders freely with no catalog — build an empty context (no SKUs)
    // and skip all product matching below.
    let catalogCtx = await buildConsumerDesignCatalogContext({
      marketplaceProductIds: isCustomMode ? [] : marketplaceNumericIds,
      textPrompt,
      roomAnalysis,
      scrapedInventoryExclusive: false,
      pinnedProductCount: isCustomMode ? 0 : designBoardProductIds.length,
    });

    let scrapedInventoryExclusive = false;
    if (dbExclusiveRequested && catalogCtx.summaryById.size > 0) {
      scrapedInventoryExclusive = true;
      catalogCtx = await buildConsumerDesignCatalogContext({
        marketplaceProductIds: marketplaceNumericIds,
        textPrompt,
        roomAnalysis,
        scrapedInventoryExclusive: true,
        maxRowsForPrompt: CLAUDE_CATALOG_ROWS_EXCLUSIVE,
        pinnedProductCount: designBoardProductIds.length,
      });
    } else if (dbExclusiveRequested) {
      marketplaceNumericIds = designBoardProductIds;
      catalogCtx = await buildConsumerDesignCatalogContext({
        marketplaceProductIds: marketplaceNumericIds,
        textPrompt,
        roomAnalysis,
        scrapedInventoryExclusive: false,
        pinnedProductCount: designBoardProductIds.length,
      });
    }
    timer.mark("catalog_context", {
      quickRoomMode,
      localModeRequested,
      dbExclusiveRequested,
      scrapedInventoryExclusive,
      catalogRows: catalogCtx.summaryById.size,
      vectorCatalog: scrapedInventoryExclusive,
    });

    if (!isCustomMode && quickRoomMode && !scrapedInventoryExclusive) {
      return NextResponse.json(
        {
          error:
            "No products available in our catalog for this design. Try adjusting your request or pin specific products.",
          code: LOCAL_SCRAPED_CATALOG_EMPTY_CODE,
          debug: timer.finish(phase === "brief" ? "brief" : "full", { ok: false }),
        },
        { status: 422 },
      );
    }

    // Not a separate toggle: vector-catalog resolution is used exactly when the request
    // runs in Armenia local scraped-exclusive mode (the only mode users actually hit).
    const useVectorCatalog = scrapedInventoryExclusive;

    const pinnedDirectorBlock = await (async () => {
      const missingPinIds = designBoardProductIds.filter(
        (id) => !catalogCtx.summaryById.has(`mp-${id}`),
      );
      if (missingPinIds.length > 0) {
        const pinRows = await fetchMarketplaceProductsAsCatalog(missingPinIds);
        for (const row of pinRows) {
          catalogCtx.summaryById.set(row.id, row);
        }
      }
      const rows: CatalogItemSummary[] = [];
      for (const numericId of designBoardProductIds) {
        const row = catalogCtx.summaryById.get(`mp-${numericId}`);
        if (row) rows.push(row);
        if (rows.length >= 12) break;
      }
      if (rows.length === 0) return "";
      const lines = rows
        .map((r) => `- "${r.name}" [${r.id}] (${r.category}, ${r.width_cm}×${r.depth_cm}×${r.height_cm} cm)`)
        .join("\n");
      return `\nUSER-PINNED CATALOG PRODUCTS — the user explicitly picked these from our store. They MUST appear in the design. Use their NAMES verbatim in "subject", "arrangement", and "fullPrompt", and include every one of these mp-* ids in "selected_catalog_ids":\n${lines}\n`;
    })();

    const merchantCatalogDirectorBlock = useVectorCatalog
      ? pinnedDirectorBlock
      : [
          catalogCtx.coverageInstructions,
          catalogCtx.catalogTextForClaude
            ? `${catalogCtx.catalogTextForClaude}

STRUCTURED FIELD CONSTRAINT: Populate "product_intents" where helpful. Populate "selected_catalog_ids" with ONLY catalog ids for SKUs that will visibly appear (do not list unused SKUs). NEVER add furniture, lighting fixtures, appliances, or major decor objects that are not in the catalog above — if a needed item type is missing from the catalog, leave that space EMPTY. Post-render list is vision-verified.`
            : "",
          pinnedDirectorBlock,
        ]
          .filter(Boolean)
          .join("\n\n");

    const claudeClient = new Anthropic({ apiKey: anthropicKey });
    const directorPrompt = buildCreativeDirectorPrompt(
      textPrompt,
      styleId,
      roomAnalysis,
      editContext || undefined,
      !!roomImage,
      isCustomMode ? undefined : merchantCatalogDirectorBlock || undefined,
      {
        vectorCatalogMode: isCustomMode ? false : useVectorCatalog,
        freeRender: isCustomMode,
        inspirationImageCount: inspirationItems.length,
        styleInspirationCount: isPlaceOnly ? 0 : styleInspirations.length,
        placementMode,
      },
    );

    type ClaudeContentBlock =
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      | { type: "text"; text: string };
    const claudeContent: ClaudeContentBlock[] = [];
    // The room photo goes to Claude too — a brief written blind invents camera
    // angle/layout text that later fights the edit renderer's geometry lock.
    if (roomImage) {
      try {
        const optimizedRoom = await optimizeImageBufferForAi(
          Buffer.from(await roomImage.arrayBuffer()),
        );
        claudeContent.push({
          type: "image",
          source: {
            type: "base64",
            media_type: optimizedRoom.mimeType,
            data: optimizedRoom.base64,
          },
        });
        claudeContent.push({
          type: "text",
          text: "[Room photo — the actual room being redesigned. Ground camera_angle, arrangement, and every design choice in THIS room; never invent architecture it does not show.]",
        });
      } catch (roomImgErr) {
        console.warn("Vista design brief: room photo attach failed, continuing without it:", roomImgErr);
      }
    }
    for (let i = 0; i < inspirationItems.length; i++) {
      const item = inspirationItems[i]!;
      claudeContent.push({
        type: "image",
        source: { type: "base64", media_type: item.mimeType, data: item.base64 },
      });
      claudeContent.push({
        type: "text",
        text: `[Uploaded product image ${i + 1}${item.label ? `: "${item.label}"` : ""}]`,
      });
    }
    for (let i = 0; i < (isPlaceOnly ? 0 : styleInspirations.length); i++) {
      const item = styleInspirations[i]!;
      claudeContent.push({
        type: "image",
        source: { type: "base64", media_type: item.mimeType, data: item.base64 },
      });
      claudeContent.push({
        type: "text",
        text: `[Style inspiration image ${i + 1} — replicate this design aesthetic, color palette, and spatial feel using real catalog products]`,
      });
    }
    claudeContent.push({ type: "text", text: directorPrompt });

    logClaudeRequest({
      label: "design-brief",
      model: ANTHROPIC_BRIEF_MODEL,
      maxTokens: scrapedInventoryExclusive ? 6144 : 8192,
      messages: claudeContent as unknown as Anthropic.ContentBlockParam[],
      context: {
        styleId,
        scrapedInventoryExclusive,
        inspirationImageCount: inspirationItems.length,
        styleInspirationCount: styleInspirations.length,
        hasRoomImage: !!roomImage,
      },
    });

    const claudeResponse = await withRetry(
      () =>
        claudeClient.messages.create({
          model: ANTHROPIC_BRIEF_MODEL,
          max_tokens: scrapedInventoryExclusive ? 6144 : 8192,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: [{ role: "user", content: claudeContent as any }],
        }),
      "Design brief",
    );
    timer.mark("claude_brief", {
      stopReason: claudeResponse.stop_reason,
      inputTokens: claudeResponse.usage?.input_tokens,
      outputTokens: claudeResponse.usage?.output_tokens,
      // Prompt-cache telemetry: cacheRead > 0 means a cached prefix was hit.
      // If these stay 0 across back-to-back requests, no prefix is being cached.
      cacheCreationInputTokens: claudeResponse.usage?.cache_creation_input_tokens,
      cacheReadInputTokens: claudeResponse.usage?.cache_read_input_tokens,
    });

    if (claudeResponse.stop_reason === "max_tokens") {
      console.warn(
        "Vista interior design generate: design brief response hit max_tokens; JSON may be truncated.",
      );
    }

    const assistantPlainText = collectAnthropicTextBlocks(claudeResponse.content);
    if (!assistantPlainText) {
      return NextResponse.json(
        {
          error: "Design brief step returned no response.",
          debug: timer.finish(phase === "brief" ? "brief" : "full", { ok: false }),
        },
        { status: 500 },
      );
    }

    let brief: DesignBrief;
    try {
      const parsedJson = parseDesignBriefJsonFromAssistantText(assistantPlainText);
      brief = normalizeParsedDesignBrief(parsedJson);
      logClaudeResponse({
        label: "design-brief",
        response: claudeResponse,
        rawText: assistantPlainText,
        parsed: brief,
      });
      timer.mark("parse_brief_json", { ok: true });
    } catch (parseErr: unknown) {
      const detail = parseErr instanceof Error ? parseErr.message : String(parseErr);
      timer.mark("parse_brief_json", { ok: false, detail });
      console.error("Vista interior design generate: failed to parse design brief payload:", detail);
      const isDev = process.env.NODE_ENV === "development";
      const userMsg = /HTML instead of JSON|proxy or API error page/i.test(detail)
        ? "Design brief step received an invalid response. Check Anthropic API keys and connectivity."
        : isDev
          ? `Failed to parse design brief: ${detail}`
          : "Failed to parse design brief.";
      return NextResponse.json(
        { error: userMsg, debug: timer.finish(phase === "brief" ? "brief" : "full", { ok: false }) },
        { status: 500 },
      );
    }

    let resolvedNumericIds: number[] = [];
    let vectorResolvedSlots: ResolvedCatalogSlot[] = [];
    const briefFunnel = new ProductFunnelTracer("brief");

    const effectiveRoomType = resolveQuickRoomType(formRoomType || null, roomAnalysis);
    const windowCountForSlots = roomAnalysisRaw?.trim() ? roomAnalysis?.window_count : undefined;

    // Uploaded product photos are placed in the render directly (via
    // buildGeminiProductVisualParts userUploads) — they are never matched to
    // catalog look-alikes. Their categories are excluded from slot resolution
    // so the catalog does not supply a competing item.
    const uploadSlotDefs = brief.productDescriptions.map((pd) => ({
      family: pd.family || "furniture",
      subtype: pd.subtype !== "other" ? pd.subtype : undefined,
      quantity: 1,
      placement: undefined as string | undefined,
    }));
    const claudeExtras =
      brief.requiredSlots.length > 0
        ? brief.requiredSlots
        : (brief.productIntents ?? []).map((i) => ({
            family: i.family,
            subtype: i.subtype !== "other" ? i.subtype : undefined,
            quantity: i.quantity,
            placement: i.placement,
          }));
    const catalogResolutionSlots = excludeSlotsCoveredByUploads(
      filterSlotsForRoomType(
        mergeRoomSlots({
          template: getRoomSlotTemplate(effectiveRoomType, windowCountForSlots),
          extras: claudeExtras,
        }),
        effectiveRoomType,
      ),
      inspirationItems.length > 0 ? uploadSlotDefs : [],
    );

    if (isPlaceOnly) {
      if (designBoardProductIds.length > 0) {
        const pinRows = await fetchMarketplaceProductsAsCatalog(designBoardProductIds);
        for (const row of pinRows) {
          catalogCtx.summaryById.set(row.id, row);
        }
        resolvedNumericIds = designBoardProductIds.filter((id) =>
          catalogCtx.summaryById.has(`mp-${id}`),
        );
      }
      timer.mark("resolve_catalog", {
        useVectorCatalog: false,
        placementMode,
        resolvedCount: resolvedNumericIds.length,
        slotCount: 0,
        failedSlotCount: 0,
        perSlot: [],
      });
    } else if (useVectorCatalog) {
      const designIntent =
        brief.designIntent.trim() ||
        buildDesignIntentFromBrief({
          userRequest: textPrompt,
          style: brief.style,
          subject: brief.subject,
          arrangement: brief.arrangement,
          context: brief.context,
          styleKeywords: styleDef.keywords,
        });

      const resolvedSlots = catalogResolutionSlots;

      const mergedConstraints = {
        ...constraintsFromRoomAndStyle(roomAnalysis, styleDef.keywords),
        ...brief.constraints,
      };

      const vectorResolved = await resolveCatalogSlots({
        designIntent,
        slots: resolvedSlots,
        pinnedProductIds: designBoardProductIds,
        roomAnalysis,
        constraints: mergedConstraints,
        roomType: effectiveRoomType,
      });

      if (vectorResolved.metrics) {
        console.info("catalog.resolve_slots.metrics", vectorResolved.metrics);
      }

      traceCatalogPipeline("1_backend_slots", {
        phase,
        metrics: vectorResolved.metrics,
        apiIds: vectorResolved.ids,
        slots: summarizeResolvedSlots(vectorResolved.slots),
      });

      resolvedNumericIds = vectorConfirmedCatalogIds({
        slots: vectorResolved.slots,
        pinnedProductIds: designBoardProductIds,
        apiIds: vectorResolved.ids,
      });
      vectorResolvedSlots = vectorResolved.slots;

      const mpKeysFromConfirmed = resolvedNumericIds.map((n) => `mp-${n}`);
      traceCatalogPipeline("2_vector_confirmed", {
        phase,
        numericIds: resolvedNumericIds,
        mpKeys: mpKeysFromConfirmed,
      });

      const failedSlotCount = vectorResolved.slots.filter((s) => !s.product_ids?.length).length;
      if (failedSlotCount > 0) {
        console.warn("catalog.resolve_slots: skipping unverified slots for render plan", {
          failedSlotCount,
          confirmedCount: resolvedNumericIds.length,
        });
      }

      let extraRowsLoaded = 0;
      if (resolvedNumericIds.length > 0) {
        const extraRows = await fetchMarketplaceProductsAsCatalog(resolvedNumericIds);
        extraRowsLoaded = extraRows.length;
        for (const row of extraRows) {
          catalogCtx.summaryById.set(row.id, row);
        }
        // Remove products whose catalog family conflicts with the slot they came from
        // (e.g. a bed resolved for a lighting/pendant slot, kitchen items for furniture slots)
        resolvedNumericIds = rejectFamilyMismatchIds({
          resolvedIds: resolvedNumericIds,
          slots: vectorResolved.slots,
          catalogById: catalogCtx.summaryById,
        });
      }

      briefFunnel.snapshot("qdrant_resolved", resolvedNumericIds.map((n) => `mp-${n}`));

      traceCatalogPipeline("3_catalog_rows_loaded", {
        phase,
        requested: resolvedNumericIds.length,
        loaded: extraRowsLoaded,
        loadedIds: [...catalogCtx.summaryById.keys()],
        missing: mpKeysFromConfirmed.filter((k) => !catalogCtx.summaryById.has(k)),
      });
    } else if (!isCustomMode) {
      const resolvedFromIntents = await resolveProductIntentsToIds({
        intents: brief.productIntents ?? [],
        pinnedProductIds: designBoardProductIds,
        perIntentLimit: 3,
      });
      resolvedNumericIds = resolvedFromIntents;
      if (resolvedFromIntents.length > 0) {
        const extraRows = await fetchMarketplaceProductsAsCatalog(resolvedFromIntents);
        for (const row of extraRows) {
          if (!catalogCtx.summaryById.has(row.id)) {
            catalogCtx.summaryById.set(row.id, row);
          }
        }
      }
    }

    if (resolvedNumericIds.length > 0) {
      const pinnedIdSet = new Set(designBoardProductIds);
      const itemsToVerify = resolvedNumericIds
        .filter((n) => !pinnedIdSet.has(n))
        .map((n) => catalogCtx.summaryById.get(`mp-${n}`))
        .filter((row): row is CatalogItemSummary => Boolean(row));
      if (itemsToVerify.length > 0) {
        const { deadIds, checkedCount } = await verifyProductAvailability(itemsToVerify);
        if (deadIds.length > 0) {
          const deadSet = new Set(deadIds);
          resolvedNumericIds = resolvedNumericIds.filter((id) => !deadSet.has(id));
          for (const id of deadIds) {
            catalogCtx.summaryById.delete(`mp-${id}`);
          }
          traceCatalogPipeline("live_url_dead", { deadIds, checkedCount });
        }
        timer.mark("verify_availability", { checkedCount, deadCount: deadIds.length });
      }
    }

    timer.mark("resolve_catalog", {
      useVectorCatalog,
      resolvedCount: resolvedNumericIds.length,
      slotCount: vectorResolvedSlots.length,
      failedSlotCount: vectorResolvedSlots.filter((s) => !s.product_ids?.length).length,
      perSlot: vectorResolvedSlots.map((s) => ({
        slot: `${s.family}/${s.subtype ?? ""}`,
        resolved: s.product_ids?.length ?? 0,
        candidates: s.qdrant_candidates ?? 0,
        dropRate: s.rerank_drop_rate ?? 0,
      })),
    });

    const allowedCatalogKeys = new Set(catalogCtx.summaryById.keys());
    const pinnedMpKeys = designBoardProductIds
      .map((id) => `mp-${id}`)
      .filter((k) => allowedCatalogKeys.has(k));

    let selectedForGemini: string[];
    if (isPlaceOnly) {
      selectedForGemini = [...pinnedMpKeys];
    } else if (useVectorCatalog) {
      selectedForGemini = resolvedNumericIds
        .map((n) => `mp-${n}`)
        .filter((k) => catalogCtx.summaryById.has(k));
    } else {
      const rawSelected = brief.selectedCatalogIds?.length ? brief.selectedCatalogIds : [];
      selectedForGemini = rawSelected
        .map((id) => normalizeSkuKey(id))
        .filter((k): k is string => Boolean(k && allowedCatalogKeys.has(k)));
      for (const n of resolvedNumericIds) {
        const k = `mp-${n}`;
        if (catalogCtx.summaryById.has(k) && !selectedForGemini.includes(k)) {
          selectedForGemini.push(k);
        }
      }
    }

    if (pinnedMpKeys.length > 0) {
      const merged = new Set([...pinnedMpKeys, ...selectedForGemini]);
      selectedForGemini = [...merged];
    }
    briefFunnel.snapshot("pins_merged", selectedForGemini);

    traceCatalogPipeline("4_selected_before_order_dedupe", {
      phase,
      count: selectedForGemini.length,
      ids: summarizeCatalogIds(selectedForGemini, catalogCtx.summaryById),
    });

    selectedForGemini = orderIdsForGemini({
      pinnedMpKeys,
      briefSelectedIds: selectedForGemini,
      catalogById: catalogCtx.summaryById,
    });

    traceCatalogPipeline("5_selected_after_order_before_dedupe", {
      phase,
      count: selectedForGemini.length,
      ids: summarizeCatalogIds(selectedForGemini, catalogCtx.summaryById),
    });

    selectedForGemini = dedupeSingletonCatalogIds(
      selectedForGemini,
      catalogCtx.summaryById,
      brief.fullPrompt,
      isPlaceOnly ? [] : catalogResolutionSlots,
      new Set(pinnedMpKeys),
    );

    traceCatalogPipeline("6_selected_after_dedupe", {
      phase,
      count: selectedForGemini.length,
      ids: summarizeCatalogIds(selectedForGemini, catalogCtx.summaryById),
    });
    briefFunnel.snapshot("selected_for_gemini", selectedForGemini);
    briefFunnel.audit(selectedForGemini, catalogCtx.summaryById, "brief");

    const plannedCatalogIds = buildVisionCandidateMpKeys({
      briefSelectedIds: selectedForGemini,
      pinnedMpKeys,
      allowedCatalogKeys: new Set(catalogCtx.summaryById.keys()),
    });

    if (!isPlaceOnly && !isCustomMode && useVectorCatalog && scrapedInventoryExclusive && selectedForGemini.length === 0) {
      return NextResponse.json(
        {
          error:
            "Could not match catalog products for this design. Try adjusting your request or pin specific products.",
          debug: timer.finish(phase === "brief" ? "brief" : "full", { ok: false }),
        },
        { status: 422 },
      );
    }

    if (phase === "brief") {
      return NextResponse.json({
        data: {
          renderSession: {
            brief,
            selectedForGemini,
            plannedCatalogIds,
            scrapedInventoryExclusive,
            designBoardProductIds,
            adminSlug,
            designStyleLabel,
            isCustomMode,
            placementMode,
            renderEngine: resolveQuickRenderModel(),
          } satisfies InteriorRenderSession,
        },
        debug: timer.finish("brief", {
          ok: true,
          selectedCatalogCount: selectedForGemini.length,
          scrapedInventoryExclusive,
          quickRoomMode,
          dbExclusiveRequested,
        }),
      });
    }

    let referenceBase64: string | undefined;
    let referenceImageMimeType: string | undefined;
    let roomImageBytes: ArrayBuffer | undefined;
    if (roomImage) {
      roomImageBytes = await roomImage.arrayBuffer();
    }
    const extraRoomImageBytes = await Promise.all(extraRoomImages.map((f) => f.arrayBuffer()));

    const pinnedMpKeysList = designBoardProductIds
      .map((id) => `mp-${id}`)
      .filter((k) => catalogCtx.summaryById.has(k));

    const visualParts = await buildGeminiProductVisualParts({
      roomImageBytes: roomImageBytes ?? null,
      extraRoomImageBytes,
      userUploads: inspirationItems.map((item) => ({
        base64: item.base64,
        mimeType: item.mimeType,
        label: item.label,
      })),
      selectedCatalogIds: selectedForGemini,
      pinnedMpKeys: pinnedMpKeysList,
      catalogById: catalogCtx.summaryById,
    });
    timer.mark("visual_parts", visualParts.stats as unknown as Record<string, unknown>);

    if (visualParts.roomInline) {
      referenceBase64 = visualParts.roomInline.data;
      referenceImageMimeType = visualParts.roomInline.mimeType;
    }

    // Annotated opening-marker guide (B grounding) — built once, reused across retries.
    const openingGuideInline = referenceBase64
      ? await annotateOpenings(
          referenceBase64,
          referenceImageMimeType || "image/jpeg",
          roomAnalysis?.window_boxes,
          roomAnalysis?.door_boxes,
        )
      : null;

    console.info("gemini.visual_payload", { ...visualParts.stats, traceTag: "[gemini-product-images]" });

    briefFunnel.snapshot("collage_included_pins", visualParts.includedPinnedIds);
    if (visualParts.pinFetchFailedIds.length > 0) {
      traceCatalogPipeline("pin_fetch_failed", {
        phase,
        pinFetchFailedIds: visualParts.pinFetchFailedIds,
      });
    }

    // Build merchant block AFTER the collage budget so the text only names SKUs
    // that have a visual reference — prevents Gemini from "selecting" items it
    // has no image for. Pinned ids that lost their image are still listed (so
    // Gemini knows to include them) but marked text-only via the cell map.
    const merchantBlockIds =
      catalogCtx.catalogTextForClaude.trim().length === 0
        ? []
        : orderMerchantBlockIds(visualParts.includedCatalogIds, pinnedMpKeysList);

    const geminiMerchantAppendix =
      merchantBlockIds.length === 0
        ? ""
        : buildGeminiMerchantFurnitureCatalogBlock(
            merchantBlockIds,
            catalogCtx.summaryById,
            catalogCtx.coverage,
            {
              armeniaLocalExclusive: scrapedInventoryExclusive,
              cellRefByCatalogId: visualParts.cellRefByCatalogId,
            },
          );

    let styleInspirationText: string | null = null;
    if (!isPlaceOnly && styleInspirations.length > 0) {
      styleInspirationText = await extractStyleInspirationBrief(styleInspirations);
      timer.mark("style_inspiration_extract", {
        imageCount: styleInspirations.length,
        ok: !!styleInspirationText,
        proseChars: styleInspirationText?.length ?? 0,
      });
    }
    const styleInspirationBlock = styleInspirationText
      ? buildStyleInspirationPromptBlock(styleInspirationText)
      : "";

    const useFalMaster = resolveRenderProvider() === "fal" && !!referenceBase64;
    let falRenderSeed: number | undefined;

    const renderOnce = () =>
      generateGeminiInteriorImage({
        fullPromptFallback: brief.fullPrompt,
        googleApiKey: googleKey,
        referenceImageBase64: referenceBase64,
        referenceImageMimeType,
        extraRoomInlines: referenceBase64 ? visualParts.extraRoomInlines : [],
        openingGuideInline: referenceBase64 ? openingGuideInline : null,
        brief: referenceBase64 ? brief : undefined,
        roomAnalysis: referenceBase64 ? roomAnalysis : undefined,
        roomGeometry,
        geometryExtractionFailed,
        designStyleLabel,
        merchantAppendix: geminiMerchantAppendix || undefined,
        productImageParts: visualParts.productImageParts,
        productIntroText: visualParts.productIntroText,
        productCloseText: visualParts.productCloseText,
        scrapedInventoryExclusive,
        keepRoomShape,
        styleInspirationText,
      });

    let images: Array<{ base64: string; mimeType: string }>;
    if (useFalMaster) {
      const objectRemovalMaskRaw = parseObjectRemovalMaskFromForm(formData);
      const normalizedRemovalMask = objectRemovalMaskRaw?.base64
        ? await normalizeObjectRemovalMask({
            maskBase64: objectRemovalMaskRaw.base64,
            originalPhotoBase64: referenceBase64 ?? undefined,
          })
        : null;
      if (normalizedRemovalMask?.base64) {
        pipelineLog("FAL_RENDER", "object removal mask present", {
          maskBytes: Math.round((normalizedRemovalMask.base64.length * 3) / 4),
        });
      }
      const falPrompt = buildFalRedesignPrompt({
        designPrompt: [
          brief.fullPrompt,
          geminiMerchantAppendix?.trim() ? geminiMerchantAppendix.trim().slice(0, 3800) : "",
          styleInspirationBlock,
        ]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 3800),
        styleId,
        styleLabel: designStyleLabel,
        roomAnalysis,
        roomGeometry,
        doorDesign: brief.doorDesign,
        hasStructuralLines: !!structuralLineMap?.base64,
        hasObjectRemovalMask: !!normalizedRemovalMask?.base64,
      });
      timer.mark("fal_master_start", { hasStyleInspirationText: !!styleInspirationText });
      const master = await renderRoomRedesign({
        photoBase64: referenceBase64!,
        photoMime: referenceImageMimeType || "image/jpeg",
        prompt: falPrompt,
        structuralLineMapBase64: structuralLineMap?.base64,
        structuralLineMapMime: structuralLineMap?.mimeType,
        structuralLineStrokeOnly: structuralLineMap?.strokeOnly,
        originalPhotoBase64: referenceBase64!,
        sessionId: `quick-${Date.now()}`,
        label: "quick-room-master",
        angleRole: "master",
      });
      timer.mark("fal_master_done", { seed: master.seed, images: master.images.length });
      if (!master.images[0]) {
        return NextResponse.json(
          {
            error: "Image generation returned no results. Try rephrasing your request.",
            debug: timer.finish("full", { ok: false }),
          },
          { status: 500 },
        );
      }

      const furnitureLabels = buildFurnitureLabels({
        requiredSlots: brief.requiredSlots,
        catalogNames: selectedForGemini
          .map((id) => catalogCtx.summaryById.get(id)?.name)
          .filter((name): name is string => typeof name === "string" && !!name.trim()),
      });

      const falRenderParams = {
        photoBase64: referenceBase64!,
        photoMime: referenceImageMimeType || "image/jpeg",
        structuralLineMapBase64: structuralLineMap?.base64,
        structuralLineMapMime: structuralLineMap?.mimeType,
        structuralLineStrokeOnly: structuralLineMap?.strokeOnly,
        originalPhotoBase64: referenceBase64!,
        sessionId: `quick-${Date.now()}`,
        label: "quick-room-master",
        angleRole: "master" as const,
        seed: master.seed,
      };

      const placementAccepted = await acceptRenderWithPlacementRetry({
        image: master.images[0],
        doorBoxes: roomAnalysis?.door_boxes,
        windowBoxes: roomAnalysis?.window_boxes,
        furnitureLabels,
        label: "quick-room-master",
        retryRender: async (correctiveFeedback) => {
          const retry = await renderRoomRedesign({
            ...falRenderParams,
            prompt: `${falPrompt}\n\n${correctiveFeedback}`,
          });
          return retry.images[0] ?? null;
        },
      });

      images = [placementAccepted.image];
      falRenderSeed = master.seed;
    } else {
      images = await renderWithEmptyRetry(renderOnce, timer);
    }

    if (images.length === 0) {
      return NextResponse.json(
        {
          error: "Image generation returned no results. Try rephrasing your request.",
          debug: timer.finish("full", { ok: false }),
        },
        { status: 500 },
      );
    }

    const visionResult = await runRenderVision({
      images,
      anthropicKey,
      selectedForGemini,
      pinnedMpKeysForVision: pinnedMpKeys,
      collageIncludedIds: visualParts.includedCatalogIds,
      allowedCatalogKeys: new Set(catalogCtx.summaryById.keys()),
      catalogById: catalogCtx.summaryById,
      brief,
      includedPinnedIds: visualParts.includedPinnedIds,
      timer,
      phase,
    });
    images = visionResult.images;
    const finalVisionIds = visionResult.finalVisionIds;

    const sessionId = `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const flooringSlotIds = extractFlooringSlotIds(vectorResolvedSlots, catalogCtx.summaryById);

    const { productLinks: verifiedLinks, usedCatalogIds, source: listSource } = isCustomMode
      ? { productLinks: [] as Awaited<ReturnType<typeof buildRenderProductLinks>>["productLinks"], usedCatalogIds: [] as string[], source: "custom_mode" as const }
      : await buildRenderProductLinks({
          selectedForGemini,
          collageIncludedIds: visualParts.includedCatalogIds,
          textOnlyCatalogIds: visualParts.textOnlyCatalogIds,
          catalogById: catalogCtx.summaryById,
          pinnedMpKeys,
          brief,
          precomputedVisionIds: finalVisionIds ?? undefined,
          finalImageBase64: images[0]?.base64,
          finalImageMimeType: images[0]?.mimeType,
          slots: catalogResolutionSlots,
          tracePhase: phase,
          funnel: briefFunnel,
          flooringSlotIds,
        });
    void listSource;
    const productLinks = verifiedLinks.length > 0 ? verifiedLinks : undefined;
    timer.mark("product_links", {
      count: verifiedLinks.length,
      planCatalogCount: usedCatalogIds.length,
      collageCount: visualParts.includedCatalogIds.length,
      selectedCount: selectedForGemini.length,
    });

    const tokenGate = await consumeTokensServer(tokenAction, request.headers);
    timer.mark("token_consume", { ok: tokenGate.ok });
    if (!tokenGate.ok) {
      return NextResponse.json(
        {
          error: tokenGate.message,
          balance: tokenGate.balance,
          required: tokenGate.required,
          debug: timer.finish("full", { ok: false }),
        },
        { status: tokenGate.status },
      );
    }

    return NextResponse.json({
      balance: tokenGate.balance,
      data: {
        sessionId,
        designBrief: brief,
        scrapedInventoryExclusive,
        selectedCatalogIds: selectedForGemini,
        usedCatalogIds,
        plannedCatalogIds: plannedCatalogIds.length > 0 ? plannedCatalogIds : buildVisionCandidateMpKeys({
          briefSelectedIds: selectedForGemini,
          pinnedMpKeys,
          allowedCatalogKeys: new Set(catalogCtx.summaryById.keys()),
        }),
        images: images.map((img, i) => ({
          id: `${sessionId}-img-${i}`,
          base64: img.base64,
          mimeType: img.mimeType,
          prompt: brief.fullPrompt,
        })),
        ...(roomGeometry ? { roomGeometry } : {}),
        ...(productLinks?.length ? { productLinks } : {}),
        ...(falRenderSeed !== undefined ? { falRenderSeed } : {}),
      },
      adminSlug,
      debug: timer.finish("full", {
        ok: true,
        selectedCatalogCount: selectedForGemini.length,
        scrapedInventoryExclusive,
      }),
      ...(isDevSpendEnabled() ? { spend: buildSpendResponse() } : {}),
    });
  } catch (error: unknown) {
    console.error("Vista interior design generate error:", error);
    const err = error as { message?: string };
    if (isOverloadedAiError(error)) {
      reportOverloadedIncident("/api/interior-design/generate");
      return NextResponse.json(
        {
          error: "The service is temporarily overloaded. Please wait a moment and try again.",
          debug: timer.finish("error", { ok: false, overloaded: true }),
        },
        { status: 503 },
      );
    }
    const incident = await buildAiIncidentResponse(error, { route: "/api/interior-design/generate" });
    return NextResponse.json(
      {
        ...incident.body,
        debug: timer.finish("error", {
          ok: false,
          message: typeof err?.message === "string" ? err.message.slice(0, 300) : undefined,
        }),
      },
      { status: incident.status },
    );
  }
}
