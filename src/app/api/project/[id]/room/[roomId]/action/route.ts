/**
 * POST /api/project/[id]/room/[roomId]/action
 *
 * Body: { action: "approve" | "regenerate" | "edit", editFeedback?: string }
 *
 * Handles the interactive room review cycle. Returns updated project state.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  handleRoomAction,
  getProject,
  isReadyToFinalize,
} from "@/lib/project/projectOrchestrator";
import { resolveProjectTokenAction } from "@/lib/project/projectTokenAction";
import { checkTokensServer, consumeTokensServer } from "@/lib/serverVistaTokens";

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) {
  const { id, roomId } = await params;

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: { action?: string; editFeedback?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (!action || !["approve", "regenerate", "edit"].includes(action)) {
    return NextResponse.json(
      { error: 'action must be "approve", "regenerate", or "edit"' },
      { status: 400 },
    );
  }

  if (action === "edit" && (!body.editFeedback || typeof body.editFeedback !== "string")) {
    return NextResponse.json(
      { error: "editFeedback is required for edit action" },
      { status: 400 },
    );
  }

  const tokenAction = resolveProjectTokenAction(action);
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

  try {
    const state = await handleRoomAction(id, {
      projectId: id,
      roomId,
      action: action as "approve" | "regenerate" | "edit",
      editFeedback: body.editFeedback,
    });

    let balance: number | undefined;
    if (tokenAction) {
      const room = state.rooms.find((r) => r.roomId === roomId);
      if ((room?.renders?.length ?? 0) > 0) {
        const tokenGate = await consumeTokensServer(tokenAction, request.headers);
        if (!tokenGate.ok) {
          return NextResponse.json(
            {
              error: tokenGate.message,
              balance: tokenGate.balance,
              required: tokenGate.required,
            },
            { status: tokenGate.status },
          );
        }
        balance = tokenGate.balance;
      }
    }

    const allApproved = await isReadyToFinalize(id);

    return NextResponse.json({
      balance,
      data: {
        projectId: state.id,
        status: state.status,
        allRoomsApproved: allApproved,
        rooms: state.rooms.map((r) => ({
          roomId: r.roomId,
          status: r.status,
          brief: r.brief,
          renders: r.renders.map((rr) => ({
            angleIndex: rr.angleIndex,
            angleDescription: rr.angleDescription,
            base64: rr.base64,
            mimeType: rr.mimeType,
          })),
          materials: r.materials,
          editHistory: r.editHistory,
          version: r.version,
          usedScrapedProducts: r.usedScrapedProducts,
          selectedCatalogIds: r.selectedCatalogIds,
          plannedCatalogIds: r.plannedCatalogIds,
        })),
        suggestedRoomOrder: state.suggestedRoomOrder,
        currentRoomIndex: state.currentRoomIndex,
      },
    });
  } catch (error: unknown) {
    console.error("Room action error:", error);
    const msg = error instanceof Error ? error.message : "Room action failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
