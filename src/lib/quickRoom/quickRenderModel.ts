import { getFalKey } from "@/lib/serverAiKeys";

/**
 * Quick Room render engine — "edit-pipeline" (default) is the Full Project
 * nano-banana-pro edit stack with geometry validation; "legacy" is the
 * original single-shot Gemini render.
 */
export type QuickRenderModel = "edit-pipeline" | "legacy";

export function resolveQuickRenderModel(): QuickRenderModel {
  const raw = process.env.VISTA_QUICK_RENDER_MODEL?.trim().toLowerCase();
  if (raw === "legacy" || raw === "gemini") return "legacy";
  // The edit pipeline renders through fal — degrade instead of erroring when
  // the deployment has no fal credentials.
  if (!getFalKey()) return "legacy";
  return "edit-pipeline";
}
