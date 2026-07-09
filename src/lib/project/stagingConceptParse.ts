import { assembleStagingPrompt } from "./stagingPromptAssembly";
import type {
  DetectedRoom,
  FloorPlanAnalysis,
  PhotoRenderPrompt,
  RoomFinishLock,
  RoomRenderPlan,
} from "./types";

export const DESIGN_CONCEPT_MIN_WORDS = 250;
export const DESIGN_CONCEPT_TARGET_MIN_WORDS = 300;
export const DESIGN_CONCEPT_TARGET_MAX_WORDS = 400;
export const STAGING_PROMPT_MIN_CHARS = 80;
export const STAGING_PROMPT_MAX_CHARS = 220;
export const FURNITURE_LAYOUT_LOCK_MIN_CHARS = 24;

export const MULTI_VIEW_LAYOUT_LOCK_ERROR =
  "Re-create design concept — multi-view rooms need a furniture layout lock.";

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function clampDesignConceptWords(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= DESIGN_CONCEPT_TARGET_MAX_WORDS) return words.join(" ");
  return words.slice(0, DESIGN_CONCEPT_TARGET_MAX_WORDS).join(" ");
}

export function clampStagingPrompt(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= STAGING_PROMPT_MAX_CHARS) return trimmed;
  return trimmed.slice(0, STAGING_PROMPT_MAX_CHARS - 1).trimEnd() + "…";
}

