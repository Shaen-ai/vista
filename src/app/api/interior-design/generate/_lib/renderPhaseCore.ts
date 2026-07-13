import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import { DESIGN_STYLES, normalizeRoomAnalysisOpenings, type DesignStyleId } from "@/lib/interiorDesignPrompts";
import { annotateOpenings } from "@/lib/annotateOpenings";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import {
  buildGeminiMerchantFurnitureCatalogBlock,
  fetchMarketplaceProductsAsCatalog,
} from "@/lib/consumerCatalog";
import { buildGeminiProductVisualParts } from "@/lib/buildGeminiProductVisualParts";
import { checkTokensServer, consumeTokensServer } from "@/lib/serverVistaTokens";
import { getAnthropicApiKey, getGoogleGenerativeAiApiKey } from "@/lib/serverAiKeys";
import { buildSpendResponse, isDevSpendEnabled } from "@/lib/aiSpend";
import { PUBLIC_AI_SERVICE_UNAVAILABLE, PUBLIC_AI_UNAVAILABLE } from "@/lib/tunzoneAi";
import type { ProductPurchaseLink } from "@/lib/productPurchaseLinks";
import { buildVisionCandidateMpKeys } from "@/lib/identifyRenderProducts";
import { numericIdsFromMpKeys } from "@/lib/scrapedRoomGeneration";
import { traceCatalogPipeline, ProductFunnelTracer } from "@/lib/catalogTrace";
import type { StepTimer } from "@/lib/generationDebug";
import { debugIngest } from "@/lib/debugIngest";
import { pipelineLog } from "@/lib/pipelineLog";
import { resolveQuickRenderModel } from "@/lib/quickRoom/quickRenderModel";
import { bootstrapQuickRoomReference } from "@/lib/quickRoom/bootstrapReferenceImage";
import { runQuickRoomEditPipeline } from "@/lib/quickRoom/quickEditPipeline";
import { parseShapeCreativityParam } from "@/lib/quickRoom/shapeCreativity";
import { runQuickRoomGalleryEditPipeline } from "@/lib/quickRoom/quickRoomGalleryEdit";
import { optimizeImageBufferForAi } from "@/lib/optimizeImageForAi";
import { orderMerchantBlockIds } from "./merchantBlock";
import { renderWithEmptyRetry, runRenderVision } from "./renderPipeline";
import { generateGeminiInteriorImage } from "./geminiRender";
import { buildRenderProductLinks, extractFlooringSlotIds } from "./productLinks";
import { parseRenderSession } from "./renderSession";
import {
  parseInspirationProducts,
  parseObjectRemovalMaskFromForm,
  parseStructuralLineMapFromForm,
  parseStyleInspirationImages,
} from "./formParsers";

export interface RenderPhaseProgress {
  message: string;
  /** 0..1 across the whole render phase. */
  progress: number;
}

export interface RenderPhaseResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The `phase === "render"` implementation shared by the plain POST route and
 * the SSE stream route. Extracted verbatim from the route handler; the only
 * addition is the edit-pipeline dispatch and the optional progress callback.
 */
