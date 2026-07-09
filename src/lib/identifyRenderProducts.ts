import Anthropic from "@anthropic-ai/sdk";
import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import { catalogSummaryToPromptText, fetchProductImagePartsForVision } from "@/lib/consumerCatalog";
import { withRetry } from "@/lib/aiRetry";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import { debugIngest } from "@/lib/debugIngest";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import {
  buildVisionCandidateMpKeys,
  dedupeSingletonCatalogIds,
  mergeVerifiedProductIds,
  normalizeMpKey,
} from "@/lib/placementPlan";

export { buildVisionCandidateMpKeys, mergeVerifiedProductIds, normalizeMpKey };

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function dedupeMpKeys(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const k = normalizeMpKey(raw);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export function buildIdentifyRenderProductsPrompt(opts: {
  catalogRows: CatalogItemSummary[];
  brief: Pick<DesignBrief, "subject" | "fullPrompt" | "arrangement">;
  pinnedMpKeys: string[];
  requirePinnedNote?: string;
  hasReferenceImages?: boolean;
}): string {
  const catalogText = catalogSummaryToPromptText(opts.catalogRows);
  const pinnedBlock =
    opts.pinnedMpKeys.length > 0
      ? `\nUSER-PINNED SKUs (include in catalog_ids ONLY if clearly visible in the render):\n${opts.pinnedMpKeys.join(", ")}\n${opts.requirePinnedNote ?? ""}`
      : "";

  const refNote = opts.hasReferenceImages
    ? "\nREFERENCE PRODUCT IMAGES: Each reference image below is prefixed with its [mp-id] label. Use those labels to map what you see in the render to the correct catalog entry — do not rely on image order alone.\n"
    : "";

  return `You are an interior design procurement specialist. Analyze the GENERATED interior render image and list ONLY marketplace catalog products that are clearly visible in the scene.
${refNote}
DESIGN BRIEF (what was intended):
Subject: ${opts.brief.subject || "(none)"}
Arrangement: ${opts.brief.arrangement || "(none)"}
Full prompt excerpt: ${(opts.brief.fullPrompt || "").slice(0, 2800)}

ALLOWED CATALOG (ONLY these mp-<id> values may appear in catalog_ids — never invent ids):
${catalogText || "(empty — return empty catalog_ids)"}
${pinnedBlock}

LARGE FURNITURE EXCEPTION — sofa, sectional, armchair, dining chair, dining table, coffee table, side table, bed, wardrobe, desk, TV stand:
When a piece of this type is clearly visible in the render, you MUST pick the closest-matching mp-id from the candidate list, even if it is not a pixel-perfect match. Gemini renders large items with realistic shading, scene-appropriate angles, and stylistic upholstery interpretation, so they will rarely match the flat reference photo exactly. The user needs the product name and purchase URL for what they see — picking the best available match is far more useful than omitting the category entirely. Only omit a large-furniture category when there is no piece of that type visible in the render at all.

RULES:
1) For finishes, lighting, rugs, curtains, and decor: include an mp-id ONLY when that product (shape, color, material) is clearly visible in the render. Do NOT include ids because they appear in the design brief or plan — brief is intent, the image is truth.
2) When reference images are provided, compare each visible item in the render to those photos and pick the single best-matching mp-id per visible item.
3) Checklist (apply LARGE FURNITURE EXCEPTION above + strict rule 1 for the rest): flooring → walls → curtains → lighting → furniture → rugs → decor.
4) At most ONE mp-id per singleton type unless two clearly distinct items are visible: sofa, coffee table, dining table, bed, desk, TV stand, wardrobe, main rug, curtain set.
5) For finishes/lighting/decor only: if unsure between two similar catalog SKUs, include only the one whose reference image matches best; omit the other. (Large furniture: always pick the closest — never omit when a piece of that type is visible.)
6) If a pinned SKU is clearly visible, you MUST include it.
7) Generic paint/plaster with no catalog SKU should NOT get an id; mention in finish_summary only.
8) Do not invent mp-ids outside ALLOWED CATALOG.

Respond ONLY with valid JSON:
{
  "catalog_ids": ["mp-123", "mp-456"],
  "finish_summary": {
    "flooring": "string (visible floor treatment)",
    "walls": "string (visible wall treatment)",
    "window_treatments": "string or null"
  }
}`;
}

export interface IdentifyRenderProductsResult {
  catalogIds: string[];
  finishSummary?: {
    flooring?: string;
    walls?: string;
    window_treatments?: string | null;
  };
}

function parseIdentifyResponse(text: string, allowedKeys: Set<string>): IdentifyRenderProductsResult {
  let raw = text.trim();
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock) raw = codeBlock[1];
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Record<string, unknown>;

  const rawIds = Array.isArray(parsed.catalog_ids)
    ? parsed.catalog_ids
    : Array.isArray(parsed.catalogIds)
      ? parsed.catalogIds
      : [];

  const catalogIds = dedupeMpKeys(
    rawIds
      .filter((x): x is string => typeof x === "string")
      .map((x) => normalizeMpKey(x))
      .filter((k): k is string => Boolean(k && allowedKeys.has(k))),
  );

  const fs = parsed.finish_summary ?? parsed.finishSummary;
  let finishSummary: IdentifyRenderProductsResult["finishSummary"];
  if (fs && typeof fs === "object" && !Array.isArray(fs)) {
    const o = fs as Record<string, unknown>;
    finishSummary = {
      flooring: typeof o.flooring === "string" ? o.flooring : undefined,
      walls: typeof o.walls === "string" ? o.walls : undefined,
      window_treatments:
        typeof o.window_treatments === "string"
          ? o.window_treatments
          : typeof o.windowTreatments === "string"
            ? o.windowTreatments
            : null,
    };
  }

  return { catalogIds, finishSummary };
}

