/**
 * Client-side persistence for Vista flows (project + quick room).
 * - localStorage: small metadata (step, projectId, preferences)
 * - IndexedDB: large blobs (floor plan, room photos, inspiration images)
 */

import type {
  InspirationProduct,
  ProjectHubView,
  ProjectStep,
  StyleInspirationImage,
  UploadedRoomPhoto,
  UserPreferences,
  VistaMode,
} from "@/app/store";
import type { UtilityEntryPoint, DetectedRoom } from "@/lib/project/types";

const LS_KEY = "vista_project_session";
const DB_NAME = "vista_project";
const DB_VERSION = 2;
const STORE_NAME = "blobs";
const BLOBS_KEY = "session";

/** Match Redis project TTL (24h). */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface SessionMeta {
  projectId: string | null;
  projectStep: ProjectStep;
  vistaMode: VistaMode;
  preferences: UserPreferences;
  timestamp: number;
  projectSuggestedRoomOrder?: string[];
  selectedFloorPlanRoomId?: string | null;
  projectHubView?: ProjectHubView;
  currentProjectRoomIndex?: number;
  utilityEntryPoints?: UtilityEntryPoint[];
  projectDraftRooms?: DetectedRoom[];
  projectDbId?: string | null;
}

export interface SessionBlobs {
  floorPlanBase64: string | null;
  floorPlanMimeType: string | null;
  roomPhotos: UploadedRoomPhoto[];
  inspirationProducts: InspirationProduct[];
  styleInspirations: StyleInspirationImage[];
}

const POST_ANALYSIS_STEPS: ProjectStep[] = [
  "floorPlanReview",
  "designBrief",
  "rooms",
  "finalizing",
  "complete",
];

/** Legacy step ids from older sessions. */
const LEGACY_STEP_MAP: Record<string, ProjectStep> = {
  preferences: "designBrief",
  matching: "floorPlanReview",
  analyzing: "analyzingFloorPlan",
};

const MID_SSE_STEPS: ProjectStep[] = ["analyzingFloorPlan", "creatingConcept"];

export function stepNeedsServerRestore(step: ProjectStep | string): boolean {
  // Mid-SSE steps re-fetch the server (which may already hold completed work) instead
  // of blindly resolving to floorPlanReview with no analysis data.
  const mapped = mapLegacyStep(step);
  return MID_SSE_STEPS.includes(mapped) || POST_ANALYSIS_STEPS.includes(mapped);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export function saveSessionMeta(meta: SessionMeta): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(meta));
  } catch {
    /* quota or private mode */
  }
}

export function loadSessionMeta(expectedMode?: VistaMode): SessionMeta | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionMeta;
    if (!parsed) return null;
    if (expectedMode) {
      if (parsed.vistaMode !== expectedMode) return null;
    } else if (parsed.vistaMode !== "project" && parsed.vistaMode !== "quick") {
      return null;
    }
    if (Date.now() - parsed.timestamp > SESSION_MAX_AGE_MS) {
      clearSession();
      void clearSessionBlobs();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export async function saveSessionBlobs(blobs: SessionBlobs): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(blobs, BLOBS_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("IndexedDB put failed"));
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    });
  } catch {
    /* ignore — persistence is best-effort */
  }
}

export async function loadSessionBlobs(): Promise<SessionBlobs | null> {
  try {
    const db = await openDb();
    return await new Promise<SessionBlobs | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(BLOBS_KEY);
      req.onsuccess = () => {
        const val = req.result as SessionBlobs | undefined;
        resolve(val ?? null);
      };
      req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    });
  } catch {
    return null;
  }
}

export async function clearSessionBlobs(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(BLOBS_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("IndexedDB delete failed"));
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    });
  } catch {
    /* ignore */
  }
}

export async function clearProjectSession(): Promise<void> {
  clearSession();
  await clearSessionBlobs();
}

function mapLegacyStep(step: ProjectStep | string): ProjectStep {
  return LEGACY_STEP_MAP[step] ?? (step as ProjectStep);
}

/** Normalize step after refresh (cannot resume mid-SSE). */
export function normalizeRestoredStep(step: ProjectStep | string, projectId?: string | null): ProjectStep {
  const mapped = mapLegacyStep(step);
  if (MID_SSE_STEPS.includes(mapped)) {
    if (mapped === "creatingConcept") return projectId ? "designBrief" : "upload";
    return projectId ? "floorPlanReview" : "upload";
  }
  return mapped;
}

/** Infer UI step from server flags when Redis has newer truth. */
export function stepFromServerState(options: {
  savedStep: ProjectStep | string;
  floorPlanConfirmed: boolean;
  hasConcept: boolean;
  hasAnalysis: boolean;
  status: string;
  hasPdf: boolean;
}): ProjectStep {
  const { floorPlanConfirmed, hasConcept, hasAnalysis, status, hasPdf } = options;
  const savedStep = mapLegacyStep(options.savedStep);
  if (hasPdf || status === "complete") return "complete";
  if (status === "finalizing") return "finalizing";
  if (hasConcept && floorPlanConfirmed) {
    if (savedStep === "floorPlanReview" || savedStep === "designBrief") return "rooms";
    if (POST_ANALYSIS_STEPS.includes(savedStep)) return savedStep;
    return "rooms";
  }
  if (floorPlanConfirmed && !hasConcept) return "designBrief";
  // floorPlanReview is only viable when the server actually has the analysis to render.
  // Without it (status "analyzing"/"failed", or expired data) fall back to upload so the
  // user can start over instead of landing on a dead-end review screen.
  if (!hasAnalysis) return "upload";
  if (status === "reviewing" && !floorPlanConfirmed) return "floorPlanReview";
  return normalizeRestoredStep(savedStep);
}
