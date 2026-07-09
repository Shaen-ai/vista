import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import { withRetry } from "@/lib/aiRetry";
import { extractFirstJsonObject } from "@/lib/extractFirstJsonObject";

export const maxDuration = 120;

const PLAN_TYPES = [
  { key: "measurement", title: "Measurement Plan", titleRu: "ОБМЕРНЫЙ ПЛАН" },
  { key: "furniture", title: "Furniture Layout", titleRu: "ПЛАН РАССТАНОВКИ МЕБЕЛИ" },
  { key: "flooring", title: "Flooring Plan", titleRu: "ПЛАН ПОЛОВ" },
  { key: "ceiling", title: "Ceiling & Lighting", titleRu: "ПЛАН ПОТОЛКОВ И ОСВЕЩЕНИЯ" },
  { key: "electrical", title: "Electrical Plan", titleRu: "ПЛАН ЭЛЕКТРИКИ" },
  { key: "plumbing", title: "Water & Drainage", titleRu: "ПЛАН ВОДОСНАБЖЕНИЯ И КАНАЛИЗАЦИИ" },
  { key: "hvac", title: "Heating & Ventilation", titleRu: "ПЛАН ОТОПЛЕНИЯ И ВЕНТИЛЯЦИИ" },
] as const;

function buildRoomAnalysisPrompt(designBrief: string, style: string): string {
  return `You are an expert architectural analyst. You are given a room photo. Analyze it and then generate 7 technical plan SVG drawings for this room.

DESIGN CONTEXT:
- Design description: ${designBrief}
- Style: ${style}

STEP 1 — Analyze the room from the photo:
- Estimate room dimensions in millimeters (width, depth)
- Identify walls, doors, windows and their positions
- Note any wet areas (kitchen sink, bathroom fixtures)
- Note existing furniture positions

STEP 2 — Generate SVG code for each of these 7 technical plans. Each SVG should be a clean architectural drawing:

1. MEASUREMENT PLAN — Show wall outlines with dimension annotations (in mm). Include room width, depth, door/window widths.

2. FURNITURE LAYOUT — Show wall outlines with furniture placed inside. Label each piece. Use rectangular shapes for furniture with labels.

3. FLOORING PLAN — Show wall outlines with colored zones for flooring materials. Label each zone with material name.

4. CEILING & LIGHTING PLAN — Show wall outlines with lighting fixture positions (circles for downlights, squares for pendants).

5. ELECTRICAL PLAN — Show wall outlines with socket positions (squares) and switch positions (circles with dots) near doors.

6. PLUMBING / WATER PLAN — Show wall outlines with water supply pipes (blue lines for cold, red for hot) and drain pipes (gray dashed). Mark fixtures (sink, toilet, etc.) with labeled symbols.

7. HEATING & VENTILATION — Show wall outlines with radiator positions (under windows), ventilation grilles, and duct paths.

IMPORTANT SVG RULES:
- Each SVG must have viewBox="0 0 1000 800" for landscape rooms or "0 0 800 1000" for portrait rooms
- Use a white background
- Draw walls as thick dark lines (stroke-width 3-4, color #222)
- Use font-family="Arial, sans-serif"
- Make it clean, professional, and readable
- Use colors: walls #222, dimensions #4466cc, furniture #8B7355, flooring zones with 0.3 opacity fills, electrical #FF8C00, plumbing cold #0077b6, plumbing hot #e63946, drains #6c757d, HVAC #2a9d8f, radiators #e63946

Respond ONLY with valid JSON matching this format:
{
  "roomWidth": number_mm,
  "roomDepth": number_mm,
  "plans": {
    "measurement": "<svg>...</svg>",
    "furniture": "<svg>...</svg>",
    "flooring": "<svg>...</svg>",
    "ceiling": "<svg>...</svg>",
    "electrical": "<svg>...</svg>",
    "plumbing": "<svg>...</svg>",
    "hvac": "<svg>...</svg>"
  }
}`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const roomImage = formData.get("roomImage") as File | null;
    const designBrief = (formData.get("designBrief") as string) || "";
    const style = (formData.get("style") as string) || "modern";

    const anthropicKey = getAnthropicApiKey();
    if (!anthropicKey) {
      return NextResponse.json(
        { error: "AI service is not configured." },
        { status: 503 },
      );
    }

    if (!roomImage) {
      return NextResponse.json(
        { error: "Room image is required." },
        { status: 400 },
      );
    }

    const imageBytes = await roomImage.arrayBuffer();
    const imageBase64 = Buffer.from(imageBytes).toString("base64");
    const imageMime = roomImage.type || "image/jpeg";

    const client = new Anthropic({ apiKey: anthropicKey });
    const prompt = buildRoomAnalysisPrompt(designBrief, style);

    const response = await withRetry(
      () =>
        client.messages.create({
          model: "claude-opus-4-8",
          max_tokens: 16384,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: imageMime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                    data: imageBase64,
                  },
                },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      "Technical plans generation",
    );

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "Plans generation returned no response." },
        { status: 500 },
      );
    }

    let rawText = textBlock.text.trim();
    const codeBlock = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) rawText = codeBlock[1].trim();
    const jsonSlice = extractFirstJsonObject(rawText) ?? rawText;

    let parsed: { roomWidth?: number; roomDepth?: number; plans?: Record<string, string> };
    try {
      parsed = JSON.parse(jsonSlice);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse technical plans response." },
        { status: 500 },
      );
    }

    const plans = parsed.plans ?? {};
    const result = PLAN_TYPES.map((pt) => ({
      key: pt.key,
      title: pt.title,
      titleRu: pt.titleRu,
      svg: plans[pt.key] || null,
    }));

    return NextResponse.json({
      data: {
        roomWidth: parsed.roomWidth ?? null,
        roomDepth: parsed.roomDepth ?? null,
        plans: result,
      },
    });
  } catch (error: unknown) {
    console.error("Technical plans generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate technical plans. Please try again." },
      { status: 500 },
    );
  }
}
