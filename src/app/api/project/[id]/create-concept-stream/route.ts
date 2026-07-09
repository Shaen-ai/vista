/**
 * POST /api/project/[id]/create-concept-stream
 *
 * SSE endpoint: saves design preferences and builds the Claude room concept.
 */

import { NextRequest } from "next/server";
import { createProjectConcept, getProject } from "@/lib/project/projectOrchestrator";
import type { UserPreferences } from "@/lib/project/types";
import { parseUserPreferences } from "@/lib/project/types";
import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";
import { LOCAL_SCRAPED_CATALOG_EMPTY_CODE } from "@/lib/scrapedAllowlist";

export const maxDuration = 300;

const MAX_INSPIRATION_IMAGES = 4;

function parseNumericIdList(raw: FormDataEntryValue | null): number[] {
  if (!raw || typeof raw !== "string") return [];
  const t = raw.trim();
  if (!t) return [];
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) {
      return arr.map((x) => Number(x)).filter((n) => !isNaN(n) && n > 0);
    }
  } catch {
    /* ignore */
  }
  return t.split(/[\s,;]+/).map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
}

async function parseInspirationUploads(
  formData: FormData,
): Promise<Array<{ base64: string; mimeType: string; label: string }>> {
  const items: Array<{ base64: string; mimeType: string; label: string }> = [];
  const labels = formData.getAll("inspirationLabels") as string[];
  const files = formData.getAll("inspirationImages") as File[];
  const urls = formData.getAll("inspirationUrls") as string[];
  let labelIdx = 0;

  for (const file of files) {
    if (items.length >= MAX_INSPIRATION_IMAGES) break;
    try {
      const bytes = await file.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes));
      items.push({
        base64: optimized.base64,
        mimeType: optimized.mimeType,
        label: labels[labelIdx] || "",
      });
    } catch {
      /* skip */
    }
    labelIdx++;
  }

  for (const url of urls) {
    if (items.length >= MAX_INSPIRATION_IMAGES) break;
    if (!/^https?:\/\//i.test(url)) {
      labelIdx++;
      continue;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (!res.ok) {
        labelIdx++;
        continue;
      }
      const arr = await res.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(arr));
      items.push({
        base64: optimized.base64,
        mimeType: optimized.mimeType,
        label: labels[labelIdx] || "",
      });
    } catch {
      /* skip */
    }
    labelIdx++;
  }

  return items;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const formData = await request.formData();
  const preferencesRaw = formData.get("preferences") as string | null;

  if (!preferencesRaw) {
    return new Response(JSON.stringify({ error: "Preferences JSON is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let preferences: UserPreferences;
  try {
    preferences = parseUserPreferences(JSON.parse(preferencesRaw));
  } catch {
    return new Response(JSON.stringify({ error: "Invalid preferences JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const inspirationUploads = await parseInspirationUploads(formData);
  const pinnedProductIds = parseNumericIdList(formData.get("pinnedProductIds"));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: unknown) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* client disconnected */
        }
      }

      try {
        await createProjectConcept(
          id,
          { preferences, inspirationUploads, pinnedProductIds },
          (event) => send(event),
        );
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Design concept creation failed";
        if (msg === LOCAL_SCRAPED_CATALOG_EMPTY_CODE) {
          send({
            phase: "error",
            message:
              "No products available in our catalog for this project. Try adjusting preferences or add inspiration products.",
            data: { code: LOCAL_SCRAPED_CATALOG_EMPTY_CODE },
          });
        } else {
          send({ phase: "error", message: msg });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
