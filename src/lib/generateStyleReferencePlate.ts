import "server-only";

import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type Part,
} from "@google/generative-ai";
import { RENDER_GENERATION_CONFIG, GEMINI_IMAGE_MODEL } from "@/lib/geminiImageConfig";
import { optimizeImageBufferForAi } from "@/lib/optimizeImageForAi";
import { STYLE_REF_OUTPUT_MAX_EDGE } from "@/lib/falStyleReferenceUtils";
import { pipelineLog } from "@/lib/pipelineLog";
import { logGeminiRequest } from "@/lib/logGeminiRequest";
import {
  validateStyleReferencePlate,
  type StylePlateValidation,
} from "@/lib/validateStyleReferencePlate";

const STYLE_REFERENCE_SYSTEM_INSTRUCTION =
  "You are an interior design visualizer. Create a photorealistic room DESIGN CONCEPT image from the brief. " +
  "The room MUST be fully furnished — show clearly visible major furniture (beds, seating, storage, tables) matching the brief. " +
  "Never output an empty shell, bare room, or floor plan. " +
  "Show the intended palette, materials, furniture, lighting mood, and styling freely — this is creative direction, not a survey photo. " +
  "Output is a STYLE / MOOD REFERENCE for another model that will apply the look to a real room photo. " +
  "Do not worry about matching any input photo pixel-for-pixel; prioritize a compelling, coherent furnished design visualization.";

export { STYLE_REF_OUTPUT_MAX_EDGE } from "@/lib/falStyleReferenceUtils";

export interface GenerateStyleReferencePlateInput {
  googleApiKey: string;
  styleBrief: string;
  /** Optional existing-room photo — loose spatial hint only, not a structural template. */
  roomImage?: { base64: string; mimeType: string };
  projectId?: string;
  roomId?: string;
}

export type { StylePlateValidation } from "@/lib/validateStyleReferencePlate";

export interface GenerateStyleReferencePlateResult {
  ok: boolean;
  base64?: string;
  mimeType?: string;
  reason?: string;
  stylePlateValidation?: StylePlateValidation;
  stylePlateSoftPass?: boolean;
}

const FURNISH_RETRY_SUFFIX =
  "\n\nCRITICAL: The image MUST show a fully furnished interior with clearly visible major furniture from the brief. " +
  "No empty room, no bare walls only, no floor plan.";

async function callGeminiStylePlate(
  googleApiKey: string,
  userPrompt: string,
  logContext: { projectId?: string; roomId?: string; hasRoomImage: boolean },
  roomImage?: { base64: string; mimeType: string },
): Promise<{ base64: string; mimeType: string } | null> {
  const parts: Part[] = [];
  if (roomImage?.base64) {
    parts.push({
      text:
        "Optional context: attached photo shows the existing room layout. Use it only as a loose hint for room type and scale — reinterpret freely.",
    });
    parts.push({ inlineData: { mimeType: roomImage.mimeType, data: roomImage.base64 } });
  }
  parts.push({ text: userPrompt });

  logGeminiRequest({
    label: "style-reference-plate",
    model: GEMINI_IMAGE_MODEL,
    systemInstruction: STYLE_REFERENCE_SYSTEM_INSTRUCTION,
    parts: parts.map((p) =>
      "text" in p && p.text
        ? { text: p.text }
        : "inlineData" in p && p.inlineData
          ? { inlineData: { mimeType: p.inlineData.mimeType, data: p.inlineData.data } }
          : {},
    ),
    context: {
      phase: "style-reference-plate",
      projectId: logContext.projectId,
      roomId: logContext.roomId,
      hasRoomImage: logContext.hasRoomImage,
    },
  });

  const genai = new GoogleGenerativeAI(googleApiKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_IMAGE_MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: RENDER_GENERATION_CONFIG as any,
    systemInstruction: STYLE_REFERENCE_SYSTEM_INSTRUCTION,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
  });

  const result = await model.generateContent(parts);
  for (const candidate of result.response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const pdata = part as { inlineData?: { data?: unknown; mimeType?: unknown } };
      const raw = pdata.inlineData?.data;
      if (typeof raw === "string" && raw) {
        const mt = pdata.inlineData?.mimeType;
        return {
          base64: raw,
          mimeType: typeof mt === "string" && mt ? mt : "image/png",
        };
      }
    }
  }
  return null;
}

