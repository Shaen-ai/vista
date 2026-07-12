import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildAnalysisSystemPrompt, normalizeRoomAnalysisOpenings } from "@/lib/interiorDesignPrompts";
import { withRetry } from "@/lib/aiRetry";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import {
  buildAiIncidentResponse,
  buildMissingKeyResponse,
  isOverloadedAiError,
  reportOverloadedIncident,
} from "@/lib/aiIncident";
import { extractFirstJsonObject } from "@/lib/extractFirstJsonObject";
import { normalizeVistaLocale } from "@/i18n/locales";
import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import { ANTHROPIC_EXTRACT_MODEL } from "@/lib/anthropicModels";
import {
  buildRoomAnalysisCacheKey,
  readPhotoCache,
  writePhotoCache,
} from "@/lib/photoAnalysisCache";
import { PUBLIC_AI_SERVICE_UNAVAILABLE } from "@/lib/tunzoneAi";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const roomImages = formData.getAll("roomImages") as File[];
    const legacySingle = formData.get("roomImage") as File | null;
    if (legacySingle && roomImages.length === 0) {
      roomImages.push(legacySingle);
    }

    if (roomImages.length === 0) {
      return NextResponse.json({ error: "At least one room image is required." }, { status: 400 });
    }

    const anthropicKey = getAnthropicApiKey();
    if (!anthropicKey) {
      const isDev = process.env.NODE_ENV === "development";
      if (isDev) {
        return NextResponse.json({ error: PUBLIC_AI_SERVICE_UNAVAILABLE }, { status: 503 });
      }
      const missing = buildMissingKeyResponse(
        "/api/interior-design/analyze",
        "ANTHROPIC_API_KEY missing for room analysis",
      );
      return NextResponse.json(missing.body, { status: missing.status });
    }

    const imageBlocks: Anthropic.ImageBlockParam[] = [];
    const optimizedBuffers: Buffer[] = [];
    for (const img of roomImages) {
      const bytes = await img.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes));
      optimizedBuffers.push(optimized.buffer);
      imageBlocks.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: optimized.base64 },
      });
    }

    const isMulti = imageBlocks.length > 1;
    const locale = normalizeVistaLocale(formData.get("locale")?.toString());
    const cacheKey = buildRoomAnalysisCacheKey(optimizedBuffers, locale);
    const cachedAnalysis = readPhotoCache<Awaited<ReturnType<typeof normalizeRoomAnalysisOpenings>>>(
      cacheKey,
    );
    if (cachedAnalysis) {
      return NextResponse.json({ data: cachedAnalysis, cached: true });
    }

    const client = new Anthropic({ apiKey: anthropicKey });

    const content: Anthropic.ContentBlockParam[] = [
      ...imageBlocks,
      {
        type: "text",
        text: buildAnalysisSystemPrompt(isMulti, locale),
      },
    ];

    logClaudeRequest({
      label: "room-analysis",
      model: ANTHROPIC_EXTRACT_MODEL,
      maxTokens: 2048,
      messages: content,
      context: { isMulti, locale, imageCount: imageBlocks.length },
    });

    const response = await withRetry(
      () =>
        client.messages.create({
          model: ANTHROPIC_EXTRACT_MODEL,
          max_tokens: 2048,
          messages: [{ role: "user", content }],
        }),
      "Room Analysis",
    );

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "No analysis returned." }, { status: 500 });
    }

    let parsed: unknown;
    try {
      let rawText = textBlock.text.trim();
      const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) rawText = codeBlockMatch[1]!.trim();
      const jsonSlice = extractFirstJsonObject(rawText) ?? rawText;
      parsed = JSON.parse(jsonSlice);
    } catch {
      console.error("Vista interior design analyze: failed to parse room analysis payload");
      return NextResponse.json({ error: "Failed to parse room analysis." }, { status: 500 });
    }

    const analysis = normalizeRoomAnalysisOpenings(parsed);

    logClaudeResponse({
      label: "room-analysis",
      response,
      parsed: analysis,
      context: {
        window_count: analysis?.window_count,
        door_count: analysis?.door_count,
        window_positions: analysis?.window_positions,
        door_positions: analysis?.door_positions,
        window_boxes: analysis?.window_boxes,
        door_boxes: analysis?.door_boxes,
      },
    });

    writePhotoCache(cacheKey, analysis);

    return NextResponse.json({ data: analysis });
  } catch (error: unknown) {
    console.error("Vista interior design analyze error:", error);
    if (isOverloadedAiError(error)) {
      reportOverloadedIncident("/api/interior-design/analyze");
      return NextResponse.json(
        { error: "The service is temporarily overloaded. Please wait a moment and try again." },
        { status: 503 },
      );
    }
    const isDev = process.env.NODE_ENV === "development";
    const err = error as { message?: string };
    const detail =
      isDev && typeof err?.message === "string" && err.message.trim()
        ? err.message.slice(0, 500)
        : undefined;
    const incident = await buildAiIncidentResponse(error, { route: "/api/interior-design/analyze" });
    return NextResponse.json(
      { ...incident.body, ...(detail ? { detail } : {}) },
      { status: incident.status },
    );
  }
}
