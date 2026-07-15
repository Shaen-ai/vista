import "server-only";

import { createHash } from "crypto";

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 200;

const urlByHash = new Map<string, CacheEntry>();

function hashBuffer(buffer: Buffer, mime: string): string {
  return createHash("sha256").update(mime).update(buffer).digest("hex");
}

function pruneExpired(now: number): void {
  for (const [key, entry] of urlByHash) {
    if (entry.expiresAt <= now) urlByHash.delete(key);
  }
  while (urlByHash.size > MAX_ENTRIES) {
    const oldest = urlByHash.keys().next().value;
    if (oldest === undefined) break;
    urlByHash.delete(oldest);
  }
}

export function getCachedFalUploadUrl(buffer: Buffer, mime: string): string | null {
  const now = Date.now();
  pruneExpired(now);
  const key = hashBuffer(buffer, mime);
  const hit = urlByHash.get(key);
  if (!hit || hit.expiresAt <= now) {
    if (hit) urlByHash.delete(key);
    return null;
  }
  return hit.url;
}

export function setCachedFalUploadUrl(buffer: Buffer, mime: string, url: string): void {
  const now = Date.now();
  pruneExpired(now);
  urlByHash.set(hashBuffer(buffer, mime), { url, expiresAt: now + CACHE_TTL_MS });
}
