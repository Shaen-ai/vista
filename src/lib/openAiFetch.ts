/**
 * OpenAI HTTP client with extended undici timeouts.
 *
 * Node's global fetch uses undici (default headersTimeout = 300s). Floor-plan
 * vision calls with two high-detail images often exceed that before the first
 * response byte arrives.
 */

import { Agent, fetch as undiciFetch } from "undici";

async function recordUsageFromResponse(res: Response, requestBody?: string): Promise<void> {
  try {
    const { isDevSpendEnabled, recordOpenAiUsage } = await import("@/lib/aiSpend");
    if (!isDevSpendEnabled()) return;
    let model = "unknown";
    if (requestBody) {
      try {
        const parsed = JSON.parse(requestBody) as { model?: string };
        if (typeof parsed.model === "string") model = parsed.model;
      } catch {
        /* ignore */
      }
    }
    const clone = res.clone();
    const data = (await clone.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
    };
    const usage = data?.usage;
    if (!usage) return;
    recordOpenAiUsage({
      model,
      inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
      label: "openai-fetch",
    });
  } catch {
    /* never break requests */
  }
}

const visionAgent = new Agent({
  connectTimeout: 60_000,
  headersTimeout: 900_000, // 15 min
  bodyTimeout: 900_000,
});

const defaultAgent = new Agent({
  connectTimeout: 30_000,
  headersTimeout: 600_000, // 10 min
  bodyTimeout: 600_000,
});

export type OpenAiFetchOptions = {
  /** Use longer timeouts for multi-image vision JSON calls. */
  vision?: boolean;
};

export async function openAiFetch(
  url: string,
  init: RequestInit,
  options: OpenAiFetchOptions = {},
): Promise<Response> {
  const dispatcher = options.vision ? visionAgent : defaultAgent;
  const bodyText = typeof init.body === "string" ? init.body : undefined;
  const res = (await undiciFetch(url, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
  if (res.ok && url.includes("/chat/completions")) {
    void recordUsageFromResponse(res, bodyText);
  }
  return res;
}

export function isOpenAiTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const cause = (err as { cause?: { code?: string } }).cause;
  const code = cause?.code ?? (err as { code?: string }).code;
  return code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT";
}
