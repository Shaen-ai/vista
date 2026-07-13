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

export function createSseEmitter(controller: ReadableStreamDefaultController<Uint8Array>) {
  const encoder = new TextEncoder();
  let closed = false;

  function emit(event: unknown): boolean {
    if (closed) return false;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      return true;
    } catch {
      closed = true;
      return false;
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    try {
      controller.close();
    } catch {
      /* already closed by client disconnect / cancel */
    }
  }

  return { emit, close };
}
