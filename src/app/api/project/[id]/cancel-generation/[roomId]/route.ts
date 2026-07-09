/**
 * POST /api/project/[id]/cancel-generation/[roomId]
 * Abort an in-flight room render and clear persisted generating state.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  cancelRoomGeneration,
  GENERATION_CANCELLED_MESSAGE,
  getProject,
  sanitizeRoomResult,
} from "@/lib/project/projectOrchestrator";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; roomId: string }> },
) {
  const { id, roomId } = await params;

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const state = await cancelRoomGeneration(id, roomId);
  if (!state) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const room = state.rooms.find((r) => r.roomId === roomId);
  return NextResponse.json({
    ok: true,
    message: GENERATION_CANCELLED_MESSAGE,
    data: { room: room ? sanitizeRoomResult(room) : undefined },
  });
}
