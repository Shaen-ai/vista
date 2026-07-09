import type { LabeledRoomPhoto } from "@/lib/buildMultiPhotoGeminiParts";

export type GeminiTextOrImagePart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
};

/**
 * Hallway multi-photo layout: reference angles first, EDIT TARGET last (right before the text prompt).
 * Gemini weights the last image heavily — the photo to edit must come immediately before instructions.
 */
export function buildHallwayPhotoGeminiParts(opts: {
  photos: LabeledRoomPhoto[];
  editTargetPhotoId: string;
  roomName?: string;
}): GeminiTextOrImagePart[] {
  const parts: GeminiTextOrImagePart[] = [];
  const editTarget = opts.photos.find((p) => p.id === opts.editTargetPhotoId);
  const references = opts.photos.filter((p) => p.id !== opts.editTargetPhotoId);
  if (!editTarget) return parts;

  if (references.length > 0) {
    parts.push({
      text:
        `Reference photos of ${opts.roomName ?? "this corridor"} — use ONLY to understand wall shape, ` +
        `corners, and door placement. Do NOT copy their camera angles into the output:`,
    });
    for (const p of references) {
      parts.push({ text: `[${p.label}] Reference angle:` });
      parts.push({
        inlineData: { mimeType: p.mimeType || "image/jpeg", data: p.base64 },
      });
    }
  }

  parts.push({
    text:
      "EDIT TARGET — corridor photo to modify in place. Preserve this exact camera angle, wall layout, " +
      "every corner and wall jog, and every door position. Apply design finishes and slim furniture ONLY:",
  });
  parts.push({
    inlineData: { mimeType: editTarget.mimeType || "image/jpeg", data: editTarget.base64 },
  });

  return parts;
}
