import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  estimateAnthropicTokenUsd,
  estimateFalEndpointUsd,
  estimateGeminiImageUsd,
  estimateGeminiTokenUsd,
  estimateOpenAiImageEditUsd,
  estimateOpenAiTokenUsd,
} from "@/lib/aiPricing";
import { getCurrentLogId } from "@/lib/logSink";

export interface SpendEntry {
  provider: "openai" | "anthropic" | "gemini" | "fal";
  model: string;
  usd: number;
  inputTokens?: number;
  outputTokens?: number;
  sessionId: string;
  at: string;
  label?: string;
}

export interface SpendBreakdownRow {
  key: string;
  provider: string;
  model: string;
  usd: number;
  calls: number;
}

export interface SpendSnapshot {
  totalUsd: number;
  sessionUsd: number;
  sessionId: string | null;
  byModel: SpendBreakdownRow[];
  lastGeneration: SpendBreakdownRow[];
  entries: SpendEntry[];
}

interface PersistedSpend {
  totalUsd: number;
  entries: SpendEntry[];
}

let cache: PersistedSpend | null = null;

function spendFilePath(): string {
  const dir = process.env.VISTA_LOG_DIR || join(process.cwd(), ".vista-logs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "spend.json");
}

function loadPersisted(): PersistedSpend {
  try {
    const raw = readFileSync(spendFilePath(), "utf8");
    const parsed = JSON.parse(raw) as PersistedSpend;
    cache = {
      totalUsd: typeof parsed.totalUsd === "number" ? parsed.totalUsd : 0,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    cache = { totalUsd: 0, entries: [] };
  }
  return cache!;
}

function persist(): void {
  if (!cache) return;
  try {
    writeFileSync(spendFilePath(), JSON.stringify(cache, null, 2));
  } catch {
    /* never break pipeline */
  }
}

export function isDevSpendEnabled(): boolean {
  if ((process.env.NEXT_PUBLIC_VISTA_SHOW_SPEND || "").trim() === "1") return true;
  if ((process.env.VISTA_DEV_SPEND || "").trim() === "1") return true;
  return process.env.NODE_ENV === "development";
}

export function recordSpend(entry: Omit<SpendEntry, "at" | "sessionId"> & { sessionId?: string }): void {
  if (!isDevSpendEnabled()) return;
  const data = loadPersisted();
  const full: SpendEntry = {
    ...entry,
    sessionId: entry.sessionId ?? getCurrentLogId() ?? "unscoped",
    at: new Date().toISOString(),
  };
  data.entries.push(full);
  data.totalUsd = roundUsd(data.totalUsd + full.usd);
  // Keep last 5000 entries to bound file size.
  if (data.entries.length > 5000) {
    data.entries = data.entries.slice(-5000);
  }
  persist();
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function aggregateRows(entries: SpendEntry[]): SpendBreakdownRow[] {
  const map = new Map<string, SpendBreakdownRow>();
  for (const e of entries) {
    const key = `${e.provider}:${e.model}`;
    const row = map.get(key) ?? {
      key,
      provider: e.provider,
      model: e.model,
      usd: 0,
      calls: 0,
    };
    row.usd = roundUsd(row.usd + e.usd);
    row.calls += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.usd - a.usd);
}

export function getSpendSnapshot(sessionId?: string | null): SpendSnapshot {
  const data = loadPersisted();
  const sid = sessionId ?? getCurrentLogId() ?? null;
  const sessionEntries = sid ? data.entries.filter((e) => e.sessionId === sid) : [];
  const sessionUsd = roundUsd(sessionEntries.reduce((n, e) => n + e.usd, 0));
  return {
    totalUsd: data.totalUsd,
    sessionUsd,
    sessionId: sid,
    byModel: aggregateRows(data.entries),
    lastGeneration: aggregateRows(sessionEntries),
    entries: sessionEntries,
  };
}

export function getSessionSpendBreakdown(sessionId: string): SpendBreakdownRow[] {
  const data = loadPersisted();
  return aggregateRows(data.entries.filter((e) => e.sessionId === sessionId));
}

export function getSessionSpendUsd(sessionId: string): number {
  const data = loadPersisted();
  return roundUsd(
    data.entries.filter((e) => e.sessionId === sessionId).reduce((n, e) => n + e.usd, 0),
  );
}

export function recordOpenAiUsage(opts: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  label?: string;
  sessionId?: string;
}): void {
  const inputTokens = opts.inputTokens ?? 0;
  const outputTokens = opts.outputTokens ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0) return;
  recordSpend({
    provider: "openai",
    model: opts.model,
    usd: estimateOpenAiTokenUsd(opts.model, inputTokens, outputTokens),
    inputTokens,
    outputTokens,
    label: opts.label,
    sessionId: opts.sessionId,
  });
}

export function recordAnthropicUsage(opts: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  label?: string;
  sessionId?: string;
}): void {
  const inputTokens = opts.inputTokens ?? 0;
  const outputTokens = opts.outputTokens ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0) return;
  recordSpend({
    provider: "anthropic",
    model: opts.model,
    usd: estimateAnthropicTokenUsd(
      opts.model,
      inputTokens,
      outputTokens,
      opts.cacheCreationInputTokens ?? 0,
      opts.cacheReadInputTokens ?? 0,
    ),
    inputTokens,
    outputTokens,
    label: opts.label,
    sessionId: opts.sessionId,
  });
}

export function recordGeminiUsage(opts: {
  model: string;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  imageGeneration?: boolean;
  label?: string;
  sessionId?: string;
}): void {
  const inputTokens = opts.promptTokenCount ?? 0;
  const outputTokens = opts.candidatesTokenCount ?? 0;
  let usd = 0;
  if (inputTokens > 0 || outputTokens > 0) {
    usd = estimateGeminiTokenUsd(opts.model, inputTokens, outputTokens);
  } else if (opts.imageGeneration) {
    usd = estimateGeminiImageUsd(opts.model);
  } else if ((opts.totalTokenCount ?? 0) > 0) {
    usd = estimateGeminiTokenUsd(opts.model, opts.totalTokenCount ?? 0, 0);
  } else {
    return;
  }
  recordSpend({
    provider: "gemini",
    model: opts.model,
    usd,
    inputTokens: inputTokens || undefined,
    outputTokens: outputTokens || undefined,
    label: opts.label,
    sessionId: opts.sessionId,
  });
}

export function recordFalUsage(opts: {
  endpoint: string;
  megapixels?: number;
  label?: string;
  sessionId?: string;
}): void {
  recordSpend({
    provider: "fal",
    model: opts.endpoint,
    usd: estimateFalEndpointUsd(opts.endpoint, opts.megapixels),
    label: opts.label,
    sessionId: opts.sessionId,
  });
}

export function recordOpenAiImageUsage(opts: { label?: string; sessionId?: string }): void {
  recordSpend({
    provider: "openai",
    model: "images/edits",
    usd: estimateOpenAiImageEditUsd(),
    label: opts.label,
    sessionId: opts.sessionId,
  });
}

export function buildSpendResponse(sessionId?: string | null): {
  totalUsd: number;
  generationUsd: number;
  byModel: SpendBreakdownRow[];
} {
  const snap = getSpendSnapshot(sessionId);
  return {
    totalUsd: snap.totalUsd,
    generationUsd: snap.sessionUsd,
    byModel: snap.lastGeneration,
  };
}
