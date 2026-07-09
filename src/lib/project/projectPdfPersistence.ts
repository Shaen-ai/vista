/**
 * Persist Full Project PDF to Laravel when a design_projects record is linked.
 */

import { getPublicApiUrl } from "@/lib/publicEnv";

function laravelApiBase(): string {
  const raw = process.env.LARAVEL_API_URL || getPublicApiUrl();
  return raw.replace(/\/$/, "");
}

export async function persistProjectPdf(
  laravelProjectId: number,
  pdfBuffer: Buffer,
): Promise<string | null> {
  const key = process.env.INTERNAL_API_KEY ?? "";
  if (!key) return null;

  try {
    const res = await fetch(
      `${laravelApiBase()}/internal/design-projects/${laravelProjectId}/pdf`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Key": key,
        },
        body: JSON.stringify({ base64: pdfBuffer.toString("base64") }),
      },
    );
    if (!res.ok) {
      console.warn("[persistProjectPdf] failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = (await res.json()) as { data?: { pdf_path?: string } };
    return json.data?.pdf_path ?? null;
  } catch (err) {
    console.warn("[persistProjectPdf] error:", err);
    return null;
  }
}
