import "server-only";

import fs from "fs/promises";
import path from "path";
import { pipelineLog } from "@/lib/pipelineLog";
import type { OpeningFailureType } from "@/lib/validateOpenings";

export function isFalDebugEnabled(): boolean {
  return (process.env.VISTA_FAL_DEBUG || "").trim() === "1";
}

export interface FalDebugSnapshot {
  projectId: string;
  roomId?: string;
  roomName?: string;
  lockedBaseUrl?: string;
  renderUrl?: string;
  photoWindowBoxes?: number;
  photoDoorBoxes?: number;
  lockWindowCount?: number | null;
  lockDoorCount?: number | null;
  planDoorCount?: number | null;
  contextImageCount?: number;
  stage1Validation?: { match: boolean; reason?: string; failureType?: OpeningFailureType };
  stage2Validation?: { match: boolean; reason?: string; failureType?: OpeningFailureType };
  usedFallback?: string;
  designOverlayFurnitureCount?: number;
  designOverlayPreview?: string;
  overlayTrimmedSections?: string[];
  overlayCapExceeded?: boolean;
  retryEligibleFurnitureCount?: number;
  furnitureSpecRan?: boolean;
  furnitureSpecMatch?: boolean;
  furnitureSpecMissing?: string[];
  furnishRetryRan?: boolean;
  furnishRetryFailed?: boolean;
  furnishRetryOpeningDrift?: boolean;
  furnitureVisibleInStage2Input?: boolean | "unknown";
  phase2Trigger?: "candidate" | "manual_review" | "none";
  usedInpaintFurnishPass?: boolean;
  inpaintBase?: "stage1" | "original";
  styleReferenceSource?: "user" | "gemini" | "none";
  styleReferenceCount?: number;
  styleReferenceUrl?: string;
  styleReferenceUrls?: string[];
  geometryReferenceUrl?: string;
  geometrySchematicIncluded?: boolean;
  geometrySchematicKontextExcluded?: boolean;
  selectedImageSource?: string;
  geminiStyleInputSource?: "hero" | "none" | "brief_only";
  stylePlateValidation?: { furnished: boolean; reason: string };
  /** @deprecated Replaced by stage1Rejected + kontextBaseSource */
  stage1UsedDespiteValidation?: boolean;
  stage1Rejected?: boolean;
  kontextBaseSource?: "stage1" | "original_photo";
  openingLockCharsPrimary?: number;
  geminiStyleFallbackFailed?: boolean;
  stylePlateSoftPass?: boolean;
  compositeFailure?: boolean;
  compositeReasons?: string[];
  photoColumnCount?: number;
  kontextEditTarget?: "stage1" | "hero_fallback";
  stage1CacheHit?: boolean;
  stage1CacheRevalidated?: boolean;
  stage1CacheInvalidated?: string;
  styleRefResolution?: "user" | "gemini" | "none";
  userStyleRefRejected?: boolean;
  inspirationUsedAsDirectStyleRef?: boolean;
  styleRefCopyDetected?: boolean;
  kontextStyleRefDropped?: boolean;
  inpaintFurnishTriggered?: boolean;
  stage2bFurnitureSpecMatch?: boolean;
  confirmedFurnitureCount?: number;
  inpaintFluxRan?: boolean;
  inpaintFluxCount?: number;
  kontextCallCount?: number;
  recoveryBudgetExceeded?: boolean;
  stage2bOnlyRetry?: boolean;
}

export function logFalDebug(snapshot: FalDebugSnapshot): void {
  pipelineLog("FAL_DEBUG", "pipeline snapshot", snapshot as unknown as Record<string, unknown>);
}

/** Persist PNG artifacts under vista/.vista-logs/debug-{projectId}/ when VISTA_FAL_DEBUG=1. */
export async function saveFalDebugArtifacts(opts: {
  projectId: string;
  artifacts: Record<string, Buffer | string | undefined>;
}): Promise<string | undefined> {
  if (!isFalDebugEnabled()) return undefined;

  const dir = path.join(process.cwd(), ".vista-logs", `debug-${opts.projectId}`);
  await fs.mkdir(dir, { recursive: true });

  for (const [name, content] of Object.entries(opts.artifacts)) {
    if (content == null) continue;
    const filePath = path.join(dir, name);
    try {
      if (Buffer.isBuffer(content)) {
        await fs.writeFile(filePath, content);
      } else if (typeof content === "string" && /^https?:\/\//i.test(content)) {
        const res = await fetch(content);
        if (res.ok) {
          await fs.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
        }
      } else if (typeof content === "string" && name.endsWith(".txt")) {
        await fs.writeFile(filePath, content, "utf8");
      } else if (typeof content === "string") {
        await fs.writeFile(filePath, Buffer.from(content, "base64"));
      }
    } catch (err) {
      pipelineLog(
        "FAL_DEBUG",
        "artifact write failed",
        { name, error: String(err).slice(0, 120) },
        "warn",
      );
    }
  }

  pipelineLog("FAL_DEBUG", "artifacts saved", { dir });
  return dir;
}
