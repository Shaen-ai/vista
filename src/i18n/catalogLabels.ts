"use client";

import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { STYLE_PRESETS } from "@/lib/project/stylePresets";
import { ROOM_TYPES, normalizeRoomTypeValue, normalizeRoomShapeValue, normalizeCeilingTypeValue, ROOM_SHAPES, CEILING_TYPES } from "@/lib/interiorDesignPrompts";

const QUICK_STYLE_IDS = [
  "modern",
  "minimalist",
  "classic",
  "scandinavian",
  "industrial",
  "bohemian",
  "japandi",
  "mid-century",
] as const;

const QUICK_STYLE_KEY: Record<string, string> = {
  modern: "stylePreset.modern",
  minimalist: "stylePreset.minimalist",
  classic: "stylePreset.classic",
  scandinavian: "stylePreset.scandinavian",
  industrial: "stylePreset.industrial",
  bohemian: "stylePreset.bohemian",
  japandi: "stylePreset.japandi",
  "mid-century": "stylePreset.midCentury",
};

const PROJECT_ROOM_TYPE_KEY: Record<string, string> = {
  hallway: "project.roomTypeHallway",
  living: "project.roomTypeLiving",
  "living room": "project.roomTypeLiving",
  kitchen: "project.roomTypeKitchen",
  bedroom: "project.roomTypeBedroom",
  children: "project.roomTypeChildren",
  bathroom: "project.roomTypeBathroom",
  toilet: "project.roomTypeToilet",
  laundry: "project.roomTypeLaundry",
  balcony: "project.roomTypeBalcony",
  dining: "project.roomTypeDining",
  office: "project.roomTypeOffice",
  wardrobe: "project.roomTypeWardrobe",
  storage: "project.roomTypeStorage",
  other: "project.roomTypeOther",
};

const ROOM_TYPE_KEY: Record<string, string> = {
  "living room": "roomType.livingRoom",
  bedroom: "roomType.bedroom",
  kitchen: "roomType.kitchen",
  bathroom: "roomType.bathroom",
  "dining room": "roomType.diningRoom",
  "home office": "roomType.homeOffice",
  "children's room": "roomType.childrenRoom",
  hallway: "roomType.hallway",
  "outdoor patio": "roomType.outdoorPatio",
  "studio apartment": "roomType.studioApartment",
};

const ROOM_SHAPE_KEY: Record<string, string> = {
  rectangular: "roomShape.rectangular",
  "l-shaped": "roomShape.lShaped",
  "u-shaped": "roomShape.uShaped",
  "open plan": "roomShape.openPlan",
  square: "roomShape.square",
  irregular: "roomShape.irregular",
};

const CEILING_TYPE_KEY: Record<string, string> = {
  flat: "ceilingTypeValues.flat",
  vaulted: "ceilingTypeValues.vaulted",
  beamed: "ceilingTypeValues.beamed",
  sloped: "ceilingTypeValues.sloped",
  coffered: "ceilingTypeValues.coffered",
  tray: "ceilingTypeValues.tray",
  exposed: "ceilingTypeValues.exposed",
  suspended: "ceilingTypeValues.suspended",
};

const STYLE_PRESET_KEY: Record<string, { label: string; desc: string }> = {
  "modern-neutral": { label: "stylePreset.modernNeutral", desc: "stylePreset.modernNeutralDesc" },
  japandi: { label: "stylePreset.japandi", desc: "stylePreset.japandiDesc" },
  "dark-luxury": { label: "stylePreset.darkLuxury", desc: "stylePreset.darkLuxuryDesc" },
  scandinavian: { label: "stylePreset.scandinavian", desc: "stylePreset.scandinavianDesc" },
  "mid-century": { label: "stylePreset.midCentury", desc: "stylePreset.midCenturyDesc" },
  contemporary: { label: "stylePreset.contemporaryElegant", desc: "stylePreset.contemporaryElegantDesc" },
  classic: { label: "stylePreset.classicTraditional", desc: "stylePreset.classicTraditionalDesc" },
  industrial: { label: "stylePreset.industrialLoft", desc: "stylePreset.industrialLoftDesc" },
};

export function useCatalogLabels() {
  const { t } = useTranslation();

  return {
    quickStyleLabel: (id: string, fallback: string) => {
      const key = QUICK_STYLE_KEY[id];
      return key ? t(key) : fallback;
    },
    roomTypeLabel: (value: string) => {
      const normalized = normalizeRoomTypeValue(value);
      const key = ROOM_TYPE_KEY[normalized];
      return key ? t(key) : value;
    },
    roomShapeLabel: (value: string) => {
      const normalized = normalizeRoomShapeValue(value);
      const key = ROOM_SHAPE_KEY[normalized];
      return key ? t(key) : value;
    },
    ceilingTypeLabel: (value: string) => {
      const normalized = normalizeCeilingTypeValue(value);
      const key = CEILING_TYPE_KEY[normalized];
      return key ? t(key) : value;
    },
    projectRoomTypeLabel: (type: string) => {
      const key = PROJECT_ROOM_TYPE_KEY[type.toLowerCase()];
      return key ? t(key) : type;
    },
    stylePresetLabel: (id: string) => {
      const keys = STYLE_PRESET_KEY[id];
      const preset = STYLE_PRESETS.find((s) => s.id === id);
      return keys ? t(keys.label) : (preset?.label ?? id);
    },
    stylePresetDescription: (id: string) => {
      const keys = STYLE_PRESET_KEY[id];
      const preset = STYLE_PRESETS.find((s) => s.id === id);
      return keys ? t(keys.desc) : (preset?.description ?? "");
    },
    quickStyles: QUICK_STYLE_IDS.map((id) => ({
      id,
      label: t(QUICK_STYLE_KEY[id] ?? "page.style"),
    })),
  };
}

export { QUICK_STYLE_IDS, ROOM_TYPES, ROOM_SHAPES, CEILING_TYPES };
