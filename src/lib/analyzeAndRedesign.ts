import { formatApiErrorMessage } from "@/lib/apiError";
import { throwIfAiServiceUnavailable, isAiServiceUnavailableError } from "@/lib/aiServiceError";
import { consumeSSE } from "@/lib/sseClient";
import {
  extractGenerationDebug,
  logGenerationClientTrace,
  mergeGenerationClientTrace,
  type GenerationClientPhaseTrace,
  type GenerationClientTrace,
} from "@/lib/generationDebug";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import type { TokenAction } from "@/lib/vistaTokens";
import type { DesignPhase } from "@/lib/phaseRouter";
import type { ProductPurchaseLink } from "@/app/store";
import { dispatchSpendUpdate, extractSpendPayload } from "@/lib/devSpendClient";

/**
 * Client orchestrator: POST room-geometry, then POST generate with optional `roomGeometry`
 * and `geometryExtractionFailed` when step 1 fails.
 *
 * When `skipGeometry` is true (edit mode using a previously generated image),
 * geometry extraction is skipped and `preloadedGeometry` is used instead.
 */
export async function analyzeAndRedesign(options: {
  onPhase?: (message: string) => void;
  onDebug?: (trace: GenerationClientTrace) => void;
  /** When omitted, room-geometry is skipped (text-to-room / no-photo path). */
  roomImageBlob?: Blob | null;
  buildGenerateFormData: () => FormData | Promise<FormData>;
  skipGeometry?: boolean;
  preloadedGeometry?: { geometry: RoomGeometry | null; failed: boolean };
  tokenAction?: TokenAction;
  requestHeaders?: Record<string, string>;
}): Promise<{
  geometry: RoomGeometry | null;
  geometryExtractionFailed: boolean;
  res: Response;
  json: { error?: string; data?: unknown; balance?: number; required?: number; debug?: unknown };
  rawBody: string;
  debug: GenerationClientTrace;
}> {
  const {
    onPhase,
    onDebug,
    roomImageBlob,
    buildGenerateFormData,
    skipGeometry,
    preloadedGeometry,
    tokenAction = "generate",
    requestHeaders = {},
  } = options;

  const traceStartedAt = Date.now();
  const phaseTraces: GenerationClientPhaseTrace[] = [];

  function publishDebug(): GenerationClientTrace {
    const trace = mergeGenerationClientTrace(traceStartedAt, phaseTraces);
    onDebug?.(trace);
    return trace;
  }

  let geometry: RoomGeometry | null = null;
  let geometryExtractionFailed = false;

  if (!roomImageBlob) {
    onPhase?.("Preparing design brief…");
  } else if (skipGeometry && preloadedGeometry) {
    geometry = preloadedGeometry.geometry;
    geometryExtractionFailed = preloadedGeometry.failed;
    onPhase?.("Designing your new interior…");
  } else {
    onPhase?.("Analysing your room structure…");

    const geoForm = new FormData();
    geoForm.set("roomImage", roomImageBlob, "room.jpg");

    const geoStartedAt = Date.now();
    try {
      const geoRes = await fetch("/api/interior-design/room-geometry", {
        method: "POST",
        body: geoForm,
        headers: requestHeaders,
      });
      const geoRaw = await geoRes.text();
      let geoJson: { error?: string; code?: string; data?: RoomGeometry; debug?: unknown };
      try {
        geoJson = JSON.parse(geoRaw) as { error?: string; data?: RoomGeometry; debug?: unknown };
      } catch {
        phaseTraces.push({
          name: "room-geometry",
          ms: Date.now() - geoStartedAt,
          httpStatus: geoRes.status,
          error: "Invalid JSON from room-geometry endpoint.",
        });
        throw new Error("Invalid JSON from room-geometry endpoint.");
      }
      phaseTraces.push({
        name: "room-geometry",
        ms: Date.now() - geoStartedAt,
        httpStatus: geoRes.status,
        error: !geoRes.ok || geoJson.error ? formatApiErrorMessage(geoJson.error, "Room geometry extraction failed.") : undefined,
        server: extractGenerationDebug(geoJson),
      });
      publishDebug();
      if (!geoRes.ok || geoJson.error) {
        throwIfAiServiceUnavailable(geoJson);
        throw new Error(formatApiErrorMessage(geoJson.error, "Room geometry extraction failed."));
      }
      geometry = geoJson.data ?? null;
      if (!geometry) {
        geometryExtractionFailed = true;
      } else if (geometry.confidence === "low" && process.env.NODE_ENV === "development") {
        console.warn("[roomGeometry] Low confidence from extraction (client).");
      }
    } catch (e) {
      if (isAiServiceUnavailableError(e)) {
        throw e;
      }
      if (phaseTraces.every((p) => p.name !== "room-geometry")) {
        phaseTraces.push({
          name: "room-geometry",
          ms: Date.now() - geoStartedAt,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      geometryExtractionFailed = true;
      geometry = null;
      if (process.env.NODE_ENV === "development") {
        console.warn("[roomGeometry] Step 1 failed, falling back to generate without geometry:", e);
      }
    }

    onPhase?.("Designing your new interior…");
  }

  /** Fresh FormData per phase so room/inspiration blobs are not consumed by the first POST. */
  async function buildPhaseForm(extra: Record<string, string>): Promise<FormData> {
    const form = await Promise.resolve(buildGenerateFormData());
    form.set("tokenAction", tokenAction);
    if (geometry) {
      form.set("roomGeometry", JSON.stringify(geometry));
    }
    if (geometryExtractionFailed) {
      form.set("geometryExtractionFailed", "true");
    }
    for (const [key, value] of Object.entries(extra)) {
      form.set(key, value);
    }
    return form;
  }

  async function postGenerate(form: FormData, phaseName: string): Promise<{
    res: Response;
    json: { error?: string; data?: unknown; balance?: number; required?: number; debug?: unknown };
    rawBody: string;
  }> {
    const startedAt = Date.now();
    const res = await fetch("/api/interior-design/generate", {
      method: "POST",
      body: form,
      headers: requestHeaders,
    });
    const rawBody = await res.text();

    let json: {
      error?: string;
      code?: string;
      data?: unknown;
      balance?: number;
      required?: number;
      cloudflare_error?: boolean;
      status?: number;
      detail?: string;
      debug?: unknown;
    };
    try {
      json = JSON.parse(rawBody) as typeof json;
    } catch {
      phaseTraces.push({
        name: phaseName,
        ms: Date.now() - startedAt,
        httpStatus: res.status,
        error: !res.ok && rawBody.trimStart().startsWith("<")
          ? "HTML error page (gateway timeout or crash)."
          : "Invalid JSON from generate endpoint.",
      });
      const debug = mergeGenerationClientTrace(traceStartedAt, phaseTraces);
      logGenerationClientTrace(debug);
      onDebug?.(debug);
      throw new Error(
        !res.ok && rawBody.trimStart().startsWith("<")
          ? "Server returned an HTML error page instead of JSON (often a gateway timeout or crash)."
          : "Invalid JSON from generate endpoint.",
      );
    }

    const parsed = json as {
      cloudflare_error?: boolean;
      status?: number;
      detail?: string;
    };
    if (
      parsed.cloudflare_error === true &&
      (parsed.status === 504 || parsed.status === 524)
    ) {
      phaseTraces.push({
        name: phaseName,
        ms: Date.now() - startedAt,
        httpStatus: res.status,
        error: parsed.detail || "Cloudflare gateway timeout.",
        server: extractGenerationDebug(json),
      });
      const debug = mergeGenerationClientTrace(traceStartedAt, phaseTraces);
      logGenerationClientTrace(debug);
      onDebug?.(debug);
      throw new Error(
        "Generation took too long and timed out at the edge. Please try again in a couple of minutes.",
      );
    }

    phaseTraces.push({
      name: phaseName,
      ms: Date.now() - startedAt,
      httpStatus: res.status,
      error: !res.ok || json.error ? formatApiErrorMessage(json.error, `${phaseName} failed.`) : undefined,
      server: extractGenerationDebug(json),
    });
    publishDebug();
    const spend = extractSpendPayload(json);
    if (spend) dispatchSpendUpdate(spend);

    return { res, json, rawBody };
  }

  /**
   * SSE variant of postGenerate for the edit-pipeline render engine — the
   * nano-banana edit + validation ladder can exceed Cloudflare's ~100s POST
   * timeout, so progress streams and the `complete` event carries the exact
   * body the plain POST returns. Errors keep postGenerate's surface: HTTP
   * failures return `{ res, json }`, stream errors throw.
   */
  async function streamGenerate(form: FormData, phaseName: string): Promise<{
    res: Response;
    json: { error?: string; data?: unknown; balance?: number; required?: number; debug?: unknown };
    rawBody: string;
  }> {
    const startedAt = Date.now();
    const res = await fetch("/api/interior-design/generate/stream", {
      method: "POST",
      body: form,
      headers: requestHeaders,
    });

    if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
      const rawBody = await res.text();
      let json: { error?: string; balance?: number; required?: number; debug?: unknown } = {};
      try {
        json = JSON.parse(rawBody) as typeof json;
      } catch { /* fall through with empty json */ }
      phaseTraces.push({
        name: phaseName,
        ms: Date.now() - startedAt,
        httpStatus: res.status,
        error: formatApiErrorMessage(json.error, `${phaseName} failed.`),
        server: extractGenerationDebug(json),
      });
      publishDebug();
      return { res, json, rawBody };
    }

    try {
      const last = await consumeSSE(res, (event) => {
        if (event.phase === "generating" && event.message) {
          onPhase?.(event.message);
        }
      });
      if (!last?.data) {
        throw new Error("Render stream did not complete. Please try again.");
      }
      const json = last.data as {
        error?: string;
        data?: unknown;
        balance?: number;
        required?: number;
        debug?: unknown;
      };
      phaseTraces.push({
        name: phaseName,
        ms: Date.now() - startedAt,
        httpStatus: res.status,
        server: extractGenerationDebug(json),
      });
      publishDebug();
      const spend = extractSpendPayload(json);
      if (spend) dispatchSpendUpdate(spend);
      return { res, json, rawBody: JSON.stringify(last.data) };
    } catch (err) {
      if (phaseTraces.every((p) => p.name !== phaseName)) {
        phaseTraces.push({
          name: phaseName,
          ms: Date.now() - startedAt,
          httpStatus: res.status,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const debug = publishDebug();
      logGenerationClientTrace(debug);
      throw err;
    }
  }

  // Split into brief + render so each request stays under Cloudflare's ~100s origin timeout.
  onPhase?.("Preparing design brief…");
  const briefForm = await buildPhaseForm({ phase: "brief" });

  const briefResult = await postGenerate(briefForm, "generate-brief");
  if (!briefResult.res.ok || briefResult.json.error) {
    throwIfAiServiceUnavailable(briefResult.json);
    const debug = publishDebug();
    logGenerationClientTrace(debug);
    return { geometry, geometryExtractionFailed, ...briefResult, debug };
  }

  const renderSession = (briefResult.json.data as { renderSession?: unknown } | undefined)
    ?.renderSession;
  if (!renderSession) {
    const debug = publishDebug();
    logGenerationClientTrace(debug);
    throw new Error("Design brief step returned no render session.");
  }

  onPhase?.("Rendering your interior…");
  const renderSessionJson = JSON.stringify(renderSession);
  const renderForm = await buildPhaseForm({
    phase: "render",
    renderSession: renderSessionJson,
  });

  // Sessions minted by the edit-pipeline engine render over SSE (the
  // validation ladder can outlive a plain POST at the edge); legacy sessions
  // keep the original POST path.
  const renderEngine = (renderSession as { renderEngine?: string }).renderEngine;
  const renderResult =
    renderEngine === "edit-pipeline"
      ? await streamGenerate(renderForm, "generate-render")
      : await postGenerate(renderForm, "generate-render");
  const renderData = renderResult.json.data as { images?: Array<{ base64?: string }> } | undefined;
  if (
    renderResult.res.ok &&
    !renderResult.json.error &&
    !renderData?.images?.[0]?.base64
  ) {
    phaseTraces.push({
      name: "generate-render",
      ms: 0,
      httpStatus: renderResult.res.status,
      error: "Render step returned no image.",
      server: extractGenerationDebug(renderResult.json),
    });
    const debug = mergeGenerationClientTrace(traceStartedAt, phaseTraces);
    logGenerationClientTrace(debug);
    onDebug?.(debug);
    throw new Error("Render step completed but returned no image. Please try again.");
  }

  const debug = publishDebug();
  logGenerationClientTrace(debug);
  return { geometry, geometryExtractionFailed, ...renderResult, debug };
}

export interface PhasedGenerationResult {
  image: { base64: string; mimeType: string };
  confirmedProducts: string[];
  missingProducts: string[];
  allPhaseProductIds: string[];
  productLinks: ProductPurchaseLink[];
  imaginedSlots?: Array<{ family: string; subtype?: string | null; label: string }>;
  slotNotices?: string[];
  balance?: number;
}

/**
 * Client orchestrator for a single phase of the three-phase pipeline.
 * Calls POST /api/interior-design/phased-generate with appropriate params.
 */
export async function runPhasedGeneration(options: {
  phase: DesignPhase;
  formData: FormData;
  previousPhaseImage?: Blob;
  previousPhaseProducts?: string[];
  onProgress: (status: string) => void;
  requestHeaders?: Record<string, string>;
}): Promise<PhasedGenerationResult> {
  const { phase, formData, previousPhaseImage, previousPhaseProducts, onProgress, requestHeaders = {} } = options;

  const phaseLabel = phase === "base" ? "materials & lighting" : phase;
  onProgress(`Selecting ${phaseLabel}...`);

  formData.set("designPhase", phase);

  if (previousPhaseImage) {
    formData.set("previousPhaseImage", previousPhaseImage, "previous-phase.jpg");
  }

  if (previousPhaseProducts && previousPhaseProducts.length > 0) {
    formData.set("previousPhaseProducts", JSON.stringify(previousPhaseProducts));
  }

  onProgress(`Generating ${phaseLabel}...`);

  const res = await fetch("/api/interior-design/phased-generate", {
    method: "POST",
    body: formData,
    headers: requestHeaders,
  });

  const rawBody = await res.text();

  let json: {
    error?: string;
    code?: string;
    data?: {
      images?: Array<{ base64?: string; mimeType?: string }>;
      confirmedCatalogIds?: string[];
      missingCatalogIds?: string[];
      allPhaseProductIds?: string[];
      productLinks?: ProductPurchaseLink[];
      imaginedSlots?: Array<{ family: string; subtype?: string | null; label: string }>;
      slotNotices?: string[];
    };
    balance?: number;
  };

  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new Error(
      rawBody.trimStart().startsWith("<")
        ? "Server returned an HTML error page (gateway timeout)."
        : "Invalid JSON from phased-generate endpoint.",
    );
  }

  if (!res.ok || json.error) {
    throwIfAiServiceUnavailable(json);
    throw new Error(json.error || `Phase "${phase}" generation failed.`);
  }

  const spend = extractSpendPayload(json);
  if (spend) dispatchSpendUpdate(spend);

  const imageData = json.data?.images?.[0];
  if (!imageData?.base64) {
    throw new Error(`Phase "${phase}" returned no image. Please try again.`);
  }

  return {
    image: { base64: imageData.base64, mimeType: imageData.mimeType || "image/png" },
    confirmedProducts: json.data?.confirmedCatalogIds ?? [],
    missingProducts: json.data?.missingCatalogIds ?? [],
    allPhaseProductIds: json.data?.allPhaseProductIds ?? [],
    productLinks: json.data?.productLinks ?? [],
    imaginedSlots: json.data?.imaginedSlots,
    slotNotices: json.data?.slotNotices,
    balance: json.balance,
  };
}

/**
 * Renders the completed design onto one EXTRA room photo (a different viewpoint of
 * the same room), keeping the same products/materials as the approved primary
 * render. Returns exactly one image. Used to build the multi-viewpoint final
 * gallery after all phases are approved.
 */
export async function runFinalViewGeneration(options: {
  extraPhoto: Blob;
  primaryDesignImage: Blob;
  confirmedProductIds: string[];
  /** Base form carrying style / roomAnalysis / roomGeometry / textPrompt. */
  baseFormData: FormData;
  requestHeaders?: Record<string, string>;
}): Promise<{ image: { base64: string; mimeType: string }; balance?: number }> {
  const { extraPhoto, primaryDesignImage, confirmedProductIds, baseFormData, requestHeaders = {} } = options;

  const formData = baseFormData;
  formData.set("designPhase", "finalview");
  formData.set("roomImage", extraPhoto, "extra-room.jpg");
  formData.set("primaryDesignImage", primaryDesignImage, "primary-design.jpg");
  formData.set("confirmedProductIds", JSON.stringify(confirmedProductIds));

  const res = await fetch("/api/interior-design/phased-generate", {
    method: "POST",
    body: formData,
    headers: requestHeaders,
  });

  const rawBody = await res.text();
  let json: { error?: string; code?: string; data?: { images?: Array<{ base64?: string; mimeType?: string }> }; balance?: number };
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new Error(
      rawBody.trimStart().startsWith("<")
        ? "Server returned an HTML error page (gateway timeout)."
        : "Invalid JSON from finalview endpoint.",
    );
  }

  if (!res.ok || json.error) {
    throwIfAiServiceUnavailable(json);
    throw new Error(json.error || "Viewpoint render failed.");
  }

  const spend = extractSpendPayload(json);
  if (spend) dispatchSpendUpdate(spend);

  const imageData = json.data?.images?.[0];
  if (!imageData?.base64) {
    throw new Error("Viewpoint render returned no image.");
  }

  return {
    image: { base64: imageData.base64, mimeType: imageData.mimeType || "image/png" },
    balance: json.balance,
  };
}
