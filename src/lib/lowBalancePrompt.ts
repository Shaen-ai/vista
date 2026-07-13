import { TOKEN_COSTS } from "@/lib/vistaTokens";

export const LOW_BALANCE_THRESHOLD = TOKEN_COSTS.generate;

const INVITE_SEEN_KEY = "vista_low_balance_invite_seen";

let episodeShown = false;

export type LowBalanceVariant = "invite" | "invite-guest" | "topup";

type ForceOpenListener = () => void;
let forceOpenListener: ForceOpenListener | null = null;

export function hasSeenLowBalanceInvite(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(INVITE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLowBalanceInviteSeen(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(INVITE_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function isLowBalanceEpisodeShown(): boolean {
  return episodeShown;
}

export function markLowBalanceEpisodeShown(): void {
  episodeShown = true;
}

export function resetLowBalanceEpisode(): void {
  episodeShown = false;
}

export function isBelowLowBalanceThreshold(balance: number | null): boolean {
  return balance !== null && balance < LOW_BALANCE_THRESHOLD;
}

export function resolveLowBalanceVariant(loggedIn: boolean): LowBalanceVariant {
  if (!hasSeenLowBalanceInvite()) {
    return loggedIn ? "invite" : "invite-guest";
  }
  return "topup";
}

export function registerLowBalanceForceOpen(listener: ForceOpenListener): () => void {
  forceOpenListener = listener;
  return () => {
    if (forceOpenListener === listener) forceOpenListener = null;
  };
}

export function forceOpenLowBalancePrompt(): void {
  forceOpenListener?.();
}
