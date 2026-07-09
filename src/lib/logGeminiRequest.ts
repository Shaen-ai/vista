/**
 * Logging for Gemini interior-design image generation. Greppable prefix: `[gemini-request]`.
 *
 * Default (`compact`): one summary line + the final edit prompt only.
 * Set `VISTA_GEMINI_REQUEST_LOG=full` for the legacy per-part dump.
 * Set `VISTA_GEMINI_REQUEST_LOG=off` to disable.
 */

import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import { summarizeRoomParams } from "@/lib/pipelineLog";
import { writeSinkLine, safeStringify } from "@/lib/logSink";

type GeminiLogLevel = "full" | "compact" | "off";

function geminiLogLevel(): GeminiLogLevel {
  const v = (process.env.VISTA_GEMINI_REQUEST_LOG || "compact").trim().toLowerCase();
  if (v === "off" || v === "0" || v === "false") return "off";
  if (v === "full" || v === "1" || v === "true") return "full";
  return "compact";
}

/**
 * Tee a console.info line to the per-project log file (when a generation context
 * is active) so the full, untruncated dump is persisted alongside the terminal.
 */
function out(first: unknown, second?: unknown): void {
  if (second !== undefined) {
    console.info(first, second);
    writeSinkLine(`${safeStringify(first)} ${safeStringify(second)}`);
  } else {
    console.info(first);
    writeSinkLine(safeStringify(first));
  }
}

export type GeminiRequestPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
};

export interface LogGeminiRequestContext {
  phase?: string;
  projectId?: string;
  roomId?: string;
  roomName?: string;
  /** Floor-plan DetectedRoom summary (dimensions, openings, polygon edges). */
  detectedRoom?: Parameters<typeof summarizeRoomParams>[0];
  roomAnalysis?: RoomAnalysis | null;
  roomGeometry?: RoomGeometry | null;
  freeRender?: boolean;
  hasRoomImage?: boolean;
  [key: string]: unknown;
}

export interface LogGeminiRequestOptions {
  /** Short caller label, e.g. "phased-base", "quick-room-full". */
  label: string;
  model?: string;
  systemInstruction?: string;
  parts: GeminiRequestPart[];
  context?: LogGeminiRequestContext;
}

const LOG_PREFIX = "[gemini-request]";

function imageByteLength(base64: string): number {
  // base64 length → approximate decoded bytes
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function precedingTextLabel(parts: GeminiRequestPart[], index: number): string | undefined {
  for (let j = index - 1; j >= 0; j--) {
    const t = parts[j]?.text?.trim();
    if (t) return t.length > 240 ? `${t.slice(0, 240)}…` : t;
  }
  return undefined;
}

/** Serialize parts for logging — text in full, images as metadata only. */
export function serializeGeminiParts(parts: GeminiRequestPart[]): Array<Record<string, unknown>> {
  return parts.map((part, index) => {
    if (part.text != null && part.text !== "") {
      return { index, kind: "text", chars: part.text.length, text: part.text };
    }
    if (part.inlineData?.data) {
      const { mimeType, data } = part.inlineData;
      return {
        index,
        kind: "image",
        mimeType,
        base64Chars: data.length,
        approxBytes: imageByteLength(data),
        label: precedingTextLabel(parts, index),
      };
    }
    return { index, kind: "empty" };
  });
}

/**
 * Emit a greppable summary of a Gemini generateContent request.
 * Safe to call from server code only (may log prompt text in compact/full modes).
 */
export function logGeminiRequest(opts: LogGeminiRequestOptions): void {
  const level = geminiLogLevel();
  if (level === "off") return;

  const { label, model, systemInstruction, parts, context } = opts;
  const imageCount = parts.filter((p) => p.inlineData?.data).length;
  const textCount = parts.filter((p) => p.text?.trim()).length;
  const totalTextChars = parts.reduce((n, p) => n + (p.text?.length ?? 0), 0);
  const imageBytes = parts.reduce((n, p) => {
    const data = p.inlineData?.data;
    return n + (data ? imageByteLength(data) : 0);
  }, 0);

  const header = [
    label,
    context?.projectId ? `project=${context.projectId}` : "",
    context?.roomId ? `room=${context.roomId}` : "",
    context?.roomName ? `name=${context.roomName}` : "",
    context?.phase ? `phase=${context.phase}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const editPrompt = [...parts].reverse().find((p) => p.text?.trim())?.text?.trim() ?? "";

  if (level === "compact") {
    const roomSummary = context?.detectedRoom ? summarizeRoomParams(context.detectedRoom).size : null;
    out(
      `${LOG_PREFIX} ${header} | model=${model ?? "unknown"} | ${parts.length} parts (${imageCount} img ~${Math.round(imageBytes / 1024)}KB, ${textCount} text, ${totalTextChars} chars) | system=${systemInstruction?.length ?? 0} chars${roomSummary ? ` | room=${roomSummary}` : ""}`,
    );
    if (editPrompt) {
      out(`${LOG_PREFIX} prompt: ${editPrompt.length > 400 ? `${editPrompt.slice(0, 400)}…` : editPrompt}`);
    }
    return;
  }

  out(`${LOG_PREFIX} ========== ${header} ==========`);
  out(`${LOG_PREFIX} model: ${model ?? "unknown"}`);
  out(`${LOG_PREFIX} parts: ${parts.length} total (${textCount} text, ${imageCount} images, ${totalTextChars} text chars)`);

  if (context && Object.keys(context).length > 0) {
    out(`${LOG_PREFIX} --- context ---`);
    const {
      detectedRoom,
      roomAnalysis,
      roomGeometry,
      ...rest
    } = context;

    if (rest && Object.keys(rest).length > 0) {
      out(`${LOG_PREFIX} context.meta`, rest);
    }

    if (detectedRoom) {
      out(`${LOG_PREFIX} context.detectedRoom (floor plan)`, summarizeRoomParams(detectedRoom));
      out(`${LOG_PREFIX} context.detectedRoom.raw`, JSON.stringify(detectedRoom, null, 2));
    }

    if (roomAnalysis) {
      out(`${LOG_PREFIX} context.roomAnalysis`, JSON.stringify(roomAnalysis, null, 2));
    } else if (roomAnalysis === null) {
      out(`${LOG_PREFIX} context.roomAnalysis: null`);
    }

    if (roomGeometry) {
      out(`${LOG_PREFIX} context.roomGeometry`, JSON.stringify(roomGeometry, null, 2));
    } else if (roomGeometry === null) {
      out(`${LOG_PREFIX} context.roomGeometry: null`);
    }
  }

  if (systemInstruction?.trim()) {
    out(`${LOG_PREFIX} --- systemInstruction (${systemInstruction.length} chars) ---`);
    out(`${LOG_PREFIX} ${systemInstruction}`);
  }

  out(`${LOG_PREFIX} --- parts ---`);
  for (const entry of serializeGeminiParts(parts)) {
    if (entry.kind === "text") {
      out(`${LOG_PREFIX} part[${entry.index}] TEXT (${entry.chars} chars):`);
      out(entry.text);
    } else if (entry.kind === "image") {
      out(
        `${LOG_PREFIX} part[${entry.index}] IMAGE mime=${entry.mimeType} ~${entry.approxBytes} bytes (base64 ${entry.base64Chars} chars)${entry.label ? ` | "${entry.label}"` : ""}`,
      );
    } else {
      out(`${LOG_PREFIX} part[${entry.index}] (empty)`);
    }
  }

  out(`${LOG_PREFIX} ========== end ${label} ==========`);
}
