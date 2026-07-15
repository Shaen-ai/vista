/**
 * POST /api/interior-design/generate/stream
 *
 * SSE variant of the Quick Room render phase (phase="render" FormData body).
 * The edit-pipeline render (erase prep + nano-banana edit + validation
 * retries) can exceed Cloudflare's ~100s POST timeout, so the client consumes
 * progress events instead of waiting on a single response. The `complete`
 * event's `data` carries the exact JSON body the plain POST route returns.
 */

import { NextRequest, NextResponse } from "next/server";
import { runWithLogContext } from "@/lib/logSink";
import { withRequestUploadUser } from "@/lib/uploadUserContext";
import { StepTimer } from "@/lib/generationDebug";
import { checkTokensServer } from "@/lib/serverVistaTokens";
import {
  buildAiIncidentSseEvent,
  isOverloadedAiError,
  reportOverloadedIncident,
} from "@/lib/aiIncident";
import { createSseEmitter, isStreamClosedError } from "@/lib/sseStream";
import { runQuickRoomRenderPhase } from "../_lib/renderPhaseCore";

export const maxDuration = 900;

export function POST(request: NextRequest) {
  const logId = `quick-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return runWithLogContext(logId, () =>
    withRequestUploadUser(request, () => handleQuickRoomStream(request)),
  );
}

async function handleQuickRoomStream(request: NextRequest) {
  const timer = new StepTimer();
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  timer.mark("parse_request", { phase: "render", transport: "sse" });

  const tokenActionRaw = String(formData.get("tokenAction") ?? "generate").trim();
  const tokenAction =
    tokenActionRaw === "regenerate" || tokenActionRaw === "edit" ? tokenActionRaw : "generate";

  // Token check before the stream opens so auth/quota failures surface as
  // plain JSON (the client's !res.ok handling), not mid-stream errors.
  const tokenCheck = await checkTokensServer(tokenAction, request.headers);
  timer.mark("token_check", { ok: tokenCheck.ok });
  if (!tokenCheck.ok) {
    return NextResponse.json(
      {
        error: tokenCheck.message,
        balance: tokenCheck.balance,
        required: tokenCheck.required,
      },
      { status: tokenCheck.status },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const { emit, close } = createSseEmitter(controller, { heartbeatMs: 10_000 });

      // First bytes immediately — keeps Cloudflare's idle timeout at bay while
      // the catalog refetch and image prep run.
      emit({ phase: "generating", message: "Preparing your design…", progress: 0.02 });

      try {
        const result = await runQuickRoomRenderPhase({
          formData,
          headers: request.headers,
          timer,
          tokenPrecheckDone: true,
          emitProgress: (ev) => {
            emit({ phase: "generating", message: ev.message, progress: ev.progress });
          },
        });

        if (result.status === 200) {
          emit({ phase: "complete", message: "Design ready", data: result.body });
        } else {
          const body = result.body as { error?: string; balance?: number; required?: number };
          emit({
            phase: "error",
            message: body.error || "Design generation failed.",
            data: { status: result.status, balance: body.balance, required: body.required },
          });
        }
      } catch (error: unknown) {
        if (isStreamClosedError(error)) {
          // Client disconnected mid-render — generation may still finish server-side;
          // do not emit or page support.
        } else if (isOverloadedAiError(error)) {
          reportOverloadedIncident("/api/interior-design/generate/stream");
          emit({
            phase: "error",
            message: "The service is temporarily overloaded. Please wait a moment and try again.",
          });
        } else {
          console.error("Vista quick room stream error:", error);
          const event = await buildAiIncidentSseEvent(error, {
            route: "/api/interior-design/generate/stream",
            phase: "render",
          });
          if (event) emit(event);
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
}
