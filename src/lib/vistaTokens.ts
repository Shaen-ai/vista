import { getPublicApiUrl } from "./publicEnv";
import { getAuthToken } from "./authApi";
import type { VistaLocale } from "@/i18n/locales";

export const TOKEN_COSTS = {
  generate: 10,
  regenerate: 5,
  edit: 3,
} as const;

export type TokenAction = keyof typeof TOKEN_COSTS;

export const AMD_PER_TOKEN = 40;
export const USD_PER_TOKEN = 0.10;

export type TopUpCurrency = "amd" | "usd";

/** AM → AMD checkout; all other countries → USD. */
export function topUpCurrencyForCountry(countryCode: string): TopUpCurrency {
  return countryCode.trim().toUpperCase() === "AM" ? "amd" : "usd";
}

const DEVICE_ID_KEY = "vista_device_id";
const ANONYMOUS_GRANTED_KEY = "vista_anonymous_granted";
const REFERRAL_CODE_KEY = "vista_referral_code";
const DEVICE_COOKIE = "vista_device_id";

function apiBase(): string {
  return getPublicApiUrl().replace(/\/$/, "");
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";

  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateUuid();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }

  try {
    document.cookie = `${DEVICE_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } catch {
    /* ignore */
  }

  return id;
}

export function getStoredReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFERRAL_CODE_KEY);
}

export function setStoredReferralCode(code: string): void {
  if (typeof window === "undefined") return;
  const normalized = code.trim().toLowerCase();
  if (!normalized) return;
  localStorage.setItem(REFERRAL_CODE_KEY, normalized);
  try {
    document.cookie = `vista_referral_code=${encodeURIComponent(normalized)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const deviceId = getOrCreateDeviceId();
  if (deviceId) headers["X-Vista-Device-Id"] = deviceId;
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function tokenRequestHeaders(): Record<string, string> {
  return buildAuthHeaders();
}

export type TokenBalanceResponse = {
  balance: number;
  isAnonymous: boolean;
  amdPerToken: number;
  granted?: boolean;
};

export async function fetchTokenBalance(): Promise<TokenBalanceResponse> {
  const res = await fetch(`${apiBase()}/tokens/balance`, {
    headers: buildAuthHeaders(),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { data?: TokenBalanceResponse; message?: string };
  if (!res.ok) {
    throw new Error(json.message || "Could not load token balance.");
  }
  return json.data ?? { balance: 0, isAnonymous: true, amdPerToken: AMD_PER_TOKEN };
}

export async function grantAnonymousTokens(): Promise<TokenBalanceResponse> {
  if (typeof window !== "undefined" && localStorage.getItem(ANONYMOUS_GRANTED_KEY) === "1") {
    return fetchTokenBalance();
  }

  const res = await fetch(`${apiBase()}/tokens/anonymous/grant`, {
    method: "POST",
    headers: buildAuthHeaders(),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: TokenBalanceResponse; message?: string };
  if (!res.ok) {
    throw new Error(json.message || "Could not grant welcome tokens.");
  }

  if (typeof window !== "undefined") {
    localStorage.setItem(ANONYMOUS_GRANTED_KEY, "1");
  }

  return json.data ?? { balance: 0, isAnonymous: true, amdPerToken: AMD_PER_TOKEN };
}

export function authContextForApi(): { deviceId: string; authHeaders: Record<string, string> } {
  const deviceId = getOrCreateDeviceId();
  return { deviceId, authHeaders: buildAuthHeaders() };
}

export type TokenTopUpVerifyResponse = {
  balance: number;
  tokensAdded: number;
  alreadyCredited: boolean;
};

/** Stripe Checkout has no Armenian (`hy`) — map hy/ru UI locale to `ru`, else `auto`. */
export function stripeCheckoutLocaleFromVistaLocale(locale: VistaLocale | "auto" = "auto"): "auto" | "ru" {
  if (locale === "hy" || locale === "ru") return "ru";
  if (locale === "en") return "auto";
  return preferredStripeCheckoutLocale();
}

/** Stripe Checkout has no Armenian (`hy`) — map hy/ru browsers to `ru`, else `auto`. */
export function preferredStripeCheckoutLocale(): "auto" | "ru" {
  if (typeof navigator === "undefined") return "auto";

  const languages = [navigator.language, ...(navigator.languages ?? [])].map((l) =>
    l.toLowerCase().split("-")[0],
  );

  for (const lang of languages) {
    if (lang === "ru") return "ru";
    if (lang === "hy") return "ru";
  }

  return "auto";
}

export async function startTokenTopUpCheckout(
  uiLocale: VistaLocale | "auto" = "auto",
  countryCode: string = "AM",
): Promise<string> {
  const locale = stripeCheckoutLocaleFromVistaLocale(uiLocale);
  const normalizedCountry = countryCode.trim().toUpperCase() || "AM";
  const res = await fetch(`${apiBase()}/tokens/top-up/checkout`, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ locale, countryCode: normalizedCountry }),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
  if (!res.ok) {
    throw new Error(json.message || "Could not start checkout.");
  }
  if (!json.url) {
    throw new Error("Checkout URL missing from server response.");
  }
  return json.url;
}

export async function verifyTokenTopUp(sessionId: string): Promise<TokenTopUpVerifyResponse> {
  const res = await fetch(
    `${apiBase()}/tokens/top-up/verify?session_id=${encodeURIComponent(sessionId)}`,
    { headers: buildAuthHeaders(), cache: "no-store" },
  );
  const json = (await res.json().catch(() => ({}))) as {
    data?: TokenTopUpVerifyResponse;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || "Could not verify payment.");
  }
  return json.data ?? { balance: 0, tokensAdded: 0, alreadyCredited: false };
}
