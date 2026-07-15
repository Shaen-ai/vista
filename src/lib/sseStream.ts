/**
 * Helpers for server-side SSE ReadableStream controllers.
 *
 * When the client disconnects (tab close, navigation, fetch abort), the
 * runtime closes the controller. Subsequent enqueue/close throw
 * "Invalid state: Controller is already closed" — which must not be
 * treated as an AI generation failure or incident.
 */

export function isStreamClosedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /controller is already closed/i.test(message);
}

export interface SseEmitterOptions {
  /**
   * Send a `: keep-alive` SSE comment every N ms while the stream is open, so a
   * long silent gap between real events (e.g. a 30-90s vision call) is not
   * dropped as idle by an intermediary (nginx proxy_read_timeout, Cloudflare).
   * Stops automatically on close() or the first failed write. 0/undefined = off.
   */
  heartbeatMs?: number;
}

export function createSseEmitter(
  controller: ReadableStreamDefaultController<Uint8Array>,
  options: SseEmitterOptions = {},
) {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  function stopHeartbeat(): void {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  }

  function emit(event: unknown): boolean {
    if (closed) return false;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      return true;
    } catch {
      closed = true;
      stopHeartbeat();
      return false;
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    stopHeartbeat();
    try {
      controller.close();
    } catch {
      /* already closed by client disconnect / cancel */
    }
  }

  const heartbeatMs = options.heartbeatMs ?? 0;
  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      if (closed) {
        stopHeartbeat();
        return;
      }
      try {
        controller.enqueue(encoder.encode(`: keep-alive\n\n`));
      } catch {
        closed = true;
        stopHeartbeat();
      }
    }, heartbeatMs);
  }

  return { emit, close };
}
