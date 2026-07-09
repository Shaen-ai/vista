import type { DetectedRoom, ProjectState, RoomPhotoWithViewpoint } from "./types";
import { resolveViewpointFraming } from "./viewpointFraming";
import { buildStagingOpeningLockSnippet } from "./claudeRenderDirector";
import { buildSecondaryViewpointPromptParts } from "./secondaryViewpointPromptParts";

export { buildSecondaryViewpointPromptParts } from "./secondaryViewpointPromptParts";

/** Wrap a master design prompt with per-photo camera framing for secondary viewpoints. */
export function buildSecondaryViewpointPrompt(opts: {
  state: ProjectState;
  roomId: string;
  photo: RoomPhotoWithViewpoint;
  detectedRoom: DetectedRoom | undefined;
  designPrompt: string;
}): string {
  const { state, roomId, photo, detectedRoom, designPrompt } = opts;
  const framingNote =
    photo.viewpoint && detectedRoom
      ? resolveViewpointFraming(photo.viewpoint, detectedRoom)?.note
      : photo.label?.trim();
  const openingLock = buildStagingOpeningLockSnippet(state, roomId, photo.id);

  return buildSecondaryViewpointPromptParts({
    framingNote,
    openingLock,
    designPrompt,
  });
}
