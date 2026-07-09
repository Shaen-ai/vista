import { buildOpeningStructuralLock } from "@/lib/roomAnalysis";
import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import { getStylePresetOrDefault } from "@/lib/project/stylePresets";
import type { BudgetTier } from "@/lib/project/types";
import { buildNoColumnHallucinationDirective } from "@/lib/structuralGeometryLock";
import { buildObjectRemovalDirective } from "@/lib/buildObjectRemovalDirective";
import { hasPhotoConfirmedColumn } from "@/lib/photoStructuralElements";
import { countMicroEdgeLabels, debugSessionLog } from "@/lib/pipelineLog";

export type InteriorPreferencesPrompt = {
  style: string;
  familyMembers: number;
  budgetTier: BudgetTier;
  wishes: string;
};

export type RoomStructuralMetrics = {
  roomId?: string;
  roomName: string;
  roomType: string;
  size: string;
  corners?: number;
  edges?: string;
  windows: string | number;
  doors: string | number;
};

export type StructuralGuardrailInput = {
  metrics: RoomStructuralMetrics;
  prefs: InteriorPreferencesPrompt;
  photoId?: string;
  cameraNote?: string;
  /** Human-readable summary of openings visible from this camera, e.g. "1 door on west wall". */
  visibleOpeningsNote?: string;
  editFeedback?: string;
  roomAnalysis?: RoomAnalysis | null;
  roomGeometry?: RoomGeometry | null;
  /** When true, visible wall geometry follows the EDIT TARGET photo — not plan micro-jogs. */
  photoGrounded?: boolean;
  /** User marked regions to clear (furniture/debris) before redesign. */
  hasObjectRemovalMask?: boolean;
};

/**
 * Room-type-scoped sleeping directive. Without it, an apartment-wide household
 * wish ("design for 4-5 person") read per-room makes the render model pack the
 * entire household's beds into one bedroom.
 */
function sleepingScopeDirective(roomType: string): string {
  const t = roomType.toLowerCase();
  if (/(child|kid|nursery)/.test(t)) {
    return "Sleeping scope: this is the children's room of a multi-room home — beds for the children only (single beds or a bunk bed), never the parents' bed or the whole household's beds.";
  }
  if (t.includes("bed")) {
    return "Sleeping scope: this is ONE bedroom of a multi-room home — exactly one sleeping arrangement (one double/queen bed, or two singles), NEVER the entire household's beds in this room.";
  }
  if (/(living|kitchen|dining|hall|bath|toilet|balcon|wardrobe|storage)/.test(t)) {
    return "Sleeping scope: no beds in this room — sleeping happens in the home's bedrooms.";
  }
  return "Sleeping scope: household size describes the whole home, not this room — do not concentrate the household's furniture needs here.";
}

