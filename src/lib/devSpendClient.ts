export type SpendBreakdownRow = {
  key: string;
  provider: string;
  model: string;
  usd: number;
  calls: number;
};

export type SpendPayload = {
  totalUsd: number;
  generationUsd?: number;
  byModel?: SpendBreakdownRow[];
};

export const DEV_SPEND_ENABLED = process.env.NEXT_PUBLIC_VISTA_SHOW_SPEND === "1";

export function dispatchSpendUpdate(spend?: SpendPayload): void {
  if (!DEV_SPEND_ENABLED || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("vista-spend-update", { detail: spend }));
}

export function extractSpendPayload(json: unknown): SpendPayload | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const spend = (json as { spend?: SpendPayload }).spend;
  if (!spend || typeof spend.totalUsd !== "number") return undefined;
  return spend;
}
