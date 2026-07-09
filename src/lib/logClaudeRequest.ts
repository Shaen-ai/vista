/**
 * Full-fidelity logging of everything sent to and received from Claude (Anthropic)
 * in the interior-design pipeline. Greppable prefixes: `[claude-request]` and
 * `[claude-response]`.
 *
 * VISTA_CLAUDE_REQUEST_LOG: `compact` (default) | `full` | `off`
 */

import type Anthropic from "@anthropic-ai/sdk";
import { collectAnthropicTextBlocks } from "@/lib/creativeDirectorJson";
import { writeSinkLine, safeStringify } from "@/lib/logSink";
import { isDevSpendEnabled, recordAnthropicUsage } from "@/lib/aiSpend";

const REQ_PREFIX = "[claude-request]";
const RES_PREFIX = "[claude-response]";

type ClaudeLogMode = "compact" | "full" | "off";

function claudeLogMode(): ClaudeLogMode {
  const raw = (process.env.VISTA_CLAUDE_REQUEST_LOG || "compact").trim().toLowerCase();
  if (raw === "full" || raw === "off") return raw;
  return "compact";
}

/** Tee a console.info line to the per-project log file (when a context is active). */
function out(first: unknown, second?: unknown): void {
  if (second !== undefined) {
    console.info(first, second);
    writeSinkLine(`${safeStringify(first)} ${safeStringify(second)}`);
  } else {
    console.info(first);
    writeSinkLine(safeStringify(first));
  }
}

function imageByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export interface LogClaudeRequestOptions {
  label: string;
  model?: string;
  maxTokens?: number;
  system?: string;
  messages: Anthropic.ContentBlockParam[];
  context?: Record<string, unknown>;
}

export function logClaudeRequest(opts: LogClaudeRequestOptions): void {
  const mode = claudeLogMode();
  if (mode === "off") return;

  const { label, model, maxTokens, system, messages, context } = opts;
  const imageCount = messages.filter((b) => b.type === "image").length;
  const textCount = messages.filter((b) => b.type === "text").length;
  const textChars = messages
    .filter((b): b is Anthropic.TextBlockParam => b.type === "text")
    .reduce((n, b) => n + b.text.length, 0);

  if (mode === "compact") {
    out(`${REQ_PREFIX} ${label}`, {
      model: model ?? "unknown",
      maxTokens,
      contentBlocks: messages.length,
      textBlocks: textCount,
      imageBlocks: imageCount,
      textChars,
      systemChars: system?.length ?? 0,
      context,
    });
    return;
  }

  out(`${REQ_PREFIX} ========== ${label} ==========`);
  out(`${REQ_PREFIX} model: ${model ?? "unknown"}${maxTokens != null ? ` max_tokens=${maxTokens}` : ""}`);
  out(`${REQ_PREFIX} content blocks: ${messages.length} (${textCount} text, ${imageCount} images)`);

  if (context && Object.keys(context).length > 0) {
    out(`${REQ_PREFIX} context`, JSON.stringify(context, null, 2));
  }

  if (system?.trim()) {
    out(`${REQ_PREFIX} --- system (${system.length} chars) ---`);
    out(`${REQ_PREFIX} ${system}`);
  }

  out(`${REQ_PREFIX} --- content ---`);
  messages.forEach((block, index) => {
    if (block.type === "text") {
      out(`${REQ_PREFIX} block[${index}] TEXT (${block.text.length} chars):`);
      out(block.text);
    } else if (block.type === "image") {
      const src = block.source;
      if (src.type === "base64") {
        out(
          `${REQ_PREFIX} block[${index}] IMAGE media=${src.media_type} ~${imageByteLength(src.data)} bytes (base64 ${src.data.length} chars)`,
        );
      } else {
        out(`${REQ_PREFIX} block[${index}] IMAGE source=${src.type}`);
      }
    } else {
      out(`${REQ_PREFIX} block[${index}] ${block.type}`);
    }
  });

  out(`${REQ_PREFIX} ========== end ${label} ==========`);
}

export interface LogClaudeResponseOptions {
  label: string;
  response: Anthropic.Message;
  parsed?: unknown;
  rawText?: string;
  context?: Record<string, unknown>;
}

export function logClaudeResponse(opts: LogClaudeResponseOptions): void {
  const mode = claudeLogMode();
  if (mode === "off") return;

  const { label, response, parsed, rawText, context } = opts;
  const usage = response.usage;
  if (usage && isDevSpendEnabled()) {
    recordAnthropicUsage({
      model: response.model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      label: opts.label,
    });
  }
  const text = rawText ?? collectAnthropicTextBlocks(response.content);

  if (mode === "compact") {
    out(`${RES_PREFIX} ${label}`, {
      stop_reason: response.stop_reason ?? "unknown",
      usage,
      textChars: text.length,
      parsedRoomCount:
        parsed && typeof parsed === "object" && parsed !== null && "rooms" in parsed
          ? Array.isArray((parsed as { rooms?: unknown }).rooms)
            ? (parsed as { rooms: unknown[] }).rooms.length
            : undefined
          : undefined,
      context,
      preview: text.slice(0, 400),
    });
    return;
  }

  out(`${RES_PREFIX} ========== ${label} ==========`);
  out(`${RES_PREFIX} stop_reason: ${response.stop_reason ?? "unknown"}`);
  if (usage) {
    out(
      `${RES_PREFIX} usage: in=${usage.input_tokens} out=${usage.output_tokens} cacheCreate=${usage.cache_creation_input_tokens ?? 0} cacheRead=${usage.cache_read_input_tokens ?? 0}`,
    );
  }
  if (context && Object.keys(context).length > 0) {
    out(`${RES_PREFIX} context`, JSON.stringify(context, null, 2));
  }
  out(`${RES_PREFIX} --- raw text (${text.length} chars) ---`);
  out(text);
  if (parsed !== undefined) {
    out(`${RES_PREFIX} --- parsed ---`);
    out(JSON.stringify(parsed, null, 2));
  }
  out(`${RES_PREFIX} ========== end ${label} ==========`);
}
