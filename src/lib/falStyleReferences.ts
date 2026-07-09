import "server-only";

import { uploadPublicImage } from "@/lib/falStorage";
import { generateStyleReferencePlate } from "@/lib/generateStyleReferencePlate";
import { getStylePresetOrDefault } from "@/lib/project/stylePresets";
import { formatBudgetTierLine } from "@/lib/falDesignPrompt";
import { pipelineLog } from "@/lib/pipelineLog";
import { validateStyleReferencePlate } from "@/lib/validateStyleReferencePlate";
import {
  computeStyleReferenceCacheKey,
  STYLE_REF_FAILURE_WARNING,
  buildCachedStyleReferenceHitResult,
} from "@/lib/falStyleReferenceUtils";
import type { UserPreferences } from "@/lib/project/types";

export {
  computeStyleReferenceCacheKey,
  mergeFalPipelineWarnings,
  STYLE_REF_FAILURE_WARNING,
  STRUCTURAL_FALLBACK_WARNING,
  COMPOSITE_RENDER_WARNING,
  FURNISH_RETRY_OPENING_DRIFT_WARNING,
  INPAINT_FURNISH_INCOMPLETE_WARNING,
  buildKontextImageUrls,
  buildImageRolesBlock,
  pickGeminiStyleInput,
  STYLE_REF_OUTPUT_MAX_EDGE,
  shouldGenerateGeminiStylePlate,
} from "@/lib/falStyleReferenceUtils";

export type StyleReferenceSource = "user" | "gemini" | "none";
export type StyleRefResolution = "user" | "gemini" | "none";

export interface StyleReferenceUpload {
  base64: string;
  mimeType: string;
  label?: string;
}

export interface StyleReferenceCacheEntry {
  base64: string;
  mimeType: string;
  cacheKey: string;
  source: "gemini";
}

export interface ResolveStyleReferenceUrlsInput {
  inspirationUploads: StyleReferenceUpload[];
  /** Used only when VISTA_FAL_STYLE_PLATE_USE_PHOTO=1 (optional loose hint for Gemini). */
  geminiStyleInputBase64?: string;
  geminiStyleInputMime?: string;
  conceptPrompt?: string;
  preferences: UserPreferences;
  photoId?: string;
  cached?: StyleReferenceCacheEntry;
  projectId?: string;
  roomId?: string;
  googleKey: string;
}

export interface ResolveStyleReferenceUrlsResult {
  urls: string[];
  source: StyleReferenceSource;
  count: number;
  geminiFallbackFailed: boolean;
  cacheEntry?: StyleReferenceCacheEntry;
  warning?: string;
  stylePlateBase64?: string;
  stylePlateMimeType?: string;
  stylePlateFromCache?: boolean;
  stylePlateValidation?: { furnished: boolean; reason: string };
  styleRefResolution?: StyleRefResolution;
  /** True when user inspiration upload is used directly at Kontext index 1. */
  inspirationUsedAsDirectStyleRef?: boolean;
  /** True when user inspiration was present but rejected or Gemini fallback failed. */
  userStyleRefRejected?: boolean;
}

function buildGeminiStyleBrief(conceptPrompt: string | undefined, preferences: UserPreferences): string {
  const style = getStylePresetOrDefault(preferences.style);
  const parts: string[] = [];
  parts.push(`Style: ${style.label}. ${style.keywords}.`);
  parts.push(formatBudgetTierLine(preferences.budgetTier));
  if (preferences.wishes?.trim()) parts.push(`Client wishes: ${preferences.wishes.trim()}`);
  if (conceptPrompt?.trim()) parts.push(conceptPrompt.trim());
  return parts.join("\n\n");
}

function stylePlateUsesRoomPhoto(): boolean {
  return (process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO || "").trim() === "1";
}

