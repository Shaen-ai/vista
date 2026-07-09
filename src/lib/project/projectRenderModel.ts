/** Full Project render model — edit-pipeline (default), kontext, or apartment-staging. */
export type ProjectRenderModel = "edit-pipeline" | "kontext" | "apartment-staging";

export function resolveProjectRenderModel(): ProjectRenderModel {
  const raw = process.env.VISTA_PROJECT_RENDER_MODEL?.trim().toLowerCase();
  if (raw === "apartment-staging" || raw === "staging") return "apartment-staging";
  if (raw === "kontext") return "kontext";
  return "edit-pipeline";
}
