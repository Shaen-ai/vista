import "server-only";

import { pipelineLog } from "@/lib/pipelineLog";
import { isFalDebugEnabled, saveFalDebugArtifacts } from "@/lib/falDebug";

export const QUICK_ROOM_FAL_SHELL_ENDPOINT = "fal-ai/flux-2-lora-gallery/apartment-staging";
export const QUICK_ROOM_FAL_BANANA_ENDPOINT = "fal-ai/nano-banana-pro/edit";

export type QuickRoomFalStep = "prep" | "shell" | "banana";

const STEP_ORDER: Record<QuickRoomFalStep, number> = {
  prep: 1,
  shell: 2,
  banana: 3,
};

export interface QuickRoomFalStepLogInput {
  step: QuickRoomFalStep;
  sessionId: string;
  endpoint: string;
  /** Full prompt sent to FAL — logged on its own line for playground copy/paste. */
  prompt?: string;
  /** FAL request params (lora_scale, guidance_scale, resolution, etc.). */
  falParams?: Record<string, unknown>;
  /** Human-readable role per image_urls index. */
  imageIndexRoles?: string[];
  extra?: Record<string, unknown>;
}

/**
 * Greppable Quick Room FAL step log — metadata line + full prompt on a second line.
 *
 *   grep 'quick-room · shell' server.log
 *   grep 'quick-room · banana · prompt' server.log
 */
export function logQuickRoomFalStep(input: QuickRoomFalStepLogInput): void {
  const order = STEP_ORDER[input.step];
  const tag = `quick-room · step ${order}/3 · ${input.step}`;

  pipelineLog("FAL_PIPELINE", tag, {
    sessionId: input.sessionId,
    endpoint: input.endpoint,
    promptChars: input.prompt?.length ?? 0,
    imageIndexRoles: input.imageIndexRoles,
    falParams: input.falParams,
    ...input.extra,
  });

  if (input.prompt?.trim()) {
    console.info(
      `[vista-pipeline][7·fal-pipeline] ${tag} · prompt (${input.prompt.length} chars):\n${input.prompt}`,
    );
  }

  if (isFalDebugEnabled() && input.prompt?.trim()) {
    const safeSession = input.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    void saveFalDebugArtifacts({
      projectId: `quick-${safeSession}`,
      artifacts: {
        [`${order}-${input.step}-prompt.txt`]: input.prompt,
      },
    }).catch(() => {});
  }
}
