import { NextRequest, NextResponse } from "next/server";
import { extractRoomGeometry } from "@/lib/roomAnalysis";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import {
  buildAiIncidentResponse,
  buildMissingKeyResponse,
  isOverloadedAiError,
  reportOverloadedIncident,
} from "@/lib/aiIncident";
import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";
import { StepTimer } from "@/lib/generationDebug";
import { PUBLIC_AI_SERVICE_UNAVAILABLE } from "@/lib/tunzoneAi";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const timer = new StepTimer();
  try {
    const formData = await request.formData();
    timer.mark("parse_request");

    const roomImage = formData.get("roomImage") as File | null;
    if (!roomImage) {
      return NextResponse.json(
        { error: "Room image is required.", debug: timer.finish("room-geometry", { ok: false }) },
        { status: 400 },
      );
    }

    const anthropicKey = getAnthropicApiKey();
    if (!anthropicKey) {
      const isDev = process.env.NODE_ENV === "development";
      if (isDev) {
        return NextResponse.json(
          { error: PUBLIC_AI_SERVICE_UNAVAILABLE, debug: timer.finish("room-geometry", { ok: false }) },
          { status: 503 },
        );
      }
      const missing = buildMissingKeyResponse(
        "/api/interior-design/room-geometry",
        "ANTHROPIC_API_KEY missing for room geometry",
      );
      return NextResponse.json(
        { ...missing.body, debug: timer.finish("room-geometry", { ok: false }) },
        { status: missing.status },
      );
    }

    const bytes = await roomImage.arrayBuffer();
    const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes));
    timer.mark("optimize_image", { bytes: optimized.byteLength });

    const data = await extractRoomGeometry(optimized.base64, "image/jpeg");
    timer.mark("extract_geometry", { confidence: data.confidence });

    if (data.confidence === "low") {
      console.warn("[roomGeometry] Low confidence from extraction.");
    }

    return NextResponse.json({
      data,
      debug: timer.finish("room-geometry", { ok: true, confidence: data.confidence }),
    });
  } catch (error: unknown) {
    console.error("Vista interior design room-geometry error:", error);
    const err = error as { message?: string };
    if (isOverloadedAiError(error)) {
      reportOverloadedIncident("/api/interior-design/room-geometry");
      return NextResponse.json(
        {
          error: "The service is temporarily overloaded. Please wait a moment and try again.",
          debug: timer.finish("room-geometry", { ok: false, overloaded: true }),
        },
        { status: 503 },
      );
    }
    const isDev = process.env.NODE_ENV === "development";
    const detail =
      isDev && typeof err?.message === "string" && err.message.trim()
        ? err.message.slice(0, 500)
        : undefined;
    const incident = await buildAiIncidentResponse(error, { route: "/api/interior-design/room-geometry" });
    return NextResponse.json(
      {
        ...incident.body,
        ...(detail ? { detail } : {}),
        debug: timer.finish("room-geometry", {
          ok: false,
          message: typeof err?.message === "string" ? err.message.slice(0, 300) : undefined,
        }),
      },
      { status: incident.status },
    );
  }
}