/** Convert pipeline log metrics into a Markdown structural guardrail block for Gemini. */
export function buildStructuralGuardrailPrompt(input: StructuralGuardrailInput): string {
  const styleLabel = getStylePresetOrDefault(input.prefs.style).label;
  const { metrics: m } = input;

  // Photo-verified roomAnalysis overrides floor-plan metrics for opening counts.
  const windows =
    input.roomAnalysis?.window_count !== undefined
      ? input.roomAnalysis.window_count === 0
        ? "none on this viewpoint"
        : input.roomAnalysis.window_positions?.length
          ? input.roomAnalysis.window_positions.join("; ")
          : String(input.roomAnalysis.window_count)
      : m.windows === 0 || m.windows === "0"
        ? "none on this viewpoint"
        : String(m.windows);
  const doors =
    input.roomAnalysis?.door_count !== undefined
      ? input.roomAnalysis.door_count === 0
        ? "none on this viewpoint"
        : input.roomAnalysis.door_positions?.length
          ? input.roomAnalysis.door_positions.join("; ")
          : String(input.roomAnalysis.door_count)
      : m.doors === 0 || m.doors === "0"
        ? "none on this viewpoint"
        : String(m.doors);

  const lines: string[] = [
    "### CRITICAL STRUCTURAL ARCHITECTURE GUARDRAILS",
    "[DO NOT ALTER THE FOLLOWING GEOMETRY]:",
    `- Room Type: ${m.roomName} (${m.roomType})`,
    `- Precise Dimensions: ${m.size}`,
  ];

  if (typeof m.corners === "number" && m.corners > 0) {
    if (input.photoGrounded && m.corners > 4) {
      lines.push(
        `- Footprint: L-shaped or irregular (${m.corners} plan corners); small plan notches are flat wall jogs — NOT freestanding columns or beams.`,
      );
    } else {
      lines.push(`- Corner count: ${m.corners}`);
    }
  }
  if (m.edges) {
    lines.push(`- Structural Boundaries: ${m.edges}`);
  }

  if (input.photoGrounded) {
    if (hasPhotoConfirmedColumn(input.roomAnalysis)) {
      lines.push(
        "- WALL GEOMETRY: Preserve every photo-confirmed structural column/post/pier exactly as visible in the EDIT TARGET photo — do not remove, flatten, or hide behind furniture.",
      );
    } else {
      lines.push(
        "- WALL GEOMETRY: The EDIT TARGET room photo is authoritative for every visible wall plane. Match its flat walls exactly — do NOT add freestanding columns, posts, piers, or exposed horizontal beams/lintels at plan corners or notches.",
      );
    }
  }

  const noColumnDirective = buildNoColumnHallucinationDirective(input.roomAnalysis);
  if (noColumnDirective) {
    lines.push(`- ${noColumnDirective}`);
  }

  const removalDirective = buildObjectRemovalDirective(!!input.hasObjectRemovalMask);
  if (removalDirective) {
    lines.push(`- ${removalDirective}`);
  }

  // #region agent log
  debugSessionLog({
    location: "buildStructuralGuardrailPrompt.ts:buildStructuralGuardrailPrompt",
    message: "gemini structural guardrail composed",
    hypothesisId: "A",
    data: {
      photoGrounded: !!input.photoGrounded,
      corners: m.corners ?? null,
      microEdgeLabels: m.edges ? countMicroEdgeLabels(m.edges) : 0,
      edgesHasWallNotch: m.edges?.includes("wall notch") ?? false,
      hasNoColumnDirective: !!noColumnDirective,
      edgesPreview: m.edges?.slice(0, 160) ?? null,
    },
  });
  // #endregion

  lines.push(
    `- Existing Wall Openings — Windows: ${windows}`,
    `- Existing Wall Openings — Doors: ${doors}`,
    "",
    "### RENDER REQUIREMENTS",
    "- Maintain the absolute spatial alignment, camera perspective, and wall lines exactly as visible in the original room photo.",
  );

  if (input.photoId) lines.push(`- Source photo id: ${input.photoId}`);
  if (input.cameraNote) {
    lines.push(`- Camera vantage (internal — never render as visible text): ${input.cameraNote}`);
  }
  if (input.visibleOpeningsNote) lines.push(`- Visible from camera: ${input.visibleOpeningsNote}`);
  if (input.editFeedback?.trim()) {
    lines.push(`- Adjustments requested: ${input.editFeedback.trim()}`);
  }

  lines.push(
    "- Every door and window listed above MUST remain physically present, unaltered in shape, and on the same wall. Do not add, shift, merge, or remove any opening.",
    "- The OPENING GUIDE image (colored D/W boxes) marks exact pixel locations — match them on the clean photo.",
    "- The EDIT PERMISSION MASK (if provided): BLACK = locked pixels (openings/architecture), WHITE = editable (finishes/furniture).",
    "",
    "### DESIGN OVERLAY",
    `Style: ${styleLabel}`,
    `Family Members: ${input.prefs.familyMembers}`,
    `Budget Level: ${input.prefs.budgetTier}`,
  );
  const wishes = input.prefs.wishes.trim();
  if (wishes) {
    lines.push(
      `Household context (describes the WHOLE home, NOT only this room — never furnish this single room for the entire household): ${wishes}`,
    );
  }
  lines.push(sleepingScopeDirective(m.roomType));

  const openingLock = buildOpeningStructuralLock(input.roomAnalysis, input.roomGeometry);
  if (openingLock) {
    lines.push("", openingLock);
  }

  return lines.join("\n");
}

/** Pull summarizeRoomParams output into typed metrics for the guardrail block. */
export function metricsFromSummarizeRoomParams(
  summary: Record<string, unknown>,
  roomType: string,
): RoomStructuralMetrics {
  return {
    roomId: typeof summary.roomId === "string" ? summary.roomId : undefined,
    roomName: typeof summary.roomName === "string" ? summary.roomName : "Room",
    roomType,
    size: typeof summary.size === "string" ? summary.size : "unknown",
    corners: typeof summary.corners === "number" ? summary.corners : undefined,
    edges: typeof summary.edges === "string" ? summary.edges : undefined,
    windows: (summary.windows as string | number) ?? 0,
    doors: (summary.doors as string | number) ?? 0,
  };
}
