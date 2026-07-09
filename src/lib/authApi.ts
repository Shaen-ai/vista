import { getPublicApiUrl } from "./publicEnv";
import { getOrCreateDeviceId, getStoredReferralCode } from "./vistaTokens";
import { identifyUser, resetAnalytics } from "./analytics";

const AUTH_TOKEN_KEY = "auth_token";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  companyName?: string;
  slug?: string;
  tokenBalance?: number;
  referralCode?: string | null;
  referralLink?: string | null;
  referralTokensEarned?: number;
};

function apiBase(): string {
  return getPublicApiUrl().replace(/\/$/, "");
}

function messageFromBody(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as { message?: unknown; errors?: Record<string, string[] | string> };
  if (typeof d.message === "string" && d.message) return d.message;
  if (d.errors) {
    for (const v of Object.values(d.errors)) {
      const first = Array.isArray(v) ? v[0] : v;
      if (typeof first === "string" && first) return first;
    }
  }
  return "";
}

function authExtras(): Record<string, string> {
  const headers: Record<string, string> = {};
  const deviceId = getOrCreateDeviceId();
  if (deviceId) headers["X-Vista-Device-Id"] = deviceId;
  return headers;
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function authJsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...authExtras(),
  };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function loginWithPassword(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
  const referralCode = getStoredReferralCode();
  const res = await fetch(`${apiBase()}/auth/login`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({
      email,
      password,
      ...(referralCode ? { referralCode } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFromBody(data) || "Login failed");
  setAuthToken(data.token);
  if (data.user?.id) identifyUser(data.user.id, { email: data.user.email, name: data.user.name });
  return { user: data.user, token: data.token };
}

export async function registerConsumer(input: {
  email: string;
  password: string;
  name: string;
  language?: "hy" | "en" | "ru";
}): Promise<{ message: string }> {
  const referralCode = getStoredReferralCode();
  const res = await fetch(`${apiBase()}/auth/register-consumer`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({
      ...input,
      ...(referralCode ? { referralCode } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFromBody(data) || "Registration failed");
  return { message: data.message ?? "Check your email to verify your account." };
}

export async function exchangeOAuthCode(code: string): Promise<{ user: AuthUser; token: string }> {
  const referralCode = getStoredReferralCode();
  const res = await fetch(`${apiBase()}/auth/oauth/exchange`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({
      code,
      ...(referralCode ? { referralCode } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFromBody(data) || "Sign-in could not be completed");
  setAuthToken(data.token);
  if (data.user?.id) identifyUser(data.user.id, { email: data.user.email, name: data.user.name });
  return { user: data.user, token: data.token };
}

let inflightMe: Promise<AuthUser | null> | null = null;

async function fetchCurrentUserImpl(): Promise<AuthUser | null> {
  const res = await fetch(`${apiBase()}/auth/me`, {
    headers: authJsonHeaders(),
  });
  if (res.status === 401) {
    setAuthToken(null);
    resetAnalytics();
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const user = data.user ?? null;
  if (user?.id) identifyUser(user.id, { email: user.email, name: user.name });
  return user;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getAuthToken();
  if (!token) return null;
  if (inflightMe) return inflightMe;
  inflightMe = fetchCurrentUserImpl().finally(() => {
    inflightMe = null;
  });
  return inflightMe;
}

export async function fetchReferralLink(): Promise<{
  code: string;
  url: string;
  referralTokensEarned: number;
  referralEarningsCap: number;
} | null> {
  const token = getAuthToken();
  if (!token) return null;
  const res = await fetch(`${apiBase()}/tokens/referral-link`, {
    headers: authJsonHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return data.data ?? null;
}

export async function logout(): Promise<void> {
  const token = getAuthToken();
  if (token) {
    try {
      await fetch(`${apiBase()}/auth/logout`, {
        method: "POST",
        headers: authJsonHeaders(),
      });
    } catch {
      /* ignore */
    }
  }
  setAuthToken(null);
  resetAnalytics();
}
