import "server-only";

import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { withRetry } from "@/lib/aiRetry";
import { pipelineLog } from "@/lib/pipelineLog";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import {
  isValidationTimeoutError,
  VALIDATION_MAX_RETRIES,
  validationAbortSignal,
} from "@/lib/validationAiHelpers";
import { getValidateModel } from "@/lib/validationImageHelpers";

/**
 * Structural validation gate (engine-agnostic): does the redesigned image keep the
 * doors and windows where the original had them? Reuses the OpenAI vision model
 * already wired for floor-plan analysis (gpt-5.5 family). Returns a pass/fail with a
 * reason; callers decide whether to retry the render or flag for manual review.
 */

export type OpeningFailureType =
  | "none"
  | "count"
  | "wall"
  | "size_drift"
  | "added_opening"
  | "unknown";

export interface OpeningValidation {
  match: boolean;
  reason: string;
  failureType: OpeningFailureType;
}

const VALID_FAILURE_TYPES = new Set<OpeningFailureType>([
  "none",
  "count",
  "wall",
  "size_drift",
  "added_opening",
  "unknown",
]);

function parseFailureType(raw: unknown, match: boolean): OpeningFailureType {
  if (match) return "none";
  if (typeof raw === "string" && VALID_FAILURE_TYPES.has(raw as OpeningFailureType)) {
    return raw as OpeningFailureType;
  }
  return "unknown";
}

export async function validateOpenings(opts: {
  originalBase64: string;
  originalMime: string;
  renderedBase64: string;
  renderedMime: string;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
  /**
   * Floor plan + viewpoint geometry summary (from `buildOpeningValidationContext`).
   * When set, the validator trusts this over visual guesses about centered vs side-wall.
   */
  openingContext?: string;
  /** Optional log label, e.g. "furnish-retry". */
  label?: string;
}): Promise<OpeningValidation> {
  const openAiKey = getOpenAiApiKey();
  if (!openAiKey) {
    return { match: true, reason: "validation skipped (no OPENAI_API_KEY)", failureType: "none" };
  }

  const known = {
    windows: opts.windowBoxes ?? [],
    doors: opts.doorBoxes ?? [],
  };

  const contextBlock = opts.openingContext?.trim()
    ? `\n\nAUTHORITATIVE OPENING DATA (from floor plan + marked viewpoint — overrides your visual guess about placement):\n${opts.openingContext.trim()}\n`
    : "";

  const content = [
    {
      type: "text",
      text:
        "Compare these two photos of the same room: FIRST is the original, SECOND is the redesigned render. " +
        "The redesign may change furniture, finishes, and colors — that is expected. " +
        "Only judge STRUCTURE: did every window and door stay on the same wall, at the same position and size, with the same count (none moved, dropped, added, or invented on a solid wall)? " +
        `Known openings as normalized boxes (x,y,w,h, top-left origin): ${JSON.stringify(known)}. ` +
        contextBlock +
        'Respond with JSON only: {"match": boolean, "reason": string, "failureType": "none"|"count"|"wall"|"size_drift"|"added_opening"|"unknown"}. ' +
        'Use failureType "none" when match is true. Use "size_drift" when count and wall are correct but opening size/shape drifted slightly. ' +
        "When authoritative opening data is provided, use it to judge wall and along-wall position — do not call a right-of-center far-wall window 'centered' or 'on the side wall' if the data says otherwise.",
    },
    { type: "image_url", image_url: { url: `data:${opts.originalMime};base64,${opts.originalBase64}`, detail: "high" } },
    { type: "image_url", image_url: { url: `data:${opts.renderedMime};base64,${opts.renderedBase64}`, detail: "high" } },
  ];

  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = getValidateModel();

  try {
    const response = await withRetry(async () => {
      const res = await openAiFetch(
        apiUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content }],
            response_format: { type: "json_object" },
            max_completion_tokens: 4000,
          }),
          signal: validationAbortSignal(),
        },
        { vision: true },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err: Error & { status?: number } = new Error(
          `Opening validation failed (${res.status}): ${body.slice(0, 300)}`,
        );
        err.status = res.status;
        throw err;
      }
      return res.json();
    }, opts.label ? `Opening validation (${opts.label})` : "Opening validation", VALIDATION_MAX_RETRIES);

    const text = response?.choices?.[0]?.message?.content;
    const finishReason = response?.choices?.[0]?.finish_reason;
    if (typeof text !== "string" || !text.trim()) {
      pipelineLog(
        "VALIDATE",
        "opening validation empty content",
        { finishReason: finishReason ?? "unknown", label: opts.label },
        "warn",
      );
      return { match: true, reason: "validation empty response", failureType: "unknown" };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      pipelineLog(
        "VALIDATE",
        "opening validation JSON parse failed",
        {
          finishReason: finishReason ?? "unknown",
          contentPreview: text.slice(0, 120),
          message: parseErr instanceof Error ? parseErr.message : String(parseErr),
          label: opts.label,
        },
        "warn",
      );
      return { match: true, reason: "validation parse failed", failureType: "unknown" };
    }
    const match = parsed?.match === true;
    const result: OpeningValidation = {
      match,
      reason: typeof parsed?.reason === "string" ? parsed.reason : "",
      failureType: parseFailureType(parsed?.failureType, match),
    };
    const logMsg = opts.label === "furnish-retry"
      ? "furnish retry opening validation"
      : "opening validation";
    pipelineLog(
      "VALIDATE",
      logMsg,
      {
        match: result.match,
        failureType: result.failureType,
        reason: result.reason.slice(0, 200),
        label: opts.label,
      },
      result.match ? "info" : "warn",
    );
    return result;
  } catch (err) {
    if (isValidationTimeoutError(err)) {
      pipelineLog(
        "VALIDATE",
        "opening validation timed out — skipping",
        { label: opts.label, deadlineMs: 90_000 },
        "warn",
      );
      return { match: true, reason: "validation timed out", failureType: "none" };
    }
    pipelineLog(
      "VALIDATE",
      opts.label === "furnish-retry" ? "furnish retry opening validation error" : "opening validation error",
      { message: err instanceof Error ? err.message.slice(0, 200) : String(err), label: opts.label },
      "warn",
    );
    return { match: true, reason: "validation unavailable", failureType: "none" };
  }
}
