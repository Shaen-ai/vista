/**
 * GET /api/project/[id]
 *
 * Returns the full project state (rooms, renders, materials, status).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getProject,
  getProjectFinalizeStatus,
  recoverOrphanedRoomGenerations,
} from "@/lib/project/projectOrchestrator";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let state = await getProject(id);

  if (!state) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const statusOnly = request.nextUrl.searchParams.get("status") === "1";
  if (statusOnly) {
    const recovered = await recoverOrphanedRoomGenerations(state);
    state = recovered.state;
  }
  const previewOnly = request.nextUrl.searchParams.get("preview") === "1";
  const finalizeStatus = getProjectFinalizeStatus(state);

  if (previewOnly) {
    if (state.furnishedPlanRender?.base64) {
      return NextResponse.json({
        data: {
          preview: {
            roomId: null,
            base64: state.furnishedPlanRender.base64,
            mimeType: state.furnishedPlanRender.mimeType,
          },
        },
      });
    }
    for (const room of state.rooms) {
      for (const render of room.renders) {
        if (render.base64) {
          return NextResponse.json({
            data: {
              preview: {
                roomId: room.roomId,
                base64: render.base64,
                mimeType: render.mimeType,
              },
            },
          });
        }
      }
    }
    return NextResponse.json({ data: { preview: null } });
  }

  const mapRoom = (r: (typeof state.rooms)[number]) => {
    if (statusOnly) {
      return {
        roomId: r.roomId,
        status: r.status,
        brief: r.brief,
        renders: r.renders.map((rr) => ({
          angleIndex: rr.angleIndex,
          angleDescription: rr.angleDescription,
          mimeType: rr.mimeType,
        })),
        viewpointErrors: r.viewpointErrors,
        photoRenderMap: r.photoRenderMap,
        viewpointTargetCount: r.viewpointTargetCount,
        gallerySyncComplete: r.gallerySyncComplete,
        generationStep: r.generationStep,
        generationError: r.generationError,
        generationFailedAt: r.generationFailedAt,
        generationAttempt: r.generationAttempt,
        lastSuccessfulStep: r.lastSuccessfulStep,
      };
    }
    return {
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
      phases: r.phases,
      currentPhase: r.currentPhase,
      viewpointErrors: r.viewpointErrors,
      photoRenderMap: r.photoRenderMap,
      viewpointTargetCount: r.viewpointTargetCount,
      viewpointPhases: r.viewpointPhases,
      primaryPhotoId: r.primaryPhotoId,
      gallerySyncComplete: r.gallerySyncComplete,
      generationStep: r.generationStep,
      generationError: r.generationError,
      generationFailedAt: r.generationFailedAt,
      generationAttempt: r.generationAttempt,
      lastSuccessfulStep: r.lastSuccessfulStep,
    };
  };

  return NextResponse.json({
    data: {
      id: state.id,
      status: state.status,
      canFinalize: finalizeStatus.canFinalize,
      pendingRoomIds: finalizeStatus.pendingRoomIds,
      requiredRoomCount: finalizeStatus.requiredRoomIds.length,
      preferences: statusOnly ? undefined : state.preferences,
      analysis: statusOnly ? undefined : state.analysis,
      concept: statusOnly
        ? null
        : state.concept
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
      rooms: state.rooms.map(mapRoom),
      currentRoomIndex: statusOnly ? undefined : state.currentRoomIndex,
      technicalDrawings: statusOnly ? undefined : state.technicalDrawings ? true : false,
      hasPdf: statusOnly ? undefined : !!state.pdfBase64,
      suggestedRoomOrder: statusOnly ? undefined : state.suggestedRoomOrder,
      floorPlanConfirmed: statusOnly ? undefined : state.floorPlanConfirmed,
      utilityEntryPoints: statusOnly ? undefined : state.utilityEntryPoints ?? [],
      error: state.error,
      createdAt: statusOnly ? undefined : state.createdAt,
      updatedAt: statusOnly ? undefined : state.updatedAt,
      floorPlanBase64: statusOnly ? undefined : state.floorPlanBase64,
      floorPlanMimeType: statusOnly ? undefined : state.floorPlanMimeType,
      inspirationUploads: statusOnly
        ? undefined
        : (state.inspirationUploads ?? []).map((u) => ({
            base64: u.base64,
            mimeType: u.mimeType,
            label: u.label,
          })),
      furnishedPlanRender: statusOnly
        ? undefined
        : state.furnishedPlanRender ?? null,
      furnishedPlanStatus: statusOnly ? undefined : state.furnishedPlanStatus ?? null,
      furnishedPlanError: statusOnly ? undefined : state.furnishedPlanError ?? null,
      uploadedPhotos: statusOnly
        ? undefined
        : state.uploadedPhotos.map((p) => ({
            id: p.id,
            label: p.label,
            base64: p.base64,
            mimeType: p.mimeType,
            roomId: p.roomId,
            confidence: p.confidence,
            viewpoint: p.viewpoint,
            structuralLineMap: p.structuralLineMap ?? null,
            objectRemovalMask: p.objectRemovalMask ?? null,
            openingAnalysis: p.openingAnalysis ?? null,
          })),
    },
  });
}
