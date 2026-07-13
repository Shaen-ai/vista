import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { getPublicApiUrl } from "@/lib/publicEnv";

const ANONYMOUS_USER_ID = "anonymous";

const uploadUserIdStore = new AsyncLocalStorage<string>();

function laravelApiBase(): string {
  return (process.env.LARAVEL_API_URL || getPublicApiUrl()).replace(/\/$/, "");
}

/** Current upload owner for nested server work (defaults to anonymous). */
export function getUploadUserId(): string {
  return uploadUserIdStore.getStore() ?? ANONYMOUS_USER_ID;
}

/** Run server work with a resolved upload user id (from auth/me or anonymous). */
export async function withUploadUserId<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return uploadUserIdStore.run(userId, fn);
}

type RequestLike = { headers: Headers };

/** Resolve user from request headers and run upload-aware server work. */
export async function withRequestUploadUser<T>(
  request: RequestLike,
  fn: () => Promise<T>,
): Promise<T> {
  const userId = await resolveUploadUserIdFromHeaders(request.headers);
  return withUploadUserId(userId, fn);
}

/** Resolve Sanctum user id from Authorization header; anonymous when missing/invalid. */
export async function resolveUploadUserIdFromHeaders(
  requestHeaders: Headers,
): Promise<string> {
  const auth = requestHeaders.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return ANONYMOUS_USER_ID;
  }

  try {
    const res = await fetch(`${laravelApiBase()}/auth/me`, {
      headers: {
        Accept: "application/json",
        Authorization: auth,
      },
      cache: "no-store",
    });
    if (!res.ok) return ANONYMOUS_USER_ID;
    const json = (await res.json()) as { user?: { id?: string } };
    const id = json.user?.id?.trim();
    return id || ANONYMOUS_USER_ID;
  } catch {
    return ANONYMOUS_USER_ID;
  }
}

export { ANONYMOUS_USER_ID };
