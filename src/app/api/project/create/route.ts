/**
 * POST /api/project/create
 *
 * Accepts multipart form with floor plan (image/PDF) + preferences JSON +
 * optional room photos (matched to rooms later in the matching step).
 * Runs Phase 1 (analysis) + Phase 2 (master concept) + generates first room.
 * Returns project state with the first room ready for review.
 */

import { NextRequest, NextResponse } from "next/server";
import { initializeProject } from "@/lib/project/projectOrchestrator";
import type { UserPreferences, RoomPhoto } from "@/lib/project/types";
import { parseUserPreferences } from "@/lib/project/types";
import { optimizeImageBufferForAiWithBuffer } from "@/lib/optimizeImageForAi";
import { LOCAL_SCRAPED_CATALOG_EMPTY_CODE } from "@/lib/scrapedAllowlist";

export const maxDuration = 120;

const MAX_INSPIRATION_IMAGES = 4;

function parseNumericIdList(raw: FormDataEntryValue | null): number[] {
  if (!raw || typeof raw !== "string") return [];
  const t = raw.trim();
  if (!t) return [];
  try {
    const arr = JSON.parse(t);
    if (Array.isArray(arr)) {
      return arr.map((x) => Number(x)).filter((n) => !isNaN(n) && n > 0);
    }
  } catch { /* ignore */ }
  return t.split(/[\s,;]+/).map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
}

async function parseInspirationUploads(formData: FormData): Promise<Array<{ base64: string; mimeType: string; label: string }>> {
  const items: Array<{ base64: string; mimeType: string; label: string }> = [];
  const labels = formData.getAll("inspirationLabels") as string[];
  const files = formData.getAll("inspirationImages") as File[];
  const urls = formData.getAll("inspirationUrls") as string[];
  let labelIdx = 0;

  for (const file of files) {
    if (items.length >= MAX_INSPIRATION_IMAGES) break;
    try {
      const bytes = await file.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(bytes));
      items.push({
        base64: optimized.base64,
        mimeType: optimized.mimeType,
        label: labels[labelIdx] || "",
      });
    } catch { /* skip */ }
    labelIdx++;
  }

  for (const url of urls) {
    if (items.length >= MAX_INSPIRATION_IMAGES) break;
    if (!/^https?:\/\//i.test(url)) {
      labelIdx++;
      continue;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (!res.ok) {
        labelIdx++;
        continue;
      }
      const arr = await res.arrayBuffer();
      const optimized = await optimizeImageBufferForAiWithBuffer(Buffer.from(arr));
      items.push({
        base64: optimized.base64,
        mimeType: optimized.mimeType,
        label: labels[labelIdx] || "",
      });
    } catch { /* skip */ }
    labelIdx++;
  }

  return items;
}

function stripBase64(project: ReturnType<typeof sanitize>) {
  return project;
}

function sanitize(state: Awaited<ReturnType<typeof initializeProject>>) {
  return {
    id: state.id,
    status: state.status,
    preferences: state.preferences,
    analysis: state.analysis,
    concept: state.concept
      ? {
          projectName: state.concept.projectName,
          overallStyle: state.concept.overallStyle,
          colorPalette: state.concept.colorPalette,
          materialPalette: state.concept.materialPalette,
          roomCount: state.concept.rooms.length,
          roomNames: state.concept.rooms.map((r) => ({ id: r.roomId, name: r.roomName, type: r.roomType })),
        }
      : null,
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
    currentRoomIndex: state.currentRoomIndex,
    suggestedRoomOrder: state.suggestedRoomOrder,
    floorPlanConfirmed: state.floorPlanConfirmed,
    error: state.error,
    createdAt: state.createdAt,
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const floorPlanFile = formData.get("floorPlan") as File | null;
    const preferencesRaw = formData.get("preferences") as string | null;

    if (!floorPlanFile) {
      return NextResponse.json({ error: "Floor plan file is required." }, { status: 400 });
    }
    if (!preferencesRaw) {
      return NextResponse.json({ error: "Preferences JSON is required." }, { status: 400 });
    }

    let preferences: UserPreferences;
    try {
      preferences = parseUserPreferences(JSON.parse(preferencesRaw));
    } catch {
      return NextResponse.json({ error: "Invalid preferences JSON." }, { status: 400 });
    }

    // Convert file to base64
    const arrayBuffer = await floorPlanFile.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = floorPlanFile.type || "image/jpeg";

    // Room photos are stored but not matched to rooms at this stage.
    // The user assigns photos to rooms on the floor plan review screen.
    const roomPhotoFiles = formData.getAll("roomPhotos") as File[];
    const roomPhotos: RoomPhoto[] = [];

    for (const file of roomPhotoFiles) {
      const buf = await file.arrayBuffer();
      const photoBase64 = Buffer.from(buf).toString("base64");
      roomPhotos.push({
        roomId: "",
        base64: photoBase64,
        mimeType: file.type || "image/jpeg",
      });
    }

    const inspirationUploads = await parseInspirationUploads(formData);
    const pinnedProductIds = parseNumericIdList(formData.get("pinnedProductIds"));

    const state = await initializeProject({
      floorPlanBase64: base64,
      floorPlanMimeType: mimeType,
      preferences,
      roomPhotos: roomPhotos.length > 0 ? roomPhotos : undefined,
      pinnedProductIds,
      inspirationUploads,
    });

    return NextResponse.json({ data: sanitize(state) });
  } catch (error: unknown) {
    console.error("Project creation error:", error);
    const msg = error instanceof Error ? error.message : "Project creation failed";
    if (msg === LOCAL_SCRAPED_CATALOG_EMPTY_CODE) {
      return NextResponse.json(
        {
          error: "No products available in our catalog for this project. Try adjusting preferences or add inspiration products.",
          code: LOCAL_SCRAPED_CATALOG_EMPTY_CODE,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
