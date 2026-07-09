import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import { debugSessionLog } from "@/lib/pipelineLog";
import {
  buildPhotoStructuralPreserveDirective,
  hasPhotoConfirmedColumn,
} from "@/lib/photoStructuralElements";

const RECESS_KEYWORDS =
  /\b(recess|alcove|soffit|pier|foreground|step(?:ped)?-back|step\s+back|bump-out|niche)\b/i;

const PIER_COLUMN_KEYWORDS =
  /\b(pier|column|post|pillar|freestanding)\b/i;

/** Plan/PDF strings that mislabel an L-shaped wall jog or corner as a column/shaft. */
const PLAN_SPECULATIVE_COLUMN_FEATURE =
  /\b(?:column|pillar|post|shaft|pier)\b.*(?:edge|corner|notch|cut-out|cutout|protrud|south|east|west|north|southeast|south-east)/i;

export function isPlanSpeculativeColumnFeature(text: string): boolean {
  return PLAN_SPECULATIVE_COLUMN_FEATURE.test(text);
}

/** True when plan analysis or legacy recess/pier text confirms asymmetric geometry. */
export function hasPlanConfirmedColumn(
  roomAnalysis: RoomAnalysis | null | undefined,
): boolean {
  if (!roomAnalysis) return false;
  const items = [
    ...roomAnalysis.structural_elements,
    ...roomAnalysis.architectural_features,
  ];
  return items.some(
    (t) => PIER_COLUMN_KEYWORDS.test(t) && !isPlanSpeculativeColumnFeature(t),
  );
}

/**
 * PLAN / GEMINI paths — alias kept for existing call sites.
 * Do NOT use for FAL column preserve mode; use hasPhotoConfirmedColumn instead.
 * @see hasPhotoConfirmedColumn
 */
export function hasConfirmedPierOrColumn(
  roomAnalysis: RoomAnalysis | null | undefined,
): boolean {
  return hasPlanConfirmedColumn(roomAnalysis);
}

function analysisText(roomAnalysis: RoomAnalysis): string {
  return [
    ...roomAnalysis.structural_elements,
    ...roomAnalysis.architectural_features,
    ...roomAnalysis.window_positions,
    ...roomAnalysis.lighting_sources,
  ].join(" ");
}

/** True when analysis suggests stepped left-side geometry (pier + recess + soffit). */
export function detectAsymmetricLeftGeometry(
  roomAnalysis: RoomAnalysis | null | undefined,
): boolean {
  if (!roomAnalysis) return false;

  if (hasPlanConfirmedColumn(roomAnalysis)) return true;

  const allText = analysisText(roomAnalysis);
  if (/\bleft\s+recess\s+wall\b/i.test(allText)) return true;

  const nonSpeculative = [
    ...roomAnalysis.structural_elements,
    ...roomAnalysis.architectural_features,
    ...roomAnalysis.lighting_sources,
  ]
    .filter((t) => !isPlanSpeculativeColumnFeature(t))
    .join(" ");

  if (RECESS_KEYWORDS.test(nonSpeculative)) return true;

  return false;
}

function filterByKeyword(items: string[], pattern: RegExp): string[] {
  return items.filter((t) => pattern.test(t));
}

export interface ColumnInjectionReport {
  triggersGeometryLock: boolean;
  confirmedPierOrColumn: boolean;
  speculativePlanFeatures: string[];
  roomShapeIrregular: boolean;
  conceptMentionsColumn: boolean;
  geometryLockWouldInventColumn: boolean;
}

/** Detect why column/pier language may reach Gemini (for logging and QA). */
export function analyzeColumnInjectionSources(
  roomAnalysis: RoomAnalysis | null | undefined,
  designConcept?: string,
): ColumnInjectionReport {
  const features = [
    ...(roomAnalysis?.structural_elements ?? []),
    ...(roomAnalysis?.architectural_features ?? []),
  ];
  const speculativePlanFeatures = features.filter(isPlanSpeculativeColumnFeature);
  const confirmed = hasPlanConfirmedColumn(roomAnalysis);
  const triggers = detectAsymmetricLeftGeometry(roomAnalysis);
  const pierHints = filterByKeyword(
    roomAnalysis?.structural_elements ?? [],
    /\b(pier|column|post|pillar|foreground)\b/i,
  );
  const conceptMentionsColumn = /\b(column|pillar|post|pier|shaft)\b/i.test(
    designConcept ?? "",
  );
  const shape = roomAnalysis?.room_shape?.toLowerCase() ?? "";

  return {
    triggersGeometryLock: triggers,
    confirmedPierOrColumn: confirmed,
    speculativePlanFeatures,
    roomShapeIrregular: /irregular|l-shape|l shape|l-shaped/.test(shape),
    conceptMentionsColumn,
    geometryLockWouldInventColumn: triggers && pierHints.length === 0 && !confirmed,
  };
}

