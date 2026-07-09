/**
 * POST /api/project/[id]/finalize
 *
 * Triggered after all rooms are approved. Assembles a renders-only PDF.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  finalizeProject,
  getProject,
  getProjectFinalizeStatus,
} from "@/lib/project/projectOrchestrator";
import { isVistaLocale, type VistaLocale } from "@/i18n/locales";

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { canFinalize, pendingRoomIds } = getProjectFinalizeStatus(project);
  if (!canFinalize) {
    const pendingNames = pendingRoomIds
      .map((roomId) => project.concept?.rooms.find((r) => r.roomId === roomId)?.roomName ?? roomId)
      .filter(Boolean);
    return NextResponse.json(
      {
        error: "Not all rooms are approved yet.",
        pendingRoomIds,
        pendingRoomNames: pendingNames,
      },
      { status: 400 },
    );
  }

  let locale: VistaLocale | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { locale?: string };
    if (body.locale && isVistaLocale(body.locale)) {
      locale = body.locale;
    }
  } catch {
    /* empty body ok */
  }

  try {
    const state = await finalizeProject(id, { locale });

    return NextResponse.json({
      data: {
        projectId: state.id,
        status: state.status,
        hasPdf: !!state.pdfBase64,
      },
    });
  } catch (error: unknown) {
    console.error("Finalization error:", error);
    const msg = error instanceof Error ? error.message : "Finalization failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
