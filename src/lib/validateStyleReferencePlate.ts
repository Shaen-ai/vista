import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { withRetry } from "@/lib/aiRetry";
import { pipelineLog } from "@/lib/pipelineLog";

export interface StylePlateValidation {
  furnished: boolean;
  reason: string;
}

/** Vision gate: reject empty/minimal style plates before Kontext upload. */
export async function validateStyleReferencePlate(opts: {
  renderedBase64: string;
  renderedMime: string;
  styleBrief: string;
}): Promise<StylePlateValidation> {
  const openAiKey = getOpenAiApiKey();
  if (!openAiKey) {
    return { furnished: true, reason: "validation skipped (no OPENAI_API_KEY)" };
  }

  const content = [
    {
      type: "text",
      text:
        "Does this interior design concept image show a FURNISHED room with clearly visible major furniture " +
        "(beds, sofas, wardrobes, tables, etc.)? Empty shells, bare rooms, and floor plans count as NOT furnished. " +
        `Design brief excerpt: ${opts.styleBrief.slice(0, 800)}. ` +
        'Respond with JSON only: {"furnished": boolean, "reason": string}.',
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
            max_completion_tokens: 500,
          }),
        },
        { vision: true },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Style plate validation failed (${res.status}): ${body.slice(0, 300)}`);
      }
      return res.json();
    }, "Style plate furniture validation");

    const text = response?.choices?.[0]?.message?.content;
    const parsed = typeof text === "string" ? JSON.parse(text) : {};
    const furnished = parsed?.furnished === true;
    const result: StylePlateValidation = {
      furnished,
      reason: typeof parsed?.reason === "string" ? parsed.reason : "",
    };
    pipelineLog(
      "VALIDATE",
      "style plate furniture validation",
      { furnished: result.furnished, reason: result.reason.slice(0, 200) },
      result.furnished ? "info" : "warn",
    );
    return result;
  } catch (err) {
    pipelineLog(
      "VALIDATE",
      "style plate furniture validation error",
      { message: err instanceof Error ? err.message.slice(0, 200) : String(err) },
      "warn",
    );
    return { furnished: true, reason: "validation unavailable" };
  }
}
