"use client";

import type { GenerationClientTrace } from "@/lib/generationDebug";

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export function GenerationDebugPanel({ trace }: { trace: GenerationClientTrace | null }) {
  if (!trace) return null;

  return (
    <details className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 text-left">
      <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
        Generation debug — {formatMs(trace.totalMs)} total · {trace.phases.length} phases
      </summary>
      <div className="px-4 pb-4 space-y-3 text-xs font-mono">
        <p className="text-[var(--muted-foreground)]">
          Started {trace.startedAt}. Open DevTools console for full <code>[vista:generate]</code> log.
        </p>
        {trace.phases.map((phase) => (
          <div key={phase.name} className="rounded-lg border border-[var(--border)] bg-[var(--background)]/60 p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
              <span className="font-semibold text-[var(--foreground)]">{phase.name}</span>
              <span className="text-[var(--primary)]">{formatMs(phase.ms)}</span>
              {phase.httpStatus != null && (
                <span className={phase.httpStatus >= 400 ? "text-red-400" : "text-emerald-400"}>
                  HTTP {phase.httpStatus}
                </span>
              )}
              {phase.error && <span className="text-red-400">{phase.error}</span>}
            </div>
            {phase.server?.steps.length ? (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[var(--muted-foreground)]">
                    <th className="text-left pr-3 pb-1 font-medium">Step</th>
                    <th className="text-right pb-1 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {phase.server.steps.map((step) => (
                    <tr key={`${phase.name}-${step.step}`} className="border-t border-[var(--border)]/60">
                      <td className="py-1 pr-3 align-top">
                        <div>{step.step}</div>
                        {step.detail && Object.keys(step.detail).length > 0 && (
                          <div className="text-[10px] text-[var(--muted-foreground)] break-all">
                            {JSON.stringify(step.detail)}
                          </div>
                        )}
                      </td>
                      <td className="py-1 text-right align-top whitespace-nowrap">{formatMs(step.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[var(--muted-foreground)]">No server step breakdown.</p>
            )}
            {phase.server?.meta && Object.keys(phase.server.meta).length > 0 && (
              <pre className="mt-2 overflow-x-auto text-[10px] text-[var(--muted-foreground)]">
                {JSON.stringify(phase.server.meta, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
