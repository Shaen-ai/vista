/**
 * Data aggregation helpers for Full Project PDF assembly.
 */

import type {
  FloorPlanAnalysis,
  MarketplaceMatch,
  MasterDesignConcept,
  ProjectState,
  RoomResult,
} from "./types";
import type { VistaLocale } from "@/i18n/locales";
import { translate } from "@/i18n/translate";

const WET_ROOM_TYPES = new Set(["kitchen", "bathroom", "toilet", "laundry"]);

export interface CatalogRow {
  roomName: string;
  category: string;
  name: string;
  material: string;
  color: string;
  quantity: number;
  dimensions: string;
  price: number | null;
  currency: string;
  marketplaceId: number | null;
  url: string | null;
  imageUrl: string | null;
}

/** Per-room product row for inline PDF room product pages. */
export interface RoomProductRow {
  category: string;
  name: string;
  material: string;
  price: number | null;
  currency: string;
  marketplaceId: number | null;
  url: string | null;
  imageUrl: string | null;
}

export interface FinishScheduleRow {
  roomName: string;
  surface: string;
  material: string;
  code: string;
  productName: string | null;
  url: string | null;
}

export interface BudgetLineItem {
  roomName: string;
  category: string;
  name: string;
  price: number;
  currency: string;
}

export interface BudgetSummary {
  total: number;
  currency: string;
  itemCount: number;
  lines: BudgetLineItem[];
  byRoom: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface TocEntry {
  key: string;
  title: string;
  section: string;
}

export function hasWetRooms(analysis: FloorPlanAnalysis | null): boolean {
  if (!analysis) return false;
  return analysis.rooms.some((r) => WET_ROOM_TYPES.has(r.type));
}

export function surfaceLabel(locale: VistaLocale, surface: string): string {
  const key = `pdf.surface.${surface}`;
  const t = translate(locale, key);
  return t !== key ? t : surface;
}

export function collectCatalogRows(rooms: RoomResult[]): CatalogRow[] {
  const rows: CatalogRow[] = [];
  const seen = new Set<number>();

  for (const room of rooms) {
    if (room.status !== "approved") continue;
    const mat = room.materials;
    if (!mat) continue;

    for (const item of mat.keyFurniture) {
      const sp = item.suggestedProduct;
      if (sp && sp.marketplaceId > 0) {
        if (seen.has(sp.marketplaceId)) continue;
        seen.add(sp.marketplaceId);
        rows.push({
          roomName: room.brief.roomName,
          category: item.category,
          name: sp.name,
          material: item.name,
          color: mat.wallColor.ncs,
          quantity: 1,
          dimensions: "—",
          price: sp.price > 0 ? sp.price : null,
          currency: sp.currency || "AMD",
          marketplaceId: sp.marketplaceId,
          url: sp.url || null,
          imageUrl: sp.imageUrl,
        });
      } else {
        rows.push({
          roomName: room.brief.roomName,
          category: item.category,
          name: item.name,
          material: item.name,
          color: mat.wallColor.ncs,
          quantity: 1,
          dimensions: "—",
          price: null,
          currency: "AMD",
          marketplaceId: null,
          url: null,
          imageUrl: null,
        });
      }
    }

    const pushListing = (
      listing: MarketplaceMatch | undefined,
      category: string,
      materialType: string,
    ) => {
      if (!listing || listing.marketplaceId <= 0 || seen.has(listing.marketplaceId)) return;
      seen.add(listing.marketplaceId);
      rows.push({
        roomName: room.brief.roomName,
        category,
        name: listing.name,
        material: materialType,
        color: mat.wallColor.ncs,
        quantity: 1,
        dimensions: "—",
        price: listing.price > 0 ? listing.price : null,
        currency: listing.currency || "AMD",
        marketplaceId: listing.marketplaceId,
        url: listing.url || null,
        imageUrl: listing.imageUrl,
      });
    };

    pushListing(mat.floorMaterial.scrapedListing, "Flooring", mat.floorMaterial.type);
    pushListing(mat.tileMaterial?.scrapedListing, "Tile", mat.tileMaterial?.type ?? "Tile");

    for (const sp of room.usedScrapedProducts) {
      if (sp.marketplaceId <= 0 || seen.has(sp.marketplaceId)) continue;
      seen.add(sp.marketplaceId);
      rows.push({
        roomName: room.brief.roomName,
        category: "Product",
        name: sp.name,
        material: "—",
        color: mat.wallColor.ncs,
        quantity: 1,
        dimensions: "—",
        price: sp.price > 0 ? sp.price : null,
        currency: sp.currency || "AMD",
        marketplaceId: sp.marketplaceId,
        url: sp.url || null,
        imageUrl: sp.imageUrl,
      });
    }
  }

  return rows;
}

/** Collect all purchasable products for a single room (deduped by marketplaceId). */
export function collectRoomProductRows(room: RoomResult): RoomProductRow[] {
  const rows: RoomProductRow[] = [];
  const seen = new Set<number>();
  const mat = room.materials;

  const pushListing = (
    listing: MarketplaceMatch | undefined,
    category: string,
    material: string,
    fallbackName?: string,
    fallbackUrl?: string | null,
    fallbackPrice?: number | null,
    fallbackImageUrl?: string | null,
  ) => {
    const marketplaceId = listing?.marketplaceId ?? null;
    if (marketplaceId != null && marketplaceId > 0) {
      if (seen.has(marketplaceId)) return;
      seen.add(marketplaceId);
      rows.push({
        category,
        name: listing!.name,
        material,
        price: listing!.price > 0 ? listing!.price : null,
        currency: listing!.currency || "AMD",
        marketplaceId,
        url: listing!.url || null,
        imageUrl: listing!.imageUrl ?? null,
      });
      return;
    }
    const name = fallbackName ?? listing?.name;
    const url = fallbackUrl ?? listing?.url ?? null;
    if (!name && !url) return;
    rows.push({
      category,
      name: name ?? "—",
      material,
      price: fallbackPrice ?? (listing?.price && listing.price > 0 ? listing.price : null),
      currency: listing?.currency || "AMD",
      marketplaceId: null,
      url,
      imageUrl: fallbackImageUrl ?? listing?.imageUrl ?? null,
    });
  };

  if (mat) {
    const floorUrl = mat.floorMaterial.productUrl ?? mat.floorMaterial.scrapedListing?.url ?? null;
    if (mat.floorMaterial.scrapedListing) {
      pushListing(mat.floorMaterial.scrapedListing, "Flooring", mat.floorMaterial.type);
    } else if (mat.floorMaterial.productName || floorUrl) {
      pushListing(
        undefined,
        "Flooring",
        mat.floorMaterial.type,
        mat.floorMaterial.productName ?? mat.floorMaterial.type,
        floorUrl,
        mat.floorMaterial.price ?? null,
      );
    }

    if (mat.tileMaterial) {
      const tileUrl = mat.tileMaterial.productUrl ?? mat.tileMaterial.scrapedListing?.url ?? null;
      if (mat.tileMaterial.scrapedListing) {
        pushListing(mat.tileMaterial.scrapedListing, "Tile", mat.tileMaterial.type);
      } else if (mat.tileMaterial.productName || tileUrl) {
        pushListing(
          undefined,
          "Tile",
          mat.tileMaterial.type,
          mat.tileMaterial.productName ?? mat.tileMaterial.type,
          tileUrl,
          mat.tileMaterial.price ?? null,
          mat.tileMaterial.imageUrl ?? null,
        );
      }
    }

    for (const item of mat.keyFurniture) {
      if (item.suggestedProduct) {
        pushListing(item.suggestedProduct, item.category, item.name);
      } else if (item.name) {
        rows.push({
          category: item.category,
          name: item.name,
          material: item.name,
          price: null,
          currency: "AMD",
          marketplaceId: null,
          url: null,
          imageUrl: null,
        });
      }
    }
  }

  for (const sp of room.usedScrapedProducts) {
    pushListing(sp, "Product", "—");
  }

  return rows;
}

export function collectFinishSchedule(
  rooms: RoomResult[],
  concept: MasterDesignConcept | null,
  locale: VistaLocale,
): FinishScheduleRow[] {
  const rows: FinishScheduleRow[] = [];

  for (const room of rooms) {
    if (room.status !== "approved") continue;
    const mat = room.materials;
    const brief = room.brief;

    rows.push({
      roomName: room.brief.roomName,
      surface: surfaceLabel(locale, "walls"),
      material: brief.wallColor.ncs,
      code: brief.wallColor.ncs,
      productName: mat?.wallColor.paintBrand ?? null,
      url: null,
    });

    rows.push({
      roomName: room.brief.roomName,
      surface: surfaceLabel(locale, "floor"),
      material: mat?.floorMaterial.type ?? brief.floorMaterial,
      code: mat?.wallColor.ncs ?? brief.wallColor.ncs,
      productName: mat?.floorMaterial.productName ?? null,
      url: mat?.floorMaterial.productUrl ?? mat?.floorMaterial.scrapedListing?.url ?? null,
    });

    if (mat?.tileMaterial) {
      rows.push({
        roomName: room.brief.roomName,
        surface: surfaceLabel(locale, "tile"),
        material: mat.tileMaterial.type,
        code: "—",
        productName: mat.tileMaterial.productName ?? null,
        url: mat.tileMaterial.productUrl ?? mat.tileMaterial.scrapedListing?.url ?? null,
      });
    }

    rows.push({
      roomName: room.brief.roomName,
      surface: surfaceLabel(locale, "ceiling"),
      material: brief.ceilingDesign,
      code: "—",
      productName: null,
      url: null,
    });
  }

  if (concept?.materialPalette) {
    const mp = concept.materialPalette;
    rows.push({
      roomName: translate(locale, "pdf.allRooms"),
      surface: surfaceLabel(locale, "wood"),
      material: mp.woodType,
      code: "—",
      productName: null,
      url: null,
    });
    rows.push({
      roomName: translate(locale, "pdf.allRooms"),
      surface: surfaceLabel(locale, "metal"),
      material: mp.metalFinish,
      code: "—",
      productName: null,
      url: null,
    });
    rows.push({
      roomName: translate(locale, "pdf.allRooms"),
      surface: surfaceLabel(locale, "textile"),
      material: mp.textilePrimary,
      code: "—",
      productName: null,
      url: null,
    });
  }

  return rows;
}

export function computeBudgetSummary(rooms: RoomResult[]): BudgetSummary {
  const lines: BudgetLineItem[] = [];
  const byRoom: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let currency = "AMD";

  for (const room of rooms) {
    if (room.status !== "approved") continue;
    for (const sp of room.usedScrapedProducts) {
      currency = sp.currency || currency;
      if (sp.price > 0) {
        lines.push({
          roomName: room.brief.roomName,
          category: "Product",
          name: sp.name,
          price: sp.price,
          currency: sp.currency || currency,
        });
        byRoom[room.brief.roomName] = (byRoom[room.brief.roomName] ?? 0) + sp.price;
        byCategory["Product"] = (byCategory["Product"] ?? 0) + sp.price;
      }
    }

    const mat = room.materials;
    if (!mat) continue;

    const addPrice = (price: number | undefined, category: string, name: string) => {
      if (!price || price <= 0) return;
      lines.push({ roomName: room.brief.roomName, category, name, price, currency });
      byRoom[room.brief.roomName] = (byRoom[room.brief.roomName] ?? 0) + price;
      byCategory[category] = (byCategory[category] ?? 0) + price;
    };

    addPrice(mat.floorMaterial.price, "Flooring", mat.floorMaterial.productName ?? mat.floorMaterial.type);
    addPrice(mat.tileMaterial?.price, "Tile", mat.tileMaterial?.productName ?? mat.tileMaterial?.type ?? "Tile");
    for (const kf of mat.keyFurniture) {
      const name = kf.suggestedProduct?.name ?? kf.name;
      if (kf.suggestedProduct?.price) {
        addPrice(kf.suggestedProduct.price, kf.category, name);
      } else if (name) {
        lines.push({ roomName: room.brief.roomName, category: kf.category, name, price: 0, currency });
      }
    }

    for (const sp of room.usedScrapedProducts) {
      if (sp.price > 0) continue;
      if (lines.some((l) => l.name === sp.name && l.roomName === room.brief.roomName)) continue;
      lines.push({
        roomName: room.brief.roomName,
        category: "Product",
        name: sp.name,
        price: 0,
        currency: sp.currency || currency,
      });
    }
  }

  const total = lines.reduce((s, l) => s + l.price, 0);
  return { total, currency, itemCount: lines.length, lines, byRoom, byCategory };
}

export function buildTocEntries(
  project: ProjectState,
  locale: VistaLocale,
  opts: {
    hasPlumbing: boolean;
    elevationCount: number;
    catalogCount: number;
    include?: {
      renderGallery?: boolean;
      finishSchedule?: boolean;
      technical?: boolean;
      elevations?: boolean;
      budget?: boolean;
    };
  },
): TocEntry[] {
  const t = (key: string) => translate(locale, key);
  const inc = opts.include ?? {};
  // Section numbers are assigned sequentially so deselecting a section never
  // leaves a gap in the table of contents.
  const entries: Omit<TocEntry, "section">[] = [
    { key: "cover", title: t("pdf.toc.cover") },
    { key: "toc", title: t("pdf.toc.index") },
    { key: "concept", title: t("pdf.toc.concept") },
  ];
  if (inc.renderGallery !== false) {
    entries.push({ key: "renders", title: t("pdf.toc.renders") });
  }
  if (opts.catalogCount > 0) {
    entries.push({ key: "catalog", title: t("pdf.toc.catalog") });
  }
  if (inc.finishSchedule !== false) {
    entries.push({ key: "finishSchedule", title: t("pdf.toc.finishSchedule") });
  }
  if (inc.technical !== false) {
    entries.push({ key: "technical", title: t("pdf.toc.technical") });
  }
  if (opts.elevationCount > 0 && inc.elevations !== false) {
    entries.push({ key: "elevations", title: t("pdf.toc.elevations") });
  }
  entries.push({ key: "contractor", title: t("pdf.toc.contractor") });
  if (inc.budget !== false) {
    entries.push({ key: "budget", title: t("pdf.toc.budget") });
  }
  return entries.map((e, i) => ({ ...e, section: String(i + 1) }));
}

/** Fetch remote product image as base64 data URI for react-pdf. */
export async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/jpeg";
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function enrichCatalogWithImages(rows: CatalogRow[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  await Promise.all(
    rows.map(async (row) => {
      if (!row.imageUrl || !row.marketplaceId) return;
      const uri = await fetchImageAsDataUri(row.imageUrl);
      if (uri) map.set(row.marketplaceId, uri);
    }),
  );
  return map;
}

/** Merge catalog + per-room product thumbnails for PDF rendering. */
export async function enrichProductImages(
  catalogRows: CatalogRow[],
  roomProductRows: RoomProductRow[],
): Promise<Map<number, string>> {
  const map = await enrichCatalogWithImages(catalogRows);
  await Promise.all(
    roomProductRows.map(async (row) => {
      if (!row.imageUrl || !row.marketplaceId || map.has(row.marketplaceId)) return;
      const uri = await fetchImageAsDataUri(row.imageUrl);
      if (uri) map.set(row.marketplaceId, uri);
    }),
  );
  return map;
}
