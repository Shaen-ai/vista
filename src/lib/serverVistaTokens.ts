import { getPublicApiUrl } from "./publicEnv";

export type TokenAction = "generate" | "regenerate" | "edit";

export type TokenGateFailure = {
  ok: false;
  status: number;
  message: string;
  balance: number;
  required: number;
};

export type TokenGateSuccess = { ok: true; balance: number };

export type TokenGateResult = TokenGateSuccess | TokenGateFailure;

function laravelApiBase(): string {
  return (process.env.LARAVEL_API_URL || getPublicApiUrl()).replace(/\/$/, "");
}

function forwardHeaders(requestHeaders: Headers): Record<string, string> {
  const forward: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const auth = requestHeaders.get("authorization");
  if (auth) forward.Authorization = auth;

  const deviceId = requestHeaders.get("x-vista-device-id");
  if (deviceId) forward["X-Vista-Device-Id"] = deviceId;

  return forward;
}

function parseTokenApiJson(json: {
  ok?: boolean;
  balance?: number;
  message?: string;
  required?: number;
}): Pick<TokenGateFailure, "message" | "balance" | "required"> {
  return {
    message: json.message || "Not enough tokens.",
    balance: json.balance ?? 0,
    required: json.required ?? 0,
  };
}

/**
 * Verify the user has enough tokens for an action without charging.
 * Call before long-running AI work; charge with {@link consumeTokensServer} only on success.
 */
export async function checkTokensServer(
  action: TokenAction,
  requestHeaders: Headers,
): Promise<TokenGateResult> {
  const res = await fetch(`${laravelApiBase()}/tokens/check`, {
    method: "POST",
    headers: forwardHeaders(requestHeaders),
    body: JSON.stringify({ action }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    balance?: number;
    message?: string;
    required?: number;
  };

  if (!res.ok) {
    const parsed = parseTokenApiJson(json);
    return {
      ok: false,
      status: res.status,
      ...parsed,
    };
  }

  return { ok: true, balance: json.balance ?? 0 };
}

/**
 * Deduct tokens after a successful generate/regenerate/edit. Do not call on failure paths.
 */
export async function consumeTokensServer(
  action: TokenAction,
  requestHeaders: Headers,
): Promise<TokenGateResult> {
  const res = await fetch(`${laravelApiBase()}/tokens/consume`, {
    method: "POST",
    headers: forwardHeaders(requestHeaders),
    body: JSON.stringify({ action }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    balance?: number;
    message?: string;
    required?: number;
  };

  if (!res.ok) {
    const parsed = parseTokenApiJson(json);
    return {
      ok: false,
      status: res.status,
      ...parsed,
    };
  }

  return { ok: true, balance: json.balance ?? 0 };
}
