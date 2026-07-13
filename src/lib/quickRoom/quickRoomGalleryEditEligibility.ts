/** Detect in-place edit of an approved Quick Room render (no new user ref photo). */
export function isQuickRoomGalleryEditRequest(input: {
  quickRoomGalleryEditRaw: string;
  tokenAction: string;
  editFeedback: string;
  hasRoomImage: boolean;
}): boolean {
  const flagged =
    input.quickRoomGalleryEditRaw === "true" || input.quickRoomGalleryEditRaw === "1";
  return (
    flagged &&
    input.tokenAction === "edit" &&
    input.editFeedback.trim().length > 0 &&
    input.hasRoomImage
  );
}

export function parseQuickRoomGalleryEditFlag(raw: FormDataEntryValue | null): boolean {
  const s = String(raw ?? "").trim();
  return s === "true" || s === "1";
}

export function parseHasEditAnnotationFlag(raw: FormDataEntryValue | null): boolean {
  const s = String(raw ?? "").trim();
  return s === "true" || s === "1";
}
