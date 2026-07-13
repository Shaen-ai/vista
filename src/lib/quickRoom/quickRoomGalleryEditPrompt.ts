import {
  EDIT_ANNOTATION_MARKER_PROMPT,
  appendEditAnnotationHint,
} from "@/lib/project/galleryRoomEdit";
import { NO_TEXT_IN_IMAGE_DIRECTIVE } from "@/lib/renderQualityDirective";

/** Preservation-first prompt for editing an approved Quick Room render in-place. */
export function buildQuickRoomGalleryEditPrompt(
  userEdit: string,
  hasAnnotation = false,
): string {
  const edit = appendEditAnnotationHint(userEdit.trim(), hasAnnotation);
  const lines = [
    "QUICK ROOM GALLERY EDIT — preserve the approved design exactly.",
    "IMAGE ROLES: The FIRST image is the approved interior render the user already accepted.",
    hasAnnotation
      ? "The SECOND image shows USER MARKED AREAS (red strokes) — apply the change only there."
      : "",
    "Apply ONLY the user change below. Keep all other furniture, appliances, finishes, colors, materials, lighting fixtures, wall art, and decor identical unless the change explicitly removes or replaces them.",
    "Do not redesign the room. Do not move unrelated items. Do not change camera angle or room geometry.",
    "",
    `USER CHANGE (the only modification allowed): ${edit}`,
    "",
  ].filter(Boolean);

  if (hasAnnotation) {
    lines.push(EDIT_ANNOTATION_MARKER_PROMPT, "");
  }

  lines.push(NO_TEXT_IN_IMAGE_DIRECTIVE);
  return lines.join("\n");
}
