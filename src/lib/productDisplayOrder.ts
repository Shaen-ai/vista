/** Procurement display band for products-in-render lists (lower = earlier). */
export const PRODUCT_DISPLAY_BAND = {
  flooring: 10,
  walls: 20,
  windowTreatments: 30,
  lighting: 40,
  furniture: 50,
  decor: 60,
  other: 70,
} as const;

export type ProductDisplayBand = (typeof PRODUCT_DISPLAY_BAND)[keyof typeof PRODUCT_DISPLAY_BAND];

const FLOORING_RE =
  /\b(floor|flooring|laminate|parquet|hardwood|vinyl|spc|lvt|carpet|rug|tile|ceramic|porcelain|ковролин|ламинат|паркет|плитк)/i;
const WALLS_RE =
  /\b(wallpaper|wall paper|wall panel|wainscot|paint|plaster|обои|панел|штукатур)/i;
const WINDOW_RE = /\b(curtain|drape|blind|sheer|штор|жалюзи)/i;
const LIGHTING_RE = /\b(light|lamp|chandelier|sconce|pendant|luminaire|люстр|светильник)/i;
const FURNITURE_RE =
  /\b(sofa|chair|table|bed|wardrobe|cabinet|shelf|desk|seating|storage|furniture|диван|кровать|стол|шкаф)/i;
const DECOR_RE = /\b(decor|vase|mirror|plant|accessory|sculpture|подушк|декор)/i;

/**
 * Sort key for marketplace product rows — flooring first, then walls, curtains, lighting, furniture, decor.
 */
export function catalogCategorySortKey(category: string, name: string): number {
  const hay = `${category} ${name}`.toLowerCase();
  if (FLOORING_RE.test(hay)) return PRODUCT_DISPLAY_BAND.flooring;
  if (WALLS_RE.test(hay)) return PRODUCT_DISPLAY_BAND.walls;
  if (WINDOW_RE.test(hay)) return PRODUCT_DISPLAY_BAND.windowTreatments;
  if (LIGHTING_RE.test(hay)) return PRODUCT_DISPLAY_BAND.lighting;
  if (FURNITURE_RE.test(hay)) return PRODUCT_DISPLAY_BAND.furniture;
  if (DECOR_RE.test(hay)) return PRODUCT_DISPLAY_BAND.decor;
  return PRODUCT_DISPLAY_BAND.other;
}

export function productDisplayBandFromCategory(category: string, name: string): ProductDisplayBand {
  const key = catalogCategorySortKey(category, name);
  const entry = Object.entries(PRODUCT_DISPLAY_BAND).find(([, v]) => v === key);
  return (entry?.[1] ?? PRODUCT_DISPLAY_BAND.other) as ProductDisplayBand;
}

export interface SortableProductRow {
  id: number;
  name: string;
  category?: string | null;
}

export function sortProductsForDisplay<T extends SortableProductRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const bandA = catalogCategorySortKey(a.category ?? "", a.name);
    const bandB = catalogCategorySortKey(b.category ?? "", b.name);
    if (bandA !== bandB) return bandA - bandB;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
