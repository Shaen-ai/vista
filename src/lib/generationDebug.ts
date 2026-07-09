export interface GenerationDebugStep {
  step: string;
  ms: number;
  detail?: Record<string, unknown>;
}

export interface GenerationDebugReport {
  phase: string;
  totalMs: number;
  steps: GenerationDebugStep[];
  meta?: Record<string, unknown>;
}

export interface GenerationClientPhaseTrace {
  name: string;
  ms: number;
  httpStatus?: number;
  error?: string;
  server?: GenerationDebugReport;
}

export interface GenerationClientTrace {
  startedAt: string;
  totalMs: number;
  phases: GenerationClientPhaseTrace[];
}

export class StepTimer {
  private readonly t0 = Date.now();
  private last = this.t0;
  readonly steps: GenerationDebugStep[] = [];

  mark(step: string, detail?: Record<string, unknown>): void {
    const now = Date.now();
    this.steps.push({ step, ms: now - this.last, detail });
    this.last = now;
  }

  finish(phase: string, meta?: Record<string, unknown>): GenerationDebugReport {
    return {
      phase,
      totalMs: Date.now() - this.t0,
      steps: [...this.steps],
      meta,
    };
  }
}

export function extractGenerationDebug(json: unknown): GenerationDebugReport | undefined {
  if (!json || typeof json !== "object") return undefined;
  const debug = (json as { debug?: unknown }).debug;
  if (!debug || typeof debug !== "object") return undefined;
  const report = debug as GenerationDebugReport;
  if (typeof report.phase !== "string" || !Array.isArray(report.steps)) return undefined;
  return report;
}

export function mergeGenerationClientTrace(
  startedAt: number,
  phases: GenerationClientPhaseTrace[],
): GenerationClientTrace {
  return {
    startedAt: new Date(startedAt).toISOString(),
    totalMs: Date.now() - startedAt,
    phases,
  };
}

export function logGenerationClientTrace(trace: GenerationClientTrace): void {
  console.group(`[vista:generate] ${trace.totalMs}ms total`);
  for (const phase of trace.phases) {
    const status = phase.httpStatus != null ? ` HTTP ${phase.httpStatus}` : "";
    const err = phase.error ? ` — ${phase.error}` : "";
    console.log(`${phase.name}: ${phase.ms}ms${status}${err}`);
    if (phase.server?.steps.length) {
      console.table(
        phase.server.steps.map((s) => ({
          step: s.step,
          ms: s.ms,
          ...(s.detail ?? {}),
        })),
      );
    }
  }
  console.log("Full trace:", trace);
  console.groupEnd();
}
