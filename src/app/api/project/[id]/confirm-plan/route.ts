/**
 * POST /api/project/[id]/confirm-plan
 *
 * User confirms floor plan after editing dimensions and photo assignments.
 */

import { NextRequest, NextResponse } from "next/server";
import { confirmFloorPlan, getProject, type ConfirmPlanInput } from "@/lib/project/projectOrchestrator";

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
