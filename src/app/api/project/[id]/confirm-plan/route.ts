/**
 * POST /api/project/[id]/confirm-plan
 *
 * User confirms floor plan after editing dimensions and photo assignments.
 */

import { NextRequest, NextResponse } from "next/server";
import { confirmFloorPlan, getProject, type ConfirmPlanInput } from "@/lib/project/projectOrchestrator";

// Server-side mirror of the client's MAX_ROOM_PHOTOS (ProjectMode.tsx) and a sane room
// cap — the client enforces these in the UI, but a direct API call could otherwise
// bypass them and multiply per-photo/per-room render cost with no ceiling.
const MAX_PHOTOS = 35;
const MAX_ROOMS = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: ConfirmPlanInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.photos && body.photos.length > MAX_PHOTOS) {
    return NextResponse.json(
      { error: `Too many photos (max ${MAX_PHOTOS}) — please remove some and try again.` },
      { status: 400 },
    );
  }
  if (body.analysis?.rooms && body.analysis.rooms.length > MAX_ROOMS) {
    return NextResponse.json(
      { error: `Too many rooms (max ${MAX_ROOMS}) — please simplify the floor plan and try again.` },
      { status: 400 },
    );
  }

  try {
    const state = await confirmFloorPlan(id, body);
    return NextResponse.json({
      data: {
        id: state.id,
        status: state.status,
        analysis: state.analysis,
        concept: state.concept
          ? {
              projectName: state.concept.projectName,
              overallStyle: state.concept.overallStyle,
              colorPalette: state.concept.colorPalette,
              materialPalette: state.concept.materialPalette,
              roomCount: state.concept.rooms.length,
              roomNames: state.concept.rooms.map((r) => ({
                id: r.roomId,
                name: r.roomName,
                type: r.roomType,
              })),
            }
          : null,
        suggestedRoomOrder: state.suggestedRoomOrder,
        floorPlanConfirmed: state.floorPlanConfirmed,
        uploadedPhotos: state.uploadedPhotos.map((p) => ({
          id: p.id,
          label: p.label,
          roomId: p.roomId,
          confidence: p.confidence,
          viewpoint: p.viewpoint,
        })),
      },
    });
  } catch (error: unknown) {
    console.error("Confirm plan error:", error);
    const msg = error instanceof Error ? error.message : "Confirm plan failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
