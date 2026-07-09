import "server-only";

import { getPublicApiUrl } from "@/lib/publicEnv";
import type { DesignPhase } from "@/lib/phaseRouter";
import { slotDisplayLabel } from "@/lib/phaseRouter";
import type { RequiredSlot, ResolvedCatalogSlot } from "@/lib/resolveCatalogSlots";

function laravelApiBase(): string {
  const raw = process.env.LARAVEL_API_URL || getPublicApiUrl();
  return raw.replace(/\/$/, "");
}

export interface ImaginedSlotEntry {
  family: string;
  subtype?: string | null;
  label: string;
}

export interface NotifySlotFailurePayload {
  phase: DesignPhase;
  roomType: string;
  style: string;
  designIntent?: string;
  failedSlots: ImaginedSlotEntry[];
}

function slotKey(slot: { family: string; subtype?: string | null | undefined }): string {
  return `${slot.family}/${slot.subtype ?? "*"}`;
}

/** Phase template slots may omit subtype; resolver may return a specific subtype (e.g. flooring/tile). */
function phaseSlotMatchesResolved(phase: RequiredSlot, resolved: ResolvedCatalogSlot): boolean {
  if (phase.family.toLowerCase() !== resolved.family.toLowerCase()) return false;
  const phaseSub = (phase.subtype ?? "").toLowerCase();
  const resolvedSub = (resolved.subtype ?? "").toLowerCase();
  if (!phaseSub || !resolvedSub) return true;
  return phaseSub === resolvedSub;
}

export function buildImaginedSlotEntries(
  phaseSlots: RequiredSlot[],
  vectorResolvedSlots: ResolvedCatalogSlot[],
  _selectedCatalogIds: string[],
): ImaginedSlotEntry[] {
  return phaseSlots
    .filter((slot) => {
      const resolved = vectorResolvedSlots.find((r) => phaseSlotMatchesResolved(slot, r));
      if (!resolved) return true;
      const ids = resolved.product_ids ?? [];
      // Empty resolution → AI-imagined; any catalog SKU from resolver → not imagined.
      return ids.length === 0;
    })
    .map((slot) => ({
      family: slot.family,
      subtype: slot.subtype ?? null,
      label: slotDisplayLabel(slot),
    }));
}

export function buildSlotNotices(imaginedSlots: ImaginedSlotEntry[]): string[] {
  return imaginedSlots.map(
    (slot) =>
      `We couldn't find an exact match for ${slot.label} in our catalog. We used a custom design for that element.`,
  );
}

export async function notifySlotFailure(payload: NotifySlotFailurePayload): Promise<void> {
  const key = process.env.INTERNAL_API_KEY ?? "";
  if (!key || payload.failedSlots.length === 0) return;

  try {
    await fetch(`${laravelApiBase()}/internal/notify/slot-failure`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": key,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[notifySlotFailure] failed:", err);
  }
}
