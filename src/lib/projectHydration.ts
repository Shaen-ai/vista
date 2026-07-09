import { useConsumerDesignStore } from "@/app/store";
import { authJsonHeaders } from "@/lib/authApi";
import type { DesignVersion, DesignBriefResult, ProductPurchaseLink } from "@/app/store";
import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import type {
  FloorPlanAnalysis,
  PhotoViewpoint,
  RoomResult,
  UtilityEntryPoint,
} from "@/lib/project/types";
import { stepFromServerState } from "@/lib/project/sessionStorage";
import type { ProjectConceptSummary, UploadedRoomPhoto } from "@/app/store";
import {
  applyInspirationProductsToStore,
  hydrateInspirationProductsFromLaravel,
  hydrateStyleInspirationsFromLaravel,
  type LaravelInspirationImage,
} from "@/lib/inspirationPersistence";

const API_BASE = "/api/vista/projects";

export interface HydratedProjectData {
  id: string;
  mode: "quick_room" | "project";
  title: string;
  style: string | null;
  roomImageUrl: string | null;
  roomAnalysis: RoomAnalysis | null;
  roomGeometry: RoomGeometry | null;
  versions: HydratedVersion[];
  messages: HydratedMessage[];
  floorPlanUrl: string | null;
  floorPlanAnalysis: unknown | null;
  masterConcept: unknown | null;
  roomResults: unknown[] | null;
  preferences: unknown | null;
  pdfUrl: string | null;
  inspirationImages: LaravelInspirationImage[];
}

export interface HydratedVersion {
  id: string;
  fileUrl: string;
  mimeType: string;
  versionNumber: number;
  type: string;
  roomId: string | null;
  angleIndex: number;
  designBrief: DesignBriefResult | null;
  productsUsed: ProductPurchaseLink[] | null;
  promptUsed: string | null;
  feedback: string | null;
  createdAt: string | null;
}

export interface HydratedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  contentType: string;
  text: string | null;
  versionId: string | null;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  sequence: number;
  createdAt: string | null;
  version: HydratedVersion | null;
}

interface OrchestratorProjectResponse {
  id: string;
  status: string;
  preferences: unknown;
  analysis: FloorPlanAnalysis | null;
  concept: ProjectConceptSummary | null;
  rooms: RoomResult[];
  currentRoomIndex: number;
  hasPdf: boolean;
  suggestedRoomOrder: string[];
  floorPlanConfirmed: boolean;
  utilityEntryPoints?: UtilityEntryPoint[];
  floorPlanBase64?: string;
  floorPlanMimeType?: string;
  uploadedPhotos?: Array<{
    id: string;
    label: string;
    base64?: string;
    mimeType?: string;
    roomId?: string;
    confidence?: "high" | "medium" | "low";
    viewpoint?: PhotoViewpoint;
    structuralLineMap?: { base64: string; mimeType: string; strokeOnly?: boolean } | null;
    objectRemovalMask?: { base64: string; mimeType: string } | null;
    openingAnalysis?: {
      window_boxes: Array<{ x: number; y: number; w: number; h: number }>;
      door_boxes: Array<{ x: number; y: number; w: number; h: number }>;
    } | null;
  }>;
  inspirationUploads?: Array<{ base64: string; mimeType: string; label: string }>;
}

function mapOrchestratorUploadedPhotos(
  photos: OrchestratorProjectResponse["uploadedPhotos"],
): UploadedRoomPhoto[] {
  if (!photos?.length) return [];
  return photos
    .filter((p) => p.base64 && p.mimeType)
    .map((p) => ({
      id: p.id,
      base64: p.base64!,
      mimeType: p.mimeType!,
      label: p.label,
      matchedRoomId: p.roomId ?? null,
      matchConfidence: p.confidence ?? null,
      viewpoint: p.viewpoint,
      structuralLineMap: p.structuralLineMap ?? undefined,
      objectRemovalMask: p.objectRemovalMask ?? undefined,
      openingAnalysis: p.openingAnalysis ?? undefined,
    }));
}

async function fetchUrlAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type || "image/png";
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return { base64: btoa(binary), mimeType };
  } catch {
    return null;
  }
}

