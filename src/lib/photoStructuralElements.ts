import type { OpeningBox, RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type {
  PhotoConfirmedStructuralElement,
  StructuralMemberType,
  ViewpointPhotoAnalysis,
  ViewpointStructuralMember,
} from "@/lib/project/types";

export const PHOTO_STRUCTURAL_MANDATE =
  "PRESERVE COLUMNS: Keep every frozen structural member at its exact position and volume; finish surfaces only — never remove or flatten.";

export const PHOTO_STRUCTURAL_PROMPT_MAX = 340;
export const PHOTO_STRUCTURAL_PROMPT_ELEMENT_MAX = 3;

const COLUMN_TYPES = new Set<StructuralMemberType>(["column", "post", "pier"]);

const BORDERLINE_AREA_MIN = 0.005;
const BORDERLINE_AREA_MAX = 0.008;
const CONFIRMED_AREA_MIN = 0.008;

const COLUMN_KEYWORD =
  /\b(column|post|pillar|pier|load[- ]bearing)\b/i;

const NEGATION_BEFORE_KEYWORD =
  /(?:\bno\b|\bnot\b|\bwithout\b|\bnone\b|\bno visible\b)[^.]{0,20}\b(column|post|pillar|pier|load[- ]bearing)\b/i;

export interface PhotoStructuralGateLog {
  candidates: number;
  confirmed: number;
  bboxRejected: Array<{ reason: string; type?: string; w?: number; h?: number }>;
  gateRejected: Array<{ reason: string; type?: string; position?: string }>;
  highConfidenceMissingBbox: Array<{ reason: string; type: string; position: string }>;
  structuralPromptTruncated?: { total: number; inPrompt: number; inMask: number };
}

export interface PhotoStructuralGateResult {
  confirmed: PhotoConfirmedStructuralElement[];
  log: PhotoStructuralGateLog;
}

/**
 * FAL two-stage pipeline only — true when photoConfirmedStructuralElements
 * passed gatePhotoConfirmedColumns. Ignores plan structural_elements.
 * @see hasPlanConfirmedColumn
 */
export function hasPhotoConfirmedColumn(
  analysis: RoomAnalysis | null | undefined,
): boolean {
  return (analysis?.photoConfirmedStructuralElements?.length ?? 0) > 0;
}

/** Affirmative column mention in photo structuralNotes (negation-aware). */
export function structuralNotesMentionsColumn(notes: string): boolean {
  const text = notes.trim();
  if (!text || !COLUMN_KEYWORD.test(text)) return false;
  if (NEGATION_BEFORE_KEYWORD.test(text)) return false;
  return true;
}

function truncateAtWordBoundary(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const slice = trimmed.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.5 ? slice.slice(0, lastSpace) : slice).trim();
}

export function buildStructuralMemberLabel(
  type: StructuralMemberType,
  position: string,
): string {
  const pos = truncateAtWordBoundary(position, 24);
  const label = `${type} at ${pos}`;
  return label.length <= 80 ? label : truncateAtWordBoundary(label, 80);
}

function isValidFormatBbox(
  bbox: { x: number; y: number; w: number; h: number } | undefined,
): boolean {
  if (!bbox) return false;
  const { x, y, w, h } = bbox;
  if (![x, y, w, h].every(Number.isFinite)) return false;
  if (w <= 0.005 || h <= 0.005) return false;
  if (x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) return false;
  return true;
}

/**
 * Reject hallucinated/misplaced boxes. Wide-angle near-field columns may
 * false-reject when photographed at a sharp angle (landscape bbox) — acceptable
 * tradeoff vs freezing a wall segment.
 */
export function validateStructuralBboxPlausibility(
  bbox: OpeningBox,
  type: StructuralMemberType,
): { ok: true } | { ok: false; reason: string } {
  const area = bbox.w * bbox.h;
  if (area < BORDERLINE_AREA_MIN) {
    return { ok: false, reason: "area too small" };
  }
  if (bbox.w > 0.35) {
    return { ok: false, reason: "w too wide" };
  }
  if (bbox.h > 0.95) {
    return { ok: false, reason: "h too tall" };
  }
  if (type !== "beam" && bbox.h < bbox.w * 0.8) {
    return { ok: false, reason: "landscape aspect for column" };
  }
  return { ok: true };
}

function memberArea(bbox: OpeningBox): number {
  return bbox.w * bbox.h;
}

