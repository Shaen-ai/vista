import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type Part,
} from "@google/generative-ai";
import type { RoomAnalysis, DesignBrief } from "@/lib/interiorDesignPrompts";
import { buildOpeningStructuralLock, redesignRoom } from "@/lib/roomAnalysis";
import { OPENING_MARKER_PROMPT } from "@/lib/annotateOpenings";
import { sanitizeDesignBriefForGemini } from "@/lib/geminiBriefSanitizer";
import { RENDER_QUALITY_DIRECTIVE } from "@/lib/renderQualityDirective";
import { RENDER_GENERATION_CONFIG } from "@/lib/geminiImageConfig";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import { logGeminiRequest } from "@/lib/logGeminiRequest";
import { resolveRenderProvider, renderRoomImageViaOpenAi } from "@/lib/roomImageRenderer";

export async function generateGeminiInteriorImage(opts: {
  fullPromptFallback: string;
  googleApiKey: string;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
  extraRoomInlines?: Array<{ mimeType: string; data: string }>;
  /** Annotated copy of the room photo with numbered window/door markers (B grounding). */
  openingGuideInline?: { mimeType: string; data: string } | null;
  brief?: DesignBrief;
  roomAnalysis?: RoomAnalysis | null;
  roomGeometry?: RoomGeometry | null;
  geometryExtractionFailed?: boolean;
  designStyleLabel: string;
  merchantAppendix?: string;
  productImageParts?: Array<{ inlineData: { mimeType: string; data: string } }>;
  productIntroText?: string;
  productCloseText?: string;
  scrapedInventoryExclusive?: boolean;
  keepRoomShape?: boolean;
  styleInspirationInlines?: Array<{ mimeType: string; data: string }>;
}): Promise<Array<{ base64: string; mimeType: string }>> {
  const {
    fullPromptFallback,
    googleApiKey,
    referenceImageBase64,
    referenceImageMimeType,
    extraRoomInlines = [],
    openingGuideInline,
    brief,
    roomAnalysis,
    roomGeometry,
    geometryExtractionFailed,
    designStyleLabel,
    merchantAppendix,
    productImageParts = [],
    productIntroText = "",
    productCloseText = "",
    scrapedInventoryExclusive,
    keepRoomShape,
    styleInspirationInlines = [],
  } = opts;

  const styleInspirationIntro =
    styleInspirationInlines.length > 0
      ? `STYLE INSPIRATION IMAGES (${styleInspirationInlines.length}) — replicate this design aesthetic, color palette, materials, and spatial mood using ONLY the real catalog products referenced below. Do NOT copy specific furniture from these photos; extract the overall style.`
      : "";

  if (referenceImageBase64 && resolveRenderProvider() === "openai") {
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
    const merchTxt = merchantAppendix?.trim() ?? "";
    if (styleInspirationInlines.length > 0 && styleInspirationIntro) {
      parts.push({ text: styleInspirationIntro });
    }
    for (const inline of styleInspirationInlines) {
      parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
    }
    if (productImageParts.length > 0 && productIntroText) {
      parts.push({ text: productIntroText });
    }
    for (const p of productImageParts) {
      parts.push(p);
    }
    if (productImageParts.length > 0 && productCloseText) {
      parts.push({ text: productCloseText });
    }
    parts.push({ inlineData: { mimeType: referenceImageMimeType || "image/jpeg", data: referenceImageBase64 } });
    for (const extra of extraRoomInlines) {
      parts.push({ inlineData: { mimeType: extra.mimeType, data: extra.data } });
    }
    const prompt = brief
      ? sanitizeDesignBriefForGemini(brief, roomAnalysis, { keepRoomShape }).fullPrompt
      : fullPromptFallback;
    parts.push({ text: prompt + (merchTxt ? `\n\n${merchTxt.slice(0, 3800)}` : "") });
    return renderRoomImageViaOpenAi(parts, "quick-room-photo-edit");
  }

  const genai = new GoogleGenerativeAI(googleApiKey);
  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash-image",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: RENDER_GENERATION_CONFIG as any,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
  });

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  const merchTxt = merchantAppendix?.trim() ?? "";

  if (referenceImageBase64 && brief) {
    const sanitizedBrief = sanitizeDesignBriefForGemini(brief, roomAnalysis, { keepRoomShape });
    const editPrompt = redesignRoom(
      referenceImageBase64,
      referenceImageMimeType || "image/jpeg",
      roomGeometry ?? null,
      designStyleLabel,
      {
        brief: sanitizedBrief,
        roomAnalysis,
        merchantAppendix: merchTxt,
        scrapedInventoryExclusive,
        geometryExtractionFailed,
        keepRoomShape,
      },
    );
    if (styleInspirationInlines.length > 0 && styleInspirationIntro) {
      parts.push({ text: styleInspirationIntro });
    }
    for (const inline of styleInspirationInlines) {
      parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
    }
    if (productImageParts.length > 0 && productIntroText) {
      parts.push({ text: productIntroText });
    }
    for (const p of productImageParts) {
      parts.push(p);
    }
    if (productImageParts.length > 0 && productCloseText) {
      parts.push({ text: productCloseText });
    }
    parts.push({ inlineData: { mimeType: referenceImageMimeType || "image/jpeg", data: referenceImageBase64 } });
    for (const extra of extraRoomInlines) {
      parts.push({ inlineData: { mimeType: extra.mimeType, data: extra.data } });
    }
    if (openingGuideInline) {
      parts.push({ text: OPENING_MARKER_PROMPT });
      parts.push({ inlineData: { mimeType: openingGuideInline.mimeType, data: openingGuideInline.data } });
    }
    parts.push({ text: editPrompt });
  } else {
    // No room image — style inspiration, then products, then generation prompt.
    if (styleInspirationInlines.length > 0 && styleInspirationIntro) {
      parts.push({ text: styleInspirationIntro });
    }
    for (const inline of styleInspirationInlines) {
      parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
    }

    if (productImageParts.length > 0 && productIntroText) {
      parts.push({ text: productIntroText });
    }
    for (const p of productImageParts) {
      parts.push(p);
    }
    if (productImageParts.length > 0 && productCloseText) {
      parts.push({ text: productCloseText });
    }

    const structuralLock = buildOpeningStructuralLock(roomAnalysis, roomGeometry);
    const structuralBlock = structuralLock ? `\n\n${structuralLock}\n` : "";
    parts.push({
      text: `Generate a photorealistic interior design image based on this description:\n\n${fullPromptFallback}${structuralBlock}${merchTxt ? `\n\n${merchTxt.slice(0, 3800)}` : ""}\n\n${RENDER_QUALITY_DIRECTIVE}`,
    });
  }

  logGeminiRequest({
    label: referenceImageBase64 && brief ? "quick-room-photo-edit" : "quick-room-text-only",
    model: "gemini-2.5-flash-image",
    parts,
    context: {
      roomAnalysis,
      roomGeometry,
      hasRoomImage: !!referenceImageBase64,
      keepRoomShape,
      geometryExtractionFailed,
      scrapedInventoryExclusive,
      designStyleLabel,
    },
  });

  const result = await model.generateContent(parts as Part[]);
  type GenPart = { inlineData?: { data?: unknown; mimeType?: unknown }; text?: string };
  const images: Array<{ base64: string; mimeType: string }> = [];
  const textParts: string[] = [];
  for (const candidate of result.response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const pdata = part as GenPart;
      const raw = pdata.inlineData?.data;
      if (typeof raw === "string" && raw) {
        const mtUnknown = pdata.inlineData?.mimeType;
        images.push({
          base64: raw,
          mimeType: typeof mtUnknown === "string" && mtUnknown ? mtUnknown : "image/png",
        });
      } else if (typeof pdata.text === "string" && pdata.text) {
        textParts.push(pdata.text);
      }
    }
  }

  const blockReason = result.response?.promptFeedback?.blockReason;
  const finishReason = result.response?.candidates?.[0]?.finishReason;
  const responseLog = {
    images: images.length,
    finishReason,
    blockReason,
    candidateCount: result.response?.candidates?.length ?? 0,
    textResponse: textParts.join(" ").slice(0, 1000),
  };
  if (images.length === 0) {
    console.error("[gemini-response] No images returned", responseLog);
  } else {
    console.info("[gemini-response]", responseLog);
  }

  const usageMeta = result.response?.usageMetadata;
  if (usageMeta) {
    const { recordGeminiUsage } = await import("@/lib/aiSpend");
    recordGeminiUsage({
      model: "gemini-2.5-flash-image",
      promptTokenCount: usageMeta.promptTokenCount,
      candidatesTokenCount: usageMeta.candidatesTokenCount,
      totalTokenCount: usageMeta.totalTokenCount,
      imageGeneration: images.length > 0,
      label: referenceImageBase64 && brief ? "quick-room-photo-edit" : "quick-room-text-only",
    });
  }

  return images;
}
