import "server-only";

import { fal } from "@fal-ai/client";
import { getFalKey } from "@/lib/serverAiKeys";
import { buildPublicUploadUrl, saveUploadToDisk } from "@/lib/localUploadStorage";
import { getUploadUserId } from "@/lib/uploadUserContext";
import { pipelineLog, pipelineTimed } from "@/lib/pipelineLog";
/**
 * fal needs PUBLICLY reachable URLs for `image_url` / `mask_url` — it fetches them
 * from its own servers, so base64 and `localhost` URLs do not work.
 *
 * Default: upload to fal's own storage (`fal.storage.upload`). This works in local
 * dev AND production, and adds no privacy delta — the same image is sent to fal for
 * rendering regardless.
 *
 * Opt-in: set VISTA_FAL_USE_LOCAL_STORAGE=1 to persist on Vista's own disk
 * (`VISTA_UPLOADS_DIR`, served at `${VISTA_PUBLIC_ORIGIN}/api/uploads/...`).
 * Only enable where the Vista origin is publicly reachable (production).
 */

let configured = false;
function ensureFalConfigured(): void {
  if (configured) return;
  const key = getFalKey();
  if (!key) throw new Error("FAL_KEY is not set (required for fal storage/render).");
  fal.config({ credentials: key });
  configured = true;
}

async function uploadViaFalStorage(buffer: Buffer, mime: string): Promise<string> {
  ensureFalConfigured();
  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  return fal.storage.upload(blob);
}

async function uploadViaLocalDisk(
  buffer: Buffer,
  mime: string,
  opts?: UploadPublicImageOpts,
): Promise<string> {
  const relativePath = await saveUploadToDisk(buffer, mime, {
    userId: opts?.userId ?? getUploadUserId(),
    projectId: opts?.projectId ?? opts?.sessionId,
    sessionId: opts?.sessionId,
    type: opts?.type,
  });
  return buildPublicUploadUrl(relativePath);
}

function urlHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function deriveUploadLabel(
  opts?: { type?: string; sessionId?: string; projectId?: string; label?: string },
): string {
  if (opts?.label?.trim()) return opts.label.trim();
  const type = opts?.type ?? "image";
  const pid = (opts?.projectId ?? opts?.sessionId)?.slice(-8);
  return pid ? `${type}-${pid}` : type;
}

export type UploadPublicImageOpts = {
  /** @deprecated Use projectId */
  sessionId?: string;
  projectId?: string;
  userId?: string;
  type?: "original" | "generated" | "edited";
  /** Greppable label in fal upload logs, e.g. "style-plate". */
  label?: string;
};

/**
 * Upload an image (room photo or mask) and return a public URL fal can fetch.
 */
export async function uploadPublicImage(
  buffer: Buffer,
  mime: string,
  opts?: UploadPublicImageOpts,
): Promise<string> {
  const useLocal = (process.env.VISTA_FAL_USE_LOCAL_STORAGE || "").trim() === "1";
  const target = useLocal ? "local-disk" : "fal-storage";
  const label = deriveUploadLabel(opts);
  const projectId = opts?.projectId ?? opts?.sessionId;

  return pipelineTimed(
    "FAL_PIPELINE",
    "fal upload",
    async () => {
      if (useLocal) {
        try {
          return await uploadViaLocalDisk(buffer, mime, {
            userId: opts?.userId,
            projectId,
            sessionId: opts?.sessionId,
            type: opts?.type,
          });
        } catch (err) {
          pipelineLog(
            "FAL_PIPELINE",
            "local upload failed — falling back to fal storage",
            { error: err instanceof Error ? err.message : String(err) },
            "warn",
          );
        }
      }
      return uploadViaFalStorage(buffer, mime);
    },
    {
      meta: {
        label,
        bytes: buffer.byteLength,
        mime,
        target,
        userId: opts?.userId ?? getUploadUserId(),
        projectId,
        sessionId: opts?.sessionId,
      },
      completeMeta: (url) => ({ urlHost: urlHost(url) }),
    },
  );
}

export { ensureFalConfigured };
