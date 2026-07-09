/** Map free-form slot subtypes (from Claude briefs) to canonical catalog taxonomy slugs. */
const ALIASES: Record<string, string> = {
  armchair: "chair",
  accent_chair: "chair",
  "accent chair": "chair",
  recliner: "chair",
  "coffee table": "coffee_table",
  coffee_table: "coffee_table",
  "side table": "coffee_table",
  side_table: "coffee_table",
  "console table": "coffee_table",
  console_table: "coffee_table",
  "dining table": "dining_table",
  dining_table: "dining_table",
  "tv stand": "tv_stand",
  tv_stand: "tv_stand",
  "media unit": "tv_stand",
  media_unit: "tv_stand",
  media_console: "tv_stand",
  media_console_low: "tv_stand",
  storage_ottoman: "storage",
  ottoman: "storage",
  sheer_linen_panels: "sheer",
  sheer_linen: "sheer",
  accent_wall_paint: "wallpaper",
  accent_wall: "wallpaper",
  wall_paint: "wallpaper",
  "area rug": "rug",
  area_rug: "rug",
  carpet: "carpet",
  rug: "rug",
  chandelier: "ceiling",
  "pendant ceiling light": "pendant",
  pendant_ceiling_light: "pendant",
  "pendant light": "pendant",
  pendant_light: "pendant",
  "arc floor lamp": "floor",
  arc_floor_lamp: "floor",
  "floor lamp": "floor",
  floor_lamp: "floor",
  "table lamp": "table",
  table_lamp: "table",
  "ceiling light": "ceiling",
  ceiling_light: "ceiling",
  "floor-length drape curtains": "curtain",
  floor_length_drape_curtains: "curtain",
  "drape curtains": "curtain",
  drape_curtains: "curtain",
  drapes: "curtain",
  drape: "curtain",
  curtains: "curtain",
  curtain: "curtain",
  blinds: "blind",
  blind: "blind",
  "accent wall finish": "wallpaper",
  accent_wall_finish: "wallpaper",
  "wall panel": "wall_panel",
  wall_panel: "wall_panel",
  wallpaper: "wallpaper",
  "decorative planter with plant": "vase",
  decorative_planter_with_plant: "vase",
  planter: "vase",
  vase: "vase",
  laminate: "laminate",
  parquet: "parquet",
  tile: "tile",
  vinyl: "vinyl",
  sofa: "sofa",
  bed: "bed",
  desk: "desk",
  wardrobe: "wardrobe",
  storage: "storage",
  chair: "chair",
  table: "table",
  ceiling: "ceiling",
  pendant: "pendant",
  floor: "floor",
  wall: "wall",
  sheer: "sheer",
};

function tokenizeSubtype(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, "_")
    .replace(/_+/g, "_");
}

export function normalizeCatalogSubtype(
  family: string | undefined | null,
  subtype: string | undefined | null,
): string | undefined {
  if (!subtype || !subtype.trim() || subtype.trim().toLowerCase() === "other") {
    return undefined;
  }

  const raw = tokenizeSubtype(subtype);
  if (ALIASES[raw]) return ALIASES[raw];

  const withSpaces = raw.replace(/_/g, " ");
  if (ALIASES[withSpaces]) return ALIASES[withSpaces];

  const fam = (family ?? "").toLowerCase();

  if (fam === "lighting") {
    if (raw.includes("chandelier") || raw.includes("ceiling")) return "ceiling";
    if (raw.includes("pendant")) return "pendant";
    if (raw.includes("floor") && raw.includes("lamp")) return "floor";
    if (raw.includes("table") && raw.includes("lamp")) return "table";
  }

  if (fam === "window_treatments") {
    if (raw.includes("sheer")) return "sheer";
    if (raw.includes("curtain") || raw.includes("drape")) return "curtain";
    if (raw.includes("blind")) return "blind";
  }

  if (fam === "walls") {
    if (raw.includes("wallpaper") || raw.includes("wall_paper")) return "wallpaper";
    if (raw.includes("panel")) return "wall_panel";
    if (raw.includes("paint") || raw.includes("accent_wall")) return "wallpaper";
  }

  if (fam === "flooring") {
    if (raw.includes("rug") || raw.includes("carpet")) {
      return raw.includes("carpet") ? "carpet" : "rug";
    }
    if (raw.includes("laminate") || raw.includes("parquet")) {
      return raw.includes("parquet") ? "parquet" : "laminate";
    }
    if (raw.includes("tile")) return "tile";
  }

  if (fam === "furniture") {
    if (raw.includes("coffee") && raw.includes("table")) return "coffee_table";
    if (raw.includes("side") && raw.includes("table")) return "coffee_table";
    if (raw.includes("tv") && raw.includes("stand")) return "tv_stand";
    if (raw.includes("armchair") || raw === "chair") return "chair";
    if (raw.includes("sofa") || raw.includes("sectional")) return "sofa";
    if (raw.includes("ottoman")) return "storage";
    if (raw.includes("media") && raw.includes("console")) return "tv_stand";
  }

  return raw;
}

export function normalizeRequiredSlotSubtype(
  family: string,
  subtype: string | undefined,
): string | undefined {
  return normalizeCatalogSubtype(family, subtype);
}