export async function runQuickRoomRenderPhase(opts: {
  formData: FormData;
  headers: Headers;
  timer: StepTimer;
  emitProgress?: (ev: RenderPhaseProgress) => void | Promise<void>;
  /** Set when the caller already ran checkTokensServer (SSE pre-check). */
  tokenPrecheckDone?: boolean;
}): Promise<RenderPhaseResult> {
  const { formData, headers, timer, emitProgress } = opts;

  const editContext = String(formData.get("editContext") ?? "").trim();
  const styleId = (formData.get("style") as DesignStyleId) || "modern";
  const roomImage = formData.get("roomImage") as File | null;
  const extraRoomImages = formData.getAll("extraRoomImages") as File[];
  const roomAnalysisRaw = formData.get("roomAnalysis") as string | null;
  const adminSlug =
    ((formData.get("adminSlug") as string) || "").trim() ||
    (process.env.INTERIOR_DESIGN_ADMIN_SLUG || "").trim() ||
    (process.env.NEXT_PUBLIC_INTERIOR_ADMIN_SLUG || "").trim() ||
    "demo";
  const isCustomMode = String(formData.get("designMode") ?? "custom").trim() === "custom";

  const tokenActionRaw = String(formData.get("tokenAction") ?? "generate").trim();
  const tokenAction =
    tokenActionRaw === "regenerate" || tokenActionRaw === "edit" ? tokenActionRaw : "generate";

  const roomGeometryRaw = formData.get("roomGeometry") as string | null;
  const geometryExtractionFailedRaw = formData.get("geometryExtractionFailed");
  const geometryExtractionFailed =
    typeof geometryExtractionFailedRaw === "string" &&
    geometryExtractionFailedRaw.trim() === "true";
  const keepRoomShapeRaw = formData.get("keepRoomShape");
  const keepRoomShape =
    typeof keepRoomShapeRaw === "string" && keepRoomShapeRaw.trim() === "true";

  const structuralLineMap = parseStructuralLineMapFromForm(formData);
  const objectRemovalMask = parseObjectRemovalMaskFromForm(formData);

  let roomAnalysis: RoomAnalysis | null = null;
  if (roomAnalysisRaw?.trim()) {
    try {
      roomAnalysis = normalizeRoomAnalysisOpenings(JSON.parse(roomAnalysisRaw) as unknown);
    } catch { /* ignore */ }
  }

  let roomGeometry: RoomGeometry | null = null;
  if (roomGeometryRaw?.trim()) {
    try {
      roomGeometry = JSON.parse(roomGeometryRaw) as RoomGeometry;
    } catch {
      console.warn("Vista interior design generate: invalid roomGeometry JSON, ignoring.");
    }
  }

  const styleEntry = DESIGN_STYLES.find((s) => s.id === styleId);
  const designStyleLabel = styleEntry?.label ?? styleId;

  const anthropicKey = getAnthropicApiKey();
  const googleKey = getGoogleGenerativeAiApiKey();

  const inspirationItems = await parseInspirationProducts(formData);
  const styleInspirations = await parseStyleInspirationImages(formData);
  timer.mark("inspiration_products", {
    count: inspirationItems.length,
    styleInspirationCount: styleInspirations.length,
  });

  const renderSessionRaw = formData.get("renderSession");
  const roomImageField = formData.get("roomImage");
  const roomImageSize =
    roomImageField &&
    typeof roomImageField === "object" &&
    "size" in roomImageField &&
    typeof (roomImageField as File).size === "number"
      ? (roomImageField as File).size
      : 0;
  debugIngest(
    "generate/route.ts:render_phase_entry",
    "render_request",
    {
      hasRenderSession: typeof renderSessionRaw === "string" && renderSessionRaw.length > 0,
      renderSessionBytes:
        typeof renderSessionRaw === "string" ? renderSessionRaw.length : 0,
      roomImageSize,
    },
    "F",
    "post-fix-v4",
  );

  const renderSession = parseRenderSession(formData.get("renderSession"));
  const isGalleryEditSessionEarly = renderSession?.renderMode === "gallery-edit";

  if (!isGalleryEditSessionEarly && !googleKey) {
    const isDev = process.env.NODE_ENV === "development";
    const msg = isDev ? PUBLIC_AI_SERVICE_UNAVAILABLE : PUBLIC_AI_UNAVAILABLE;
    return { status: 503, body: { error: msg } };
  }

  timer.mark("render_session", {
    ok: Boolean(renderSession?.brief),
    selectedCount: renderSession?.selectedForGemini?.length ?? 0,
    renderMode: renderSession?.renderMode ?? "initial",
  });
  if (!renderSession?.brief) {
    return {
      status: 400,
      body: { error: "Missing or invalid render session.", debug: timer.finish("render", { ok: false }) },
    };
  }

  if (!opts.tokenPrecheckDone) {
    const tokenCheck = await checkTokensServer(tokenAction, headers);
    timer.mark("token_check", { ok: tokenCheck.ok });
    if (!tokenCheck.ok) {
      return {
        status: tokenCheck.status,
        body: {
          error: tokenCheck.message,
          balance: tokenCheck.balance,
          required: tokenCheck.required,
          debug: timer.finish("render", { ok: false }),
        },
      };
    }
  }

  const {
    brief,
    selectedForGemini,
    plannedCatalogIds,
    scrapedInventoryExclusive,
    designBoardProductIds: sessionBoardIds,
    adminSlug: sessionAdminSlug,
    designStyleLabel: sessionStyleLabel,
    placementMode: sessionPlacementMode,
  } = renderSession;

  const isGalleryEdit = renderSession.renderMode === "gallery-edit";

  if (isGalleryEdit) {
    if (resolveQuickRenderModel() !== "edit-pipeline") {
      return {
        status: 503,
        body: {
          error: "Gallery edit requires FAL render. Configure FAL_KEY.",
          debug: timer.finish("render", { ok: false, galleryEdit: true }),
        },
      };
    }
    if (!roomImage) {
      return {
        status: 400,
        body: {
          error: "Approved render image is required for gallery edit.",
          debug: timer.finish("render", { ok: false, galleryEdit: true }),
        },
      };
    }

    const editFeedbackText = renderSession.editFeedback?.trim() || editContext;
    if (!editFeedbackText) {
      return {
        status: 400,
        body: {
          error: "Edit feedback is required.",
          debug: timer.finish("render", { ok: false, galleryEdit: true }),
        },
      };
    }

    const roomBytes = await roomImage.arrayBuffer();
    const optimized = await optimizeImageBufferForAi(Buffer.from(roomBytes));
    timer.mark("gallery_edit_image", { bytes: optimized.byteLength });

    let annotationBase64: string | undefined;
    let annotationMime: string | undefined;
    const editAnnotationImage = formData.get("editAnnotationImage");
    if (
      renderSession.hasEditAnnotation &&
      editAnnotationImage &&
      typeof editAnnotationImage === "object" &&
      "arrayBuffer" in editAnnotationImage
    ) {
      const annOpt = await optimizeImageBufferForAi(
        Buffer.from(await (editAnnotationImage as File).arrayBuffer()),
      );
      annotationBase64 = annOpt.base64;
      annotationMime = annOpt.mimeType;
    }

    const gallerySessionId = `qr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pipelineLog("FAL_RENDER", "quick room gallery edit render phase", {
      editFeedbackChars: editFeedbackText.length,
      hasAnnotation: !!annotationBase64,
    });

    await emitProgress?.({ message: "Applying your edit…", progress: 0.15 });

    const galleryResult = await runQuickRoomGalleryEditPipeline({
      sessionId: gallerySessionId,
      approvedRenderBase64: optimized.base64,
      approvedRenderMime: optimized.mimeType,
      editFeedback: editFeedbackText,
      hasEditAnnotation: renderSession.hasEditAnnotation,
      annotationBase64,
      annotationMime,
      onProgress: emitProgress
        ? async (ev) => {
            await emitProgress({ message: ev.message, progress: 0.1 + ev.progress * 0.8 });
          }
        : undefined,
    });

    timer.mark("gallery_edit_pipeline", { ok: true });

    const tokenGate = await consumeTokensServer(tokenAction, headers);
    timer.mark("token_consume", { ok: tokenGate.ok });
    if (!tokenGate.ok) {
      return {
        status: tokenGate.status,
        body: {
          error: tokenGate.message,
          balance: tokenGate.balance,
          required: tokenGate.required,
          debug: timer.finish("render", { ok: false, galleryEdit: true }),
        },
      };
    }

    const responseSessionId = `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      status: 200,
      body: {
        balance: tokenGate.balance,
        data: {
          sessionId: responseSessionId,
          designBrief: brief,
          scrapedInventoryExclusive,
          selectedCatalogIds: selectedForGemini,
          usedCatalogIds: [],
          plannedCatalogIds: plannedCatalogIds.length > 0 ? plannedCatalogIds : selectedForGemini,
          images: [
            {
              id: `${responseSessionId}-img-0`,
              base64: galleryResult.base64,
              mimeType: galleryResult.mimeType,
              prompt: brief.fullPrompt || editFeedbackText,
            },
          ],
        },
        adminSlug: sessionAdminSlug || adminSlug,
        debug: timer.finish("render", {
          ok: true,
          galleryEdit: true,
          selectedCatalogCount: selectedForGemini.length,
          scrapedInventoryExclusive,
        }),
        ...(isDevSpendEnabled() ? { spend: buildSpendResponse() } : {}),
      },
    };
  }

  const placementMode = sessionPlacementMode ?? "redesign";
  const isPlaceOnly = placementMode === "placeOnly";

  // Prefer the mode captured at brief time; fall back to the recomputed value
  // for sessions minted before isCustomMode was carried in the session.
  const renderIsCustomMode = renderSession.isCustomMode ?? isCustomMode;

  const catalogIdsForFetch = [
    ...new Set([...numericIdsFromMpKeys(selectedForGemini), ...sessionBoardIds]),
  ];
  const catalogRows =
    catalogIdsForFetch.length > 0
      ? await fetchMarketplaceProductsAsCatalog(catalogIdsForFetch)
      : [];
  const catalogById = new Map(catalogRows.map((row) => [row.id, row]));
  const renderFunnel = new ProductFunnelTracer("render");
  renderFunnel.snapshot("render_session_in", selectedForGemini);
  traceCatalogPipeline("10_render_session_in", {
    phase: "render",
    selectedCount: selectedForGemini.length,
    selectedForGemini,
  });
  traceCatalogPipeline("11_render_catalog_refetch", {
    phase: "render",
    requested: catalogIdsForFetch.length,
    loaded: catalogRows.length,
    missing: selectedForGemini.filter((k) => !catalogById.has(k)),
  });
  timer.mark("catalog_refetch", {
    requested: catalogIdsForFetch.length,
    loaded: catalogRows.length,
  });

  await emitProgress?.({ message: "Preparing your design…", progress: 0.03 });

  let roomImageBytes: ArrayBuffer | undefined;
  if (roomImage) {
    roomImageBytes = await roomImage.arrayBuffer();
  }
  const extraRoomImageBytes = await Promise.all(extraRoomImages.map((f) => f.arrayBuffer()));

  const pinnedMpKeysList = sessionBoardIds
    .map((id) => `mp-${id}`)
    .filter((k) => catalogById.has(k));

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
    catalogById,
  });
  timer.mark("visual_parts", visualParts.stats as unknown as Record<string, unknown>);

  let referenceBase64: string | undefined;
  let referenceImageMimeType: string | undefined;
  if (visualParts.roomInline) {
    referenceBase64 = visualParts.roomInline.data;
    referenceImageMimeType = visualParts.roomInline.mimeType;
  }

  const sessionId = `qr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let bootstrappedReference = false;
  try {
    const resolved = await bootstrapQuickRoomReference({
      referenceBase64,
      referenceImageMimeType,
      briefFullPrompt: brief.fullPrompt,
      designStyleLabel: sessionStyleLabel || designStyleLabel,
      sessionId,
    });
    referenceBase64 = resolved.base64;
    referenceImageMimeType = resolved.mimeType;
    bootstrappedReference = resolved.bootstrapped;
  } catch (bootstrapErr) {
    return {
      status: 400,
      body: {
        error: bootstrapErr instanceof Error ? bootstrapErr.message : "Could not prepare room reference.",
        debug: timer.finish("render", { ok: false }),
      },
    };
  }

  if (bootstrappedReference) {
    roomAnalysis = null;
  }

  console.info("gemini.visual_payload", { ...visualParts.stats, traceTag: "[gemini-product-images]", bootstrappedReference });

  renderFunnel.snapshot("collage_included_pins", visualParts.includedPinnedIds);
  if (visualParts.pinFetchFailedIds.length > 0) {
    traceCatalogPipeline("pin_fetch_failed", {
      phase: "render",
      pinFetchFailedIds: visualParts.pinFetchFailedIds,
    });
  }

  const merchantBlockIds =
    selectedForGemini.length === 0
      ? []
      : orderMerchantBlockIds(visualParts.includedCatalogIds, pinnedMpKeysList);

  const geminiMerchantAppendix =
    merchantBlockIds.length === 0
      ? ""
      : buildGeminiMerchantFurnitureCatalogBlock(merchantBlockIds, catalogById, null, {
          armeniaLocalExclusive: scrapedInventoryExclusive,
          cellRefByCatalogId: visualParts.cellRefByCatalogId,
        });

  const styleInspirationInlines = isPlaceOnly
    ? []
    : styleInspirations.map((item) => ({
        mimeType: item.mimeType,
        data: item.base64,
      }));

  const useEditPipeline = resolveQuickRenderModel() === "edit-pipeline" && !!referenceBase64;

  let images: Array<{ base64: string; mimeType: string }>;
  let validationWarning: string | undefined;

  const effectiveObjectRemovalMask = bootstrappedReference ? null : objectRemovalMask;

  if (useEditPipeline) {
    pipelineLog("FAL_RENDER", "quick room render via staging→banana pipeline", {
      sheets: visualParts.productImageParts.length,
      pinned: pinnedMpKeysList.length,
      hasRemovalMask: !!effectiveObjectRemovalMask,
      bootstrappedReference,
    });
    const result = await runQuickRoomEditPipeline({
      sessionId,
      roomPhotoBase64: referenceBase64!,
      roomPhotoMime: referenceImageMimeType || "image/jpeg",
      placementMode,
      objectRemovalMaskBase64: isPlaceOnly ? null : effectiveObjectRemovalMask?.base64 ?? null,
      productSheetInlines: visualParts.productImageParts.map((p) => p.inlineData),
      styleInspiration: !isPlaceOnly && styleInspirations[0]
        ? { base64: styleInspirations[0].base64, mimeType: styleInspirations[0].mimeType }
        : null,
      brief,
      designStyleLabel: sessionStyleLabel || designStyleLabel,
      productIntroText: visualParts.productIntroText,
      productCloseText: visualParts.productCloseText,
      editContext,
      shapeCreativity: parseShapeCreativityParam(formData.get("shapeCreativity")),
      onProgress: emitProgress
        ? async (ev) => {
            await emitProgress({ message: ev.message, progress: 0.05 + ev.progress * 0.75 });
          }
        : undefined,
    });
    timer.mark("edit_pipeline", {
      attempts: result.attempts,
      validationPassed: result.validationPassed,
      droppedSheetCount: result.droppedSheetCount,
    });
    images = [result.image];
    validationWarning = undefined;
  } else if (!referenceBase64) {
    return {
      status: 400,
      body: {
        error: "Room photo is required when FAL render is unavailable. Upload a room photo or configure FAL_KEY.",
        debug: timer.finish("render", { ok: false }),
      },
    };
  } else {
    if (!googleKey) {
      const isDev = process.env.NODE_ENV === "development";
      const msg = isDev ? PUBLIC_AI_SERVICE_UNAVAILABLE : PUBLIC_AI_UNAVAILABLE;
      return { status: 503, body: { error: msg } };
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
        designStyleLabel: sessionStyleLabel || designStyleLabel,
        merchantAppendix: geminiMerchantAppendix || undefined,
        productImageParts: visualParts.productImageParts,
        productIntroText: visualParts.productIntroText,
        productCloseText: visualParts.productCloseText,
        scrapedInventoryExclusive,
        keepRoomShape,
        styleInspirationInlines,
      });

    await emitProgress?.({ message: "Rendering your interior…", progress: 0.25 });
    images = await renderWithEmptyRetry(renderOnce, timer);
  }

  if (images.length === 0) {
    debugIngest(
      "generate/route.ts:render_phase",
      "gemini_empty",
      { roomImageSize },
      "F",
      "post-fix-v4",
    );
    return {
      status: 500,
      body: {
        error: "Image generation returned no results. Try rephrasing your request.",
        debug: timer.finish("render", { ok: false }),
      },
    };
  }

  await emitProgress?.({ message: "Matching products in your design…", progress: 0.85 });

  const visionResult = await runRenderVision({
    images,
    anthropicKey,
    selectedForGemini,
    pinnedMpKeysForVision: pinnedMpKeysList,
    collageIncludedIds: visualParts.includedCatalogIds,
    allowedCatalogKeys: new Set(catalogById.keys()),
    catalogById,
    brief,
    includedPinnedIds: visualParts.includedPinnedIds,
    timer,
    phase: "render",
  });
  images = visionResult.images;
  const finalVisionIds = visionResult.finalVisionIds;

  const responseSessionId = `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const flooringSlotIds = extractFlooringSlotIds(undefined, catalogById, selectedForGemini);
  let verifiedLinks: ProductPurchaseLink[] = [];
  let usedCatalogIds: string[] = [];
  try {
    if (!renderIsCustomMode) {
      const rendered = await buildRenderProductLinks({
        selectedForGemini,
        collageIncludedIds: visualParts.includedCatalogIds,
        textOnlyCatalogIds: visualParts.textOnlyCatalogIds,
        catalogById,
        pinnedMpKeys: pinnedMpKeysList,
        brief,
        precomputedVisionIds: finalVisionIds ?? undefined,
        finalImageBase64: images[0]?.base64,
        finalImageMimeType: images[0]?.mimeType,
        tracePhase: "render",
        funnel: renderFunnel,
        flooringSlotIds,
      });
      verifiedLinks = rendered.productLinks;
      usedCatalogIds = rendered.usedCatalogIds;
    }
  } catch (linksErr) {
    console.warn("buildRenderProductLinks failed (render continues):", linksErr);
    debugIngest(
      "generate/route.ts:render_phase",
      "product_links_error",
      {
        message: linksErr instanceof Error ? linksErr.message.slice(0, 200) : String(linksErr),
      },
      "F",
      "post-fix-v4",
    );
  }
  const productLinks = verifiedLinks.length > 0 ? verifiedLinks : undefined;
  timer.mark("product_links", {
    count: verifiedLinks.length,
    planCatalogCount: usedCatalogIds.length,
    collageCount: visualParts.includedCatalogIds.length,
    selectedCount: selectedForGemini.length,
  });

  const tokenGate = await consumeTokensServer(tokenAction, headers);
  timer.mark("token_consume", { ok: tokenGate.ok });
  if (!tokenGate.ok) {
    return {
      status: tokenGate.status,
      body: {
        error: tokenGate.message,
        balance: tokenGate.balance,
        required: tokenGate.required,
        debug: timer.finish("render", { ok: false }),
      },
    };
  }

  debugIngest(
    "generate/route.ts:render_phase",
    "render_ok",
    {
      imageCount: images.length,
      roomImageSize,
      productLinkCount: verifiedLinks.length,
    },
    "F",
    "post-fix-v4",
  );

  return {
    status: 200,
    body: {
      balance: tokenGate.balance,
      data: {
        sessionId: responseSessionId,
        designBrief: brief,
        scrapedInventoryExclusive,
        selectedCatalogIds: selectedForGemini,
        usedCatalogIds,
        plannedCatalogIds:
          plannedCatalogIds.length > 0
            ? plannedCatalogIds
            : buildVisionCandidateMpKeys({
                briefSelectedIds: selectedForGemini,
                pinnedMpKeys: pinnedMpKeysList,
                allowedCatalogKeys: new Set(catalogById.keys()),
              }),
        images: images.map((img, i) => ({
          id: `${responseSessionId}-img-${i}`,
          base64: img.base64,
          mimeType: img.mimeType,
          prompt: brief.fullPrompt,
        })),
        ...(roomGeometry ? { roomGeometry } : {}),
        ...(productLinks?.length ? { productLinks } : {}),
        ...(validationWarning !== undefined
          ? { validationWarning: validationWarning || "The render was accepted with a consistency warning." }
          : {}),
      },
      adminSlug: sessionAdminSlug || adminSlug,
      debug: timer.finish("render", {
        ok: true,
        selectedCatalogCount: selectedForGemini.length,
        scrapedInventoryExclusive,
      }),
      ...(isDevSpendEnabled() ? { spend: buildSpendResponse() } : {}),
    },
  };
}