function stylePlateUsesRoomPhoto(): boolean {
  return (process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO || "").trim() === "1";
}

export async function generateStyleReferencePlate(
  input: GenerateStyleReferencePlateInput,
): Promise<GenerateStyleReferencePlateResult> {
  const styleBrief = input.styleBrief.trim();
  if (!styleBrief) {
    return { ok: false, reason: "empty style brief" };
  }

  const roomImage = stylePlateUsesRoomPhoto() ? input.roomImage : undefined;
  const baseUserPrompt = `DESIGN BRIEF — visualize this room concept as a finished furnished interior photograph:\n${styleBrief}`;
  const logCtx = {
    projectId: input.projectId,
    roomId: input.roomId,
    hasRoomImage: !!roomImage?.base64,
  };

  pipelineLog("FAL_PIPELINE", "gemini design context plate attempt", {
    projectId: input.projectId,
    roomId: input.roomId,
    styleBriefChars: styleBrief.length,
    usesRoomPhoto: logCtx.hasRoomImage,
  });

  let rendered = await callGeminiStylePlate(
    input.googleApiKey,
    baseUserPrompt,
    logCtx,
    roomImage,
  );
  if (!rendered) {
    return { ok: false, reason: "gemini returned no image" };
  }

  let validation = await validateStyleReferencePlate({
    renderedBase64: rendered.base64,
    renderedMime: rendered.mimeType,
    styleBrief,
  });

  if (!validation.furnished) {
    pipelineLog(
      "FAL_PIPELINE",
      "style plate unfurnished — retrying with stronger prompt",
      { projectId: input.projectId, roomId: input.roomId, reason: validation.reason.slice(0, 120) },
      "warn",
    );
    const retryRendered = await callGeminiStylePlate(
      input.googleApiKey,
      baseUserPrompt + FURNISH_RETRY_SUFFIX,
      logCtx,
      roomImage,
    );
    if (retryRendered) {
      rendered = retryRendered;
      validation = await validateStyleReferencePlate({
        renderedBase64: rendered.base64,
        renderedMime: rendered.mimeType,
        styleBrief,
      });
    }
  }

  if (!validation.furnished) {
    pipelineLog(
      "FAL_PIPELINE",
      "style plate rejected — not furnished after retry",
      { projectId: input.projectId, roomId: input.roomId, reason: validation.reason.slice(0, 200) },
      "warn",
    );
    return {
      ok: false,
      reason: `style plate not furnished: ${validation.reason.slice(0, 200)}`,
      stylePlateValidation: validation,
    };
  }

  const optimized = await optimizeImageBufferForAi(Buffer.from(rendered.base64, "base64"), {
    maxEdge: STYLE_REF_OUTPUT_MAX_EDGE,
    quality: 82,
    maxBytes: 400_000,
  });

  pipelineLog("FAL_PIPELINE", "gemini design context plate ready", {
    projectId: input.projectId,
    roomId: input.roomId,
    outputWidth: optimized.width,
    outputHeight: optimized.height,
    outputBytes: optimized.byteLength,
    stylePlateFurnished: validation.furnished,
  });

  pipelineLog("FAL_PIPELINE", "style plate — handoff to upload", {
    projectId: input.projectId,
    roomId: input.roomId,
    outputBytes: optimized.byteLength,
  });

  return {
    ok: true,
    base64: optimized.base64,
    mimeType: optimized.mimeType,
    stylePlateValidation: validation,
  };
}
