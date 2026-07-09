import { normalizeRoomTypeValue, type RoomType } from "@/lib/interiorDesignPrompts";
import { normalizeCatalogSubtype } from "@/lib/normalizeCatalogSubtype";
import type { RequiredSlot } from "@/lib/resolveCatalogSlots";

function slotKey(s: RequiredSlot): string {
  return `${s.family}/${s.subtype ?? "*"}`;
}

function normalizeSlot(s: RequiredSlot): RequiredSlot {
  const family = s.family.trim();
  const subtype = normalizeCatalogSubtype(family, s.subtype);
  return { ...s, family, subtype, quantity: s.quantity ?? 1 };
}

const LIVING_ROOM_SLOTS: RequiredSlot[] = [
  { family: "flooring", quantity: 1 },
  { family: "window_treatments", subtype: "curtain", quantity: 1 },
  { family: "lighting", subtype: "ceiling", quantity: 1 },
  { family: "furniture", subtype: "sofa", quantity: 1 },
  { family: "furniture", subtype: "coffee_table", quantity: 1 },
  { family: "furniture", subtype: "tv_stand", quantity: 1 },
  { family: "home_accessories", subtype: "vase", quantity: 1 },
  { family: "home_accessories", subtype: "decorative_plant", quantity: 1 },
];

const BEDROOM_SLOTS: RequiredSlot[] = [
  { family: "flooring", quantity: 1 },
  { family: "window_treatments", subtype: "curtain", quantity: 1 },
  { family: "lighting", quantity: 1 },
  { family: "furniture", subtype: "bed", quantity: 1 },
  { family: "furniture", subtype: "wardrobe", quantity: 1 },
  { family: "home_accessories", subtype: "decorative_plant", quantity: 1 },
];

const KITCHEN_SLOTS: RequiredSlot[] = [
  { family: "flooring", subtype: "tile", quantity: 1 },
  { family: "lighting", quantity: 1 },
  { family: "furniture", subtype: "table", quantity: 1 },
  { family: "furniture", subtype: "chair", quantity: 2 },
  { family: "home_accessories", subtype: "vase", quantity: 1 },
];

const DINING_ROOM_SLOTS: RequiredSlot[] = [
  { family: "flooring", quantity: 1 },
  { family: "lighting", quantity: 1 },
  { family: "furniture", subtype: "dining_table", quantity: 1 },
  { family: "furniture", subtype: "chair", quantity: 4 },
  { family: "home_accessories", subtype: "vase", quantity: 1 },
];

const BATHROOM_SLOTS: RequiredSlot[] = [
  { family: "flooring", subtype: "tile", quantity: 1 },
  { family: "lighting", quantity: 1 },
];

const HOME_OFFICE_SLOTS: RequiredSlot[] = [
  { family: "flooring", quantity: 1 },
  { family: "lighting", quantity: 1 },
  { family: "furniture", subtype: "desk", quantity: 1 },
  { family: "furniture", subtype: "chair", quantity: 1 },
  { family: "home_accessories", subtype: "decorative_plant", quantity: 1 },
];

const CHILDRENS_ROOM_SLOTS: RequiredSlot[] = [
  { family: "flooring", quantity: 1 },
  { family: "window_treatments", subtype: "curtain", quantity: 1 },
  { family: "lighting", quantity: 1 },
  { family: "furniture", subtype: "bed", quantity: 1 },
  { family: "furniture", subtype: "desk", quantity: 1 },
  { family: "home_accessories", subtype: "decorative_plant", quantity: 1 },
];

const HALLWAY_SLOTS: RequiredSlot[] = [
  { family: "flooring", quantity: 1 },
  { family: "lighting", quantity: 1 },
];

