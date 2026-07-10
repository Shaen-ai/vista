import type { DesignBrief } from "@/lib/interiorDesignPrompts";
import type { QuickRoomPlacementMode } from "@/lib/quickRoom/placementMode";
import type { QuickRenderModel } from "@/lib/quickRoom/quickRenderModel";

export interface InteriorRenderSession {
  brief: DesignBrief;
  selectedForGemini: string[];
  plannedCatalogIds: string[];
  scrapedInventoryExclusive: boolean;
  designBoardProductIds: number[];
  adminSlug: string;
  designStyleLabel: string;
  /** Optional for backward compat with sessions minted before this field existed. */
  isCustomMode?: boolean;
  /** Optional — defaults to full redesign for sessions minted before this field existed. */
  placementMode?: QuickRoomPlacementMode;
  /**
   * Render engine chosen at brief time — the client uses it to pick the
   * transport (SSE for edit-pipeline, plain POST for legacy). Optional for
   * sessions minted before this field existed.
   */
  renderEngine?: QuickRenderModel;
}

export function parseRenderSession(raw: FormDataEntryValue | null): InteriorRenderSession | null {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as InteriorRenderSession;
  } catch {
    return null;
  }
}
