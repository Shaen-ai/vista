import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "@/lib/aiRetry";
import { ANTHROPIC_EXTRACT_MODEL } from "@/lib/anthropicModels";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import { pipelineLog } from "@/lib/pipelineLog";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import {
  formatStyleInspirationProse,
  parseStyleInspirationExtractFromText,
} from "./extractStyleInspirationBriefFormat";

export type { StyleInspirationExtract } from "./extractStyleInspirationBriefFormat";
export { formatStyleInspirationProse, parseStyleInspirationExtractFromText };

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface StyleInspirationImageInput {
  base64: string;
  mimeType: string;
}

function toAnthropicMime(mime: string): ImageMediaType {
  if (mime === "image/png" || mime === "image/gif" || mime === "image/webp") return mime;
  return "image/jpeg";
}

const EXTRACT_PROMPT = `You analyze interior design inspiration photos for a room-redesign app.

The user uploaded inspiration image(s). Extract ONLY stylistic qualities to apply inside THEIR existing room photo (geometry is fixed separately).

Return JSON with these string fields:
- palette: main colors and tonal balance
- materials: dominant materials and textures
- lightingMood: lighting quality and atmosphere
- furnitureCharacter: furniture style character (e.g. mid-century, minimal, cozy) — NOT specific products
- decorDensity: sparse / balanced / layered
- styleSummary: one sentence combining the above (optional shortcut)

RULES:
- Describe palette, materials, textures, lighting mood, furniture character, decor density.
- NEVER describe room shape, wall count, corners, window/door positions, camera angle, layout, proportions, or spatial arrangement.
- Do NOT name specific branded products to copy.
- Output valid JSON only.`;

/**
 * Analyze all style inspiration images with Claude; return prose for FAL prompt injection.
 * Returns null on missing key, empty input, parse failure, or API error — never falls back to pixels.
 */
export async function extractStyleInspirationBrief(
  images: StyleInspirationImageInput[],
): Promise<string | null> {
  if (images.length === 0) return null;

  const anthropicKey = getAnthropicApiKey();
  if (!anthropicKey) {
    pipelineLog("CLAUDE_STYLE", "style inspiration extract skipped — no API key", {}, "warn");
    return null;
  }

  const client = new Anthropic({ apiKey: anthropicKey });

  const imageContent: Anthropic.MessageParam["content"] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const data = img.base64?.trim();
    if (!data) continue;
    imageContent.push({ type: "text", text: `[Inspiration ${i + 1}]` });
    imageContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: toAnthropicMime(img.mimeType || "image/jpeg"),
        data,
      },
    });
  }

  if (imageContent.length === 0) return null;

  const content: Anthropic.MessageParam["content"] = [
    ...imageContent,
    { type: "text", text: EXTRACT_PROMPT },
  ];

  try {
    logClaudeRequest({
      label: "quick-room-style-inspiration-extract",
      model: ANTHROPIC_EXTRACT_MODEL,
      maxTokens: 768,
      messages: content as Anthropic.ContentBlockParam[],
      context: { imageCount: images.length },
    });

    const response = await withRetry(
      () =>
        client.messages.create({
          model: ANTHROPIC_EXTRACT_MODEL,
          max_tokens: 768,
          messages: [{ role: "user", content }],
        }),
      "Style inspiration extract",
    );

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      pipelineLog("CLAUDE_STYLE", "style inspiration extract — no text block", {}, "warn");
      return null;
    }

    const parsed = parseStyleInspirationExtractFromText(textBlock.text);
    const prose = parsed ? formatStyleInspirationProse(parsed) : null;

    logClaudeResponse({
      label: "quick-room-style-inspiration-extract",
      response,
      rawText: textBlock.text,
      parsed: parsed ?? undefined,
    });

    if (!prose) {
      pipelineLog("CLAUDE_STYLE", "style inspiration extract — empty prose", {}, "warn");
      return null;
    }

    pipelineLog("CLAUDE_STYLE", "style inspiration extract ok", {
      imageCount: images.length,
      proseChars: prose.length,
    });
    return prose;
  } catch (err) {
    pipelineLog(
      "CLAUDE_STYLE",
      "style inspiration extract failed",
      { error: String(err).slice(0, 200) },
      "warn",
    );
    return null;
  }
}
