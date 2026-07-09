import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import type { ResolvedCatalogSlot } from "@/lib/resolveCatalogSlots";

/** Structured server logs for catalog id funnel debugging (grep `[catalog-trace]`). */
export function traceCatalogPipeline(step: string, payload: Record<string, unknown>): void {
  console.info(`[catalog-trace] ${step}`, JSON.stringify(payload));
}

/**
 * Per-request product funnel tracer.
 *
 * Usage:
 *   const funnel = new ProductFunnelTracer("brief");
 *   funnel.snapshot("qdrant_resolved", resolvedIds);
 *   funnel.snapshot("selected_for_gemini", selectedForGemini);
 *   // ... more snapshots ...
 *   funnel.audit(finalProductIds, catalogById);
 *
 * Each snapshot emits a [catalog-trace] funnel.<step> log line with the delta
 * (products added/removed vs the previous step).
 *
 * audit() emits a [catalog-trace] funnel_audit.<label> log with:
 *   - perProduct: for every output product, which step first introduced it (origin)
 *     and where it was present/dropped.
 *   - ALERT_suspicious: output products whose origin is not from a Qdrant-verified step.
 *     After the non-Qdrant fallback fix these should always be empty.
 */
export class ProductFunnelTracer {
  readonly funnelId: string;
  private readonly steps: Array<{ name: string; ids: string[] }> = [];

  constructor(label?: string) {
    this.funnelId = `${label ?? "funnel"}-${Date.now().toString(36)}`;
  }

  /** Snapshot the product ID set at a named pipeline step and log the delta. */
  snapshot(name: string, ids: string[]): void {
    const prev = this.steps.length > 0
      ? new Set(this.steps[this.steps.length - 1]!.ids)
      : new Set<string>();
    const curr = new Set(ids);
    const added = ids.filter((id) => !prev.has(id));
    const removed = [...prev].filter((id) => !curr.has(id));
    this.steps.push({ name, ids: [...ids] });

    traceCatalogPipeline(`funnel.${name}`, {
      funnelId: this.funnelId,
      total: curr.size,
      added_count: added.length,
      removed_count: removed.length,
      ...(added.length > 0 ? { added } : {}),
      ...(removed.length > 0 ? { removed } : {}),
    });
  }

  /**
   * Emit the cross-step audit.  Call this after you have the final output product IDs.
   * grep: [catalog-trace] funnel_audit
   */
  audit(
    outputIds: string[],
    catalogById: Map<string, CatalogItemSummary>,
    label = "final",
  ): void {
    const stepNames = this.steps.map((s) => s.name);
    const stepSets = new Map(this.steps.map((s) => [s.name, new Set(s.ids)]));

    const perProduct = outputIds.map((id) => {
      const name = catalogById.get(id)?.name ?? id;
      const origin = stepNames.find((s) => stepSets.get(s)!.has(id)) ?? "not_in_any_step";
      const presentIn = stepNames.filter((s) => stepSets.get(s)!.has(id));
      const droppedAfter = stepNames
        .slice(1)
        .filter((s, i) => {
          const prev = stepSets.get(stepNames[i])!;
          const curr = stepSets.get(s)!;
          return prev.has(id) && !curr.has(id);
        });
      return { id, name, origin, presentIn, ...(droppedAfter.length ? { droppedAfter } : {}) };
    });

    // Origins that are acceptable — everything else is a bug worth investigating.
    const SAFE_ORIGINS = new Set([
      "qdrant_constrained",
      "qdrant_retry",
      "pins_merged",
      "render_session_in",
    ]);
    const suspicious = perProduct.filter((p) => !SAFE_ORIGINS.has(p.origin));

    traceCatalogPipeline(`funnel_audit.${label}`, {
      funnelId: this.funnelId,
      label,
      outputCount: outputIds.length,
      suspiciousCount: suspicious.length,
      ...(suspicious.length > 0
        ? {
            ALERT_suspicious: suspicious.map((p) => ({
              id: p.id,
              name: p.name,
              origin: p.origin,
              presentIn: p.presentIn,
            })),
          }
        : {}),
      perProduct,
      stepSummary: stepNames.map((name, i) => {
        const curr = stepSets.get(name)!;
        const prev = i > 0 ? stepSets.get(stepNames[i - 1])! : new Set<string>();
        return {
          step: name,
          count: curr.size,
          added: [...curr].filter((id) => !prev.has(id)).length,
          removed: [...prev].filter((id) => !curr.has(id)).length,
        };
      }),
    });
  }
}

export function summarizeCatalogIds(
  mpKeys: string[],
  catalogById: Map<string, CatalogItemSummary>,
): Array<{ id: string; name: string; family: string | null; subtype: string | null }> {
  return mpKeys.map((k) => {
    const row = catalogById.get(k);
    return {
      id: k,
      name: row?.name ?? k,
      family: row?.product_family ?? null,
      subtype: row?.product_subtype ?? null,
    };
  });
}

export function summarizeResolvedSlots(slots: ResolvedCatalogSlot[]) {
  return slots.map((s) => ({
    slot: s.slot,
    product_ids: s.product_ids,
    top_score: s.top_score,
    fallback_stage: s.fallback_stage ?? null,
    qdrant_candidates: s.qdrant_candidates ?? 0,
    rerank_drop_rate: s.rerank_drop_rate ?? 0,
  }));
}