async function resolveGeminiStyleReferenceUrls(
  input: ResolveStyleReferenceUrlsInput,
  styleBrief: string,
): Promise<ResolveStyleReferenceUrlsResult> {
  if ((process.env.VISTA_FAL_STYLE_PLATE || "").trim() === "0") {
    pipelineLog("FAL_PIPELINE", "style plate skipped (VISTA_FAL_STYLE_PLATE=0)", {
      projectId: input.projectId,
      roomId: input.roomId,
    });
    return {
      urls: [],
      source: "none",
      count: 0,
      geminiFallbackFailed: true,
      warning: STYLE_REF_FAILURE_WARNING,
      styleRefResolution: "none",
    };
  }

  const cacheKey = computeStyleReferenceCacheKey(input);
  if (input.cached?.cacheKey === cacheKey && input.cached.base64) {
    const url = await uploadPublicImage(
      Buffer.from(input.cached.base64, "base64"),
      input.cached.mimeType || "image/jpeg",
      { sessionId: input.projectId, type: "generated", label: "style-plate-cached" },
    );
    pipelineLog("FAL_PIPELINE", "style ref routing — gemini plate from cache", {
      projectId: input.projectId,
      roomId: input.roomId,
      url,
      plateBytes: input.cached.base64.length,
    });
    return {
      ...buildCachedStyleReferenceHitResult(url),
      stylePlateBase64: input.cached.base64,
      stylePlateMimeType: input.cached.mimeType || "image/jpeg",
      stylePlateFromCache: true,
      styleRefResolution: "gemini",
    };
  }

  const usePhoto = stylePlateUsesRoomPhoto();
  const plate = await generateStyleReferencePlate({
    googleApiKey: input.googleKey,
    styleBrief,
    roomImage:
      usePhoto && input.geminiStyleInputBase64
        ? {
            base64: input.geminiStyleInputBase64,
            mimeType: input.geminiStyleInputMime || "image/jpeg",
          }
        : undefined,
    projectId: input.projectId,
    roomId: input.roomId,
  });

  if (!plate.ok || !plate.base64) {
    pipelineLog(
      "FAL_PIPELINE",
      "gemini design context failed",
      { projectId: input.projectId, roomId: input.roomId, reason: plate.reason?.slice(0, 200) },
      "warn",
    );
    return {
      urls: [],
      source: "none",
      count: 0,
      geminiFallbackFailed: true,
      warning: STYLE_REF_FAILURE_WARNING,
      styleRefResolution: "none",
    };
  }

  pipelineLog("FAL_PIPELINE", "style plate — upload starting", {
    projectId: input.projectId,
    roomId: input.roomId,
    plateBytes: plate.base64.length,
  });

  const url = await uploadPublicImage(
    Buffer.from(plate.base64, "base64"),
    plate.mimeType || "image/jpeg",
    { sessionId: input.projectId, type: "generated", label: "style-plate" },
  );

  pipelineLog("FAL_PIPELINE", "style ref routing — gemini plate generated", {
    projectId: input.projectId,
    roomId: input.roomId,
    url,
    plateBytes: plate.base64.length,
  });

  const cacheEntry: StyleReferenceCacheEntry = {
    base64: plate.base64,
    mimeType: plate.mimeType || "image/jpeg",
    cacheKey,
    source: "gemini",
  };

  return {
    urls: [url],
    source: "gemini",
    count: 1,
    geminiFallbackFailed: false,
    cacheEntry,
    stylePlateBase64: plate.base64,
    stylePlateMimeType: plate.mimeType || "image/jpeg",
    stylePlateFromCache: false,
    stylePlateValidation: plate.stylePlateValidation,
    styleRefResolution: "gemini",
  };
}

async function resolveUserStyleReferenceUrls(
  input: ResolveStyleReferenceUrlsInput,
  styleBrief: string,
  userUploads: StyleReferenceUpload[],
): Promise<ResolveStyleReferenceUrlsResult> {
  const validatedUrls: string[] = [];
  for (const upload of userUploads) {
    const validation = await validateStyleReferencePlate({
      renderedBase64: upload.base64,
      renderedMime: upload.mimeType || "image/jpeg",
      styleBrief,
    });
    if (!validation.furnished) {
      pipelineLog(
        "FAL_PIPELINE",
        "user style ref rejected — not furnished",
        {
          projectId: input.projectId,
          roomId: input.roomId,
          reason: validation.reason.slice(0, 120),
        },
        "warn",
      );
      continue;
    }
    const url = await uploadPublicImage(
      Buffer.from(upload.base64, "base64"),
      upload.mimeType || "image/jpeg",
      { sessionId: input.projectId, type: "generated", label: "user-style-ref" },
    );
    validatedUrls.push(url);
  }

  if (validatedUrls.length > 0) {
    pipelineLog("FAL_PIPELINE", "style ref routing — user inspiration direct", {
      projectId: input.projectId,
      roomId: input.roomId,
      count: validatedUrls.length,
      urls: validatedUrls,
    });
    return {
      urls: validatedUrls,
      source: "user",
      count: validatedUrls.length,
      geminiFallbackFailed: false,
      styleRefResolution: "user",
      inspirationUsedAsDirectStyleRef: true,
    };
  }

  pipelineLog("FAL_PIPELINE", "style ref routing — all user uploads rejected, trying gemini", {
    projectId: input.projectId,
    roomId: input.roomId,
  });
  const gemini = await resolveGeminiStyleReferenceUrls(input, styleBrief);
  return { ...gemini, userStyleRefRejected: true };
}

export async function resolveStyleReferenceUrls(
  input: ResolveStyleReferenceUrlsInput,
): Promise<ResolveStyleReferenceUrlsResult> {
  const userUploads = input.inspirationUploads.slice(0, 4);
  const styleBrief = buildGeminiStyleBrief(input.conceptPrompt, input.preferences);

  if (userUploads.length > 0) {
    return resolveUserStyleReferenceUrls(input, styleBrief, userUploads);
  }

  return resolveGeminiStyleReferenceUrls(input, styleBrief);
}
