import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { CatalogItemSummary } from "@/lib/consumerCatalog";
import { fetchProductImagePartsForVision } from "@/lib/consumerCatalog";
import { withRetry } from "@/lib/aiRetry";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import { ANTHROPIC_EXTRACT_MODEL } from "@/lib/anthropicModels";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function toAnthropicMime(mime: string): ImageMediaType {
  if (mime === "image/png" || mime === "image/gif" || mime === "image/webp") return mime;
  return "image/jpeg";
}

export interface PhaseValidationResult {
  confirmed: string[];
  missing: string[];
}

export async function validatePhaseProducts(opts: {
  imageBase64: string;
  imageMimeType: string;
  expectedProductIds: string[];
  catalogById: Map<string, CatalogItemSummary>;
}): Promise<PhaseValidationResult> {
  const anthropicKey = getAnthropicApiKey();
  if (!anthropicKey) {
    return { confirmed: opts.expectedProductIds, missing: [] };
  }

  if (opts.expectedProductIds.length === 0) {
    return { confirmed: [], missing: [] };
  }

  const client = new Anthropic({ apiKey: anthropicKey });
  const mediaType = toAnthropicMime(opts.imageMimeType || "image/jpeg");

  const refParts = await fetchProductImagePartsForVision(opts.expectedProductIds, opts.catalogById);

  const catalogDescriptions = opts.expectedProductIds
    .map((id) => {
      const row = opts.catalogById.get(id);
      if (!row) return null;
      return `- ${id}: "${row.name}" (${row.category}, ${row.width_cm}x${row.depth_cm}x${row.height_cm}cm)`;
    })
    .filter(Boolean)
    .join("\n");

  const prompt = `You are a quality control specialist for an AI interior design system. 

Analyze the GENERATED interior render image and determine which of the expected products are CLEARLY VISIBLE in the scene.

EXPECTED PRODUCTS (these should all be present):
${catalogDescriptions}

${refParts.length > 0 ? "REFERENCE IMAGES: Each reference image below is prefixed with its [mp-id] label. Compare these references against what appears in the render." : ""}

RULES:
1. A product is "confirmed" if you can clearly see it (or something very close to it in shape/color/style) in the render.
2. For large furniture (sofa, bed, table, chair, wardrobe), accept close visual matches — Gemini renders with artistic interpretation.
3. For flooring/lighting/curtains, check if the material/style matches even if exact appearance differs slightly.
4. A product is "missing" if there is no corresponding item visible in the render at all.
5. Do NOT mark a product as confirmed just because the design brief mentioned it — only confirm what you can SEE.

Return a JSON object with exactly this structure:
{
  "confirmed": ["mp-123", "mp-456"],
  "missing": ["mp-789"]
}

Only use IDs from the expected products list. Every expected ID must appear in either "confirmed" or "missing".`;

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

  try {
    logClaudeRequest({
      label: "phase-product-validation",
      model: ANTHROPIC_EXTRACT_MODEL,
      maxTokens: 1024,
      messages: content as Anthropic.ContentBlockParam[],
      context: { expectedProductIds: opts.expectedProductIds },
    });

    const response = await withRetry(
      () =>
        client.messages.create({
          model: ANTHROPIC_EXTRACT_MODEL,
          max_tokens: 1024,
          messages: [{ role: "user", content }],
        }),
      "Phase product validation",
    );

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { confirmed: opts.expectedProductIds, missing: [] };
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { confirmed: opts.expectedProductIds, missing: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]) as { confirmed?: string[]; missing?: string[] };
    const expectedSet = new Set(opts.expectedProductIds);

    const confirmed = (parsed.confirmed ?? []).filter((id: string) => expectedSet.has(id));
    const missing = (parsed.missing ?? []).filter((id: string) => expectedSet.has(id));

    // Any ID not mentioned goes to confirmed (benefit of the doubt)
    const mentioned = new Set([...confirmed, ...missing]);
    for (const id of opts.expectedProductIds) {
      if (!mentioned.has(id)) {
        confirmed.push(id);
      }
    }

    logClaudeResponse({
      label: "phase-product-validation",
      response,
      rawText: textBlock.text,
      parsed: { confirmed, missing },
    });
    return { confirmed, missing };
  } catch (err) {
    console.warn("validatePhaseProducts: vision validation failed, assuming all confirmed", err);
    return { confirmed: opts.expectedProductIds, missing: [] };
  }
}