export function gatePhotoConfirmedColumns(
  analysis: ViewpointPhotoAnalysis | undefined,
): PhotoStructuralGateResult {
  const log: PhotoStructuralGateLog = {
    candidates: 0,
    confirmed: 0,
    bboxRejected: [],
    gateRejected: [],
    highConfidenceMissingBbox: [],
  };

  if (!analysis?.structuralMembers?.length) {
    return { confirmed: [], log };
  }

  const members = analysis.structuralMembers;
  log.candidates = members.length;

  const highMembers = members.filter((m) => m.confidence === "high" && COLUMN_TYPES.has(m.type));

  const confirmedElements: PhotoConfirmedStructuralElement[] = [];

  for (const member of highMembers) {
    if (!member.bbox) {
      log.highConfidenceMissingBbox.push({
        reason: "high confidence but missing bbox",
        type: member.type,
        position: member.position,
      });
      continue;
    }

    if (!isValidFormatBbox(member.bbox)) {
      log.bboxRejected.push({
        reason: "invalid format bbox",
        type: member.type,
        w: member.bbox.w,
        h: member.bbox.h,
      });
      continue;
    }

    const plausibility = validateStructuralBboxPlausibility(member.bbox, member.type);
    if (!plausibility.ok) {
      log.bboxRejected.push({
        reason: plausibility.reason,
        type: member.type,
        w: member.bbox.w,
        h: member.bbox.h,
      });
      continue;
    }

    const area = memberArea(member.bbox);

    if (area >= BORDERLINE_AREA_MIN && area < BORDERLINE_AREA_MAX) {
      if (highMembers.length !== 1) {
        log.gateRejected.push({
          reason: "borderline bbox requires single high member",
          type: member.type,
          position: member.position,
        });
        continue;
      }
      if (!structuralNotesMentionsColumn(analysis.structuralNotes)) {
        log.gateRejected.push({
          reason: "borderline bbox without structuralNotes corroboration",
          type: member.type,
          position: member.position,
        });
        continue;
      }
    } else if (area < CONFIRMED_AREA_MIN) {
      log.gateRejected.push({
        reason: "area below confirmed threshold",
        type: member.type,
        position: member.position,
      });
      continue;
    }

    confirmedElements.push({
      type: member.type,
      position: truncateAtWordBoundary(member.position, 24),
      label: buildStructuralMemberLabel(member.type, member.position),
      bbox: member.bbox,
    });
  }

  log.confirmed = confirmedElements.length;
  return { confirmed: confirmedElements, log };
}

/** Top N by bbox area for text prompts; all confirmed elements for freeze mask. */
export function selectStructuralElementsForPrompt(
  elements: PhotoConfirmedStructuralElement[],
  maxCount = PHOTO_STRUCTURAL_PROMPT_ELEMENT_MAX,
): PhotoConfirmedStructuralElement[] {
  return [...elements]
    .sort((a, b) => memberArea(b.bbox) - memberArea(a.bbox))
    .slice(0, maxCount);
}

export function buildPhotoStructuralPromptBlock(
  elements: PhotoConfirmedStructuralElement[],
): string {
  const forPrompt = selectStructuralElementsForPrompt(elements);
  const lines = forPrompt.map((el) => `- ${el.label}`);
  let block = [PHOTO_STRUCTURAL_MANDATE, ...lines].join("\n");
  if (block.length > PHOTO_STRUCTURAL_PROMPT_MAX) {
    block = block.slice(0, PHOTO_STRUCTURAL_PROMPT_MAX - 1).trimEnd() + "…";
  }
  return block;
}

export function allStructuralColumnBoxes(
  elements: PhotoConfirmedStructuralElement[],
): OpeningBox[] {
  return elements.map((el) => el.bbox);
}

export function buildPhotoStructuralPreserveDirective(
  analysis: RoomAnalysis | null | undefined,
): string {
  const elements = analysis?.photoConfirmedStructuralElements ?? [];
  if (elements.length === 0) return "";
  return buildPhotoStructuralPromptBlock(elements);
}

/** Parse raw structuralMembers from OpenAI JSON. */
export function parseStructuralMembers(raw: unknown): ViewpointStructuralMember[] {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set<string>(["column", "post", "pier", "beam"]);
  const validConfidence = new Set<string>(["high", "medium", "low"]);

  const out: ViewpointStructuralMember[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const o = entry as Record<string, unknown>;
    const typeRaw = typeof o.type === "string" ? o.type.trim().toLowerCase() : "";
    if (!validTypes.has(typeRaw)) continue;
    const type = typeRaw as StructuralMemberType;
    const position = typeof o.position === "string" && o.position.trim() ? o.position.trim() : "mid-room";
    const confRaw = typeof o.confidence === "string" ? o.confidence.trim().toLowerCase() : "medium";
    const confidence = validConfidence.has(confRaw)
      ? (confRaw as ViewpointStructuralMember["confidence"])
      : "medium";

    let bbox: OpeningBox | undefined;
    if (typeof o.bbox === "object" && o.bbox !== null) {
      const b = o.bbox as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
      const x = num(b.x);
      const y = num(b.y);
      let w = num(b.w ?? b.width);
      let h = num(b.h ?? b.height);
      if ([x, y, w, h].every(Number.isFinite)) {
        w = Math.min(w, 1 - x);
        h = Math.min(h, 1 - y);
        if (w > 0 && h > 0) bbox = { x, y, w, h };
      }
    }

    const description =
      typeof o.description === "string" && o.description.trim()
        ? o.description.trim().slice(0, 60)
        : undefined;

    out.push({ type, position, confidence, ...(bbox ? { bbox } : {}), ...(description ? { description } : {}) });
  }
  return out;
}
