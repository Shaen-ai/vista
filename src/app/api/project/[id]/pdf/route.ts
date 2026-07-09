/**
 * GET /api/project/[id]/pdf
 *
 * Returns the final assembled PDF as a downloadable file.
 */

import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/project/projectOrchestrator";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const state = await getProject(id);

  if (!state) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (!state.pdfBase64) {
    return NextResponse.json(
      { error: "PDF not yet generated. Finalize the project first." },
      { status: 400 },
    );
  }

  const pdfBuffer = Buffer.from(state.pdfBase64, "base64");
  const filename = `${(state.concept?.projectName || "Design-Project").replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBuffer.length),
    },
  });
}
