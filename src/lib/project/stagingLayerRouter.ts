import { hasOpeningBoxes } from "@/lib/openingFreezeRegions";
import type { RoomPhotoWithViewpoint } from "./types";

export type StagingLayerRenderer = "apartment-staging" | "flux-opening-freeze";
export type StagingLayerKind = "shell" | "furnish";

/** Pick renderer per layer — opening boxes force flux + freeze mask on both shell and furnish. */
export function resolveStagingLayerRenderer(
  photo: RoomPhotoWithViewpoint,
  _layer: StagingLayerKind,
): StagingLayerRenderer {
  const windowBoxes = photo.openingAnalysis?.window_boxes;
  const doorBoxes = photo.openingAnalysis?.door_boxes;
  if (hasOpeningBoxes(windowBoxes, doorBoxes)) {
    return "flux-opening-freeze";
  }
  return "apartment-staging";
}
