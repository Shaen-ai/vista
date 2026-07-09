import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const UPLOAD_TTL_MS = 48 * 60 * 60 * 1000;

export function getUploadsDir(): string {
  return (
    process.env.VISTA_UPLOADS_DIR?.trim() ||
    path.join(process.cwd(), ".data/vista-uploads")
  );
}

/** Public origin fal can fetch from, e.g. https://vista.tunzone.com */
export function getVistaPublicOrigin(): string {
  const raw =
    process.env.VISTA_PUBLIC_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "";
  return raw.replace(/\/+$/, "");
}

function extensionForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "misc";
}

export type SaveUploadOpts = {
  sessionId?: string;
  type?: "original" | "generated" | "edited";
};

/** Writes buffer to disk; returns a relative path safe for `/api/uploads/<path>`. */
export async function saveUploadToDisk(
  buffer: Buffer,
  mime: string,
  opts?: SaveUploadOpts,
): Promise<string> {
  const dirSegment = sanitizeSegment(opts?.sessionId?.trim() || "misc");
  const fileName = `${randomUUID()}.${extensionForMime(mime)}`;
  const relativePath = path.posix.join(dirSegment, fileName);
  const absolutePath = path.join(getUploadsDir(), dirSegment, fileName);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  void cleanupOldUploads().catch(() => {});

  return relativePath.replace(/\\/g, "/");
}

export function buildPublicUploadUrl(relativePath: string): string {
  const origin = getVistaPublicOrigin();
  const normalized = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!origin) {
    throw new Error("VISTA_PUBLIC_ORIGIN is not set (required for local upload URLs).");
  }
  return `${origin}/api/uploads/${normalized}`;
}

/** Resolve a relative upload path to an absolute file path with traversal protection. */
export function resolveUploadFilePath(relativePath: string): string | null {
  const uploadsDir = path.resolve(getUploadsDir());
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;

  const absolute = path.resolve(uploadsDir, normalized);
  if (!absolute.startsWith(`${uploadsDir}${path.sep}`) && absolute !== uploadsDir) {
    return null;
  }
  return absolute;
}

async function cleanupOldUploads(): Promise<void> {
  const root = getUploadsDir();
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry);
      try {
        const stat = await fs.stat(entryPath);
        if (stat.isDirectory()) {
          const files = await fs.readdir(entryPath);
          await Promise.all(
            files.map(async (file) => {
              const filePath = path.join(entryPath, file);
              const fileStat = await fs.stat(filePath);
              if (fileStat.isFile() && fileStat.mtimeMs < cutoff) {
                await fs.unlink(filePath).catch(() => {});
              }
            }),
          );
        } else if (stat.isFile() && stat.mtimeMs < cutoff) {
          await fs.unlink(entryPath).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    }),
  );
}
