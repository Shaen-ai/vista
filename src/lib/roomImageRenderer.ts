import "server-only";

import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { pipelineLog } from "@/lib/pipelineLog";

/**
 * Provider-agnostic room-image rendering.
 *
 * Vista can render the interior with Gemini, OpenAI (`gpt-image-1`), or fal.ai,
 * selected by `VISTA_RENDER_PROVIDER` (default `gemini` for Quick Room).
 *
 * Full Project uses `resolveProjectRenderProvider()` which defaults to `fal`
 * (override via `VISTA_PROJECT_RENDER_PROVIDER` or `VISTA_RENDER_PROVIDER`).
 *
 * The phased engine assembles a single `parts` array (text + inline images); this
 * module adapts that to the OpenAI Images Edit API. The Gemini path stays inline in
 * the engine — here we only own provider selection and the OpenAI adapter.
 */

export type RenderPart = { text?: string; inlineData?: { mimeType: string; data: string } };

export type RenderProvider = "openai" | "gemini" | "fal";

function normalizeProvider(raw: string): RenderProvider {
  const v = raw.toLowerCase();
  if (v === "fal") return "fal";
  if (v === "openai") return "openai";
  return "gemini";
}

/** Global render provider — used by Quick Room and shared phased engine (default: gemini). */
export function resolveRenderProvider(): RenderProvider {
  return normalizeProvider(process.env.VISTA_RENDER_PROVIDER?.trim() || "gemini");
}

/** Full Project render provider — defaults to fal when no env override is set. */
export function resolveProjectRenderProvider(): RenderProvider {
  const raw =
    process.env.VISTA_PROJECT_RENDER_PROVIDER?.trim() ||
    process.env.VISTA_RENDER_PROVIDER?.trim() ||
    "fal";
  return normalizeProvider(raw);
}

function extFor(mime: string | undefined): string {
  if (!mime) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

interface OpenAiEditOptions {
  /** Greppable label, e.g. "phased-base". */
  label: string;
}

/**
 * Render via OpenAI `gpt-image-1` `images/edits`.
 *
 * - All text parts are concatenated into the edit prompt (locks + design intent).
 * - All inline images become `image[]` inputs, **primary room photo first** (it leads
 *   the `parts` array), then references (floor plan, opening guide, design reference).
 * - `input_fidelity: high` keeps gpt-image-1 close to the input photo — the main lever
 *   against it re-imagining the real room geometry.
 *
 * NOTE: gpt-image-1 treats every supplied image as an input to combine, so abstract
 * floor-plan schematics ride along as references; the prompt labels their roles. If
 * schematic leakage shows up in renders, prune non-photo references upstream.
 */
async function renderViaOpenAiImages(
  parts: RenderPart[],
  opts: OpenAiEditOptions,
): Promise<Array<{ base64: string; mimeType: string }>> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set (VISTA_RENDER_PROVIDER=openai).");

  const prompt = parts
    .map((p) => p.text?.trim())
    .filter((t): t is string => !!t)
    .join("\n\n");

  const images = parts.filter((p) => p.inlineData?.data);
  if (images.length === 0) {
    throw new Error("OpenAI image edit requires at least one input image (no inline images in parts).");
  }

  const model = process.env.VISTA_OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = process.env.VISTA_OPENAI_IMAGE_SIZE || "1024x1536"; // portrait, ~room photos
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", size);
  form.append("quality", process.env.VISTA_OPENAI_IMAGE_QUALITY || "high");
  form.append("input_fidelity", "high");
  images.forEach((p, i) => {
    const mime = p.inlineData!.mimeType || "image/png";
    const buf = Buffer.from(p.inlineData!.data, "base64");
    const blob = new Blob([buf], { type: mime });
    form.append("image[]", blob, `input-${i}.${extFor(mime)}`);
  });

  pipelineLog("GEMINI_GENERATE", "openai image request", {
    label: opts.label,
    model,
    size,
    promptChars: prompt.length,
    inputImages: images.length,
  });

  const apiUrl = process.env.OPENAI_IMAGE_API_URL || "https://api.openai.com/v1/images/edits";
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI images/edits failed: ${res.status} ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const { recordOpenAiImageUsage } = await import("@/lib/aiSpend");
  recordOpenAiImageUsage({ label: opts.label });
  const out: Array<{ base64: string; mimeType: string }> = [];
  for (const d of json.data ?? []) {
    if (d.b64_json) out.push({ base64: d.b64_json, mimeType: "image/png" });
  }
  return out;
}

/**
 * Render the assembled `parts` with the active provider. The Gemini branch is run by
 * the caller (it owns the model handle); call this only for the OpenAI branch.
 */
export async function renderRoomImageViaOpenAi(
  parts: RenderPart[],
  label: string,
): Promise<Array<{ base64: string; mimeType: string }>> {
  return renderViaOpenAiImages(parts, { label });
}
