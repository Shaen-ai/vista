import { resolveProjectRenderModel } from "./projectRenderModel";

/** Layered prep → shell → furnish pipeline for Full Project apartment-staging. */
export function isLayeredStagingEnabled(): boolean {
  const raw = process.env.VISTA_STAGING_LAYERED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return resolveProjectRenderModel() === "apartment-staging";
}

export function shellWorkspaceFilename(photoId: string): string {
  return `shell-${photoId}.jpg`;
}
