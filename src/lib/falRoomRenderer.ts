import "server-only";

import sharp from "sharp";
import { fal, ValidationError } from "@fal-ai/client";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import { uploadPublicImage, ensureFalConfigured } from "@/lib/falStorage";
import { extractCannyLineDrawing } from "@/lib/extractCannyLineDrawing";
import { normalizeStructuralLineMap } from "@/lib/extractUserStructuralLines";
import { pipelineLog, pipelineTimed, createFalQueueLogger } from "@/lib/pipelineLog";
import { withRetry } from "@/lib/aiRetry";
import { buildGeometryLockPrompt } from "@/lib/falGeometryLockPrompt";
import { buildFreezeMask } from "@/lib/buildFreezeMask";
import { buildStructuralMarkupComposite } from "@/lib/buildStructuralMarkupComposite";
import { buildImageRolesBlock } from "@/lib/falStyleReferenceUtils";

/**
 * FAL room renderer:
 *   Primary — fal-ai/flux-pro/kontext (/multi when markup and/or style refs)
 *   Legacy  — fal-ai/flux-general/image-to-image + Canny (renderRoomImageViaFal only)
 */

const FAL_IMG2IMG_ENDPOINT = "fal-ai/flux-general/image-to-image";
const FAL_INPAINT_ENDPOINT = "fal-ai/flux-general/inpainting";
const FAL_KONTEXT_ENDPOINT = "fal-ai/flux-pro/kontext";
const FAL_KONTEXT_MULTI_ENDPOINT = "fal-ai/flux-pro/kontext/multi";
const FAL_STAGING_ENDPOINT = "fal-ai/flux-2-lora-gallery/apartment-staging";

const FAL_CANNY_LORA_PATH =
  process.env.VISTA_FAL_CANNY_LORA_PATH ||
  "https://huggingface.co/camenduru/FLUX.1-dev/resolve/fc63f3204a12362f98c04bc4c981a06eb9123eee/flux1-canny-dev-lora.safetensors";

export type FalAngleRole = "master" | "secondary";
export type FalRenderPath = "kontext" | "controlnet-user-lines" | "controlnet-inpaint-openings";

/** @deprecated Legacy render modes — use angleRole for new callers. */
export type FalRenderMode = "hero" | "viewpoint-secondary" | "default";

export type RenderedImage = { base64: string; mimeType: string };

export interface FalRenderResult {
  images: RenderedImage[];
  seed?: number;
  renderPath?: FalRenderPath;
}

export interface FluxCannyImg2ImgInput {
  photoBase64: string;
  photoMime: string;
  prompt: string;
  /** Pre-normalized user line map — skips auto Canny when set. */
  controlImageBase64?: string;
  controlImageMime?: string;
  /** img2img strength — default from VISTA_FAL_DENOISE (0.95). */
  denoise?: number;
  seed?: number;
  sessionId?: string;
  label?: string;
  angleRole?: FalAngleRole;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
  /** When false and no user line map, skip auto Canny control_loras. */
  useAutoCanny?: boolean;
}

export interface KontextRedesignInput {
  photoBase64: string;
  photoMime: string;
  prompt: string;
  styleReferenceBase64?: string;
  styleReferenceMime?: string;
  structuralLineMapBase64?: string;
  structuralLineMapMime?: string;
  structuralLineStrokeOnly?: boolean;
  originalPhotoBase64?: string;
  /** Hero render used as design consistency ref (secondary viewpoints). */
  heroDesignRef?: boolean;
  seed?: number;
  sessionId?: string;
  label?: string;
  angleRole?: FalAngleRole;
}

export interface RoomRedesignInput {
  photoBase64: string;
  photoMime: string;
  prompt: string;
  structuralLineMapBase64?: string;
  structuralLineMapMime?: string;
  /** When line map is composite (photo + strokes), pass original for extraction. */
  originalPhotoBase64?: string;
  structuralLineStrokeOnly?: boolean;
  styleReferenceBase64?: string;
  styleReferenceMime?: string;
  seed?: number;
  sessionId?: string;
  label?: string;
  angleRole?: FalAngleRole;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
}

