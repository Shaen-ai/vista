/** Cloudflare managed challenge on API POSTs — fetch cannot solve it; user must reload. */

export class CloudflareSecurityChallengeError extends Error {
  constructor() {
    super("Cloudflare security challenge");
    this.name = "CloudflareSecurityChallengeError";
  }
}

export function isCloudflareSecurityChallengeError(
  err: unknown,
): err is CloudflareSecurityChallengeError {
  return err instanceof CloudflareSecurityChallengeError;
}

function looksLikeCloudflareChallengeHtml(body: string): boolean {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith("<")) return false;
  return /challenges\.cloudflare\.com|cf-browser-verification|__cf_chl|cdn-cgi\/challenge-platform/i.test(
    body,
  );
}

/** True when Cloudflare returned a managed challenge instead of the app response. */
export function isCloudflareChallengeResponse(res: Response, body?: string): boolean {
  if (res.status !== 403) return false;
  const mitigated = res.headers.get("cf-mitigated")?.toLowerCase();
  if (mitigated === "challenge") return true;
  if (body !== undefined && looksLikeCloudflareChallengeHtml(body)) return true;
  return false;
}

export function throwIfCloudflareChallenge(res: Response, body?: string): void {
  if (isCloudflareChallengeResponse(res, body)) {
    throw new CloudflareSecurityChallengeError();
  }
}
