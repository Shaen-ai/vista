/**
 * POST /api/project/[id]/photos
 *
 * Sync matched room photos to server project state (for photo-grounded renders).
 */

import { NextRequest, NextResponse } from "next/server";
import { getProject, setRoomPhotos } from "@/lib/project/projectOrchestrator";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const state = await getProject(id);
  if (!state) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as {
      photos?: Array<{ roomId: string; base64: string; mimeType: string }>;
    };

    const photos = Array.isArray(body.photos) ? body.photos : [];
    const valid = photos.filter(
      (p) =>
        typeof p.roomId === "string" &&
        p.roomId.trim() &&
        typeof p.base64 === "string" &&
        p.base64.trim() &&
        typeof p.mimeType === "string",
    );

    if (valid.length === 0) {
      return NextResponse.json({ error: "No valid photos provided." }, { status: 400 });
    }

    await setRoomPhotos(
      id,
      valid.map((p) => ({
        roomId: p.roomId.trim(),
        base64: p.base64.trim(),
        mimeType: p.mimeType.trim() || "image/jpeg",
      })),
    );

    return NextResponse.json({ ok: true, count: valid.length });
  } catch (error: unknown) {
    console.error("Project photos sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync photos" },
      { status: 500 },
    );
  }
}