/** Anti-hallucination or photo-preserve directive for columns. */
export function buildNoColumnHallucinationDirective(
  roomAnalysis: RoomAnalysis | null | undefined,
): string {
  if (!roomAnalysis) return "";

  const photoPreserve = buildPhotoStructuralPreserveDirective(roomAnalysis);
  if (photoPreserve) {
    return photoPreserve;
  }

  if (hasPlanConfirmedColumn(roomAnalysis)) return "";

  return `STRUCTURAL COLUMNS & BEAMS (mandatory): The EDIT TARGET photo shows NO freestanding columns, posts, piers, or exposed horizontal beams/lintels. Do NOT add any. Polygon corners and L-shaped wall jogs/notches (including sub-meter plan edge segments) are continuous flat wall surfaces — NOT vertical posts or horizontal beams. Render them as smooth drywall/plaster only unless the photo clearly shows a structural member.`;
}

/**
 * Strong structural geometry lock for asymmetric rooms (foreground pier + left recess).
 * Wired into Gemini edit prompts when recess/L-shape cues are present.
 */
export function buildStructuralGeometryLock(
  roomAnalysis: RoomAnalysis | null | undefined,
  designConcept?: string,
): string {
  const report = analyzeColumnInjectionSources(roomAnalysis, designConcept);
  // #region agent log
  debugSessionLog({
    location: "structuralGeometryLock.ts:buildStructuralGeometryLock",
    message: "column injection sources",
    hypothesisId: "COL",
    data: report as unknown as Record<string, unknown>,
  });
  // #endregion

  if (!roomAnalysis || !report.triggersGeometryLock) return "";

  const lines: string[] = [
    "STRUCTURAL GEOMETRY LOCK — preserve asymmetric layout from reference photo:",
  ];

  const pierHints = filterByKeyword(
    roomAnalysis.structural_elements,
    /\b(pier|column|post|pillar|foreground)\b/i,
  ).filter((t) => !isPlanSpeculativeColumnFeature(t));

  if (pierHints.length > 0) {
    lines.push(
      `  LEFT FOREGROUND: ${pierHints.join("; ")} — preserve exactly as-is; the pier protrudes into the room and stays visible`,
    );
    lines.push(
      "  The column/pier MUST remain a visibly exposed structural element with its own faces and edges reading as a protruding pier — do NOT clad it into the wall plane, box it inside a wardrobe/cabinet, hide it behind furniture, or flatten it away. Finish it (paint/plaster/stone) but keep its volume clearly visible.",
    );
  }

  const hasRecessCue = RECESS_KEYWORDS.test(analysisText(roomAnalysis));
  if (hasRecessCue) {
    lines.push(
      "  LEFT RECESS: the room steps back behind any foreground pier into a recessed alcove — preserve the stepped footprint and the alcove depth exactly as in the photo.",
    );
  }

  const soffitHints = filterByKeyword(
    [
      ...roomAnalysis.structural_elements,
      ...roomAnalysis.architectural_features,
      ...roomAnalysis.lighting_sources,
    ],
    /\b(soffit|drop ceiling|lower ceiling|recessed (?:spot)?lights?)\b/i,
  );
  if (soffitHints.length > 0) {
    lines.push(
      `  CEILING: ${soffitHints.join("; ")} — preserve lower soffit zone above left recess; the stepped ceiling height difference between recess zone and main room stays intact`,
    );
  } else if (hasRecessCue) {
    lines.push(
      "  CEILING: preserve any lower soffit/drop ceiling above the left recess if visible; the stepped ceiling height difference between recess zone and main room stays intact",
    );
  }

  if (pierHints.length > 0) {
    lines.push(
      "  Any real structural dropped beam/soffit visible in the photo (e.g. capping the column) MUST be kept — integrate the designed ceiling (tray/cove/downlights) AROUND it; do NOT flatten it into a smooth ceiling.",
    );
  }

  const preserveFeatures = roomAnalysis.architectural_features.filter(
    (f) =>
      !/\b(window|door|glaz|opening|passage)\b/i.test(f) &&
      !isPlanSpeculativeColumnFeature(f),
  );
  if (preserveFeatures.length > 0) {
    lines.push(
      `  ARCHITECTURAL (must preserve): ${preserveFeatures.join("; ")}`,
    );
  }

  if (pierHints.length > 0 || hasRecessCue) {
    lines.push("Left side retains its stepped asymmetric geometry distinct from the right side.");
  }
  if (pierHints.length > 0) {
    lines.push("The foreground pier remains visible and intact.");
  }

  return lines.join("\n");
}
