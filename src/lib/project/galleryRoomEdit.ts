/**
 * Post-gallery edits: user liked all renders and requests a small change
 * (wardrobe, chandelier, etc.). Regenerate each angle with the full set of
 * approved renders as visual reference — no Claude concept rewrite.
 */

import { NO_TEXT_IN_IMAGE_DIRECTIVE } from "@/lib/renderQualityDirective";
import type { ViewpointFraming } from "./viewpointFraming";

export const EDIT_ANNOTATION_MARKER_PROMPT =
  "USER MARKED AREA — red strokes on this image highlight the section to modify. " +
  "Apply the user change ONLY to the marked region. Do NOT reproduce the red marks in the final render.";

export function appendEditAnnotationHint(userEdit: string, hasAnnotation: boolean): string {
  if (!hasAnnotation) return userEdit;
  return (
    `${userEdit.trim()}\n\n` +
    "Apply the change to the areas marked in red on the USER MARKED AREA reference image."
  );
}

export function isGalleryEditEligible(rendersCount: number, viewpointTargetCount: number): boolean {
  const targets = Math.max(1, viewpointTargetCount);
  return rendersCount > 0 && rendersCount >= targets;
}

/** Preservation-first prompt for one camera angle. */
export function buildGalleryEditPrompt(
  userEdit: string,
  framing?: ViewpointFraming | null,
  hasAnnotation = false,
): string {
  const edit = appendEditAnnotationHint(userEdit, hasAnnotation);
  const lines = [
    "GALLERY EDIT — preserve the approved design exactly.",
    "The APPROVED DESIGN REFERENCE images show the same room the user already accepted from multiple cameras.",
    "Apply ONLY the user change below. Keep all other furniture, finishes, colors, materials, lighting fixtures, and decor identical unless the change explicitly replaces them.",
    "",
    `USER CHANGE (the only modification allowed): ${edit}`,
    "",
  ];
  if (framing?.note) {
    lines.push(
      `CAMERA FOR THIS OUTPUT (internal metadata — never render as visible text): ${framing.note}`,
      "Apply the user change only on walls and surfaces visible from this camera. Do not add the new item on walls behind the camera or outside this view.",
      "",
    );
  }
  lines.push(NO_TEXT_IN_IMAGE_DIRECTIVE);
  return lines.join("\n");
}
