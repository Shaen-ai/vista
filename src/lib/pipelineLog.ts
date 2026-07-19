/**
 * Step-numbered, greppable logging for the Vista Full Project pipeline.
 *
 * When an uploaded plan + photos produce a wrong interior design, these logs let
 * us pinpoint WHICH stage the room parameters went wrong. Every line is prefixed
 * `[vista-pipeline]` and tagged with its step, so you can filter the server
 * terminal or the browser console:
 *
 *   grep '\[vista-pipeline\]'                 # whole pipeline
 *   grep '\[vista-pipeline\]\[5·claude'        # Claude per-room design concepts
 *
 * Timed ops (uploads, Redis, FAL subscribe) use `pipelineTimed` with greppable suffixes:
 *
 *   grep '— start'       .vista-logs/proj-*.log   # in-flight ops
 *   grep 'still running' .vista-logs/proj-*.log   # heartbeats / long waits
 *   grep '— failed'     .vista-logs/proj-*.log   # hard failures
 *   grep 'fal upload'   .vista-logs/proj-*.log   # all uploads
 *   grep 'redis setProject' .vista-logs/proj-*.log
 *
 * Env knobs:
 *   VISTA_PIPELINE_HEARTBEAT_SEC  default 30 — heartbeat interval for long ops; 0 disables
 *   VISTA_PIPELINE_OP_TIMEOUT_MS  default 0 (off) — optional op timeout in pipelineTimed
 *   VISTA_FAL_QUEUE_LOGS          default 0 — log fal queue status updates (throttled)
 *
 * Safe to import from both server code and client components (no server-only deps).
 */

export const PIPELINE_STEPS = {
  STATE_PERSIST: "0·state-persist",
  STRUCTURAL: "5·structural",
  UPLOAD: "1·upload",
  ANALYZE_FLOOR_PLAN: "2·analyze-floor-plan",
  FLOOR_PLAN_RESULTS: "3·floor-plan-results",
  ASSIGN_PHOTOS_VIEWPOINTS: "4·assign-photos+viewpoints",
  ANALYZE_IMAGES_VIEWPOINTS: "5·analyze-images+viewpoints",
  CLAUDE_ROOM_CONCEPTS: "5·claude-room-concepts",
  CLAUDE_STYLE: "6·claude-style-inspiration",
  ROOM_OPENINGS: "5·room-openings",
  ASSEMBLE_PROMPT: "6·assemble-gemini-prompt",
  GEMINI_GENERATE: "7·gemini-generate",
  FAL_RENDER: "7·fal-render",
  FAL_PIPELINE: "7·fal-pipeline",
  FAL_KONTEXT: "7·fal-kontext",
  PIPELINE_STAGE: "7·pipeline-stage",
  FAL_DEBUG: "7·fal-debug",
  PRODUCT_IMAGES: "6·product-images",
  FINISH_ROOM: "8·finish-room",
  VALIDATE: "8·validate-structure",
  CROSS_VIEW_QC: "9·cross-view-qc",
  COST_ESTIMATE: "0·cost-estimate",
  REMOVE_RENDER: "8·remove-render",
} as const;

export type PipelineStepKey = keyof typeof PIPELINE_STEPS;

/** User-facing test flow steps (paste logs after each step to debug part-by-part). */
export type UserFlowStep = 1 | 2 | 3 | 4 | 5 | 6;

type LogLevel = "info" | "warn" | "error";

const DEBUG_SESSION_ID = "e20623";
const DEBUG_INGEST_URL =
  "http://127.0.0.1:7828/ingest/11550746-5e7b-478f-b28e-9e894272fe85";

function debugIngestEnabled(): boolean {
  return (process.env.VISTA_DEBUG_INGEST || "0").trim() === "1";
}