/** @deprecated Legacy input — openings wired through renderFluxCannyImg2Img when present. */
export interface FalRenderInput {
  photoBase64: string;
  photoMime: string;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
  structuralBoxes?: OpeningBox[];
  prompt: string;
  useCanny?: boolean;
  cannyImageBase64?: string;
  cannyImageMime?: string;
  ipAdapterImageUrl?: string;
  ipAdapterImageBase64?: string;
  ipAdapterImageMime?: string;
  ipAdapterScale?: number;
  angleRole?: FalAngleRole;
  seed?: number;
  inspirationBase64?: string;
  inspirationMime?: string;
  renderMode?: FalRenderMode;
  sessionId?: string;
  label?: string;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function denoiseStrength(override?: number): number {
  if (typeof override === "number" && override > 0 && override <= 1) return override;
  const env = Number(process.env.VISTA_FAL_DENOISE);
  if (Number.isFinite(env) && env > 0 && env <= 1) return env;
  return 0.95;
}

function parseFalSeed(data: unknown): number | undefined {
  const seed = (data as { seed?: unknown })?.seed;
  return typeof seed === "number" && Number.isFinite(seed) ? seed : undefined;
}

const KONTEXT_ASPECT_RATIOS = [
  { ratio: "21:9", value: 21 / 9 },
  { ratio: "16:9", value: 16 / 9 },
  { ratio: "4:3", value: 4 / 3 },
  { ratio: "3:2", value: 3 / 2 },
  { ratio: "1:1", value: 1 },
  { ratio: "2:3", value: 2 / 3 },
  { ratio: "3:4", value: 3 / 4 },
  { ratio: "9:16", value: 9 / 16 },
  { ratio: "9:21", value: 9 / 21 },
] as const;

type KontextAspectRatio = (typeof KONTEXT_ASPECT_RATIOS)[number]["ratio"];

function nearestKontextAspectRatio(width: number, height: number): KontextAspectRatio | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const ar = width / height;
  let best: (typeof KONTEXT_ASPECT_RATIOS)[number] = KONTEXT_ASPECT_RATIOS[0]!;
  let bestDiff = Math.abs(ar - best.value);
  for (const candidate of KONTEXT_ASPECT_RATIOS) {
    const diff = Math.abs(ar - candidate.value);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best.ratio;
}

async function fetchFalImages(
  images: Array<{ url?: string }>,
  label: string,
): Promise<RenderedImage[]> {
  const out: RenderedImage[] = [];
  for (const img of images) {
    if (!img.url) continue;
    try {
      const item = await pipelineTimed(
        "FAL_RENDER",
        "fetch flux result",
        async () => {
          const res = await fetch(img.url!);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const mimeType = res.headers.get("content-type") || "image/png";
          const buf = Buffer.from(await res.arrayBuffer());
          return { base64: buf.toString("base64"), mimeType };
        },
        { meta: { label } },
      );
      out.push(item);
    } catch (err) {
      pipelineLog(
        "FAL_RENDER",
        "fetch flux result — unreachable URL skipped",
        { label, error: String(err).slice(0, 120) },
        "warn",
      );
    }
  }
  return out;
}

/** flux-general img2img or inpainting + optional Canny control_lora. */
export async function renderFluxCannyImg2Img(input: FluxCannyImg2ImgInput): Promise<FalRenderResult> {
  ensureFalConfigured();

  const label = input.label ?? "fal-canny-img2img";
  const role = input.angleRole ?? "master";
  const strength = denoiseStrength(input.denoise);
  const hasUserLines = !!input.controlImageBase64?.trim();
  const useAutoCanny = input.useAutoCanny !== false;
  const hasOpeningBoxes =
    role === "master" &&
    ((input.windowBoxes?.length ?? 0) > 0 || (input.doorBoxes?.length ?? 0) > 0);

  let renderPath: FalRenderPath | "controlnet-auto-canny" = hasUserLines
    ? "controlnet-user-lines"
    : "controlnet-auto-canny";

  const photoBuf = Buffer.from(input.photoBase64, "base64");
  const meta = await sharp(photoBuf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const photoUrl = await uploadPublicImage(photoBuf, input.photoMime || "image/jpeg", {
    sessionId: input.sessionId,
    type: "original",
  });

  let controlBase64: string | undefined;
  let controlMime: string | undefined;
  let cannyControlUrl: string | undefined;

  if (hasUserLines) {
    controlBase64 = input.controlImageBase64!;
    controlMime = input.controlImageMime || "image/png";
  } else if (useAutoCanny) {
    const canny = await extractCannyLineDrawing(input.photoBase64);
    controlBase64 = canny.base64;
    controlMime = canny.mimeType;
  }

  if (controlBase64) {
    cannyControlUrl = await uploadPublicImage(
      Buffer.from(controlBase64, "base64"),
      controlMime || "image/png",
      {
        sessionId: input.sessionId,
        type: "original",
        label: hasUserLines ? "user-structural-lines" : "canny-lines",
      },
    );
  }

  const controlScale = hasUserLines
    ? num("VISTA_FAL_USER_LINE_CONTROL_STRENGTH", 0.4)
    : num("VISTA_FAL_CANNY_STRENGTH", 0.35);

  const controlLoras = cannyControlUrl
    ? [
        {
          path: FAL_CANNY_LORA_PATH,
          control_image_url: cannyControlUrl,
          preprocess: "None" as const,
          scale: controlScale,
        },
      ]
    : undefined;

  let maskUrl: string | undefined;
  if (hasOpeningBoxes) {
    const maskBuf = await buildFreezeMask({
      width,
      height,
      windowBoxes: input.windowBoxes,
      doorBoxes: input.doorBoxes,
    });
    if (maskBuf) {
      maskUrl = await uploadPublicImage(maskBuf, "image/png", {
        sessionId: input.sessionId,
        type: "original",
        label: "opening-freeze-mask",
      });
      renderPath = "controlnet-inpaint-openings";
    }
  }

  const useInpaint = !!maskUrl;
  const endpoint = useInpaint ? FAL_INPAINT_ENDPOINT : FAL_IMG2IMG_ENDPOINT;

  const renderInput: Record<string, unknown> = {
    image_url: photoUrl,
    prompt: input.prompt,
    strength,
    num_inference_steps: Math.round(num("VISTA_FAL_STEPS", 28)),
    guidance_scale: num("VISTA_FAL_GUIDANCE", 3.5),
    output_format: "png",
    ...(controlLoras ? { control_loras: controlLoras } : {}),
    ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
    ...(useInpaint ? { mask_url: maskUrl } : {}),
  };

  pipelineLog("FAL_RENDER", useInpaint ? "flux inpaint + canny request" : "flux img2img + canny request", {
    label,
    angleRole: role,
    endpoint,
    width,
    height,
    strength,
    seed: input.seed,
    hasCanny: !!controlLoras,
    hasUserLines,
    hasOpeningFreeze: useInpaint,
    windowBoxes: input.windowBoxes?.length ?? 0,
    doorBoxes: input.doorBoxes?.length ?? 0,
    controlScale,
    renderPath,
    promptChars: input.prompt.length,
    promptPreview: input.prompt.slice(0, 120),
  });

  const queueLog = createFalQueueLogger("FAL_RENDER", "flux queue update", {
    label,
    endpoint,
    hasCanny: !!controlLoras,
    hasUserLines,
    hasOpeningFreeze: useInpaint,
  });

  const subscribe = (ep: string, inp: Record<string, unknown>) =>
    pipelineTimed(
      "FAL_RENDER",
      "flux subscribe",
      () =>
        fal.subscribe(ep, {
          input: inp as { image_url: string; prompt: string },
          logs: true,
          onQueueUpdate: (update) => {
            queueLog(update);
          },
        }),
      { meta: { label, endpoint: ep, hasCanny: !!controlLoras, hasUserLines, hasOpeningFreeze: useInpaint } },
    );

  let result: Awaited<ReturnType<typeof fal.subscribe>>;
  try {
    result = await subscribe(endpoint, renderInput);
  } catch (err) {
    if (useInpaint && err instanceof ValidationError) {
      pipelineLog(
        "FAL_RENDER",
        "inpaint validation error — falling back to img2img",
        { label, fieldErrors: err.fieldErrors },
        "warn",
      );
      const fallbackInput = { ...renderInput };
      delete fallbackInput.mask_url;
      renderPath = hasUserLines ? "controlnet-user-lines" : "controlnet-auto-canny";
      try {
        result = await subscribe(FAL_IMG2IMG_ENDPOINT, fallbackInput);
      } catch (fallbackErr) {
        if (fallbackErr instanceof ValidationError) {
          pipelineLog("FAL_RENDER", "flux validation error", {
            label,
            fieldErrors: fallbackErr.fieldErrors,
          }, "error");
        }
        throw fallbackErr;
      }
    } else {
      if (err instanceof ValidationError) {
        pipelineLog("FAL_RENDER", "flux validation error", {
          label,
          fieldErrors: err.fieldErrors,
        }, "error");
      }
      throw err;
    }
  }

  const responseSeed = parseFalSeed(result.data);
  const images = (result.data as { images?: Array<{ url?: string }> })?.images ?? [];
  const usedEndpoint =
    (result as { endpoint?: string }).endpoint ??
    (useInpaint && images.length > 0 ? endpoint : endpoint);

  const out = await fetchFalImages(images, label);

  const { recordFalUsage } = await import("@/lib/aiSpend");
  recordFalUsage({ endpoint: usedEndpoint, label });

  pipelineLog("FAL_RENDER", "flux render response", {
    label,
    images: out.length,
    seed: responseSeed,
    renderPath,
    endpoint: usedEndpoint,
  });

  return {
    images: out,
    seed: responseSeed,
    renderPath: renderPath === "controlnet-inpaint-openings" ? renderPath : hasUserLines ? "controlnet-user-lines" : undefined,
  };
}

/** Primary path — Kontext pro redesign (marked structural ref + style inspiration). */
export async function renderKontextRedesign(input: KontextRedesignInput): Promise<FalRenderResult> {
  ensureFalConfigured();

  const label = input.label ?? "fal-kontext";
  const role = input.angleRole ?? "master";
  const hasStyleRef = !!input.styleReferenceBase64?.trim();
  let hasStructuralMarkup = false;
  let markupBase64: string | undefined;

  if (input.structuralLineMapBase64?.trim()) {
    const normalized = await normalizeStructuralLineMap({
      lineMapBase64: input.structuralLineMapBase64,
      originalPhotoBase64: input.originalPhotoBase64 ?? input.photoBase64,
      strokeOnly: input.structuralLineStrokeOnly,
    });
    const composite = await buildStructuralMarkupComposite({
      photoBase64: input.photoBase64,
      strokeMapBase64: normalized.base64,
    });
    markupBase64 = composite.base64;
    hasStructuralMarkup = true;
  }

  const photoBuf = Buffer.from(input.photoBase64, "base64");
  const photoMeta = await sharp(photoBuf).metadata();
  const aspectRatio = nearestKontextAspectRatio(photoMeta.width ?? 0, photoMeta.height ?? 0);
  const photoUrl = await uploadPublicImage(photoBuf, input.photoMime || "image/jpeg", {
    sessionId: input.sessionId,
    type: "original",
  });

  const imageUrls = [photoUrl];
  if (hasStructuralMarkup && markupBase64) {
    const markupUrl = await uploadPublicImage(
      Buffer.from(markupBase64, "base64"),
      "image/png",
      {
        sessionId: input.sessionId,
        type: "original",
        label: "structural-markup",
      },
    );
    imageUrls.push(markupUrl);
  }
  if (hasStyleRef) {
    const styleUrl = await uploadPublicImage(
      Buffer.from(input.styleReferenceBase64!, "base64"),
      input.styleReferenceMime || "image/jpeg",
      { sessionId: input.sessionId, type: "original", label: "style-ref" },
    );
    imageUrls.push(styleUrl);
  }

  const useMulti = imageUrls.length > 1;
  const endpoint = useMulti ? FAL_KONTEXT_MULTI_ENDPOINT : FAL_KONTEXT_ENDPOINT;
  const rolesBlock = buildImageRolesBlock({
    styleRefCount: hasStyleRef ? 1 : 0,
    hasStructuralMarkup,
    heroDesignRef: input.heroDesignRef,
  });
  const fullPrompt = `${rolesBlock}\n\n${input.prompt}`;

  const kontextInput = useMulti
    ? {
        prompt: fullPrompt,
        image_urls: imageUrls,
        guidance_scale: num("VISTA_FAL_KONTEXT_GUIDANCE", 3.5),
        output_format: "png" as const,
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
      }
    : {
        prompt: fullPrompt,
        image_url: photoUrl,
        guidance_scale: num("VISTA_FAL_KONTEXT_GUIDANCE", 3.5),
        output_format: "png" as const,
        ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
      };

  pipelineLog("FAL_RENDER", "kontext design request", {
    label,
    endpoint,
    renderPath: "kontext",
    hasStyleRef,
    hasStructuralMarkup,
    imageCount: imageUrls.length,
    aspectRatio,
    promptChars: fullPrompt.length,
    promptPreview: fullPrompt.slice(0, 120),
  });

  const queueLog = createFalQueueLogger("FAL_RENDER", "kontext queue update", {
    label,
    endpoint,
    renderPath: "kontext",
  });

  let result: Awaited<ReturnType<typeof fal.subscribe>>;
  try {
    result = await pipelineTimed(
      "FAL_RENDER",
      "kontext subscribe",
      () =>
        fal.subscribe(endpoint, {
          input: kontextInput,
          logs: false,
          onQueueUpdate: queueLog,
        }),
      { meta: { label, endpoint, renderPath: "kontext" } },
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      pipelineLog("FAL_RENDER", "kontext validation error", { label, fieldErrors: (err as ValidationError).fieldErrors }, "error");
    }
    throw err;
  }

  const responseSeed = parseFalSeed(result.data);
  const images = (result.data as { images?: Array<{ url?: string }> })?.images ?? [];

  const out = await fetchFalImages(images, label);

  const { recordFalUsage } = await import("@/lib/aiSpend");
  recordFalUsage({ endpoint, label });

  pipelineLog("FAL_RENDER", "kontext render response", {
    label,
    images: out.length,
    seed: responseSeed,
    renderPath: "kontext",
    hasStructuralMarkup,
  });

  return { images: out, seed: responseSeed, renderPath: "kontext" };
}

/** Virtual staging via fal apartment-staging LoRA gallery model. */
export async function renderApartmentStaging(input: {
  imageUrl: string;
  prompt: string;
  seed?: number;
  sessionId?: string;
  label?: string;
  photoId?: string;
  width?: number;
  height?: number;
  /** Override LoRA strength; Quick Room shell uses 1 for maximum structure lock. */
  loraScale?: number;
}): Promise<FalRenderResult> {
  ensureFalConfigured();
  const label = input.label ?? "apartment-staging";
  const loraScale =
    typeof input.loraScale === "number" && input.loraScale > 0
      ? input.loraScale
      : num("VISTA_FAL_STAGING_LORA_SCALE", 0.8);
  const guidanceScale = num("VISTA_FAL_STAGING_GUIDANCE", 2.5);

  const { logFalCostEstimate } = await import("@/lib/project/projectStagingCost");
  if (input.width && input.height) {
    logFalCostEstimate("staging", input.width, input.height, FAL_STAGING_ENDPOINT, {
      sessionId: input.sessionId,
      label,
    });
  }

  pipelineLog("FAL_RENDER", "apartment-staging request", {
    label,
    photoId: input.photoId,
    promptChars: input.prompt.length,
    prompt: input.prompt,
    seed: input.seed,
    lora_scale: loraScale,
    guidance_scale: guidanceScale,
    imageUrlHost: input.imageUrl.slice(0, 60),
  });

  if (label.includes("quick-room")) {
    console.info(
      `[vista-pipeline][7·fal-render] ${label} · apartment-staging · prompt (${input.prompt.length} chars):\n${input.prompt}`,
    );
  }

  const result = await withRetry(
    () =>
      pipelineTimed(
        "FAL_RENDER",
        "apartment-staging subscribe",
        () =>
          fal.subscribe(FAL_STAGING_ENDPOINT, {
            input: {
              image_urls: [input.imageUrl],
              prompt: input.prompt,
              ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
              guidance_scale: guidanceScale,
              lora_scale: loraScale,
            },
            logs: false,
          }),
        { meta: { label, endpoint: FAL_STAGING_ENDPOINT } },
      ),
    "apartment-staging",
  );

  const responseSeed = parseFalSeed(result.data);
  const images = (result.data as { images?: Array<{ url?: string }> })?.images ?? [];
  const out = await fetchFalImages(images, label);

  const { recordFalUsage } = await import("@/lib/aiSpend");
  recordFalUsage({ endpoint: FAL_STAGING_ENDPOINT, label, megapixels: input.width && input.height ? (input.width * input.height) / 1_000_000 : undefined });

  pipelineLog("FAL_RENDER", "apartment-staging response", {
    label,
    photoId: input.photoId,
    images: out.length,
    seed: responseSeed,
    lora_scale: loraScale,
  });

  return { images: out, seed: responseSeed };
}

/**
 * Route to Kontext (marked structural ref + style) or plain Kontext when no lines.
 */
export async function renderRoomRedesign(input: RoomRedesignInput): Promise<FalRenderResult> {
  const role = input.angleRole ?? "master";
  const label = input.label ?? "room-redesign";

  if (input.structuralLineMapBase64?.trim()) {
    return renderKontextRedesign({
      photoBase64: input.photoBase64,
      photoMime: input.photoMime,
      prompt: input.prompt,
      structuralLineMapBase64: input.structuralLineMapBase64,
      structuralLineMapMime: input.structuralLineMapMime,
      structuralLineStrokeOnly: input.structuralLineStrokeOnly,
      originalPhotoBase64: input.originalPhotoBase64 ?? input.photoBase64,
      styleReferenceBase64: input.styleReferenceBase64,
      styleReferenceMime: input.styleReferenceMime,
      heroDesignRef: role === "secondary" && !!input.styleReferenceBase64,
      seed: input.seed,
      sessionId: input.sessionId,
      label,
      angleRole: role,
    });
  }

  return renderKontextRedesign({
    photoBase64: input.photoBase64,
    photoMime: input.photoMime,
    prompt: input.prompt,
    styleReferenceBase64: input.styleReferenceBase64,
    styleReferenceMime: input.styleReferenceMime,
    heroDesignRef: role === "secondary" && !!input.styleReferenceBase64,
    seed: input.seed,
    sessionId: input.sessionId,
    label,
    angleRole: role,
  });
}

/** @deprecated Use renderRoomRedesign — legacy openings + canny wired through renderFluxCannyImg2Img. */
export async function renderRoomImageViaFal(input: FalRenderInput): Promise<FalRenderResult> {
  const role = input.angleRole
    ?? (input.renderMode === "viewpoint-secondary" ? "secondary" : input.renderMode === "hero" ? "master" : "master");

  const hasOpenings = !!(input.windowBoxes?.length || input.doorBoxes?.length);
  const useCanny = input.useCanny !== false;

  if (input.cannyImageBase64?.trim() || useCanny || hasOpenings) {
    return renderFluxCannyImg2Img({
      photoBase64: input.photoBase64,
      photoMime: input.photoMime,
      prompt: input.prompt,
      controlImageBase64: input.cannyImageBase64,
      controlImageMime: input.cannyImageMime,
      windowBoxes: input.windowBoxes,
      doorBoxes: input.doorBoxes,
      useAutoCanny: useCanny && !input.cannyImageBase64?.trim(),
      seed: input.seed,
      sessionId: input.sessionId,
      label: input.label,
      angleRole: role,
    });
  }

  return renderRoomRedesign({
    photoBase64: input.photoBase64,
    photoMime: input.photoMime,
    prompt: input.prompt,
    styleReferenceBase64: input.inspirationBase64 ?? input.ipAdapterImageBase64,
    styleReferenceMime: input.inspirationMime ?? input.ipAdapterImageMime,
    seed: input.seed,
    sessionId: input.sessionId,
    label: input.label,
    angleRole: role,
  });
}

export async function renderMasterAngle(opts: {
  photoBase64: string;
  photoMime: string;
  prompt: string;
  inspirationBase64?: string;
  inspirationMime?: string;
  structuralLineMapBase64?: string;
  structuralLineMapMime?: string;
  structuralLineStrokeOnly?: boolean;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
  structuralBoxes?: OpeningBox[];
  sessionId?: string;
  label?: string;
}): Promise<FalRenderResult> {
  return renderRoomRedesign({
    photoBase64: opts.photoBase64,
    photoMime: opts.photoMime,
    prompt: opts.prompt,
    structuralLineMapBase64: opts.structuralLineMapBase64,
    structuralLineMapMime: opts.structuralLineMapMime,
    structuralLineStrokeOnly: opts.structuralLineStrokeOnly,
    originalPhotoBase64: opts.photoBase64,
    styleReferenceBase64: opts.inspirationBase64,
    styleReferenceMime: opts.inspirationMime,
    windowBoxes: opts.windowBoxes,
    doorBoxes: opts.doorBoxes,
    angleRole: "master",
    sessionId: opts.sessionId,
    label: opts.label ?? "master-angle",
  });
}

export async function renderSecondaryAngle(opts: {
  secondaryPhotoBase64: string;
  secondaryPhotoMime: string;
  heroBase64: string;
  heroMime: string;
  prompt: string;
  seed?: number;
  structuralLineMapBase64?: string;
  structuralLineMapMime?: string;
  structuralLineStrokeOnly?: boolean;
  sessionId?: string;
  label?: string;
}): Promise<FalRenderResult> {
  return renderRoomRedesign({
    photoBase64: opts.secondaryPhotoBase64,
    photoMime: opts.secondaryPhotoMime,
    prompt: opts.prompt,
    structuralLineMapBase64: opts.structuralLineMapBase64,
    structuralLineMapMime: opts.structuralLineMapMime,
    structuralLineStrokeOnly: opts.structuralLineStrokeOnly,
    originalPhotoBase64: opts.secondaryPhotoBase64,
    styleReferenceBase64: opts.heroBase64,
    styleReferenceMime: opts.heroMime,
    seed: opts.seed,
    angleRole: "secondary",
    sessionId: opts.sessionId,
    label: opts.label ?? "secondary-angle",
  });
}

/** @deprecated Use renderSecondaryAngle. */
export async function renderViewpointFromHero(opts: {
  heroBase64: string;
  heroMime: string;
  secondaryPhotoBase64: string;
  secondaryPhotoMime: string;
  prompt: string;
  seed?: number;
  sessionId?: string;
  label?: string;
}): Promise<{ base64: string; mimeType: string } | null> {
  const result = await renderSecondaryAngle({
    secondaryPhotoBase64: opts.secondaryPhotoBase64,
    secondaryPhotoMime: opts.secondaryPhotoMime,
    heroBase64: opts.heroBase64,
    heroMime: opts.heroMime,
    prompt: opts.prompt,
    seed: opts.seed,
    sessionId: opts.sessionId,
    label: opts.label ?? "viewpoint-secondary",
  });
  return result.images[0] ?? null;
}

export interface GeometryLockInput {
  photoBase64: string;
  photoMime: string;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
  structuralBoxes?: OpeningBox[];
  hasPhotoColumns?: boolean;
  wallNotchDirective?: string;
  sessionId?: string;
  label?: string;
}

/** @deprecated Kontext Stage 1 — delegates to canny img2img. */
export async function runGeometryLockInpaint(input: GeometryLockInput): Promise<{
  base64: string;
  mimeType: string;
  url: string;
}> {
  const result = await renderFluxCannyImg2Img({
    photoBase64: input.photoBase64,
    photoMime: input.photoMime,
    prompt: buildGeometryLockPrompt({
      hasPhotoColumns: !!input.hasPhotoColumns,
      wallNotchDirective: input.wallNotchDirective,
    }),
    sessionId: input.sessionId,
    label: input.label ?? "geometry-lock",
  });

  if (!result.images[0]) throw new Error("Geometry-lock render returned no image");

  const buf = Buffer.from(result.images[0].base64, "base64");
  const url = await uploadPublicImage(buf, result.images[0].mimeType, {
    sessionId: input.sessionId,
    type: "generated",
  });

  return { base64: result.images[0].base64, mimeType: result.images[0].mimeType, url };
}
