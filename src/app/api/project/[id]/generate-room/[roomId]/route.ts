/**
 * POST /api/project/[id]/generate-room/[roomId]
 *
 * SSE endpoint for FAL-direct room rendering. Body:
 *   { action: "generate"|"regenerate"|"edit", editFeedback?, photoId? } — FAL img2img all or one photo
 *   { action: "approve-room" }              — approve after review
 *   { action: "finish" }                    — alias for approve-room
 *   { action: "next-viewpoint" }              — legacy sequential secondary (optional redo)
 *   { action: "remove-render", renderIndex } — remove one render from the gallery
 */

import { NextRequest, NextResponse } from "next/server";
import {
  generateRoomPhase,
  generateNextViewpoint,
  approveRoomPhase,
  approveViewpoint,
  syncGallery,
  selectRoomPhaseVersion,
  finishRoom,
  approveRoomReview,
  removeRoomRender,
  getProject,
  GENERATION_CANCELLED_MESSAGE,
  GenerationCancelledError,
} from "@/lib/project/projectOrchestrator";
import type { DesignPhase, EditAnnotation, ProgressEvent, RoomResult } from "@/lib/project/types";
import { LOCAL_SCRAPED_CATALOG_EMPTY_CODE } from "@/lib/scrapedAllowlist";
import {
  buildAiIncidentSseEvent,
  isOverloadedAiError,
  reportOverloadedIncident,
} from "@/lib/aiIncident";
import { createSseEmitter, isStreamClosedError } from "@/lib/sseStream";
import { resolveProjectTokenAction } from "@/lib/project/projectTokenAction";
import { checkTokensServer, consumeTokensServer } from "@/lib/serverVistaTokens";
import { withRequestUploadUser } from "@/lib/uploadUserContext";

export const maxDuration = 900;

function isPhase(v: unknown): v is DesignPhase {
  return v === "base" || v === "furniture" || v === "decor";
}

function roomPayloadHasImage(room: RoomResult | undefined): boolean {
  return (room?.renders?.length ?? 0) > 0;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) {
  return withRequestUploadUser(request, async () => {
  const { id, roomId } = await params;

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: {
    phase?: string;
    action?: string;
    editFeedback?: string;
    editAnnotation?: EditAnnotation;
    index?: number;
    designMode?: "made" | "custom";
    redo?: boolean;
    photoId?: string;
    renderIndex?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* legacy no-body call → base phase */
  }

  const action = (body.action ?? "generate").trim();
  const phase = body.phase;
  const tokenAction = resolveProjectTokenAction(action, { redo: body.redo });

  if (tokenAction) {
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
  }

  const stream = new ReadableStream({
    async start(controller) {
      const { emit: emitRaw, close } = createSseEmitter(controller, { heartbeatMs: 10_000 });
      let tokenConsumed = false;
      let billingChain: Promise<void> = Promise.resolve();

      async function emitWithBilling(event: unknown) {
        const ev = event as ProgressEvent;
        if (
          tokenAction &&
          ev.phase === "complete" &&
          !tokenConsumed
        ) {
          const room = (ev.data as { room?: RoomResult } | undefined)?.room;
          if (roomPayloadHasImage(room)) {
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
        if (action === "next-viewpoint") {
          await generateNextViewpoint(
            id,
            roomId,
            (event) => send(event),
            body.editFeedback?.trim() || undefined,
            body.editAnnotation,
            { redo: !!body.redo },
          );
        } else if (action === "remove-render") {
          const renderIndex = Number(body.renderIndex);
          if (!Number.isInteger(renderIndex) || renderIndex < 0) {
            throw new Error("renderIndex is required for remove-render");
          }
          const updated = await removeRoomRender(id, roomId, renderIndex);
          const room = updated.rooms.find((r) => r.roomId === roomId);
          send({ phase: "complete", message: "Render removed", data: { room } });
        } else if (action === "finish") {
          await finishRoom(id, roomId, (event) => send(event));
        } else if (action === "approve-room") {
          await approveRoomReview(id, roomId, (event) => send(event));
        } else if (action === "approve-viewpoint") {
          if (!body.photoId) throw new Error("photoId is required for approve-viewpoint");
          await approveViewpoint(id, roomId, body.photoId);
          send({ phase: "complete", message: "Viewpoint approved", data: { photoId: body.photoId } });
        } else if (action === "sync-gallery") {
          await syncGallery(id, roomId, body.editFeedback?.trim() || undefined, (event) => send(event));
        } else if (action === "approve") {
          if (!isPhase(phase)) throw new Error("A valid phase is required to approve.");
          await approveRoomPhase(id, roomId, phase);
          send({ phase: "complete", message: "Phase approved" });
        } else if (action === "select") {
          if (!isPhase(phase)) throw new Error("A valid phase is required to select a version.");
          await selectRoomPhaseVersion(id, roomId, phase, Number(body.index) || 0);
          send({ phase: "complete", message: "Version selected" });
        } else {
          // generate | regenerate | edit — FAL-direct base render only
          if (isPhase(phase) && phase !== "base") {
            throw new Error("Only base render is supported in FAL-direct mode.");
          }
          const targetPhase: DesignPhase = "base";
          const feedback = action === "edit" ? body.editFeedback : undefined;
          const editAnnotation =
            action === "edit" &&
            body.editAnnotation &&
            typeof body.editAnnotation.base64 === "string" &&
            body.editAnnotation.base64.length > 0
              ? body.editAnnotation
              : undefined;
          await generateRoomPhase(id, roomId, targetPhase, feedback, (event) => send(event), {
            designMode:
              body.designMode === "made" || body.designMode === "custom" ? body.designMode : undefined,
            editAnnotation,
            photoId: body.photoId,
            roomAction:
              action === "generate" || action === "regenerate" || action === "edit"
                ? action
                : undefined,
            abortSignal: request.signal,
          });
        }
        await billingChain;
      } catch (error: unknown) {
        await billingChain;
        if (isStreamClosedError(error)) {
          // Client disconnected — do not overwrite room meta or page support.
        } else if (error instanceof GenerationCancelledError) {
          send({ phase: "error", message: GENERATION_CANCELLED_MESSAGE, data: { code: "cancelled" } });
        } else if (error instanceof Error && error.message === LOCAL_SCRAPED_CATALOG_EMPTY_CODE) {
          send({
            phase: "error",
            message:
              "No products available in our catalog for this room. Try adjusting preferences or add inspiration products.",
            data: { code: LOCAL_SCRAPED_CATALOG_EMPTY_CODE },
          });
        } else if (isOverloadedAiError(error)) {
          reportOverloadedIncident("/api/project/[id]/generate-room/[roomId]");
          send({
            phase: "error",
            message: "The service is temporarily overloaded. Please wait a moment and try again.",
          });
        } else {
          const event = await buildAiIncidentSseEvent(error, {
            route: "/api/project/[id]/generate-room/[roomId]",
            phase: typeof phase === "string" ? phase : undefined,
          });
          if (event) send(event);
        }
        await billingChain;
      } finally {
        await billingChain;
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
