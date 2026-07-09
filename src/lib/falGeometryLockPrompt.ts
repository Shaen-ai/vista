import { detectWallNotchesFromPolygon, describePolygonEdgesForPrompt, pipelineLog } from "@/lib/pipelineLog";
import type { DetectedRoom } from "@/lib/project/types";

const GEOMETRY_LOCK_PROMPT =
  "Empty room, clean neutral surfaces, no furniture, no decor, no rugs. " +
  "Preserve all walls, doors, windows, ceiling, and floor exactly as shown. " +
  "Smooth matte white walls, light oak hardwood floor, flat white ceiling.";

const GEOMETRY_LOCK_PROMPT_WITH_COLUMNS =
  "Empty room, clean neutral surfaces, no furniture, no decor, no rugs. " +
  "Preserve all walls, doors, windows, ceiling, floor, and every visible structural column/post/pier exactly as shown. " +
  "Smooth matte neutral finish on all non-structural surfaces. Light oak hardwood floor, flat white ceiling. " +
  "Do not remove or smooth away freestanding structural members.";

const FLUX_NOTCH_DIRECTIVE_MAX = 180;

export interface GeometryLockPromptOptions {
  hasPhotoColumns: boolean;
  wallNotchDirective?: string;
}

/** Compact Flux Stage-1 suffix from floor-plan polygon geometry (not log string parsing). */
export function buildWallNotchDirectiveForFlux(
  detectedRoom?: DetectedRoom,
): string | undefined {
  const polygon = detectedRoom?.polygon;
  if (!polygon || polygon.length <= 4) return undefined;

  const notches = detectWallNotchesFromPolygon(polygon);
  if (notches.length === 0) {
    pipelineLog(
      "FAL_PIPELINE",
      "wall notch geometry: polygon has extra corners but no micro-edge notch detected",
      { corners: polygon.length, roomId: detectedRoom?.id },
    );
    return undefined;
  }

  const primary = notches.reduce((a, b) => (b.totalLenM > a.totalLenM ? b : a));
  let directive =
    `Wall geometry: shallow wall recess (~${primary.totalLenM.toFixed(2)}m flat jog). ` +
    "Paint as continuous flat wall indent — NOT a column, post, pier, or shaft.";

  if (directive.length > FLUX_NOTCH_DIRECTIVE_MAX) {
    directive = directive.slice(0, FLUX_NOTCH_DIRECTIVE_MAX - 1).trimEnd() + "…";
  }
  return directive;
}

export function buildGeometryLockPrompt(opts: GeometryLockPromptOptions | boolean): string {
  const resolved: GeometryLockPromptOptions =
    typeof opts === "boolean" ? { hasPhotoColumns: opts } : opts;

  let base = resolved.hasPhotoColumns ? GEOMETRY_LOCK_PROMPT_WITH_COLUMNS : GEOMETRY_LOCK_PROMPT;
  const notch = resolved.wallNotchDirective?.trim();
  if (notch) {
    base = `${base} ${notch}`;
  }
  return base;
}

/** Compact room-shape line for Kontext prompts (8+ corner rooms). */
export function buildCompactRoomShapeBlock(detectedRoom?: DetectedRoom): string | undefined {
  const polygon = detectedRoom?.polygon;
  if (!polygon || polygon.length <= 4) return undefined;

  const corners = polygon.length;
  const edgeSummary = describePolygonEdgesForPrompt(polygon);
  const notch = buildWallNotchDirectiveForFlux(detectedRoom);
  let block =
    `ROOM SHAPE: ${corners} wall corners — preserve every jog and notch exactly; not a simple rectangle.`;
  if (edgeSummary) block += ` Edges: ${edgeSummary}.`;
  if (notch) block += ` ${notch}`;
  return block;
}
