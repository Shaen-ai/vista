import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";

/** Phrases that cause Gemini to relocate or reinvent window/door architecture. */
const ARCHITECTURAL_LEAK_PATTERNS: RegExp[] = [
  /\bfloor-to-ceiling windows?\b/gi,
  /\bfloor to ceiling windows?\b/gi,
  /\bwall of windows?\b/gi,
  /\bpanoramic (?:view|windows?|glass)\b/gi,
  /\bexpansive windows?\b/gi,
  /\blarge corner windows?\b/gi,
  /\bdouble-height ceiling\b/gi,
  /\b(?:full[- ]height|floor[- ]to[- ]ceiling) glass\b/gi,
  /\b(?:new|additional|extra|more)\s+windows?\b/gi,
  /\b(?:remove|cover|brick over|panel over)\s+(?:the\s+)?windows?\b/gi,
  /\b(?:city|skyline|landscape|garden|ocean|mountain)\s+view\b/gi,
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|multiple|several|many)\s+(?:large\s+|tall\s+|narrow\s+)?windows?\s+(?:on|along|across|facing)\b/gi,
  /\bwindows?\s+(?:on|along|across|facing)\s+(?:the\s+)?(?:back|left|right|front|far|side)\s+wall\b/gi,
];

/** Plaid/tartan/checkered textile phrases — stripped so first render stays decor-free. */
const PLAID_PATTERN_PHRASES: RegExp[] = [
  /\bplaid\s+(?:throw|blanket|textile|fabric|accent|pattern|rug|sofa|upholstery)\b/gi,
  /\b(?:throw|blanket|textile|fabric|cushion|pillow|sofa\s+cover|bed\s+spread|accent)\s+(?:with\s+)?plaid(?:\s+pattern)?\b/gi,
  /\btartan\s+(?:throw|blanket|textile|fabric|pattern|plaid|accent)\b/gi,
  /\bcheckered\s+(?:throw|blanket|textile|fabric|pattern|plaid)\b/gi,
  /\b(?:cozy|soft|woven|knitted|decorative)\s+plaid\b/gi,
  /\bplaid\b/gi,
  /\b(?:throw|knit(?:ted)?|woven|draped|cozy|soft|chunky|cable[- ]knit|herringbone)\s+blankets?\b/gi,
  /\bblankets?\s+(?:draped|thrown|laid|placed|folded|tossed|casually)\b/gi,
  /\b(?:decorative|accent|sofa|bed|armchair)\s+(?:throw|blanket)s?\b/gi,
  /\bthrow\s+(?:over|across|on)\s+(?:the\s+)?(?:sofa|couch|bed|chair|armchair|settee)\b/gi,
];

const CAMERA_LOCK_COMPOSITION =
  "Preserve exact camera angle and perspective from input image.";

/** Curtain/drape phrases — stripped when room has zero windows. */
const CURTAIN_LEAK_PATTERNS: RegExp[] = [
  /\b(?:sheer|linen|velvet|cotton|silk|blackout)?\s*curtains?\b/gi,
  /\b(?:sheer|linen|velvet|cotton|silk|blackout)?\s*drapes?\b/gi,
  /\bblinds?\b/gi,
  /\bsheers?\b/gi,
  /\bvalances?\b/gi,
  /\bcurtain\s+rods?\b/gi,
  /\bwindow\s+treatments?\b/gi,
];

function stripArchitecturalLeakage(text: string): string {
  let out = text;
  for (const pattern of ARCHITECTURAL_LEAK_PATTERNS) {
    out = out.replace(pattern, " ");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

function stripCurtainLeakage(text: string): string {
  let out = text;
  for (const pattern of CURTAIN_LEAK_PATTERNS) {
    out = out.replace(pattern, " ");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

function stripPlaidPatternLeakage(text: string): string {
  let out = text;
  for (const pattern of PLAID_PATTERN_PHRASES) {
    out = out.replace(pattern, " ");
  }
  return out.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").replace(/,\s*\./g, ".").trim();
}

export interface SanitizeDesignBriefOptions {
  keepRoomShape?: boolean;
}

/** Remove creative-brief wording that contradicts reference-photo structural locks. */
export function sanitizeDesignBriefForGemini(
  brief: DesignBrief,
  roomAnalysis?: RoomAnalysis | null,
  options?: SanitizeDesignBriefOptions,
): DesignBrief {
  const stripBase = roomAnalysis?.window_count === 0
    ? (text: string) => stripCurtainLeakage(stripArchitecturalLeakage(text))
    : stripArchitecturalLeakage;
  const strip = (text: string) => stripPlaidPatternLeakage(stripBase(text));

  const sanitized: DesignBrief = {
    ...brief,
    subject: strip(brief.subject),
    arrangement: strip(brief.arrangement),
    context: strip(brief.context),
    composition: strip(brief.composition),
    style: strip(brief.style),
    fullPrompt: strip(brief.fullPrompt),
  };

  if (options?.keepRoomShape) {
    sanitized.context = "";
    sanitized.composition = CAMERA_LOCK_COMPOSITION;
  }

  return sanitized;
}

/** Drop compass-wall openings from geometry when room analysis already has camera-relative positions. */
export function geometryForGeminiPrompt(
  roomGeometry: RoomGeometry,
  roomAnalysis?: RoomAnalysis | null,
): RoomGeometry {
  const hasAnalysisWindows =
    (roomAnalysis?.window_positions?.length ?? 0) > 0 && (roomAnalysis?.window_count ?? 0) > 0;
  const hasAnalysisDoors =
    (roomAnalysis?.door_positions?.length ?? 0) > 0 && (roomAnalysis?.door_count ?? 0) > 0;

  if (!hasAnalysisWindows && !hasAnalysisDoors) return roomGeometry;

  return {
    ...roomGeometry,
    windows: hasAnalysisWindows ? [] : roomGeometry.windows,
    doors: hasAnalysisDoors ? [] : roomGeometry.doors,
  };
}

export function hasAuthoritativeAnalysisOpenings(roomAnalysis?: RoomAnalysis | null): boolean {
  if (!roomAnalysis) return false;
  return (
    (roomAnalysis.window_positions.length > 0 && roomAnalysis.window_count > 0) ||
    (roomAnalysis.door_positions.length > 0 && roomAnalysis.door_count > 0)
  );
}
