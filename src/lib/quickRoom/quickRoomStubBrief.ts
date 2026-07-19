import type { InteriorRenderSession } from "@/app/api/interior-design/generate/_lib/renderSession";
import { parseQuickRoomPlacementMode } from "@/lib/quickRoom/placementMode";
import { resolveQuickRenderModel } from "@/lib/quickRoom/quickRenderModel";
import { DEFAULT_QUICK_ROOM_PROMPT } from "@/lib/quickRoomDefaultPrompt";
import { DESIGN_STYLES, type DesignBrief, type DesignStyleId } from "@/lib/interiorDesignPrompts";

const SUBJECT_SLICE = 220;

function parseDesignBoardProductIds(formData: FormData): number[] {
  const raw = formData.get("designBoardProductIds");
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

export interface QuickRoomStubBriefInput {
  textPrompt: string;
  designStyleLabel: string;
  roomType?: string;
  editContext?: string;
  doorDesign?: string;
}

/** Minimal design brief for Quick Room custom mode — no Claude redesign. */
export function buildQuickRoomStubBrief(input: QuickRoomStubBriefInput): DesignBrief {
  const fullPrompt = input.textPrompt.trim() || DEFAULT_QUICK_ROOM_PROMPT;
  const style = input.designStyleLabel.trim() || "modern";
  return {
    subject: fullPrompt.slice(0, SUBJECT_SLICE),
    arrangement: "",
    context: input.editContext?.trim() ?? "",
    composition: "",
    style,
    fullPrompt,
    roomType: input.roomType?.trim() ?? "",
    cameraAngle: "",
    designIntent: fullPrompt,
    requiredSlots: [],
    constraints: {},
    selectedCatalogIds: [],
    productIntents: [],
    productDescriptions: [],
    ...(input.doorDesign?.trim() ? { doorDesign: input.doorDesign.trim() } : {}),
  };
}

/** Build a render session from Quick Room form fields — FAL-only, no catalog matching. */
export function buildQuickRoomRenderSession(formData: FormData): InteriorRenderSession {
  const textPrompt =
    ((formData.get("textPrompt") as string) || "").trim() || DEFAULT_QUICK_ROOM_PROMPT;
  const editContext = String(formData.get("editContext") ?? "").trim();
  const styleId = (formData.get("style") as DesignStyleId) || "modern";
  const styleEntry = DESIGN_STYLES.find((s) => s.id === styleId);
  const designStyleLabel = styleEntry?.label ?? styleId;
  const roomType = String(formData.get("roomType") ?? "").trim();
  const doorDesign = String(formData.get("doorDesign") ?? "").trim();
  const designBoardProductIds = parseDesignBoardProductIds(formData);
  const adminSlug =
    ((formData.get("adminSlug") as string) || "").trim() ||
    (process.env.INTERIOR_DESIGN_ADMIN_SLUG || "").trim() ||
    (process.env.NEXT_PUBLIC_INTERIOR_ADMIN_SLUG || "").trim() ||
    "demo";
  const placementMode = parseQuickRoomPlacementMode(formData.get("placementMode"));

  const brief = buildQuickRoomStubBrief({
    textPrompt,
    designStyleLabel,
    roomType,
    editContext,
    doorDesign: doorDesign || undefined,
  });

  const selectedForGemini = designBoardProductIds.map((id) => `mp-${id}`);

  return {
    brief,
    selectedForGemini,
    plannedCatalogIds: [],
    scrapedInventoryExclusive: false,
    designBoardProductIds,
    adminSlug,
    designStyleLabel,
    isCustomMode: true,
    placementMode,
    renderEngine: resolveQuickRenderModel(),
    renderMode: "initial",
  };
}