/** NDJSON debug sink — off by default; set VISTA_DEBUG_INGEST=1 to enable. */
export function debugSessionLog(payload: {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  hypothesisId?: string;
  userStep?: UserFlowStep;
  runId?: string;
  level?: LogLevel;
}): void {
  if (!debugIngestEnabled()) return;
  // #region agent log
  fetch(DEBUG_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": DEBUG_SESSION_ID,
    },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      location: payload.location,
      message: payload.message,
      data: payload.data,
      hypothesisId: payload.hypothesisId,
      userStep: payload.userStep,
      runId: payload.runId,
      level: payload.level ?? "info",
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

/**
 * Log one of the six user test steps. Also mirrors to console with a greppable tag.
 * Hypothesis ids: A=plan geometry, B=photo assignment, C=viewpoint mapping,
 * D=opening confirmation, E=photo opening detection, F=render/approve.
 */
export function userFlowLog(
  userStep: UserFlowStep,
  event: string,
  data?: Record<string, unknown>,
  hypothesisId?: string,
): void {
  const tag = `[vista-user-flow][step-${userStep}] ${event}`;
  if (data && Object.keys(data).length > 0) console.info(tag, data);
  else console.info(tag);
}

/**
 * Emit one structured pipeline log line.
 * @param step  which numbered stage this belongs to
 * @param event short human label of what happened ("received", "rooms detected", "failed")
 * @param data  structured context (ids, counts, params) — keep it small + serializable
 * @param level console level (default "info"; use "warn"/"error" for failures)
 */
export function pipelineLog(
  step: PipelineStepKey,
  event: string,
  data?: Record<string, unknown>,
  level: LogLevel = "info",
): void {
  const tag = `[vista-pipeline][${PIPELINE_STEPS[step]}] ${event}`;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  if (data && Object.keys(data).length > 0) fn(tag, data);
  else fn(tag);

  // Tee to the server-side per-project log file when a generation context is
  // active. Reached via globalThis so this client-safe module never imports the
  // `node:*`-backed sink. Captures the `data` object the terminal truncates.
  const sink = globalThis.__vistaLogSink;
  if (sink && data && Object.keys(data).length > 0) {
    sink.writeSinkLine(`${tag} ${sink.safeStringify(data)}`);
  } else if (sink) {
    sink.writeSinkLine(tag);
  }
}

function defaultHeartbeatSec(): number {
  const raw = (process.env.VISTA_PIPELINE_HEARTBEAT_SEC ?? "30").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

function opTimeoutMs(): number {
  const raw = (process.env.VISTA_PIPELINE_OP_TIMEOUT_MS ?? "0").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function withOptionalTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`pipelineTimed op exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export interface PipelineTimedOptions<T = unknown> {
  /** Heartbeat interval in seconds; overrides VISTA_PIPELINE_HEARTBEAT_SEC when set. */
  heartbeatSec?: number;
  meta?: Record<string, unknown>;
  /** Extra fields merged into the — complete log (e.g. urlHost after upload). */
  completeMeta?: (result: T) => Record<string, unknown>;
}

/**
 * Wrap an async pipeline step with start / complete / failed logs and optional heartbeats.
 */
export async function pipelineTimed<T>(
  step: PipelineStepKey,
  label: string,
  fn: () => Promise<T>,
  opts?: PipelineTimedOptions<T>,
): Promise<T> {
  const meta = opts?.meta ?? {};
  const start = Date.now();
  pipelineLog(step, `${label} — start`, meta);

  const heartbeatSec =
    opts?.heartbeatSec !== undefined ? opts.heartbeatSec : defaultHeartbeatSec();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  if (heartbeatSec > 0) {
    heartbeat = setInterval(() => {
      pipelineLog(step, `${label} — still running`, {
        ...meta,
        elapsedMs: Date.now() - start,
      });
    }, heartbeatSec * 1000);
  }

  try {
    const result = await withOptionalTimeout(fn(), opTimeoutMs());
    const extra = opts?.completeMeta?.(result) ?? {};
    pipelineLog(step, `${label} — complete`, {
      ...meta,
      ...extra,
      durationMs: Date.now() - start,
    });
    return result;
  } catch (err) {
    pipelineLog(
      step,
      `${label} — failed`,
      {
        ...meta,
        durationMs: Date.now() - start,
        error: String(err).slice(0, 300),
      },
      "error",
    );
    throw err;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

/** Throttled fal queue status logger when VISTA_FAL_QUEUE_LOGS=1. */
export function createFalQueueLogger(
  step: PipelineStepKey,
  event: string,
  meta?: Record<string, unknown>,
): (update: { status?: string }) => void {
  const enabled = (process.env.VISTA_FAL_QUEUE_LOGS || "0").trim() === "1";
  let lastLog = 0;
  const throttleMs = 30_000;
  return (update) => {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastLog < throttleMs) return;
    lastLog = now;
    pipelineLog(step, event, {
      ...meta,
      queueStatus: update.status,
    });
  };
}

/** Corner letter for a vertex index: 0 -> "A", 1 -> "B", … */
function cornerLabel(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

/** Angle in degrees between two consecutive edges at vertex `cur`. */
function edgeAngleDeg(prev: [number, number], cur: [number, number], next: [number, number]): number {
  const ax = cur[0] - prev[0], ay = cur[1] - prev[1];
  const bx = next[0] - cur[0], by = next[1] - cur[1];
  const dot = ax * bx + ay * by;
  const cross = ax * by - ay * bx;
  return Math.abs(Math.atan2(cross, dot) * (180 / Math.PI));
}

/** Sub-meter plan segments are wall jogs — listing each one makes Gemini add columns/beams. */
export const MICRO_EDGE_MAX_M = 0.65;

export type EdgeSegment = { from: string; to: string; lenM: number; isArc?: boolean };

export type WallNotchGeometry = { totalLenM: number; from: string; to: string };

/** Edge segments (metres) from a floor-plan polygon — shared by log strings and Flux notch detection. */
export function polygonToEdgeSegments(
  polygon: [number, number][],
  collinearThreshDeg = 15,
): EdgeSegment[] {
  const n = polygon.length;
  if (n < 2) return [];

  const lengths: number[] = [];
  const isCollinear: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    lengths.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const cur = polygon[i];
    const next = polygon[(i + 1) % n];
    isCollinear[i] = edgeAngleDeg(prev, cur, next) < collinearThreshDeg;
  }

  const segments: EdgeSegment[] = [];
  let i = 0;
  while (i < n) {
    if (!isCollinear[(i + 1) % n] || n <= 4) {
      segments.push({
        from: cornerLabel(i),
        to: cornerLabel((i + 1) % n),
        lenM: lengths[i]! / 1000,
      });
      i++;
    } else {
      const arcStart = i;
      let arcLen = lengths[i]!;
      i++;
      while (i < arcStart + n && isCollinear[(i + 1) % n]) {
        arcLen += lengths[i % n]!;
        i++;
      }
      if (i < arcStart + n) {
        arcLen += lengths[i % n]!;
        i++;
      }
      segments.push({
        from: cornerLabel(arcStart),
        to: cornerLabel(i % n),
        lenM: arcLen / 1000,
        isArc: true,
      });
    }
  }
  return segments;
}

/** Micro-edge runs (wall jogs/notches) as structured geometry — not log text. */
export function detectWallNotchesFromPolygon(polygon: [number, number][]): WallNotchGeometry[] {
  const segments = polygonToEdgeSegments(polygon);
  const notches: WallNotchGeometry[] = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i]!;
    if (seg.isArc || seg.lenM >= MICRO_EDGE_MAX_M) {
      i++;
      continue;
    }
    const notchStart = seg.from;
    let notchLen = seg.lenM;
    let notchEnd = seg.to;
    i++;
    while (i < segments.length && !segments[i]!.isArc && segments[i]!.lenM < MICRO_EDGE_MAX_M) {
      notchLen += segments[i]!.lenM;
      notchEnd = segments[i]!.to;
      i++;
    }
    notches.push({ totalLenM: notchLen, from: notchStart, to: notchEnd });
  }
  return notches;
}

/** Collapse consecutive sub-0.5m edges into one "wall notch" label for Gemini prompts. */
export function collapseMicroEdgeRuns(segments: EdgeSegment[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i]!;
    if (seg.isArc || seg.lenM >= MICRO_EDGE_MAX_M) {
      out.push(
        seg.isArc
          ? `${seg.from}..${seg.to}: ~${seg.lenM.toFixed(2)}m arc`
          : `${seg.from}-${seg.to}: ${seg.lenM.toFixed(2)}m`,
      );
      i++;
      continue;
    }
    const notchStart = seg.from;
    let notchLen = seg.lenM;
    let notchEnd = seg.to;
    i++;
    while (i < segments.length && !segments[i]!.isArc && segments[i]!.lenM < MICRO_EDGE_MAX_M) {
      notchLen += segments[i]!.lenM;
      notchEnd = segments[i]!.to;
      i++;
    }
    out.push(
      `${notchStart}..${notchEnd}: wall notch ~${notchLen.toFixed(2)}m (flat wall jog — NOT a column, post, or beam)`,
    );
  }
  return out;
}

/** Count individual sub-0.5m edge labels (high count correlates with column hallucination). */
export function countMicroEdgeLabels(edges: string): number {
  if (edges.includes("wall notch")) return 0;
  const re = /:\s*(\d+\.\d+)m/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(edges)) !== null) {
    if (parseFloat(m[1]!) < MICRO_EDGE_MAX_M) count++;
  }
  return count;
}

/** Group consecutive near-collinear edges into arc runs; collapse micro jogs for Gemini. */
export function describePolygonEdgesForPrompt(
  polygon: [number, number][],
  collinearThreshDeg = 15,
): string {
  if (polygon.length < 2) return "";
  return collapseMicroEdgeRuns(polygonToEdgeSegments(polygon, collinearThreshDeg)).join(", ");
}

type OpeningSummary = { position: string; width: number; height?: number; edgeIndex?: number; t?: number; connectsTo?: string };

function describeOpeningSummary(o: OpeningSummary, kind: "window" | "door", polygon?: [number, number][]): string {
  const edge = typeof o.edgeIndex === "number" && polygon && polygon.length > 0
    ? `wall ${cornerLabel(o.edgeIndex)}-${cornerLabel((o.edgeIndex + 1) % polygon.length)}`
    : o.position;
  const tDesc = typeof o.t === "number" ? ` at t=${o.t.toFixed(2)}` : "";
  const size = kind === "window"
    ? `${o.width}m×${o.height ?? 1.5}m`
    : `${o.width}m×${o.height ?? 2.1}m`;
  const conn = o.connectsTo ? ` → ${o.connectsTo}` : "";
  return `${edge}${tDesc}, ${size}${conn}`;
}

/** Compact one-line summary of a detected room's structural params (for steps 3/5/6). */
export function summarizeRoomParams(room: {
  id: string;
  name: string;
  dimensions?: { width: number; depth: number; height: number };
  windows?: OpeningSummary[];
  doors?: OpeningSummary[];
  polygon?: [number, number][];
}): Record<string, unknown> {
  const dims = room.dimensions;
  const poly = room.polygon;
  const n = poly?.length ?? 0;

  const result: Record<string, unknown> = {
    roomId: room.id,
    roomName: room.name,
    size: dims ? `${dims.width}m×${dims.depth}m×${dims.height}m` : "unknown",
    corners: n,
  };

  if (poly && n >= 3) {
    result.edges = describePolygonEdgesForPrompt(poly);
  }

  const wins = room.windows ?? [];
  const drs = room.doors ?? [];
  result.windows = wins.length > 0
    ? wins.map((w, i) => `${i + 1}: ${describeOpeningSummary(w, "window", poly)}`).join(" | ")
    : 0;
  result.doors = drs.length > 0
    ? drs.map((d, i) => `${i + 1}: ${describeOpeningSummary(d, "door", poly)}`).join(" | ")
    : 0;

  return result;
}
