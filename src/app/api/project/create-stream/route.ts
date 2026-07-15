/**
 * POST /api/project/create-stream
 *
 * SSE endpoint: analyze uploaded floor plan (OpenAI vision or optional manual trace).
 * Room photos are uploaded at confirm-plan; render prompts via create-concept-stream.
 */

import { NextRequest } from "next/server";
import { initializeSpatialAnalysis } from "@/lib/project/projectOrchestrator";
import type { UserPreferences, FloorPlanAnalysis } from "@/lib/project/types";
import { parseUserPreferences } from "@/lib/project/types";
import { pipelineLog } from "@/lib/pipelineLog";
import {
  buildAiIncidentSseEvent,
  isOverloadedAiError,
  reportOverloadedIncident,
} from "@/lib/aiIncident";
import { createSseEmitter, isStreamClosedError } from "@/lib/sseStream";
import { withRequestUploadUser } from "@/lib/uploadUserContext";

export const maxDuration = 900;

export async function POST(request: NextRequest) {
  return withRequestUploadUser(request, async () => {
  const formData = await request.formData();

  const floorPlanFile = formData.get("floorPlan") as File | null;
  const preferencesRaw = formData.get("preferences") as string | null;

  if (!floorPlanFile) {
    return new Response(JSON.stringify({ error: "Floor plan file is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!preferencesRaw) {
    return new Response(JSON.stringify({ error: "Preferences JSON is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let preferences: UserPreferences;
  try {
    preferences = parseUserPreferences(JSON.parse(preferencesRaw));
  } catch {
    return new Response(JSON.stringify({ error: "Invalid preferences JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const arrayBuffer = await floorPlanFile.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = floorPlanFile.type || "image/jpeg";

  // Optional user-drawn plan — when present, manual geometry is authoritative.
  let manualAnalysis: FloorPlanAnalysis | undefined;
  const manualAnalysisRaw = formData.get("manualAnalysis") as string | null;
  if (manualAnalysisRaw) {
    try {
      const parsed = JSON.parse(manualAnalysisRaw);
      if (Array.isArray(parsed?.rooms) && parsed.rooms.length > 0) {
        manualAnalysis = parsed as FloorPlanAnalysis;
      }
    } catch {
      manualAnalysis = undefined;
    }
  }

  const analysisSource = manualAnalysis ? "manual" : "ai-vision";

  const stream = new ReadableStream({
    async start(controller) {
      // Heartbeat keeps the SSE connection alive during the long, silent
      // floor-plan vision call (no events are emitted between ~10% and 100%).
      const { emit: send, close } = createSseEmitter(controller, { heartbeatMs: 10_000 });

      try {
        pipelineLog("UPLOAD", "create-stream analysis source", { source: analysisSource });
        await initializeSpatialAnalysis(
          {
            floorPlanBase64: base64,
            floorPlanMimeType: mimeType,
            preferences,
            manualAnalysis,
          },
          (event) => send(event),
        );
      } catch (error: unknown) {
        if (isStreamClosedError(error)) {
          // Client disconnected mid-analysis.
        } else {
          console.error("[create-stream] floor plan analysis failed", error);
          if (isOverloadedAiError(error)) {
            reportOverloadedIncident("/api/project/create-stream");
            send({
              phase: "error",
              message: "The service is temporarily overloaded. Please wait a moment and try again.",
            });
          } else {
            const event = await buildAiIncidentSseEvent(error, { route: "/api/project/create-stream" });
            if (event) send(event);
          }
        }
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
  });
}
