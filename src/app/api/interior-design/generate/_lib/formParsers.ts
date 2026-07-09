import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";
import type { SurfaceMaterialOverrides } from "@/lib/falPipelinePrompt";

const MAX_INSPIRATION_IMAGES = 10;
const MAX_STYLE_INSPIRATION_IMAGES = 4;

export interface InspirationItem {
  base64: string;
  mimeType: string;
  label: string;
}

export async function parseInspirationProducts(formData: FormData): Promise<InspirationItem[]> {
  const labels = formData.getAll("inspirationLabels") as string[];
  const files = formData.getAll("inspirationImages") as File[];
  const urls = formData.getAll("inspirationUrls") as string[];

  // Each file/url consumes one positional label slot (files first, then urls), matching
  // the original sequential labelIdx counter. Optimize/fetch all in parallel, then keep
  // successful items in order and apply the cap — output is identical to the loop version.
  const fileTasks = files.map(async (file, i): Promise<InspirationItem | null> => {
    try {
      const bytes = await file.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes));
      return { base64: optimized.base64, mimeType: optimized.mimeType, label: labels[i] || "" };
    } catch { return null; /* skip bad file */ }
  });

  const urlTasks = urls.map(async (url, j): Promise<InspirationItem | null> => {
    if (!/^https?:\/\//i.test(url)) return null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(arr));
      return { base64: optimized.base64, mimeType: optimized.mimeType, label: labels[files.length + j] || "" };
    } catch { return null; /* skip bad url */ }
  });

  const settled = await Promise.all([...fileTasks, ...urlTasks]);
  return settled
    .filter((item): item is InspirationItem => item !== null)
    .slice(0, MAX_INSPIRATION_IMAGES);
}

export interface StyleInspirationItem {
  base64: string;
  mimeType: string;
}

export async function parseStyleInspirationImages(formData: FormData): Promise<StyleInspirationItem[]> {
  const files = formData.getAll("styleInspirationImages") as File[];

  // Optimize all candidate files in parallel, keep successful ones in order, then apply cap.
  const settled = await Promise.all(
    files.map(async (file): Promise<StyleInspirationItem | null> => {
      try {
        const bytes = await file.arrayBuffer();
        const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes));
        return { base64: optimized.base64, mimeType: optimized.mimeType };
      } catch { return null; /* skip bad file */ }
    }),
  );

  return settled
    .filter((item): item is StyleInspirationItem => item !== null)
    .slice(0, MAX_STYLE_INSPIRATION_IMAGES);
}

export function parseNumericIdListFromForm(formData: FormData, field: string): number[] {
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

export function parseDesignBoardProductIds(formData: FormData): number[] {
  return parseNumericIdListFromForm(formData, "designBoardProductIds");
}

export function parseStructuralLineMapFromForm(formData: FormData): {
  base64: string;
  mimeType: string;
  strokeOnly: boolean;
} | null {
  const base64 = String(formData.get("structuralLineMapBase64") ?? "").trim();
  if (!base64) return null;
  const mimeType = String(formData.get("structuralLineMapMime") ?? "image/png").trim() || "image/png";
  const strokeOnlyRaw = String(formData.get("structuralLineStrokeOnly") ?? "").trim();
  const strokeOnly = strokeOnlyRaw === "true" || strokeOnlyRaw === "1";
  return { base64, mimeType, strokeOnly };
}

export function parseObjectRemovalMaskFromForm(formData: FormData): {
  base64: string;
  mimeType: string;
} | null {
  const base64 = String(formData.get("objectRemovalMaskBase64") ?? "").trim();
  if (!base64) return null;
  const mimeType = String(formData.get("objectRemovalMaskMime") ?? "image/png").trim() || "image/png";
  return { base64, mimeType };
}

export function parseSurfaceMaterialsFromForm(formData: FormData): SurfaceMaterialOverrides | undefined {
  const raw = String(formData.get("surfaceMaterials") ?? "").trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as SurfaceMaterialOverrides;
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
