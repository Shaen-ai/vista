import { appendFileSync } from "node:fs";

const DEBUG_LOG_PATH = "/Users/shahen1/apps/mebel/.cursor/debug-b0e29c.log";

/** Debug-mode NDJSON ingest (session b0e29c). Remove after verification. */
export function debugIngest(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
  runId = "pre-fix",
): void {
  const line = JSON.stringify({
    sessionId: "b0e29c",
    runId,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  });
  // #region agent log
  try {
    appendFileSync(DEBUG_LOG_PATH, `${line}\n`);
  } catch {
    /* ignore */
  }
  fetch("http://127.0.0.1:7828/ingest/11550746-5e7b-478f-b28e-9e894272fe85", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b0e29c" },
    body: line,
  }).catch(() => {});
  // #endregion
}
