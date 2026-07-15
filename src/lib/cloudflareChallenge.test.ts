import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CloudflareSecurityChallengeError,
  isCloudflareChallengeResponse,
  throwIfCloudflareChallenge,
} from "./cloudflareChallenge.ts";

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe("cloudflareChallenge", () => {
  it("detects cf-mitigated challenge header", () => {
    assert.equal(
      isCloudflareChallengeResponse(mockResponse(403, { "cf-mitigated": "challenge" })),
      true,
    );
  });

  it("detects challenge HTML body", () => {
    const body = "<html><script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\"></script></html>";
    assert.equal(isCloudflareChallengeResponse(mockResponse(403), body), true);
  });

  it("ignores non-403 responses", () => {
    assert.equal(isCloudflareChallengeResponse(mockResponse(401)), false);
  });

  it("throwIfCloudflareChallenge throws typed error", () => {
    assert.throws(
      () => throwIfCloudflareChallenge(mockResponse(403, { "cf-mitigated": "challenge" })),
      CloudflareSecurityChallengeError,
    );
  });
});