function toAnthropicMime(mime: string): ImageMediaType {
  if (mime === "image/png" || mime === "image/gif" || mime === "image/webp") return mime;
  return "image/jpeg";
}

/**
 * Vision pass on the generated render: which allowlisted catalog SKUs are actually visible.
 */
export async function identifyCatalogProductsInRender(opts: {
  imageBase64: string;
  mimeType: string;
  catalogById: Map<string, CatalogItemSummary>;
  candidateMpKeys: string[];
  brief: Pick<DesignBrief, "subject" | "fullPrompt" | "arrangement">;
  pinnedMpKeys: string[];
}): Promise<IdentifyRenderProductsResult> {
  const allowedKeys = new Set(opts.candidateMpKeys.filter((k) => opts.catalogById.has(k)));
  if (allowedKeys.size === 0) {
    return { catalogIds: [] };
  }

  const anthropicKey = getAnthropicApiKey();
  if (!anthropicKey) {
    return { catalogIds: [] };
  }

  const catalogRows = opts.candidateMpKeys
    .map((k) => opts.catalogById.get(k))
    .filter((r): r is CatalogItemSummary => Boolean(r));

  const refParts = await fetchProductImagePartsForVision(opts.candidateMpKeys, opts.catalogById);

  const client = new Anthropic({ apiKey: anthropicKey });
  const mediaType = toAnthropicMime(opts.mimeType || "image/jpeg");

  const runVision = async (requirePinnedNote?: string): Promise<IdentifyRenderProductsResult> => {
    const prompt = buildIdentifyRenderProductsPrompt({
      catalogRows,
      brief: opts.brief,
      pinnedMpKeys: opts.pinnedMpKeys,
      requirePinnedNote,
      hasReferenceImages: refParts.length > 0,
    });

    const refContent: Anthropic.MessageParam["content"] = refParts.flatMap((p) => {
      const mt = toAnthropicMime(p.inlineData.mimeType || "image/jpeg");
      return [
        { type: "text" as const, text: `[${p.id}]` },
        {
          type: "image" as const,
          source: { type: "base64" as const, media_type: mt, data: p.inlineData.data },
        },
      ];
    });

    const content: Anthropic.MessageParam["content"] = [
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: opts.imageBase64 },
      },
      ...refContent,
      { type: "text", text: prompt },
    ];

    logClaudeRequest({
      label: "render-product-identification",
      model: "claude-opus-4-8",
      maxTokens: 2048,
      messages: content as Anthropic.ContentBlockParam[],
      context: { candidateCount: opts.candidateMpKeys.length, pinned: opts.pinnedMpKeys },
    });

    const response = await withRetry(
      () =>
        client.messages.create({
          model: "claude-opus-4-8",
          max_tokens: 2048,
          messages: [{ role: "user", content }],
        }),
      "Render product identification",
    );

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { catalogIds: [] };
    }

    try {
      let result = parseIdentifyResponse(textBlock.text, allowedKeys);
      result = {
        ...result,
        catalogIds: dedupeSingletonCatalogIds(result.catalogIds, opts.catalogById, opts.brief.fullPrompt),
      };
      logClaudeResponse({
        label: "render-product-identification",
        response,
        rawText: textBlock.text,
        parsed: result,
      });
      return result;
    } catch (err) {
      console.warn("identifyCatalogProductsInRender: failed to parse vision JSON", err);
      return { catalogIds: [] };
    }
  };

  let result = await runVision();

  debugIngest(
    "identifyRenderProducts.ts:identifyCatalogProductsInRender",
    "coverage_retry_skipped",
    { candidateCount: opts.candidateMpKeys.length, visionCount: result.catalogIds.length },
    "E",
  );

  const missingPins = opts.pinnedMpKeys.filter((p) => !result.catalogIds.includes(p));
  if (missingPins.length > 0) {
    const retry = await runVision(
      `RETRY: These user-pinned SKUs were not in your first answer but MUST be included if any matching product is visible: ${missingPins.join(", ")}. Look again carefully.`,
    );
    if (retry.catalogIds.length > 0) {
      const merged = dedupeSingletonCatalogIds(
        dedupeMpKeys([...result.catalogIds, ...retry.catalogIds]).filter((k) => allowedKeys.has(k)),
        opts.catalogById,
        opts.brief.fullPrompt,
      );
      result = {
        catalogIds: merged,
        finishSummary: retry.finishSummary ?? result.finishSummary,
      };
    }
  }

  if (result.finishSummary) {
    console.info("[identifyRenderProducts] finish_summary:", result.finishSummary);
  }

  return result;
}

/** Pinned-only fallback when vision returns empty (never full brief list). */
export function fallbackCatalogIdsPinnedOnly(opts: {
  pinnedMpKeys: string[];
  allowedCatalogKeys: Set<string>;
}): string[] {
  return dedupeMpKeys(opts.pinnedMpKeys).filter((k) => opts.allowedCatalogKeys.has(k));
}

