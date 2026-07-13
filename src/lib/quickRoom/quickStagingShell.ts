import "server-only";

import sharp from "sharp";
import { renderApartmentStaging } from "@/lib/falRoomRenderer";
import { uploadPublicImage } from "@/lib/falStorage";
import { buildQuickStagingShellPrompt } from "./quickStagingShellPrompt";
import {
  QUICK_ROOM_FAL_SHELL_ENDPOINT,
  logQuickRoomFalStep,
} from "./quickFalStepLog";

export { buildQuickStagingShellPrompt } from "./quickStagingShellPrompt";

export interface RenderQuickStagingShellInput {
  photoBase64: string;
  photoMime: string;
  designStyleLabel: string;
  sessionId: string;
  label?: string;
  /** apartment-staging LoRA strength — default 1. */
  loraScale?: number;
}

export async function renderQuickStagingShell(
  input: RenderQuickStagingShellInput,
): Promise<{ base64: string; mimeType: string; seed?: number }> {
  const label = input.label ?? "quick-staging-shell";
  const loraScale = input.loraScale ?? 1;
  const prompt = buildQuickStagingShellPrompt(input.designStyleLabel);
  const buf = Buffer.from(input.photoBase64, "base64");
  const meta = await sharp(buf).metadata();
  const imageUrl = await uploadPublicImage(buf, input.photoMime || "image/jpeg", {
    sessionId: input.sessionId,
    type: "original",
    label: `${label}-input`,
  });

  logQuickRoomFalStep({
    step: "shell",
    sessionId: input.sessionId,
    endpoint: QUICK_ROOM_FAL_SHELL_ENDPOINT,
    prompt,
    falParams: {
      lora_scale: loraScale,
      guidance_scale: Number(process.env.VISTA_FAL_STAGING_GUIDANCE) || 2.5,
      image_count: 1,
      image_role: "original room photo",
    },
    imageIndexRoles: ["0: original room photo"],
    extra: {
      label,
      width: meta.width,
      height: meta.height,
    },
  });

  const rendered = await renderApartmentStaging({
    imageUrl,
    prompt,
    sessionId: input.sessionId,
    label,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    loraScale,
  });

  const img = rendered.images[0];
  if (!img) throw new Error("Quick staging shell returned no image");
  return { ...img, seed: rendered.seed };
}
