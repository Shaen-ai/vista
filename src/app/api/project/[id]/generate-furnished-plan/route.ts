/**
 * POST /api/project/[id]/generate-furnished-plan
 *
 * SSE endpoint: render one furnished floor-plan overview when no room photos exist.
 * Body: { action?: "generate" | "regenerate" }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateFurnishedFloorPlan,
  getProject,
} from "@/lib/project/projectOrchestrator";
import type { ProgressEvent } from "@/lib/project/types";
import {
  buildAiIncidentSseEvent,
  isOverloadedAiError,
  reportOverloadedIncident,
} from "@/lib/aiIncident";
import { createSseEmitter, isStreamClosedError } from "@/lib/sseStream";
import { checkTokensServer, consumeTokensServer } from "@/lib/serverVistaTokens";
import { withRequestUploadUser } from "@/lib/uploadUserContext";

export const maxDuration = 300;

function furnishedPlanPayloadHasImage(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const render = (data as { furnishedPlanRender?: { base64?: string } }).furnishedPlanRender;
  return typeof render?.base64 === "string" && render.base64.length > 0;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRequestUploadUser(request, async () => {
    const { id } = await params;

    const project = await getProject(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let body: { action?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      /* default generate */
    }

    const action = body.action === "regenerate" ? "regenerate" : "generate";
    const tokenAction = action === "regenerate" ? "regenerate" : "generate";

    const tokenCheck = await checkTokensServer(tokenAction, request.headers);
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
        const { emit: emitRaw, close } = createSseEmitter(controller, { heartbeatMs: 10_000 });
        let tokenConsumed = false;
        let billingChain: Promise<void> = Promise.resolve();

        async function emitWithBilling(event: unknown) {
          const ev = event as ProgressEvent;
          if (tokenAction && ev.phase === "complete" && !tokenConsumed) {
            if (furnishedPlanPayloadHasImage(ev.data)) {
              const tokenGate = await consumeTokensServer(tokenAction, request.headers);
              tokenConsumed = true;
              if (!tokenGate.ok) {
                emitRaw({
                  phase: "error",
                  message: tokenGate.message,
                  data: { balance: tokenGate.balance, required: tokenGate.required },
                });
                return;
              }
              const baseData =
                typeof ev.data === "object" && ev.data !== null
                  ? (ev.data as Record<string, unknown>)
                  : {};
              emitRaw({ ...ev, data: { ...baseData, balance: tokenGate.balance } });
              return;
            }
          }
          emitRaw(event);
        }

        function send(event: unknown) {
          billingChain = billingChain.then(() => emitWithBilling(event));
        }

        try {
          await generateFurnishedFloorPlan(id, (event) => send(event));
          await billingChain;
        } catch (error: unknown) {
          await billingChain;
          if (isStreamClosedError(error)) {
            /* client disconnected */
          } else if (isOverloadedAiError(error)) {
            reportOverloadedIncident("/api/project/[id]/generate-furnished-plan");
            send(await buildAiIncidentSseEvent(error, { route: "/api/project/[id]/generate-furnished-plan" }));
          } else {
            const msg = error instanceof Error ? error.message : "Furnished floor plan generation failed";
            send({ phase: "error", message: msg });
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
      },
    });
  });
}