const STUDIO_APARTMENT_SLOTS: RequiredSlot[] = [
  { family: "flooring", quantity: 1 },
  { family: "window_treatments", subtype: "curtain", quantity: 1 },
  { family: "lighting", quantity: 1 },
  { family: "furniture", subtype: "sofa", quantity: 1 },
  { family: "furniture", subtype: "coffee_table", quantity: 1 },
  { family: "furniture", subtype: "bed", quantity: 1 },
  { family: "home_accessories", subtype: "decorative_plant", quantity: 1 },
];

const OUTDOOR_PATIO_SLOTS: RequiredSlot[] = [
  { family: "flooring", quantity: 1 },
  { family: "lighting", quantity: 1 },
  { family: "furniture", subtype: "chair", quantity: 2 },
  { family: "furniture", subtype: "table", quantity: 1 },
];

const ROOM_SLOT_TEMPLATES: Record<RoomType, RequiredSlot[]> = {
  "living room": LIVING_ROOM_SLOTS,
  bedroom: BEDROOM_SLOTS,
  kitchen: KITCHEN_SLOTS,
  bathroom: BATHROOM_SLOTS,
  "dining room": DINING_ROOM_SLOTS,
  "home office": HOME_OFFICE_SLOTS,
  "children's room": CHILDRENS_ROOM_SLOTS,
  hallway: HALLWAY_SLOTS,
  "outdoor patio": OUTDOOR_PATIO_SLOTS,
  "studio apartment": STUDIO_APARTMENT_SLOTS,
};

/** Canonical slot kit for a room type — server-owned, not Claude-driven. */
export function getRoomSlotTemplate(roomType: string, windowCount?: number | null): RequiredSlot[] {
  const canonical = normalizeRoomTypeValue(roomType);
  const template = ROOM_SLOT_TEMPLATES[canonical];
  const slots = template.map((s) => ({ ...s }));
  if (windowCount != null && windowCount <= 0) {
    return slots.filter((s) => s.family !== "window_treatments");
  }
  return slots;
}

export interface MergeRoomSlotsOptions {
  template: RequiredSlot[];
  extras?: RequiredSlot[];
}

/**
 * Merge template (wins on family+subtype conflict) with optional Claude extras.
 * For flooring: only one slot kept per room — extras override the template.
 */
export function mergeRoomSlots(opts: MergeRoomSlotsOptions): RequiredSlot[] {
  const merged = new Map<string, RequiredSlot>();

  for (const s of opts.template) {
    merged.set(slotKey(normalizeSlot(s)), normalizeSlot(s));
  }

  for (const s of opts.extras ?? []) {
    const normalized = normalizeSlot(s);
    const key = slotKey(normalized);
    if (normalized.family === "flooring") {
      for (const [k, v] of merged) {
        if (v.family === "flooring") merged.delete(k);
      }
      merged.set(key, normalized);
    } else if (!merged.has(key)) {
      merged.set(key, normalized);
    }
  }

  return [...merged.values()];
}

/**
 * Drop slots whose category is already covered by a user-uploaded product, so the
 * catalog resolver does not place a competing item next to the user's own piece.
 * Coverage: flooring uploads clear all flooring slots; otherwise a slot is covered
 * on exact family+subtype match, or when the slot has no subtype in the same family
 * (e.g. an uploaded chandelier covers a generic "lighting" slot).
 */
export function excludeSlotsCoveredByUploads(
  slots: RequiredSlot[],
  uploadSlots: RequiredSlot[],
): RequiredSlot[] {
  if (uploadSlots.length === 0) return slots;
  const uploads = uploadSlots.map(normalizeSlot);
  const uploadKeys = new Set(uploads.map(slotKey));
  const uploadFamilies = new Set(uploads.map((s) => s.family));
  const hasFlooringUpload = uploadFamilies.has("flooring");

  return slots.filter((s) => {
    const normalized = normalizeSlot(s);
    if (hasFlooringUpload && normalized.family === "flooring") return false;
    if (uploadKeys.has(slotKey(normalized))) return false;
    if (normalized.subtype === undefined && uploadFamilies.has(normalized.family)) return false;
    return true;
  });
}
