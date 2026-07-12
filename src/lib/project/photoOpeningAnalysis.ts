import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import {
  buildAnalysisSystemPrompt,
  normalizeRoomAnalysisOpenings,
  type OpeningBox,
} from "@/lib/interiorDesignPrompts";
import { withRetry } from "@/lib/aiRetry";
import { extractFirstJsonObject } from "@/lib/extractFirstJsonObject";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import { ANTHROPIC_EXTRACT_MODEL } from "@/lib/anthropicModels";
import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";
import { pipelineLog } from "@/lib/pipelineLog";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";

export interface PhotoOpeningAnalysis {
  window_boxes: OpeningBox[];
  door_boxes: OpeningBox[];
}

/**
 * Detect door/window bounding boxes in a single room photo (server-side).
 * Same analysis path as Quick Room `/api/interior-design/analyze`, trimmed to boxes.
 */
export async function analyzePhotoOpenings(opts: {
  photoBase64: string;
  photoMime?: string;
  photoId?: string;
  projectId?: string;
  roomId?: string;
}): Promise<PhotoOpeningAnalysis | null> {
  const anthropicKey = getAnthropicApiKey();
  if (!anthropicKey) {
    pipelineLog(
      "ROOM_OPENINGS",
      "photo opening analysis skipped (no Anthropic key)",
      { photoId: opts.photoId, projectId: opts.projectId, roomId: opts.roomId },
      "warn",
    );
    return null;
  }

  const bytes = Buffer.from(opts.photoBase64, "base64");
  const optimized = await optimizeImageBufferForAiWithBuffer(bytes);

  const client = new Anthropic({ apiKey: anthropicKey });
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: optimized.base64 },
    },
    {
      type: "text",
      text: buildAnalysisSystemPrompt(false, "en"),
    },
  ];

  logClaudeRequest({
    label: "project-photo-opening-analysis",
    model: ANTHROPIC_EXTRACT_MODEL,
    maxTokens: 2048,
    messages: content,
    context: {
      photoId: opts.photoId,
      projectId: opts.projectId,
      roomId: opts.roomId,
    },
  });

  try {
    const response = await withRetry(
      () =>
        client.messages.create({
          model: ANTHROPIC_EXTRACT_MODEL,
          max_tokens: 2048,
          messages: [{ role: "user", content }],
        }),
      "Photo opening analysis",
    );

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      pipelineLog(
        "ROOM_OPENINGS",
        "photo opening analysis empty response",
        { photoId: opts.photoId },
        "warn",
      );
      return null;
    }

    let rawText = textBlock.text.trim();
    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) rawText = codeBlockMatch[1]!.trim();
    const jsonSlice = extractFirstJsonObject(rawText) ?? rawText;
    const parsed = JSON.parse(jsonSlice) as unknown;
    const analysis = normalizeRoomAnalysisOpenings(parsed);

    const result: PhotoOpeningAnalysis = {
      window_boxes: analysis.window_boxes ?? [],
      door_boxes: analysis.door_boxes ?? [],
    };

    logClaudeResponse({
      label: "project-photo-opening-analysis",
      response,
      parsed: {
        window_count: result.window_boxes.length,
        door_count: result.door_boxes.length,
      },
      context: { photoId: opts.photoId, projectId: opts.projectId, roomId: opts.roomId },
    });

    pipelineLog("ROOM_OPENINGS", "photo opening analysis complete", {
      photoId: opts.photoId,
      projectId: opts.projectId,
      roomId: opts.roomId,
      windows: result.window_boxes.length,
      doors: result.door_boxes.length,
    });

    return result;
  } catch (err) {
    pipelineLog(
      "ROOM_OPENINGS",
      "photo opening analysis failed",
      {
        photoId: opts.photoId,
        projectId: opts.projectId,
        roomId: opts.roomId,
        message: err instanceof Error ? err.message.slice(0, 200) : String(err),
      },
      "warn",
    );
    return null;
  }
}
