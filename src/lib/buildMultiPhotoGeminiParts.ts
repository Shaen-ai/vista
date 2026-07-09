/** Labeled room photo for multimodal Gemini payloads. */
export type LabeledRoomPhoto = {
  id: string;
  label: string;
  base64: string;
  mimeType: string;
  cameraNote?: string;
};

export type GeminiTextOrImagePart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
};

export type MultiPhotoContextMode = "initial-design" | "viewpoint-transfer";

/**
 * Structured intro + inline images so Gemini can cross-reference every assigned
 * camera angle of the same room in one request.
 */
export function buildMultiPhotoIntroText(opts: {
  roomName: string;
  roomType: string;
  photos: LabeledRoomPhoto[];
  editTargetPhotoId: string;
  mode: MultiPhotoContextMode;
}): string {
  const { roomName, roomType, photos, editTargetPhotoId, mode } = opts;
  const n = photos.length;
  const editIndex = Math.max(
    0,
    photos.findIndex((p) => p.id === editTargetPhotoId),
  );
  const editPart = editIndex + 1;

  const lines: string[] = [
    `You are an elite interior designer. Analyze the following ${n} perspective photo(s) of the same ${roomName} (${roomType}) to understand its full geometry, door/window placement, and wall lengths.`,
    "",
  ];

  photos.forEach((p, i) => {
    const partNum = i + 1;
    let role = "";
    if (p.id === editTargetPhotoId) {
      role =
        mode === "initial-design"
          ? " — EDIT TARGET: render the cohesive interior design onto THIS camera angle"
          : " — EDIT TARGET: re-render the approved design onto THIS camera angle";
    } else {
      role = ` — Reference angle ${partNum} of the same room`;
    }
    lines.push(`- [Image Part ${partNum}] ${p.label}${role}`);
  });

  lines.push(
    "",
    "### MULTI-PHOTO CONSTRAINTS",
    "- Cross-reference ALL photos above — they show the SAME physical room from different cameras.",
    "- Link matching walls, corners, and openings across every angle; do not treat any photo as a different room.",
    "- The design must map consistently across every structural boundary visible in any photo.",
    "- Maintain the exact window/door layout across the whole set.",
    "- Never render any text, captions, labels, or metadata overlays in the output image.",
  );

  if (mode === "initial-design") {
    lines.push(
      `- Output ONE photorealistic render of the furnished room from [Image Part ${editPart}] camera only.`,
      "- Use the other photos only for spatial understanding — do not copy their camera angles into the output.",
    );
  } else {
    lines.push(
      `- Output ONE photorealistic render from [Image Part ${editPart}] camera only.`,
      "- Match the PRIMARY DESIGN REFERENCE for furniture identity, finishes, palette, and decor.",
      "- Every piece of furniture stays on its SAME physical compass wall as in the reference — the room layout is FIXED, only the camera moved. Do NOT move the bed or any furniture to a different wall.",
      "- Use every room photo for geometry; use the design reference for style and products.",
    );
  }

  return lines.join("\n");
}

/** Intro text plus one labeled inline image part per assigned photo. */
export function buildMultiPhotoContextParts(opts: {
  roomName: string;
  roomType: string;
  photos: LabeledRoomPhoto[];
  editTargetPhotoId: string;
  mode: MultiPhotoContextMode;
}): GeminiTextOrImagePart[] {
  const parts: GeminiTextOrImagePart[] = [];
  const usable = opts.photos.filter((p) => p.base64);
  if (usable.length === 0) return parts;

  parts.push({
    text: buildMultiPhotoIntroText({ ...opts, photos: usable }),
  });

  for (let i = 0; i < usable.length; i++) {
    const p = usable[i]!;
    parts.push({ text: `[Image Part ${i + 1}] ${p.label}:` });
    parts.push({ inlineData: { mimeType: p.mimeType || "image/jpeg", data: p.base64 } });
  }

  return parts;
}
