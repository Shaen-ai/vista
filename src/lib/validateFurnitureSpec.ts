import "server-only";

import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { withRetry } from "@/lib/aiRetry";
import { pipelineLog } from "@/lib/pipelineLog";

export interface FurnitureSpecValidation {
  match: boolean;
  confirmed: string[];
  missing: string[];
  reason: string;
}

/** Opt-out default — aligned with VISTA_FAL_VALIDATE (on unless explicitly disabled). */
export function isFurnitureSpecValidationEnabled(): boolean {
  if ((process.env.VISTA_FAL_VALIDATE_FURNITURE || "").trim() === "0") return false;
  return !!getOpenAiApiKey();
}

export async function validateFurnitureSpec(opts: {
  renderedBase64: string;
  renderedMime: string;
  furnitureItems: string[];
}): Promise<FurnitureSpecValidation> {
  const openAiKey = getOpenAiApiKey();
  if (!openAiKey || opts.furnitureItems.length === 0) {
    return {
      match: true,
      confirmed: opts.furnitureItems,
      missing: [],
      reason: "validation skipped",
    };
  }

  const list = opts.furnitureItems.map((item, i) => `${i + 1}. ${item}`).join("\n");

  const content = [
    {
      type: "text",
      text:
        "You are reviewing an AI interior render. Does the image visibly contain each listed furniture piece or close equivalent?\n\n" +
        `EXPECTED FURNITURE:\n${list}\n\n` +
        "Rules: Rug or floor treatment alone is NOT sufficient if beds, wardrobes, or major seating are listed. " +
        "Mark each item confirmed only if clearly visible. " +
        'Respond JSON only: {"match": boolean, "confirmed": string[], "missing": string[], "reason": string}. ' +
        "match is true only when every listed piece (or clear equivalent) is visible.",
    },
    {
      type: "image_url",
      image_url: {
        url: `data:${opts.renderedMime};base64,${opts.renderedBase64}`,
        detail: "high",
      },
    },
  ];

  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.FLOOR_PLAN_ANALYSIS_MODEL || "gpt-5.5";

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
            max_completion_tokens: 1000,
          }),
        },
        { vision: true },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Furniture spec validation failed (${res.status}): ${body.slice(0, 300)}`);
      }
      return res.json();
    }, "Furniture spec validation");

    const text = response?.choices?.[0]?.message?.content;
    const parsed = typeof text === "string" ? JSON.parse(text) : {};
    const result: FurnitureSpecValidation = {
      match: parsed?.match === true,
      confirmed: Array.isArray(parsed?.confirmed)
        ? parsed.confirmed.filter((x: unknown) => typeof x === "string")
        : [],
      missing: Array.isArray(parsed?.missing)
        ? parsed.missing.filter((x: unknown) => typeof x === "string")
        : [],
      reason: typeof parsed?.reason === "string" ? parsed.reason : "",
    };
    pipelineLog("VALIDATE", "furniture spec validation", {
      match: result.match,
      confirmed: result.confirmed.slice(0, 8),
      missing: result.missing.slice(0, 8),
      reason: result.reason.slice(0, 200),
    });
    return result;
  } catch (err) {
    pipelineLog(
      "VALIDATE",
      "furniture spec validation error",
      { message: err instanceof Error ? err.message.slice(0, 200) : String(err) },
      "warn",
    );
    return {
      match: true,
      confirmed: opts.furnitureItems,
      missing: [],
      reason: "validation unavailable",
    };
  }
}
