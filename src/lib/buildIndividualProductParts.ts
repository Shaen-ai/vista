import "server-only";

import {
  fetchCatalogImageBuffer,
  isFlooringMaterial,
  isMultiViewFurniture,
  type CatalogItemSummary,
} from "@/lib/consumerCatalog";
import { logGeminiIndividualPayload } from "@/lib/logGeminiProductImages";
import { normalizeProductImageForGemini } from "@/lib/optimizeImageForAi";
import { type DesignPhase, PHASE_PRODUCT_LIMITS } from "@/lib/phaseRouter";
import {
  buildCollageSheetsForGroup,
  COLLAGE_MAX_IMAGES,
  type CollageCellInput,
} from "@/lib/productReferenceCollage";

const MULTI_VIEW_MAX = 3;

type ReferenceKind = "single" | "multi_view" | "material_collage";

export interface IndividualProductPart {
  catalogId: string;
  label: string;
  referenceKind: ReferenceKind;
  views: Array<{ mimeType: string; data: string }>;
  sourceUrls: string[];
}

export interface UserUploadPart {
  label: string;
  inlineData: { mimeType: string; data: string };
}

export interface BuildIndividualPartsResult {
  productParts: IndividualProductPart[];
  uploadParts: UserUploadPart[];
  fetchFailedIds: string[];
}

async function fetchAndNormalize(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8500);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok || res.status >= 400) return null;
    const arr = await res.arrayBuffer();
    if (arr.byteLength === 0) return null;
    const normalized = await normalizeProductImageForGemini(Buffer.from(arr));
    return normalized.buffer;
  } catch {
    return null;
  }
}

