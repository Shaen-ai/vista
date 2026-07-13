import "server-only";

import { getFalKey } from "@/lib/serverAiKeys";
import { renderFalTextToImage } from "@/lib/falTextToImage";
import { resolveQuickRenderModel } from "@/lib/quickRoom/quickRenderModel";

export interface BootstrapReferenceResult {
  base64: string;
  mimeType: string;
  bootstrapped: boolean;
}

export async function bootstrapQuickRoomReference(opts: {
  referenceBase64?: string;
  referenceImageMimeType?: string;
  briefFullPrompt: string;
  designStyleLabel: string;
  sessionId?: string;
}): Promise<BootstrapReferenceResult> {
  if (opts.referenceBase64?.trim()) {
    return {
      base64: opts.referenceBase64,
      mimeType: opts.referenceImageMimeType || "image/jpeg",
      bootstrapped: false,
    };
  }

  if (resolveQuickRenderModel() !== "edit-pipeline" || !getFalKey()) {
    throw new Error(
      "Room photo is required when FAL render is unavailable. Upload a room photo or configure FAL_KEY.",
    );
  }

  const shellPrompt = [
    `Create a photorealistic empty-to-sparse interior room photograph.`,
    `Style: ${opts.designStyleLabel}.`,
    opts.briefFullPrompt.trim(),
    "Show believable architecture: walls, floor, ceiling, natural light, and camera perspective.",
    "Do not add a product collage or text overlay. Furniture will be placed in a later pass.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const shell = await renderFalTextToImage({
    prompt: shellPrompt,
    sessionId: opts.sessionId,
    label: "quick-room-txt2img-shell",
  });

  return {
    base64: shell.base64,
    mimeType: shell.mimeType,
    bootstrapped: true,
  };
}