export function buildStagingPromptFromConcept(
  designConcept: string,
  room?: DetectedRoom,
  style?: string,
): string {
  const roomLabel = room?.name ?? "room";
  const styleBit = style?.trim() || "modern neutral";
  const excerpt = designConcept
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const base = `Furnish this ${roomLabel.toLowerCase()} with ${excerpt}`;
  return clampStagingPrompt(
    base.length >= STAGING_PROMPT_MIN_CHARS
      ? base
      : `${base} in ${styleBit} style with cohesive materials and warm layered lighting.`,
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

export function parseFinishLock(raw: unknown): RoomFinishLock | undefined {
  if (!isRecord(raw)) return undefined;
  const floorMaterial = asStr(raw.floorMaterial);
  const ceilingDesign = asStr(raw.ceilingDesign);
  const wallColor = asStr(raw.wallColor);
  const lightingConcept = asStr(raw.lightingConcept);
  if (!floorMaterial && !ceilingDesign && !wallColor) return undefined;
  return {
    floorMaterial: floorMaterial || "neutral floor finish",
    ceilingDesign: ceilingDesign || "flat white ceiling",
    wallColor: wallColor || "soft neutral walls",
    lightingConcept: lightingConcept || "warm balanced lighting",
    paletteSummary: asStr(raw.paletteSummary) || undefined,
  };
}

const REMODELING_VOCAB =
  /\b(tray|cove|soffit|coffer|recessed panel|bulkhead|built[- ]in(?:\s+led)?|paneling|panelling|niche|beam|led channel|perimeter step|coffered)\b/gi;

/** Strip architectural remodeling language — surface finishes only. */
export function sanitizeSurfaceFinishText(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed
    .replace(REMODELING_VOCAB, "")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 8) return fallback;
  return cleaned;
}

export function sanitizeFinishLock(lock: RoomFinishLock): RoomFinishLock {
  return {
    ...lock,
    ceilingDesign: sanitizeSurfaceFinishText(lock.ceilingDesign, "flat painted ceiling"),
    wallColor: sanitizeSurfaceFinishText(lock.wallColor, "soft neutral walls"),
    lightingConcept: sanitizeSurfaceFinishText(
      lock.lightingConcept,
      "warm surface-mounted and freestanding lighting",
    ),
    paletteSummary: lock.paletteSummary
      ? sanitizeSurfaceFinishText(lock.paletteSummary, lock.paletteSummary)
      : undefined,
  };
}

export function buildFinishLockFromPlan(plan: Pick<
  RoomRenderPlan,
  "finishLock" | "floorMaterial" | "wallColor" | "ceilingDesign" | "lightingConcept"
>): RoomFinishLock {
  if (plan.finishLock) return sanitizeFinishLock(plan.finishLock);
  return sanitizeFinishLock({
    floorMaterial: plan.floorMaterial?.trim() || "neutral floor finish",
    ceilingDesign: plan.ceilingDesign?.trim() || "flat white ceiling",
    wallColor: plan.wallColor?.trim() || "soft neutral walls",
    lightingConcept: plan.lightingConcept?.trim() || "warm balanced lighting",
  });
}

/** Compact finish phrase repeated at the start of every per-photo staging prompt. */
export function buildFinishLockSnippet(finishLock: RoomFinishLock): string {
  const sanitized = sanitizeFinishLock(finishLock);
  const palette = sanitized.paletteSummary?.trim();
  const base = `${sanitized.wallColor} walls, ${sanitized.floorMaterial} floor, ${sanitized.ceilingDesign} ceiling`;
  return palette ? `${base}, ${palette}` : base;
}

export type PhotoMatrixEntry = {
  photoId: string;
  label?: string;
  cameraNote?: string | null;
};

export function parsePhotoPrompts(raw: unknown): PhotoRenderPrompt[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PhotoRenderPrompt[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const photoId = asStr(item.photoId);
    const stagingRaw = asStr(item.stagingPrompt);
    const renderInstruction = asStr(item.renderInstruction) || undefined;
    if (!photoId || (!stagingRaw && !renderInstruction)) continue;
    out.push({
      photoId,
      label: asStr(item.label) || undefined,
      stagingPrompt: stagingRaw ? clampStagingPrompt(stagingRaw) : "",
      renderInstruction,
      cameraNote: asStr(item.cameraNote) || undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}

export function deriveFurnitureLayoutLockFallback(plan: RoomRenderPlan): string {
  const explicit = plan.furnitureLayoutLock?.trim();
  if (explicit && explicit.length >= FURNITURE_LAYOUT_LOCK_MIN_CHARS) return explicit;

  const fromStaging = plan.stagingPrompt?.trim();
  if (fromStaging) {
    const furnish = fromStaging.replace(/^Furnish this[^,]*,\s*/i, "").trim();
    if (furnish.length >= FURNITURE_LAYOUT_LOCK_MIN_CHARS) return furnish.slice(0, 300);
  }

  if (plan.furnitureList?.length) {
    const list = plan.furnitureList.slice(0, 10).join(", ");
    return `Place ${list} in fixed positions that do not move between camera angles.`;
  }

  const excerpt = plan.designConcept.replace(/\s+/g, " ").trim().slice(0, 300);
  if (excerpt.length >= FURNITURE_LAYOUT_LOCK_MIN_CHARS) return excerpt;

  return "";
}

export function requireFurnitureLayoutLock(
  plan: RoomRenderPlan | undefined,
  photoCount: number,
): { lock: string; derived: boolean } {
  if (photoCount < 2) return { lock: "", derived: false };
  if (!plan) throw new Error(MULTI_VIEW_LAYOUT_LOCK_ERROR);

  const explicit = plan.furnitureLayoutLock?.trim();
  if (explicit && explicit.length >= FURNITURE_LAYOUT_LOCK_MIN_CHARS) {
    return { lock: explicit, derived: false };
  }

  const derived = deriveFurnitureLayoutLockFallback(plan);
  if (derived.length >= FURNITURE_LAYOUT_LOCK_MIN_CHARS) {
    return { lock: derived, derived: true };
  }

  throw new Error(MULTI_VIEW_LAYOUT_LOCK_ERROR);
}

export function buildSecondaryStagingPrompt(
  plan: RoomRenderPlan,
  layoutLock: string,
  openingLock?: string,
  editFeedback?: string,
): string {
  const finishLock = buildFinishLockFromPlan(plan);
  const finishSnippet = buildFinishLockSnippet(finishLock);
  const body = [finishSnippet, layoutLock].filter(Boolean).join(". ").replace(/\s+/g, " ").trim();
  return assembleStagingPrompt({
    openingLock,
    body,
    editFeedback,
  });
}

export function buildPhotoStagingPromptFromPlan(
  plan: RoomRenderPlan,
  photoId: string,
  cameraNote?: string | null,
): string {
  const finishLock = buildFinishLockFromPlan(plan);
  const finishSnippet = buildFinishLockSnippet(finishLock);
  const layoutLock = deriveFurnitureLayoutLockFallback(plan);
  const perPhoto = plan.photoPrompts?.find((p) => p.photoId === photoId);
  const camera = cameraNote?.trim() || perPhoto?.cameraNote?.trim();
  const visibleSubset = camera ? `Visible from this camera: ${camera.slice(0, 60)}.` : "";
  const lockPart = layoutLock ? `${layoutLock}.` : "";
  return clampStagingPrompt(
    `${finishSnippet}. ${lockPart} ${visibleSubset}`.replace(/\s+/g, " ").trim(),
  );
}

export function ensurePhotoPromptsForRoom(
  plan: RoomRenderPlan,
  matrixPhotos: PhotoMatrixEntry[],
): RoomRenderPlan {
  if (matrixPhotos.length === 0) return plan;

  const byId = new Map((plan.photoPrompts ?? []).map((p) => [p.photoId, p]));
  const photoPrompts: PhotoRenderPrompt[] = matrixPhotos.map((entry) => {
    const existing = byId.get(entry.photoId);
    if (existing?.stagingPrompt || existing?.renderInstruction) return existing;
    return {
      photoId: entry.photoId,
      label: entry.label,
      stagingPrompt: buildPhotoStagingPromptFromPlan(plan, entry.photoId, entry.cameraNote),
      cameraNote: entry.cameraNote ?? undefined,
    };
  });

  const heroPrompt = photoPrompts[0]?.stagingPrompt ?? plan.stagingPrompt;

  return {
    ...plan,
    finishLock: plan.finishLock ?? buildFinishLockFromPlan(plan),
    photoPrompts,
    stagingPrompt: heroPrompt ?? plan.stagingPrompt,
  };
}

export function padDesignConceptToMinimum(
  text: string,
  room: DetectedRoom,
  styleLabel: string,
): string {
  let out = text.trim();
  const area = room.estimatedArea ? `${room.estimatedArea.toFixed(1)} m²` : "unknown area";
  const filler = `This ${room.type} (${room.name}, ~${area}) uses ${styleLabel} styling. Furniture must be freestanding, scaled to real dimensions, and must not block doors, windows, or circulation paths shown on the plan. Materials, palette, and lighting stay cohesive with the apartment-wide concept. Layer warm indirect lighting with balanced accents for a photorealistic staged look.`;
  while (countWords(out) < DESIGN_CONCEPT_MIN_WORDS) {
    out = `${out} ${filler}`;
  }
  return clampDesignConceptWords(out);
}

export interface ParsedConceptResponse {
  plans: Record<string, RoomRenderPlan>;
  overallConcept?: string;
  overallStyle?: string;
}

export function parseAllRoomsStagingResponse(
  raw: unknown,
  analysis: FloorPlanAnalysis,
  photoMatrix?: Record<string, PhotoMatrixEntry[]>,
): ParsedConceptResponse {
  const o = isRecord(raw) ? raw : {};
  const rows = Array.isArray(o.rooms) ? o.rooms : [];
  const byId = new Map<string, RoomRenderPlan>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const roomId = typeof row.roomId === "string" ? row.roomId.trim() : "";
    if (!roomId) continue;
    const detected = analysis.rooms.find((r) => r.id === roomId);
    const rawConcept =
      typeof row.designConcept === "string"
        ? row.designConcept
        : typeof row.geminiPrompt === "string"
          ? row.geminiPrompt
          : "";
    const wordCount = countWords(rawConcept);
    if (wordCount < DESIGN_CONCEPT_MIN_WORDS && rawConcept.length < 1500) continue;

    let designConcept =
      wordCount >= DESIGN_CONCEPT_MIN_WORDS ? clampDesignConceptWords(rawConcept) : rawConcept.trim();

    if (countWords(designConcept) < DESIGN_CONCEPT_MIN_WORDS && detected) {
      designConcept = padDesignConceptToMinimum(designConcept, detected, asStr(row.style, ""));
    }

    const stagingRaw = typeof row.stagingPrompt === "string" ? row.stagingPrompt.trim() : "";
    const stagingPrompt = stagingRaw
      ? clampStagingPrompt(stagingRaw)
      : buildStagingPromptFromConcept(designConcept, detected, asStr(row.style, ""));

    const furnitureLayoutLockRaw =
      typeof row.furnitureLayoutLock === "string" ? row.furnitureLayoutLock.trim() : "";

    let plan: RoomRenderPlan = {
      roomId,
      roomName:
        typeof row.roomName === "string" && row.roomName.trim()
          ? row.roomName.trim()
          : detected?.name ?? roomId,
      designConcept,
      stagingPrompt,
      geminiPrompt: designConcept,
      finishLock: parseFinishLock(row.finishLock),
      furnitureLayoutLock: furnitureLayoutLockRaw || undefined,
      photoPrompts: parsePhotoPrompts(row.photoPrompts),
      style: asStr(row.style, ""),
      primaryColor: asStr(row.primaryColor, ""),
      accentColor: asStr(row.accentColor, ""),
      materials: asStrArr(row.materials),
      mood: asStr(row.mood, ""),
      furnitureList: asStrArr(row.furnitureList),
      floorMaterial: asStr(row.floorMaterial, ""),
      wallColor: asStr(row.wallColor, ""),
      ceilingDesign: asStr(row.ceilingDesign, ""),
      lightingConcept: asStr(row.lightingConcept, ""),
    };

    const matrixPhotos = photoMatrix?.[roomId] ?? [];
    plan = ensurePhotoPromptsForRoom(plan, matrixPhotos);
    byId.set(roomId, plan);
  }

  return {
    plans: Object.fromEntries(byId),
    overallConcept: asStr(o.overallConcept, ""),
    overallStyle: asStr(o.overallStyle, ""),
  };
}
