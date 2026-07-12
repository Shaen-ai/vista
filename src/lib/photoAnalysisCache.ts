import "server-only";

import { createHash } from "crypto";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 100;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export function sha256Buffers(buffers: Buffer[]): string {
  const hash = createHash("sha256");
  for (const buffer of buffers) {
    hash.update(buffer);
  }
  return hash.digest("hex");
}

export function readPhotoCache<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function writePhotoCache<T>(
  key: string,
  value: T,
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function buildRoomAnalysisCacheKey(
  imageBuffers: Buffer[],
  locale: string,
): string {
  return `room-analysis:${sha256Buffers(imageBuffers)}:${locale}:${imageBuffers.length}`;
}

export function buildRoomGeometryCacheKey(imageBuffer: Buffer): string {
  return `room-geometry:${sha256Buffers([imageBuffer])}`;
}