export async function fetchProjectDetail(projectId: string): Promise<HydratedProjectData | null> {
  try {
    const res = await fetch(`${API_BASE}/${projectId}`, {
      headers: authJsonHeaders(),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.data;
    if (!d) return null;

    return {
      id: d.id,
      mode: d.mode,
      title: d.title,
      style: d.style ?? null,
      roomImageUrl: d.room_image_url ?? null,
      roomAnalysis: d.room_analysis ?? null,
      roomGeometry: d.room_geometry ?? null,
      versions: (d.versions ?? []).map(mapVersion),
      messages: (d.messages ?? []).map(mapMessage),
      floorPlanUrl: d.floor_plan_url ?? null,
      floorPlanAnalysis: d.floor_plan_analysis ?? null,
      masterConcept: d.master_concept ?? null,
      roomResults: d.room_results ?? null,
      preferences: d.preferences ?? null,
      pdfUrl: d.pdf_url ?? null,
      inspirationImages: mapInspirationImages(d.inspiration_images),
    };
  } catch {
    return null;
  }
}

function mapInspirationImages(raw: unknown): LaravelInspirationImage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object" && typeof (item as { url?: string }).url === "string")
    .map((item) => ({
      url: (item as { url: string }).url,
      label: typeof (item as { label?: string }).label === "string" ? (item as { label: string }).label : "",
      mime: typeof (item as { mime?: string }).mime === "string" ? (item as { mime: string }).mime : "image/jpeg",
    }));
}

function mapVersion(v: Record<string, unknown>): HydratedVersion {
  return {
    id: v.id as string,
    fileUrl: v.file_url as string,
    mimeType: (v.mime_type as string) ?? "image/png",
    versionNumber: (v.version_number as number) ?? 1,
    type: (v.type as string) ?? "generated",
    roomId: (v.room_id as string) ?? null,
    angleIndex: (v.angle_index as number) ?? 0,
    designBrief: (v.design_brief as DesignBriefResult) ?? null,
    productsUsed: (v.products_used as ProductPurchaseLink[]) ?? null,
    promptUsed: (v.prompt_used as string) ?? null,
    feedback: (v.feedback as string) ?? null,
    createdAt: (v.created_at as string) ?? null,
  };
}

function mapMessage(m: Record<string, unknown>): HydratedMessage {
  return {
    id: m.id as string,
    role: m.role as "user" | "assistant" | "system",
    contentType: (m.content_type as string) ?? "text",
    text: (m.text as string) ?? null,
    versionId: (m.version_id as string) ?? null,
    attachmentUrl: (m.attachment_url as string) ?? null,
    attachmentMime: (m.attachment_mime as string) ?? null,
    sequence: (m.sequence as number) ?? 0,
    createdAt: (m.created_at as string) ?? null,
    version: m.version ? mapVersion(m.version as Record<string, unknown>) : null,
  };
}

async function hydrateQuickRoomProject(project: HydratedProjectData): Promise<void> {
  const store = useConsumerDesignStore.getState();
  store.setVistaMode("quick");
  store.setSelectedStyle(project.style ?? "modern");

  if (project.roomAnalysis) {
    store.setQuickRoomAnalysis(project.roomAnalysis);
  }
  if (project.roomGeometry) {
    store.setLastRoomGeometry(project.roomGeometry, false);
  }

  if (project.roomImageUrl) {
    const roomImg = await fetchUrlAsBase64(project.roomImageUrl);
    if (roomImg) {
      store.setRoomImage(roomImg.base64, roomImg.mimeType);
    }
  }

  const versions = project.versions;
  if (versions.length > 0) {
    const latest = versions[versions.length - 1]!;
    const latestImg = latest.fileUrl ? await fetchUrlAsBase64(latest.fileUrl) : null;
    if (latestImg) {
      store.setGeneratedImage(latestImg.base64, latestImg.mimeType);
    } else {
      store.setGeneratedImage(null, null);
    }
    store.setDesignBrief(latest.designBrief ?? null);
    if (latest.productsUsed) {
      store.setProductLinks(latest.productsUsed);
    }

    const historyEntries: DesignVersion[] = [];
    for (const v of versions.slice(0, -1).reverse()) {
      const img = v.fileUrl ? await fetchUrlAsBase64(v.fileUrl) : null;
      historyEntries.push({
        id: v.id,
        imageBase64: img?.base64 ?? "",
        imageMimeType: img?.mimeType ?? v.mimeType,
        brief: v.designBrief,
        feedback: v.feedback ?? null,
        timestamp: v.createdAt ? new Date(v.createdAt).getTime() : Date.now(),
      });
    }
    store.setDesignHistory(historyEntries);
  }

  const lastUserMsg = [...project.messages].reverse().find(
    (m) => m.role === "user" && m.contentType === "text",
  );
  if (lastUserMsg?.text) {
    store.setTextPrompt(lastUserMsg.text);
  }

  if (project.inspirationImages.length > 0) {
    await hydrateStyleInspirationsFromLaravel(project.inspirationImages);
  }
}

async function hydrateFullProjectFromOrchestrator(
  orchestratorId: string,
  project: HydratedProjectData,
): Promise<void> {
  const store = useConsumerDesignStore.getState();
  store.setVistaMode("project");

  if (project.preferences && typeof project.preferences === "object") {
    store.setProjectPreferences(project.preferences as never);
  }

  try {
    const res = await fetch(`/api/project/${orchestratorId}`, { cache: "no-store" });
    if (!res.ok) {
      if (project.roomResults) {
        store.setProjectData({
          id: orchestratorId,
          analysis: project.floorPlanAnalysis as never,
          concept: project.masterConcept as never,
          rooms: project.roomResults as never[],
          hasPdf: !!project.pdfUrl,
        });
        store.setProjectStep("complete");
      } else {
        store.setProjectStep("upload");
      }
      return;
    }

    const json = await res.json();
    const data = json.data as OrchestratorProjectResponse;
    if (data.floorPlanBase64 && data.floorPlanMimeType) {
      store.setFloorPlan(data.floorPlanBase64, data.floorPlanMimeType);
    } else if (project.floorPlanUrl) {
      const fp = await fetchUrlAsBase64(project.floorPlanUrl);
      if (fp) store.setFloorPlan(fp.base64, fp.mimeType);
    }

    const step = stepFromServerState({
      savedStep: store.projectStep,
      floorPlanConfirmed: data.floorPlanConfirmed,
      hasConcept: Boolean(data.concept),
      hasAnalysis: Boolean(data.analysis),
      status: data.status,
      hasPdf: data.hasPdf,
    });

    if (data.analysis || data.concept || (data.rooms?.length ?? 0) > 0) {
      store.setProjectData({
        id: orchestratorId,
        analysis: data.analysis,
        concept: data.concept,
        rooms: data.rooms ?? [],
        currentRoomIndex: data.currentRoomIndex ?? 0,
        hasPdf: data.hasPdf ?? false,
        suggestedRoomOrder: data.suggestedRoomOrder ?? [],
      });
    } else {
      useConsumerDesignStore.setState({ projectId: orchestratorId });
    }

    const mappedPhotos = mapOrchestratorUploadedPhotos(data.uploadedPhotos);
    if (mappedPhotos.length > 0) {
      useConsumerDesignStore.setState({ roomPhotos: mappedPhotos });
    }

    if (data.inspirationUploads?.length) {
      applyInspirationProductsToStore(data.inspirationUploads);
    } else if (project.inspirationImages.length > 0) {
      await hydrateInspirationProductsFromLaravel(project.inspirationImages);
    }

    if (data.utilityEntryPoints?.length) {
      store.setProjectUtilityEntryPoints(data.utilityEntryPoints);
    } else if (data.analysis?.utilityPoints?.length && !data.floorPlanConfirmed) {
      store.setProjectUtilityEntryPoints(data.analysis.utilityPoints);
    }

    store.setProjectStep(step);
  } catch {
    if (project.roomResults) {
      store.setProjectData({
        id: orchestratorId,
        analysis: project.floorPlanAnalysis as never,
        concept: project.masterConcept as never,
        rooms: project.roomResults as never[],
        hasPdf: !!project.pdfUrl,
      });
      store.setProjectStep("complete");
    } else {
      store.setProjectStep("upload");
    }
  }
}

/**
 * Load a saved project from the API and hydrate the Zustand store
 * so the user can continue editing where they left off.
 */
export async function loadAndHydrateProject(projectId: string): Promise<boolean> {
  const project = await fetchProjectDetail(projectId);
  if (!project) return false;

  const store = useConsumerDesignStore.getState();
  store.setCurrentProjectDbId(project.id);

  if (project.mode === "quick_room") {
    await hydrateQuickRoomProject(project);
  } else {
    const prefs = project.preferences as { orchestratorProjectId?: string } | null;
    const orchestratorId = prefs?.orchestratorProjectId;
    if (orchestratorId) {
      await hydrateFullProjectFromOrchestrator(orchestratorId, project);
    } else if (project.roomResults) {
      store.setVistaMode("project");
      store.setProjectData({
        id: projectId,
        analysis: project.floorPlanAnalysis as never,
        concept: project.masterConcept as never,
        rooms: project.roomResults as never[],
        hasPdf: !!project.pdfUrl,
      });
      store.setProjectStep("complete");
    } else {
      store.setVistaMode("project");
      if (project.preferences && typeof project.preferences === "object") {
        store.setProjectPreferences(project.preferences as never);
      }
      if (project.inspirationImages.length > 0) {
        await hydrateInspirationProductsFromLaravel(project.inspirationImages);
      }
      store.setProjectStep("upload");
    }
  }

  return true;
}
