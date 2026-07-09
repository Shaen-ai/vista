import { resolveRoomDesignPrompt } from "@/lib/project/claudeRenderDirector";
import {
  assembleProjectKontextPrompt,
  type ProjectKontextPromptParts,
} from "@/lib/project/assembleProjectKontextPrompt";
import { getStylePresetOrDefault } from "@/lib/project/stylePresets";
import type { ProjectState, RoomDesignBrief, UserPreferences } from "@/lib/project/types";

const DEFAULT_WISHES = "warm lighting, photoreal interior, magazine-quality styling";

/** Simple FAL prompt for Full Project — no Claude / structural guardrails. */
export function buildProjectFalPrompt(
  roomName: string,
  preferences: UserPreferences,
  editFeedback?: string,
): string {
  const styleLabel = getStylePresetOrDefault(preferences.style).label;
  const wishes = preferences.wishes?.trim() || DEFAULT_WISHES;
  const base = `${styleLabel} ${roomName}, ${wishes}`;
  const edit = editFeedback?.trim();
  return edit ? `${base}. Adjustments: ${edit}` : base;
}

export interface ProjectRichFalPromptInput {
  state: ProjectState;
  roomId: string;
  brief: RoomDesignBrief;
  detectedRoom?: ProjectKontextPromptParts["detectedRoom"];
  editFeedback?: string;
  hasStructuralLines?: boolean;
  hasObjectRemovalMask?: boolean;
  /** Pre-resolved Claude concept; when omitted, resolved from state.roomRenderPlans. */
  conceptProse?: string;
}

/** View 1 / Kontext path — rich design with geometry-first bookends. */
export function buildProjectKontextPrompt(input: ProjectRichFalPromptInput): string {
  const { state, roomId, brief, detectedRoom, editFeedback, hasStructuralLines, hasObjectRemovalMask, conceptProse } = input;
  const plan = state.roomRenderPlans?.[roomId];
  const resolvedConcept =
    conceptProse ?? resolveRoomDesignPrompt(state, roomId, editFeedback);

  return assembleProjectKontextPrompt({
    brief,
    plan,
    preferences: state.preferences,
    detectedRoom,
    conceptProse: resolvedConcept,
    hasStructuralLines,
    hasObjectRemovalMask,
  });
}

/** @deprecated Use buildProjectKontextPrompt for Full Project Kontext renders. */
export function buildProjectRichFalPrompt(input: ProjectRichFalPromptInput): string {
  return buildProjectKontextPrompt(input);
}

export { assembleProjectKontextPrompt, type ProjectKontextPromptParts };