/** Resolve up to `max` reference image URLs for a product (gallery first, then clean/primary). */
function resolveReferenceUrls(row: CatalogItemSummary, max: number): string[] {
  const candidates = [
    ...(row.galleryUrls ?? []),
    row.cleanImageUrl ?? "",
    row.primaryImageUrl ?? "",
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of candidates) {
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** Build a 2×2 collage of a flooring material's own photos for texture fidelity. */
async function buildFlooringCollageView(
  row: CatalogItemSummary,
): Promise<{ mimeType: string; data: string } | null> {
  const urls = resolveReferenceUrls(row, COLLAGE_MAX_IMAGES);
  if (urls.length === 0) return null;
  const buffers = await Promise.all(urls.map((url) => fetchCatalogImageBuffer(url)));
  const cells: CollageCellInput[] = [];
  buffers.forEach((buffer, i) => {
    if (buffer) cells.push({ candidateId: `${row.id}-floor-${i}`, buffer, role: "catalog_product", catalogId: row.id });
  });
  if (cells.length === 0) return null;
  const sheets = await buildCollageSheetsForGroup(cells, "catalog", 0);
  return sheets[0]?.inlineData ?? null;
}

export async function buildIndividualProductParts(opts: {
  selectedCatalogIds: string[];
  catalogById: Map<string, CatalogItemSummary>;
  phase: DesignPhase;
  userUploads?: Array<{ base64: string; mimeType: string; label: string }>;
}): Promise<BuildIndividualPartsResult> {
  const limit = PHASE_PRODUCT_LIMITS[opts.phase];
  const productParts: IndividualProductPart[] = [];
  const fetchFailedIds: string[] = [];

  const ids = opts.selectedCatalogIds.slice(0, limit);

  for (const id of ids) {
    const row = opts.catalogById.get(id);
    if (!row) {
      fetchFailedIds.push(id);
      continue;
    }

    const sizeParts = [row.width_cm, row.depth_cm, row.height_cm]
      .filter((v) => v > 0)
      .map((v) => `${v}cm`);
    const sizeStr = sizeParts.length > 0 ? ` (${sizeParts.join("x")})` : "";
    const basePart = { catalogId: id, label: `${row.name}${sizeStr}` };

    // Flooring material (base phase): 2×2 collage of the material's own photos.
    if (opts.phase === "base" && isFlooringMaterial(row)) {
      const collage = await buildFlooringCollageView(row);
      if (collage) {
        productParts.push({ ...basePart, referenceKind: "material_collage", views: [collage], sourceUrls: resolveReferenceUrls(row, COLLAGE_MAX_IMAGES) });
        continue;
      }
      // fall through to single-image handling if collage could not be built
    }

    // Structured furniture (wardrobes, sofas, cabinets…): multiple views for structural fidelity.
    if (isMultiViewFurniture(row)) {
      const urls = resolveReferenceUrls(row, MULTI_VIEW_MAX);
      const buffers = (await Promise.all(urls.map((url) => fetchAndNormalize(url)))).filter(
        (b): b is Buffer => Boolean(b),
      );
      if (buffers.length > 0) {
        productParts.push({
          ...basePart,
          referenceKind: buffers.length > 1 ? "multi_view" : "single",
          views: buffers.map((b) => ({ mimeType: "image/jpeg", data: b.toString("base64") })),
          sourceUrls: urls,
        });
        continue;
      }
      fetchFailedIds.push(id);
      continue;
    }

    // Default: single reference image.
    const url = row.cleanImageUrl || row.primaryImageUrl;
    if (!url || !/^https?:\/\//i.test(url)) {
      fetchFailedIds.push(id);
      continue;
    }
    const buffer = await fetchAndNormalize(url);
    if (!buffer) {
      fetchFailedIds.push(id);
      continue;
    }
    productParts.push({
      ...basePart,
      referenceKind: "single",
      views: [{ mimeType: "image/jpeg", data: buffer.toString("base64") }],
      sourceUrls: [url],
    });
  }

  const uploadParts: UserUploadPart[] = [];
  for (const upload of opts.userUploads ?? []) {
    try {
      const buf = Buffer.from(upload.base64, "base64");
      const normalized = await normalizeProductImageForGemini(buf);
      uploadParts.push({
        label: upload.label || "User product",
        inlineData: {
          mimeType: "image/jpeg",
          data: normalized.base64,
        },
      });
    } catch {
      console.warn("buildIndividualProductParts: skipped user upload");
    }
  }

  logGeminiIndividualPayload({
    phase: opts.phase,
    products: productParts.map((p) => ({
      catalogId: p.catalogId,
      name: p.label,
      referenceKind: p.referenceKind,
      sourceUrls: p.sourceUrls,
      viewByteSizes: p.views.map((v) => Buffer.byteLength(v.data, "base64")),
    })),
    userUploads: uploadParts.map((u) => ({
      label: u.label,
      bytesSent: Buffer.byteLength(u.inlineData.data, "base64"),
    })),
    fetchFailedIds,
    catalogById: opts.catalogById,
  });

  return { productParts, uploadParts, fetchFailedIds };
}

export function buildGeminiPartsFromIndividual(
  result: BuildIndividualPartsResult,
  phase: DesignPhase,
): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  // One logical entry per product/upload; a product may carry multiple views.
  const allItems: Array<{ label: string; views: Array<{ mimeType: string; data: string }> }> = [
    ...result.uploadParts.map((u, i) => ({
      label: `Upload ${i + 1}: ${u.label}`,
      views: [u.inlineData],
    })),
    ...result.productParts.map((p, i) => {
      let suffix = "";
      if (p.referenceKind === "material_collage") {
        suffix =
          " — this reference is a single 2×2 collage of multiple photos of the SAME flooring material; use them together to reproduce its EXACT plank/tile pattern, grain, color, and finish across the whole floor";
      } else if (p.referenceKind === "multi_view") {
        suffix = ` — ${p.views.length} reference views of the SAME item; reproduce its EXACT shape, proportions, frame/structure, color, and material. Where it has doors, drawers, or sections, keep the same count — do NOT add or remove any`;
      }
      return { label: `Product ${i + 1}: ${p.label} [${p.catalogId}]${suffix}`, views: p.views };
    }),
  ];

  if (allItems.length > 0) {
    const phaseLabel = phase === "base" ? "materials/lighting" : phase;
    parts.push({
      text: `PRODUCT REFERENCE IMAGES — ${allItems.length} ${phaseLabel} product(s) to place in the room. Each labelled entry below is ONE product (some show multiple views/photos of the same item). Place these EXACT products in the design.`,
    });
  }

  for (const item of allItems) {
    parts.push({ text: item.label });
    for (const view of item.views) {
      parts.push({ inlineData: view });
    }
  }

  return parts;
}

export const PHASE_REMINDER_TEXT =
  "REMINDER: Use ONLY the exact products shown above. Do not substitute or invent any furniture, material, or decoration. Every product reference image must appear as a real item in the final render. Where a product shows multiple views, preserve its EXACT structure — the same number of doors, drawers, and sections; never add or remove sections.";

export function buildPhasePreservationText(phase: DesignPhase): string {
  if (phase === "base") return "";
  const prev = phase === "furniture" ? "flooring, lighting, curtains, and wall treatments" : "all existing furniture, flooring, lighting, and curtains";
  return `CRITICAL: Do NOT modify, remove, or change the existing ${prev} already present in the room. Only ADD the new ${phase} items shown in the reference images above. The room's existing elements must remain exactly as they are.`;
}
