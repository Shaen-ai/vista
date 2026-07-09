import { buildFalDesignOverlayPrompt } from "@/lib/falDesignPrompt";
import { buildCompactRoomShapeBlock } from "@/lib/falGeometryLockPrompt";
import { FAL_GEOMETRY_LOCK, FINISH_MANDATE_GEOMETRY_SAFE } from "@/lib/falPipelinePrompt";
import { FAL_OBJECT_REMOVAL_TAIL } from "@/lib/buildObjectRemovalDirective";
import type { DetectedRoom, RoomDesignBrief, RoomRenderPlan, UserPreferences } from "./types";

const KONTEXT_EDIT_TASK =
  "IMAGE EDITING TASK: Modify the uploaded photo in place.";

export interface ProjectKontextPromptParts {
  brief: RoomDesignBrief;
  plan?: RoomRenderPlan;
  preferences: UserPreferences;
  detectedRoom?: DetectedRoom;
  conceptProse?: string;
  hasStructuralLines?: boolean;
  hasObjectRemovalMask?: boolean;
}

/** Pure Kontext prompt assembly — geometry bookends, no Gemini tail or floor-plan openings. */
export function assembleProjectKontextPrompt(input: ProjectKontextPromptParts): string {
  const { overlay } = buildFalDesignOverlayPrompt({
    brief: input.brief,
    plan: input.plan,
    preferences: input.preferences,
    detectedRoom: input.detectedRoom,
    conceptProse: input.conceptProse,
    kontextMode: true,
  });

  const shapeBlock = buildCompactRoomShapeBlock(input.detectedRoom);

  return [
    KONTEXT_EDIT_TASK,
    FAL_GEOMETRY_LOCK,
    shapeBlock,
    overlay,
    FINISH_MANDATE_GEOMETRY_SAFE,
    input.hasObjectRemovalMask ? FAL_OBJECT_REMOVAL_TAIL : undefined,
    FAL_GEOMETRY_LOCK,
  ]
    .filter(Boolean)
    .join("\n\n");
}
