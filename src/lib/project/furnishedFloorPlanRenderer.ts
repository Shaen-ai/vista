import "server-only";

import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { DESIGNER_SYSTEM_INSTRUCTION } from "@/lib/designerSystemInstruction";
import { getGoogleGenerativeAiApiKey } from "@/lib/serverAiKeys";
import { logGeminiRequest } from "@/lib/logGeminiRequest";
import { pipelineLog } from "@/lib/pipelineLog";
import { optimizeImageBufferForAi } from "@/lib/optimizeImageForAi";
import {
  GEMINI_IMAGE_MODEL,
  GEMINI_IMAGE_MODEL_LABEL,
  RENDER_GENERATION_CONFIG,
} from "@/lib/geminiImageConfig";
import { renderHighlightedFloorPlan } from "./roomFloorPlanContext";
import { buildFurnishedFloorPlanPrompt } from "./furnishedFloorPlanPrompt";
import type { ProjectState } from "./types";

export { buildFurnishedFloorPlanPrompt, furnitureHintForRoomType } from "./furnishedFloorPlanPrompt";

function extractFirstGeminiImage(
  result: Awaited<
    ReturnType<ReturnType<GoogleGenerativeAI["getGenerativeModel"]>["generateContent"]>
  >,
): { base64: string; mimeType: string } | null {
  type GenPart = { inlineData?: { data?: unknown; mimeType?: unknown } };
  for (const candidate of result.response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const pdata = part as GenPart;
      const raw = pdata.inlineData?.data;
      if (typeof raw === "string" && raw) {
        const mt = pdata.inlineData?.mimeType;
        return { base64: raw, mimeType: typeof mt === "string" && mt ? mt : "image/png" };
      }
    }
  }
  return null;
}

export async function renderFurnishedFloorPlanImage(
  state: ProjectState,
): Promise<{ base64: string; mimeType: string }> {
  const googleKey = getGoogleGenerativeAiApiKey();
  if (!googleKey) {
    throw new Error("GOOGLE_AI_API_KEY or GEMINI_API_KEY is not configured");
  }
  if (!state.floorPlanBase64 || !state.analysis) {
    throw new Error("Floor plan image and analysis are required.");
  }

  const prompt = buildFurnishedFloorPlanPrompt(state);
  const parts: Part[] = [];

  const planOptimized = await optimizeImageBufferForAi(
    Buffer.from(state.floorPlanBase64, "base64"),
    { maxEdge: 1400, quality: 82 },
  );

  parts.push({
    text:
      "PRIMARY IMAGE — architectural floor plan. Preserve this exact layout, walls, doors, and windows. Add furnished plan-view furniture only:",
  });
  parts.push({
    inlineData: { mimeType: planOptimized.mimeType, data: planOptimized.base64 },
  });

  const schematic = await renderHighlightedFloorPlan(
    state.analysis.rooms,
    state.analysis.imageFrame,
  );
  if (schematic?.base64) {
    parts.push({
      text:
        "FLOOR PLAN SCHEMATIC — room outlines with doors (orange) and windows (blue). Match these boundaries exactly when placing furniture:",
    });
    parts.push({
      inlineData: { mimeType: schematic.mimeType, data: schematic.base64 },
    });
  }

  parts.push({ text: prompt });

  pipelineLog("GEMINI_GENERATE", "furnished floor plan request", {
    projectId: state.id,
    promptChars: prompt.length,
    hasSchematic: !!schematic?.base64,
    roomCount: state.analysis.rooms.length,
    model: GEMINI_IMAGE_MODEL_LABEL,
  });

  logGeminiRequest({
    label: "furnished-floor-plan",
    model: GEMINI_IMAGE_MODEL_LABEL,
    systemInstruction: DESIGNER_SYSTEM_INSTRUCTION,
    parts,
    context: {
      projectId: state.id,
      freeRender: true,
      designStyleLabel: state.concept?.overallStyle,
    },
  });

  const genai = new GoogleGenerativeAI(googleKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_IMAGE_MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: RENDER_GENERATION_CONFIG as any,
    systemInstruction: DESIGNER_SYSTEM_INSTRUCTION,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
  });

  const result = await model.generateContent(parts);
  const image = extractFirstGeminiImage(result);
  if (!image) {
    throw new Error("Furnished floor plan render returned no image.");
  }

  pipelineLog("GEMINI_GENERATE", "furnished floor plan response", {
    projectId: state.id,
    bytes: image.base64.length,
    model: GEMINI_IMAGE_MODEL_LABEL,
  });

  return image;
}
