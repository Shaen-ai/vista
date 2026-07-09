import type { ProgressEvent } from "@/lib/project/types";
import { AiServiceUnavailableError, isAiServiceUnavailableCode } from "@/lib/aiServiceError";
import { sanitizeUserFacingMessage } from "@/lib/userFacingMessages";

export function parseSsePart(
  part: string,
  onProgress: (event: ProgressEvent) => void,
  lastComplete: { value: ProgressEvent | null },
): void {
  const line = part.trim();
  if (!line.startsWith("data:")) return;
  const json = line.slice(5).trim();
  if (!json) return;

  try {
    const raw = JSON.parse(json) as ProgressEvent;
    const event: ProgressEvent = raw.message
      ? { ...raw, message: sanitizeUserFacingMessage(raw.message) }
      : raw;
    onProgress(event);
    if (event.phase === "complete") lastComplete.value = event;
    if (event.phase === "error") {
      if (isAiServiceUnavailableCode(event.code)) {
        throw new AiServiceUnavailableError(event.message || "Operation failed");
      }
      throw new Error(event.message || "Operation failed");
    }
  } catch (err) {
    if (err instanceof Error && err.message !== "Operation failed") {
      throw err;
    }
    if (err instanceof Error) throw err;
  }
}

export function drainSseBuffer(
  buffer: string,
  onProgress: (event: ProgressEvent) => void,
  lastComplete: { value: ProgressEvent | null },
): string {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";
  for (const part of parts) {
    parseSsePart(part, onProgress, lastComplete);
  }
  return remainder;
}

export async function consumeSSE(
  response: Response,
  onProgress: (event: ProgressEvent) => void,
): Promise<ProgressEvent | null> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  const lastComplete = { value: null as ProgressEvent | null };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      buffer = drainSseBuffer(buffer, onProgress, lastComplete);
    }
    if (done) break;
  }

  buffer += decoder.decode();
  buffer = drainSseBuffer(buffer, onProgress, lastComplete);
  if (buffer.trim()) {
    parseSsePart(buffer, onProgress, lastComplete);
  }

  return lastComplete.value;
}
