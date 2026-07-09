import { createHash } from "crypto";
import type { UserPreferences } from "@/lib/project/types";

export const STYLE_REF_FAILURE_WARNING =
  "Style reference could not be generated — design mood may be less accurate.";

export const STRUCTURAL_FALLBACK_WARNING =
  "Design styling failed structural check — result may not match room layout.";

export const COMPOSITE_RENDER_WARNING =
  "Design may not match room layout or furniture list — try regenerating.";

export const FURNISH_RETRY_OPENING_DRIFT_WARNING =
  "Furniture retry changed room openings — showing previous render.";

export const INPAINT_FURNISH_INCOMPLETE_WARNING =
  "Furnishing could not be completed — showing structurally correct render. Try regenerating.";

export type StyleReferenceSource = "user" | "gemini" | "none";

export interface CachedStyleReferenceHitResult {
  urls: string[];
  source: "gemini";
  count: number;
  geminiFallbackFailed: false;
}

/** Cache hit — plate already in room.styleReferenceCache; omit cacheEntry to skip redundant Redis persist. */
export function buildCachedStyleReferenceHitResult(url: string): CachedStyleReferenceHitResult {
  return {
    urls: [url],
    source: "gemini",
    count: 1,
    geminiFallbackFailed: false,
  };
}

export interface StyleReferenceUploadLike {
  base64: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function computeStyleReferenceCacheKey(input: {
  conceptPrompt?: string;
  preferences: UserPreferences;
  photoId?: string;
  inspirationUploads: StyleReferenceUploadLike[];
  geminiStyleInputBase64?: string;
}): string {
  const inspirationHash =
    input.inspirationUploads.length === 0
      ? "none"
      : sha256(input.inspirationUploads.map((u) => u.base64).join("|"));

  const usePhoto = (process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO || "").trim() === "1";
  const photoHash = usePhoto && input.geminiStyleInputBase64
    ? sha256(input.geminiStyleInputBase64)
    : "brief-only";

  return sha256(
    [
      input.conceptPrompt ?? "",
      input.preferences.wishes ?? "",
      input.preferences.style ?? "",
      input.preferences.budgetTier ?? "",
      input.photoId ?? "",
      inspirationHash,
      photoHash,
      usePhoto ? "with-photo" : "brief-only",
    ].join("|"),
  );
}

export function mergeFalPipelineWarnings(
  ...clauses: (string | undefined)[]
): string | undefined {
  const parts = clauses.filter((p): p is string => !!p?.trim());
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** True when Gemini style plate generation should run (no user uploads, plate enabled). */
export function shouldGenerateGeminiStylePlate(
  inspirationUploads: StyleReferenceUploadLike[],
): boolean {
  if (inspirationUploads.length > 0) return false;
  return (process.env.VISTA_FAL_STYLE_PLATE || "").trim() !== "0";
}

export const STYLE_REF_OUTPUT_MAX_EDGE = 1024;

export type GeminiStyleInputSource = "hero" | "none" | "brief_only";

/** Optional room photo hint for Gemini style plate — never Stage 1 empty shell. */
export function pickGeminiStyleInput(input: {
  heroPhotoBase64: string;
  heroPhotoMime: string;
}): { base64?: string; mimeType?: string; source: GeminiStyleInputSource } {
  const usePhoto = (process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO || "").trim() === "1";
  if (!usePhoto) {
    return { source: "brief_only" };
  }
  if (input.heroPhotoBase64?.trim()) {
    return {
      base64: input.heroPhotoBase64,
      mimeType: input.heroPhotoMime,
      source: "hero",
    };
  }
  return { source: "none" };
}

/** Kontext image_urls: room photo first, then style refs and optional product cutouts. Geometry is text-only. */
export function buildKontextImageUrls(input: {
  baseUrl: string;
  styleReferenceUrls?: string[];
  productImageUrls?: string[];
  retryPrimaryUrl?: string;
}): string[] {
  const base = input.retryPrimaryUrl ?? input.baseUrl;
  const urls = [base];
  if (input.styleReferenceUrls?.length) urls.push(...input.styleReferenceUrls);
  if (input.productImageUrls?.length) urls.push(...input.productImageUrls);
  return urls;
}

export function buildImageRolesBlock(opts: {
  styleRefCount: number;
  geminiStyleRef?: boolean;
  hasStructuralMarkup?: boolean;
  /** Secondary viewpoint: hero render is a design reference, not a style mood board. */
  heroDesignRef?: boolean;
}): string {
  const lines = [
    "IMAGE ROLES (strict):",
    "- image_urls[0] = TARGET ROOM — preserve walls, corners, openings, camera exactly.",
    "Output a single full-frame photoreal interior photograph — no collage, split screen, inset panels, or floor-plan overlay.",
  ];
  let styleStart = 1;
  if (opts.hasStructuralMarkup) {
    lines.push(
      "- image_urls[1] = STRUCTURAL MARKUP — user-marked junction lines on this room (floor-wall, wall-ceiling, corners). Preserve this exact geometry and camera; do NOT reproduce the gold markup lines in the output.",
    );
    styleStart = 2;
  }
  if (opts.styleRefCount > 0) {
    const refRange =
      opts.styleRefCount === 1
        ? `image_urls[${styleStart}]`
        : `image_urls[${styleStart}..${styleStart + opts.styleRefCount - 1}]`;
    lines.push(
      `- ${refRange} = STYLE REFERENCES — copy palette, materials, furniture character, lux mood.`,
      "  NEVER copy room shape, openings, or camera from style references.",
      "  Style references show how THIS room should look when furnished — match their design, not their pixels literally.",
    );
    if (opts.heroDesignRef) {
      lines.push(
        "  The hero reference is an approved design of this SAME room from another angle — match furniture, finishes, and palette only.",
        "  Decorative items — rug, cushions, wall art, curtains, plants — must be the identical items from the master design, not similar alternatives.",
        "  Render that design as seen from image_urls[0]'s camera — never reproduce the hero's camera angle, wall composition, or openings.",
        "  Walls and openings not visible in image_urls[0] must not appear in the output.",
      );
    } else if (opts.geminiStyleRef) {
      lines.push(
        `  Reference [${styleStart}] is a Gemini DESIGN CONCEPT image — copy palette, materials, furniture character, and mood only. NEVER copy its walls, openings, camera angle, or room shape. [0] defines all structure.`,
      );
    } else {
      lines.push(
        `  Reference [${styleStart}] is the user's STYLE INSPIRATION photo — borrow palette, materials, furniture character, and mood ONLY. NEVER copy its walls, openings, camera angle, room shape, or layout. image_urls[0] defines all structure.`,
      );
    }
  }
  if (opts.hasStructuralMarkup) {
    lines.push(
      "TASK: Generate a fully furnished photoreal interior photograph of image_urls[0], honoring structural layout from the markup reference and design mood from style references. Replace unfinished surfaces; add real furniture, lighting, and finishes.",
    );
  }
  return lines.join("\n");
}
