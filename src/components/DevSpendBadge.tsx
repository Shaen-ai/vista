"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUsd } from "@/lib/aiPricing";
import {
  DEV_SPEND_ENABLED,
  type SpendBreakdownRow,
  type SpendPayload,
} from "@/lib/devSpendClient";

export { dispatchSpendUpdate } from "@/lib/devSpendClient";

export function DevSpendBadge() {
  const [totalUsd, setTotalUsd] = useState(0);
  const [generationUsd, setGenerationUsd] = useState(0);
  const [byModel, setByModel] = useState<SpendBreakdownRow[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const applySpend = useCallback((payload: SpendPayload) => {
    if (typeof payload.totalUsd === "number") setTotalUsd(payload.totalUsd);
    if (typeof payload.generationUsd === "number") setGenerationUsd(payload.generationUsd);
    if (Array.isArray(payload.byModel)) setByModel(payload.byModel);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/spend");
      if (!res.ok) return;
      const data = (await res.json()) as SpendPayload & {
        lastGeneration?: SpendBreakdownRow[];
        spend?: SpendPayload;
      };
      applySpend({
        totalUsd: data.totalUsd,
        generationUsd: data.generationUsd ?? data.spend?.generationUsd,
        byModel: data.lastGeneration ?? data.byModel ?? data.spend?.byModel,
      });
    } catch {
      /* ignore */
    }
  }, [applySpend]);

  useEffect(() => {
    if (!DEV_SPEND_ENABLED) return;
    void refresh();
    const onSpend = (event: Event) => {
      const detail = (event as CustomEvent<SpendPayload>).detail;
      if (detail) applySpend(detail);
      else void refresh();
    };
    window.addEventListener("vista-spend-update", onSpend);
    return () => window.removeEventListener("vista-spend-update", onSpend);
  }, [applySpend, refresh]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!DEV_SPEND_ENABLED) return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-[10px] font-semibold tabular-nums text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        title="Dev spend"
        aria-expanded={open}
      >
        {formatUsd(totalUsd)}
        {generationUsd > 0 ? (
          <span className="ml-1 text-[var(--muted-foreground)]">+{formatUsd(generationUsd)}</span>
        ) : null}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 shadow-lg">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Dev spend
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums">{formatUsd(totalUsd)} total</p>
          {generationUsd > 0 && (
            <p className="text-xs text-[var(--muted-foreground)] tabular-nums">
              Last generation: {formatUsd(generationUsd)}
            </p>
          )}
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
            {byModel.length === 0 ? (
              <li className="text-[var(--muted-foreground)]">No model usage yet</li>
            ) : (
              byModel.map((row) => (
                <li key={row.key} className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-[var(--foreground)]" title={row.model}>
                    <span className="text-[var(--muted-foreground)]">Service</span>{" "}
                    {row.model.split("/").pop()}
                  </span>
                  <span className="shrink-0 tabular-nums font-medium">{formatUsd(row.usd)}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
