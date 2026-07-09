/**
 * POST /api/project/[id]/regenerate-pdf
 *
 * Re-assembles the PDF with a user-chosen set of sections (e.g. after the user
 * deselects the electrical/flooring plans on the complete screen). Reuses the
 * already-generated technical drawings/elevations — no model calls.
 */

import { NextRequest, NextResponse } from "next/server";
import { getProject, regenerateProjectPdf } from "@/lib/project/projectOrchestrator";
import { PDF_SECTION_KEYS, type PdfSectionSelection } from "@/lib/project/pdfAssembler";
import { isVistaLocale, type VistaLocale } from "@/i18n/locales";

export const maxDuration = 120;

function parseSections(raw: unknown): PdfSectionSelection | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const input = raw as Record<string, unknown>;
  const out: PdfSectionSelection = {};
  for (const key of PDF_SECTION_KEYS) {
    if (typeof input[key] === "boolean") out[key] = input[key] as boolean;
  }
  return out;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.pdfBase64 && !project.rooms.some((r) => r.status === "approved" && r.renders.length > 0)) {
    return NextResponse.json(
      { error: "Project has not been finalized yet." },
      { status: 400 },
    );
  }

  let locale: VistaLocale | undefined;
  let sections: PdfSectionSelection | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      locale?: string;
      sections?: unknown;
    };
    if (body.locale && isVistaLocale(body.locale)) locale = body.locale;
    sections = parseSections(body.sections);
  } catch {
    /* empty body ok */
  }

  try {
    const state = await regenerateProjectPdf(id, { locale, sections });
    return NextResponse.json({
      data: {
        projectId: state.id,
        hasPdf: !!state.pdfBase64,
      },
    });
  } catch (error: unknown) {
    console.error("PDF regeneration error:", error);
    const msg = error instanceof Error ? error.message : "PDF regeneration failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
