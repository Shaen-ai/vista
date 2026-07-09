import { createHash } from "crypto";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import { readWorkspaceFile, writeWorkspaceFile } from "./projectRoomWorkspace";
import type { RoomFinishLock } from "./types";

export type PhotoCacheInput = {
  objectRemovalMask?: { base64?: string };
  openingAnalysis?: {
    window_boxes?: OpeningBox[];
    door_boxes?: OpeningBox[];
  };
};

export interface PhotoStagingCacheMeta {
  prepFingerprint?: string;
  shellFingerprint?: string;
}

export interface StagingCacheMetaFile {
  photos: Record<string, PhotoStagingCacheMeta>;
}

const CACHE_META_FILE = "cache-meta.json";

function hashParts(parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p).update("|");
  return h.digest("hex").slice(0, 16);
}

export function prepFingerprint(photo: PhotoCacheInput): string {
  const mask = photo.objectRemovalMask?.base64?.trim() ?? "";
  const openings = JSON.stringify({
    w: photo.openingAnalysis?.window_boxes ?? [],
    d: photo.openingAnalysis?.door_boxes ?? [],
  });
  return hashParts([mask, openings]);
}

export function shellFingerprint(
  photo: PhotoCacheInput,
  finishLock: RoomFinishLock | undefined,
): string {
  return hashParts([prepFingerprint(photo), JSON.stringify(finishLock ?? {})]);
}

export async function readStagingCacheMeta(
  projectId: string,
  roomId: string,
): Promise<StagingCacheMetaFile> {
  const buf = await readWorkspaceFile(projectId, roomId, CACHE_META_FILE);
  if (!buf) return { photos: {} };
  try {
    const parsed = JSON.parse(buf.toString()) as StagingCacheMetaFile;
    return { photos: parsed.photos ?? {} };
  } catch {
    return { photos: {} };
  }
}

export async function writePhotoStagingCacheMeta(
  projectId: string,
  roomId: string,
  photoId: string,
  patch: Partial<PhotoStagingCacheMeta>,
): Promise<void> {
  const meta = await readStagingCacheMeta(projectId, roomId);
  meta.photos[photoId] = { ...meta.photos[photoId], ...patch };
  await writeWorkspaceFile(
    projectId,
    roomId,
    CACHE_META_FILE,
    Buffer.from(JSON.stringify(meta, null, 2)),
  );
}
