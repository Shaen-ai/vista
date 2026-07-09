/**
 * Server-side file sink for the Vista pipeline logs.
 *
 * Why this exists: `pipelineLog`, `logGeminiRequest`, and `logClaudeRequest` only
 * `console.*`, and those dumps are huge (full prompts, 15k+ chars each, many per
 * render). The dev terminal truncates its scrollback, so the exact stage where a
 * design went wrong is lost. This module tees every one of those lines to an
 * untruncated, greppable file keyed by projectId, so a finished generation can be
 * read back in full from `.vista-logs/<projectId>.log`.
 *
 * Design:
 * - An AsyncLocalStorage carries the current `logId` (projectId / sessionId).
 *   `runWithLogContext` wraps a generation so every nested log call — no matter how
 *   deep, including inside SSE stream callbacks — keys to the same file.
 * - The API is registered on `globalThis.__vistaLogSink` so the CLIENT-SAFE
 *   `pipelineLog.ts` can reach it WITHOUT importing this module (which pulls in
 *   `node:*` and must never enter the client bundle).
 *
 * Disable with `VISTA_FILE_LOGS=0`. Output dir: `VISTA_LOG_DIR` or `<cwd>/.vista-logs`.
 */
import "server-only";

import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

interface LogContext {
  logId: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<LogContext>();

function enabled(): boolean {
  return (process.env.VISTA_FILE_LOGS || "1").trim() !== "0";
}

function logDir(): string {
  return process.env.VISTA_LOG_DIR || join(process.cwd(), ".vista-logs");
}

/** Keep a filename to a safe slug; collapse anything non-alphanumeric to "-". */
function sanitize(logId: string): string {
  return logId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "unkeyed";
}

let dirEnsured = false;
function ensureDir(dir: string): boolean {
  if (dirEnsured) return true;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    dirEnsured = true;
    pruneOldLogs(dir);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort: delete log files older than 7 days so the dir doesn't grow forever. */
function pruneOldLogs(dir: string): void {
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  try {
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".log")) continue;
      const full = join(dir, name);
      try {
        if (now - statSync(full).mtimeMs > maxAgeMs) unlinkSync(full);
      } catch {
        /* ignore individual file errors */
      }
    }
  } catch {
    /* ignore */
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Append one line to the current context's log file. No-ops when file logging is
 * disabled or there is no active `runWithLogContext` scope.
 */
export function getCurrentLogId(): string | undefined {
  return storage.getStore()?.logId;
}

export function writeSinkLine(line: string): void {
  if (!enabled()) return;
  const ctx = storage.getStore();
  if (!ctx) return;
  const dir = logDir();
  if (!ensureDir(dir)) return;
  try {
    appendFileSync(join(dir, `${sanitize(ctx.logId)}.log`), `${line}\n`);
  } catch {
    /* never let logging break a request */
  }
}

/**
 * Run `fn` inside a log context keyed by `logId`. Writes START/END block markers so
 * one project file cleanly delimits each operation (every room/phase of a project
 * accumulates into the same file).
 */
export function runWithLogContext<T>(logId: string, fn: () => Promise<T>): Promise<T> {
  const ctx: LogContext = { logId, startedAt: Date.now() };
  return storage.run(ctx, async () => {
    writeSinkLine(`===== START ${logId} @ ${new Date(ctx.startedAt).toISOString()} =====`);
    try {
      return await fn();
    } finally {
      writeSinkLine(`===== END ${logId} (${Date.now() - ctx.startedAt}ms) =====`);
    }
  });
}

export interface VistaLogSink {
  writeSinkLine: (line: string) => void;
  runWithLogContext: <T>(logId: string, fn: () => Promise<T>) => Promise<T>;
  safeStringify: (value: unknown) => string;
}

declare global {
  var __vistaLogSink: VistaLogSink | undefined;
}

// Register on globalThis so the client-safe `pipelineLog.ts` can tee without
// importing this (server-only) module.
globalThis.__vistaLogSink = { writeSinkLine, runWithLogContext, safeStringify };

export { safeStringify };
