/**
 * Phase 5 — PDF Assembly.
 *
 * Professional interior design PDF: cover, concept, renders, catalog,
 * finish schedule, technical plans, elevations, contractor notes, budget.
 */

import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  Link,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { planTitle } from "@/i18n/planTitle";
import { translate } from "@/i18n/translate";
import { DEFAULT_LOCALE, isVistaLocale, type VistaLocale } from "@/i18n/locales";
import type { ProjectState, RoomResult, TechnicalDrawingsSet } from "./types";
import { renderAllPlans } from "./technicalDrawings";
import { prepareApprovedWallElevations } from "./approvedRoomPlanBuilder";
import { renderAllElevations } from "./elevationGenerator";
import { ensurePdfFontsRegistered, PDF_FONT_FAMILY } from "./pdfFonts";
import { svgToPngDataUri } from "./svgRaster";
import {
  collectCatalogRows,
  collectFinishSchedule,
  collectRoomProductRows,
  computeBudgetSummary,
  buildTocEntries,
  enrichProductImages,
  hasWetRooms,
  type RoomProductRow,
} from "./pdfDataHelpers";

const TECH_PLAN_KEY: Record<string, string> = {
  measurement: "measurement",
  furnitureLayout: "furniture",
  flooring: "flooring",
  ceiling: "ceiling",
  lighting: "lighting",
  electrical: "electrical",
  plumbing: "plumbing",
  gas: "gas",
  hvac: "hvac",
};

/** Landscape A4 usable body height (pt) below header + above footer. */
const PDF_BODY_HEIGHT_PT = 470;
/** Max raster width for technical SVG → PNG (keeps react-pdf Image within page). */
const PDF_PLAN_RASTER_WIDTH = 1100;

/**
 * Technical plans included in the final PDF, in order. Reflected Ceiling Plan
 * ("ceiling") and Heating & Ventilation ("hvac") are intentionally excluded —
 * Vista has no real HVAC/RCP input data to make them meaningful.
 */
const KEPT_PLAN_KEYS: (keyof TechnicalDrawingsSet)[] = [
  "measurement",
  "furnitureLayout",
  "flooring",
  "lighting",
  "electrical",
  "plumbing",
  "gas",
];

/**
 * PDF sections the user can include/exclude from the final export. Mandatory
 * pages (cover, table of contents, design concept, per-room pages, catalog,
 * contractor notes) are always present and not listed here.
 */
export type PdfSectionKey =
  | "renderGallery"
  | "measurement"
  | "furnitureLayout"
  | "flooring"
  | "lighting"
  | "electrical"
  | "plumbing"
  | "gas"
  | "finishSchedule"
  | "elevations"
  | "budget";

export const PDF_SECTION_KEYS: PdfSectionKey[] = [
  "renderGallery",
  "measurement",
  "furnitureLayout",
  "flooring",
  "lighting",
  "electrical",
  "plumbing",
  "gas",
  "finishSchedule",
  "elevations",
  "budget",
];

export type PdfSectionSelection = Partial<Record<PdfSectionKey, boolean>>;

/** Every section defaults to included; only an explicit `false` excludes one. */
function resolveSections(sel?: PdfSectionSelection): Record<PdfSectionKey, boolean> {
  const out = {} as Record<PdfSectionKey, boolean>;
  for (const key of PDF_SECTION_KEYS) out[key] = sel?.[key] !== false;
  return out;
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const s = StyleSheet.create({
  page: { flexDirection: "column", backgroundColor: "#FFFFFF", padding: 0, fontFamily: PDF_FONT_FAMILY },
  coverContainer: { flex: 1, flexDirection: "row" },
  coverImageSide: { width: "55%", padding: 30, justifyContent: "center", alignItems: "center" },
  coverImage: { width: "100%", height: "100%", objectFit: "cover", borderRadius: 4 },
  coverTextSide: { width: "45%", justifyContent: "center", paddingHorizontal: 40 },
  coverTitle: { fontSize: 32, fontWeight: "bold", color: "#222", marginBottom: 12 },
  coverSubtitle: { fontSize: 13, color: "#666", marginBottom: 6 },
  coverBrand: { fontSize: 10, color: "#AAA", marginTop: 24 },
  sectionHeader: {
    textAlign: "center",
    fontSize: 22,
    fontWeight: "bold",
    color: "#222",
    marginTop: 28,
    marginBottom: 16,
  },
  footer: {
    position: "absolute",
    bottom: 15,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 8,
    color: "#AAA",
  },
  roomHeader: { textAlign: "center", fontSize: 20, fontWeight: "bold", color: "#222", marginTop: 24, marginBottom: 14 },
  roomBody: { flexDirection: "row", paddingHorizontal: 30, gap: 14, height: PDF_BODY_HEIGHT_PT },
  renderImage: { objectFit: "cover", borderRadius: 4 },
  rendersColumn: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 10, height: PDF_BODY_HEIGHT_PT },
  ncsPanel: { width: 200, alignItems: "center", paddingTop: 8 },
  ncsLabel: { fontSize: 10, fontWeight: "bold", color: "#333", marginBottom: 4, textAlign: "center" },
  ncsCode: { fontSize: 9, color: "#555", marginBottom: 6, textAlign: "center" },
  ncsSwatch: { width: 64, height: 64, borderRadius: 4 },
  ncsSwatchSmall: { width: 48, height: 48, borderRadius: 4 },
  specBlock: { marginTop: 12, alignItems: "center", width: "100%" },
  specDetail: { fontSize: 7, color: "#555", textAlign: "center", marginTop: 2 },
  specLink: { fontSize: 7, color: "#1565C0", textDecoration: "underline", textAlign: "center", marginTop: 2 },
  roomProductsHeader: { textAlign: "center", fontSize: 16, fontWeight: "bold", color: "#222", marginTop: 20, marginBottom: 10 },
  designElementsBlock: { paddingHorizontal: 36, marginTop: 10, marginBottom: 8 },
  designElementItem: { fontSize: 8, color: "#444", marginBottom: 3 },
  collageContainer: { flexDirection: "row", padding: 28, gap: 10, height: PDF_BODY_HEIGHT_PT },
  collageLarge: { width: "40%", height: PDF_BODY_HEIGHT_PT, objectFit: "cover", borderRadius: 4 },
  collageRight: { width: "60%", height: PDF_BODY_HEIGHT_PT, flexDirection: "column", gap: 10 },
  collageSmall: { flex: 1, maxHeight: (PDF_BODY_HEIGHT_PT - 10) / 2, objectFit: "cover", borderRadius: 4 },
  techTitle: { textAlign: "center", fontSize: 18, fontWeight: "bold", color: "#222", marginTop: 24, marginBottom: 14 },
  techImageFrame: {
    height: PDF_BODY_HEIGHT_PT,
    marginHorizontal: 24,
    marginBottom: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  techImage: { width: "100%", height: PDF_BODY_HEIGHT_PT, objectFit: "contain" },
  tocRow: { flexDirection: "row", marginBottom: 6, paddingHorizontal: 36 },
  tocNum: { width: 28, fontSize: 10, color: "#666" },
  tocLabel: { flex: 1, fontSize: 10, color: "#222" },
  legendBlock: { marginTop: 20, paddingHorizontal: 36 },
  legendItem: { fontSize: 9, color: "#444", marginBottom: 4 },
  paletteRow: { flexDirection: "row", gap: 12, marginBottom: 12, paddingHorizontal: 36 },
  paletteSwatch: { width: 64, height: 64, borderRadius: 4 },
  paletteLabel: { fontSize: 8, color: "#555", marginTop: 4, textAlign: "center", maxWidth: 64 },
  conceptText: { fontSize: 10, color: "#444", lineHeight: 1.5, paddingHorizontal: 36, marginBottom: 8 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#222",
    paddingVertical: 6,
    paddingHorizontal: 36,
    marginTop: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#DDD",
    paddingVertical: 5,
    paddingHorizontal: 36,
    alignItems: "center",
  },
  th: { fontSize: 7, fontWeight: "bold", color: "#222" },
  td: { fontSize: 7, color: "#333" },
  catalogImg: { width: 36, height: 36, objectFit: "cover", borderRadius: 2 },
  galleryGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 28, gap: 10 },
  galleryItem: { width: "31%", marginBottom: 8 },
  galleryCaption: { fontSize: 7, color: "#666", textAlign: "center", marginTop: 4 },
  noteText: { fontSize: 9, color: "#444", lineHeight: 1.5, paddingHorizontal: 36, marginBottom: 8 },
  disclaimer: { fontSize: 8, color: "#888", fontStyle: "italic", paddingHorizontal: 36, marginTop: 12 },
});

function dataUri(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

function footerEl(t: TFn) {
  return React.createElement(Text, { style: s.footer }, t("pdf.footer"));
}

/** Only treat absolute http(s) URLs as clickable links; skip empty/relative ones. */
function isHttpUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

const clampText = { maxLines: 2, textOverflow: "ellipsis" as const };

/**
 * A fixed-width table cell. Content is wrapped in a width-owning View with the
 * Text/Link inside (no width), so long values wrap/clamp within the column
 * instead of overflowing into the next one.
 */
function textCell(value: string, width: string, clamp = false) {
  return React.createElement(
    View,
    { style: { width } },
    React.createElement(Text, { style: clamp ? { ...s.td, ...clampText } : s.td }, value),
  );
}

function linkCell(url: string | null | undefined, value: string, width: string) {
  return React.createElement(
    View,
    { style: { width } },
    isHttpUrl(url)
      ? React.createElement(
          Link,
          { src: url, style: { ...s.td, color: "#1565C0", textDecoration: "underline", ...clampText } },
          value,
        )
      : React.createElement(Text, { style: { ...s.td, ...clampText } }, value),
  );
}

function specLinkEl(url: string | null | undefined, label: string, t: TFn) {
  if (!isHttpUrl(url)) return null;
  return React.createElement(Link, { src: url, style: s.specLink }, label || t("pdf.viewInStore"));
}

function ncsSwatchBlock(label: string, ncs: string, hex: string, small = false) {
  return React.createElement(
    View,
    { style: s.specBlock },
    React.createElement(Text, { style: s.ncsLabel }, label),
    React.createElement(Text, { style: s.ncsCode }, ncs),
    React.createElement(View, { style: { ...(small ? s.ncsSwatchSmall : s.ncsSwatch), backgroundColor: hex } }),
  );
}

function materialSpecBlock(
  label: string,
  typeText: string,
  productName: string | null | undefined,
  url: string | null | undefined,
  t: TFn,
) {
  return React.createElement(
    View,
    { style: s.specBlock },
    React.createElement(Text, { style: s.ncsLabel }, label),
    React.createElement(Text, { style: s.specDetail }, typeText),
    productName ? React.createElement(Text, { style: s.specDetail }, productName) : null,
    specLinkEl(url, t("pdf.viewInStore"), t),
  );
}

function resolveLocale(project: ProjectState): VistaLocale {
  if (project.locale && isVistaLocale(project.locale)) return project.locale;
  return DEFAULT_LOCALE;
}

function CoverPage({ project, t }: { project: ProjectState; t: TFn }) {
  const heroRender = project.rooms.find((r) => r.renders.length > 0)?.renders[0];
  const concept = project.concept;
  const dateStr = new Date(project.createdAt).toLocaleDateString();
  const roomCount = project.concept?.rooms.length ?? project.rooms.length;

  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(
      View,
      { style: s.coverContainer },
      React.createElement(
        View,
        { style: s.coverImageSide },
        heroRender
          ? React.createElement(Image, {
              style: s.coverImage,
              src: dataUri(heroRender.base64, heroRender.mimeType),
            })
          : React.createElement(View, { style: { ...s.coverImage, backgroundColor: "#F0EDE8" } }),
      ),
      React.createElement(
        View,
        { style: s.coverTextSide },
        React.createElement(Text, { style: s.coverTitle }, concept?.projectName || t("project.designProjectFallback")),
        React.createElement(Text, { style: s.coverSubtitle }, `${t("pdf.coverDate")}: ${dateStr}`),
        React.createElement(Text, { style: s.coverSubtitle }, `${t("pdf.coverRooms")}: ${roomCount}`),
        React.createElement(
          Text,
          { style: s.coverSubtitle },
          `${t("pdf.coverArea")}: ${project.preferences.totalArea || project.analysis?.totalArea || "—"} m²`,
        ),
        project.preferences.address
          ? React.createElement(Text, { style: s.coverSubtitle }, `${t("pdf.coverAddress")}: ${project.preferences.address}`)
          : null,
        React.createElement(
          Text,
          { style: { ...s.coverSubtitle, marginTop: 12 } },
          `${t("pdf.coverStyle")}: ${concept?.overallStyle || project.preferences.style}`,
        ),
      ),
    ),
    footerEl(t),
  );
}

function TocPage({ entries, t }: { entries: { section: string; title: string }[]; t: TFn }) {
  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(Text, { style: s.sectionHeader }, t("pdf.tocTitle")),
    ...entries.map((e, i) =>
      React.createElement(
        View,
        { key: i, style: s.tocRow },
        React.createElement(Text, { style: s.tocNum }, e.section),
        React.createElement(Text, { style: s.tocLabel }, e.title),
      ),
    ),
    React.createElement(
      View,
      { style: s.legendBlock },
      React.createElement(Text, { style: { ...s.th, marginBottom: 8 } }, t("pdf.legendTitle")),
      React.createElement(Text, { style: s.legendItem }, t("pdf.legendSwitch")),
      React.createElement(Text, { style: s.legendItem }, t("pdf.legendSocket")),
      React.createElement(Text, { style: s.legendItem }, t("pdf.legendLight")),
      React.createElement(Text, { style: s.legendItem }, t("pdf.legendPlumbing")),
    ),
    footerEl(t),
  );
}

function ConceptPage({ project, t }: { project: ProjectState; t: TFn }) {
  const concept = project.concept;
  if (!concept) return null;
  const mp = concept.materialPalette;
  const colors = [concept.colorPalette.primary, concept.colorPalette.secondary, concept.colorPalette.accent, concept.colorPalette.neutral];

  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(Text, { style: s.sectionHeader }, t("pdf.conceptTitle")),
    React.createElement(Text, { style: s.conceptText }, `${t("pdf.conceptStyle")}: ${concept.overallStyle}`),
    React.createElement(Text, { style: { ...s.conceptText, fontWeight: "bold", marginTop: 8 } }, t("pdf.conceptPalette")),
    React.createElement(
      View,
      { style: s.paletteRow },
      ...colors.map((c, i) =>
        React.createElement(
          View,
          { key: i, style: { alignItems: "center" } },
          React.createElement(View, { style: { ...s.paletteSwatch, backgroundColor: c.hex } }),
          React.createElement(Text, { style: s.paletteLabel }, c.ncs),
        ),
      ),
    ),
    React.createElement(Text, { style: { ...s.conceptText, fontWeight: "bold", marginTop: 8 } }, t("pdf.conceptMaterials")),
    React.createElement(Text, { style: s.conceptText }, `${mp.woodType} · ${mp.metalFinish} · ${mp.stoneType}`),
    React.createElement(Text, { style: s.conceptText }, `${t("pdf.conceptTextiles")}: ${mp.textilePrimary}`),
    React.createElement(
      Text,
      { style: s.conceptText },
      `${t("pdf.conceptLighting")}: ${concept.rooms[0]?.lightingConcept ?? "—"}`,
    ),
    footerEl(t),
  );
}

function RenderGalleryPage({ rooms, t }: { rooms: RoomResult[]; t: TFn }) {
  const shots: { src: string; caption: string }[] = [];
  for (const room of rooms) {
    for (const r of room.renders) {
      const vt = r.viewType ?? "standard";
      const vtKey = `pdf.viewType.${vt}`;
      const vtLabel = t(vtKey);
      shots.push({
        src: dataUri(r.base64, r.mimeType),
        caption: `${room.brief.roomName} — ${vtLabel !== vtKey ? vtLabel : r.angleDescription}`,
      });
    }
  }
  if (shots.length === 0) return null;

  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(Text, { style: s.sectionHeader }, t("pdf.renderGalleryTitle")),
    React.createElement(
      View,
      { style: s.galleryGrid },
      ...shots.slice(0, 9).map((shot, i) =>
        React.createElement(
          View,
          { key: i, style: s.galleryItem },
          React.createElement(Image, { style: { width: "100%", height: 100, objectFit: "cover", borderRadius: 3 }, src: shot.src }),
          React.createElement(Text, { style: s.galleryCaption }, shot.caption),
        ),
      ),
    ),
    footerEl(t),
  );
}

function collectFurnitureLinksForRoom(room: RoomResult): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  const seen = new Set<number>();
  const push = (name: string, url: string | null | undefined, marketplaceId?: number) => {
    const trimmed = url?.trim();
    if (!trimmed) return;
    if (marketplaceId != null && marketplaceId > 0) {
      if (seen.has(marketplaceId)) return;
      seen.add(marketplaceId);
    }
    out.push({ name, url: trimmed });
  };

  const mat = room.materials;
  if (mat) {
    for (const item of mat.keyFurniture) {
      const sp = item.suggestedProduct;
      if (sp?.url) push(sp.name || item.name, sp.url, sp.marketplaceId);
    }
  }
  for (const sp of room.usedScrapedProducts) {
    push(sp.name, sp.url, sp.marketplaceId);
  }
  return out.slice(0, 3);
}

function RoomMainPage({ room, t }: { room: RoomResult; t: TFn }) {
  const renders = room.renders.slice(0, 3);
  const wc = room.materials?.wallColor ?? room.brief.wallColor;
  const fc = room.brief.furnitureColor;
  const mat = room.materials;
  const furnitureLinks = collectFurnitureLinksForRoom(room);
  const floorUrl = mat?.floorMaterial.productUrl ?? mat?.floorMaterial.scrapedListing?.url ?? null;
  const floorName = mat?.floorMaterial.productName ?? mat?.floorMaterial.scrapedListing?.name ?? null;
  const tileUrl = mat?.tileMaterial?.productUrl ?? mat?.tileMaterial?.scrapedListing?.url ?? null;
  const tileName = mat?.tileMaterial?.productName ?? mat?.tileMaterial?.scrapedListing?.name ?? null;

  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(Text, { style: s.roomHeader }, room.brief.roomName),
    React.createElement(
      View,
      { style: s.roomBody },
      React.createElement(
        View,
        { style: { ...s.rendersColumn, flex: 1 } },
        ...renders.map((r, i) =>
          React.createElement(Image, {
            key: i,
            style: {
              ...s.renderImage,
              width: renders.length === 1 ? "100%" : "48%",
              height: renders.length > 2 ? PDF_BODY_HEIGHT_PT / 2 - 8 : PDF_BODY_HEIGHT_PT,
            },
            src: dataUri(r.base64, r.mimeType),
          }),
        ),
      ),
      React.createElement(
        View,
        { style: s.ncsPanel },
        ncsSwatchBlock(t("project.walls"), wc.ncs, wc.hex),
        mat?.wallColor.paintBrand
          ? React.createElement(Text, { style: s.specDetail }, `${t("pdf.paintBrand")}: ${mat.wallColor.paintBrand}`)
          : null,
        furnitureLinks.length > 0
          ? React.createElement(
              View,
              { style: s.specBlock },
              React.createElement(Text, { style: s.ncsLabel }, t("project.furniture")),
              ...furnitureLinks.map((item, i) =>
                React.createElement(
                  View,
                  { key: i, style: { marginBottom: 4, alignItems: "center", width: "100%" } },
                  React.createElement(Text, { style: s.specDetail }, item.name),
                  specLinkEl(item.url, t("pdf.viewInStore"), t),
                ),
              ),
            )
          : fc
            ? ncsSwatchBlock(t("project.furniture"), fc.ncs, fc.hex, true)
            : null,
        mat?.floorMaterial
          ? materialSpecBlock(
              t("project.floor"),
              mat.floorMaterial.type,
              floorName,
              floorUrl,
              t,
            )
          : null,
        mat?.tileMaterial
          ? materialSpecBlock(t("project.tile"), mat.tileMaterial.type, tileName, tileUrl, t)
          : null,
      ),
    ),
    footerEl(t),
  );
}

function RoomProductsPage({
  room,
  rows,
  imageMap,
  t,
}: {
  room: RoomResult;
  rows: RoomProductRow[];
  imageMap: Map<number, string>;
  t: TFn;
}) {
  const designElements = room.brief.keyDesignElements.filter(Boolean);
  if (rows.length === 0 && designElements.length === 0) return null;

  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(
      Text,
      { style: s.roomProductsHeader },
      `${room.brief.roomName} — ${t("pdf.roomProducts")}`,
    ),
    rows.length > 0
      ? React.createElement(
          View,
          { style: s.tableHeader },
          React.createElement(Text, { style: { ...s.th, width: "8%" } }, ""),
          React.createElement(Text, { style: { ...s.th, width: "14%" } }, t("pdf.catalogCategory")),
          React.createElement(Text, { style: { ...s.th, width: "30%" } }, t("pdf.catalogName")),
          React.createElement(Text, { style: { ...s.th, width: "18%" } }, t("pdf.catalogMaterial")),
          React.createElement(Text, { style: { ...s.th, width: "12%" } }, t("pdf.catalogPrice")),
          React.createElement(Text, { style: { ...s.th, width: "18%" } }, t("pdf.catalogLink")),
        )
      : null,
    ...(rows.length > 0
      ? rows.slice(0, 14).map((row, i) =>
          React.createElement(
            View,
            { key: i, style: s.tableRow },
            React.createElement(
              View,
              { style: { width: "8%" } },
              row.marketplaceId && imageMap.has(row.marketplaceId)
                ? React.createElement(Image, { style: s.catalogImg, src: imageMap.get(row.marketplaceId)! })
                : React.createElement(View, { style: { ...s.catalogImg, backgroundColor: "#EEE" } }),
            ),
            textCell(row.category, "14%", true),
            linkCell(row.url, row.name, "30%"),
            textCell(row.material, "18%", true),
            textCell(row.price != null ? `${row.price} ${row.currency}` : t("pdf.noPrice"), "12%"),
            linkCell(row.url, isHttpUrl(row.url) ? t("pdf.viewInStore") : "—", "18%"),
          ),
        )
      : []),
    designElements.length > 0
      ? React.createElement(
          View,
          { style: s.designElementsBlock },
          React.createElement(Text, { style: { ...s.ncsLabel, textAlign: "left", marginBottom: 6 } }, t("pdf.designElements")),
          ...designElements.map((el, i) =>
            React.createElement(Text, { key: i, style: s.designElementItem }, `• ${el}`),
          ),
        )
      : null,
    footerEl(t),
  );
}

function RoomCollagePage({ room }: { room: RoomResult }) {
  const renders = room.renders.slice(2, 5);
  if (renders.length === 0) return null;
  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(
      View,
      { style: s.collageContainer },
      renders[0] &&
        React.createElement(Image, { style: s.collageLarge, src: dataUri(renders[0].base64, renders[0].mimeType) }),
      React.createElement(
        View,
        { style: s.collageRight },
        ...renders.slice(1).map((r, i) =>
          React.createElement(Image, { key: i, style: s.collageSmall, src: dataUri(r.base64, r.mimeType) }),
        ),
      ),
    ),
  );
}

function CatalogPage({
  rows,
  imageMap,
  t,
}: {
  rows: ReturnType<typeof collectCatalogRows>;
  imageMap: Map<number, string>;
  t: TFn;
}) {
  if (rows.length === 0) return null;

  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(Text, { style: s.sectionHeader }, t("pdf.catalogTitle")),
    React.createElement(
      View,
      { style: s.tableHeader },
      React.createElement(Text, { style: { ...s.th, width: "8%" } }, ""),
      React.createElement(Text, { style: { ...s.th, width: "12%" } }, t("pdf.catalogCategory")),
      React.createElement(Text, { style: { ...s.th, width: "22%" } }, t("pdf.catalogName")),
      React.createElement(Text, { style: { ...s.th, width: "12%" } }, t("pdf.catalogMaterial")),
      React.createElement(Text, { style: { ...s.th, width: "6%" } }, t("pdf.catalogQty")),
      React.createElement(Text, { style: { ...s.th, width: "12%" } }, t("pdf.catalogPrice")),
      React.createElement(Text, { style: { ...s.th, width: "10%" } }, t("pdf.catalogSku")),
      React.createElement(Text, { style: { ...s.th, width: "18%" } }, t("pdf.finishRoom")),
    ),
    ...rows.slice(0, 18).map((row, i) =>
      React.createElement(
        View,
        { key: i, style: s.tableRow },
        React.createElement(
          View,
          { style: { width: "8%" } },
          row.marketplaceId && imageMap.has(row.marketplaceId)
            ? React.createElement(Image, { style: s.catalogImg, src: imageMap.get(row.marketplaceId)! })
            : React.createElement(View, { style: { ...s.catalogImg, backgroundColor: "#EEE" } }),
        ),
        textCell(row.category, "12%", true),
        linkCell(row.url, row.name, "22%"),
        textCell(row.material, "12%", true),
        textCell(String(row.quantity), "6%"),
        textCell(row.price != null ? `${row.price} ${row.currency}` : t("pdf.noPrice"), "12%"),
        textCell(row.marketplaceId ? String(row.marketplaceId) : "—", "10%"),
        textCell(row.roomName, "18%", true),
      ),
    ),
    footerEl(t),
  );
}

function FinishSchedulePage({
  rows,
  t,
}: {
  rows: ReturnType<typeof collectFinishSchedule>;
  t: TFn;
}) {
  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(Text, { style: s.sectionHeader }, t("pdf.finishScheduleTitle")),
    React.createElement(
      View,
      { style: s.tableHeader },
      React.createElement(Text, { style: { ...s.th, width: "18%" } }, t("pdf.finishRoom")),
      React.createElement(Text, { style: { ...s.th, width: "14%" } }, t("pdf.finishSurface")),
      React.createElement(Text, { style: { ...s.th, width: "28%" } }, t("pdf.finishMaterial")),
      React.createElement(Text, { style: { ...s.th, width: "14%" } }, t("pdf.finishCode")),
      React.createElement(Text, { style: { ...s.th, width: "26%" } }, t("pdf.finishProduct")),
    ),
    ...rows.map((row, i) =>
      React.createElement(
        View,
        { key: i, style: s.tableRow },
        textCell(row.roomName, "18%", true),
        textCell(row.surface, "14%", true),
        textCell(row.material, "28%", true),
        textCell(row.code, "14%", true),
        linkCell(row.url, row.productName ?? (isHttpUrl(row.url) ? row.url : "—"), "26%"),
      ),
    ),
    footerEl(t),
  );
}

function TechnicalPlanPage({ title, svgDataUri, t }: { title: string; svgDataUri: string; t: TFn }) {
  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(Text, { style: s.techTitle }, title),
    React.createElement(
      View,
      { style: s.techImageFrame },
      React.createElement(Image, { style: s.techImage, src: svgDataUri }),
    ),
    footerEl(t),
  );
}

function ContractorPage({ project, t }: { project: ProjectState; t: TFn }) {
  const ch = project.analysis?.ceilingHeight;
  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(Text, { style: s.sectionHeader }, t("pdf.contractorTitle")),
    React.createElement(Text, { style: s.noteText }, t("pdf.contractorSocketHeight")),
    React.createElement(Text, { style: s.noteText }, t("pdf.contractorSwitchHeight")),
    React.createElement(Text, { style: s.noteText }, t("pdf.contractorClearance")),
    ch
      ? React.createElement(Text, { style: s.noteText }, `${t("pdf.contractorCeilingHeight")}: ${ch} mm`)
      : null,
    React.createElement(Text, { style: s.disclaimer }, t("pdf.contractorDisclaimer")),
    footerEl(t),
  );
}

function BudgetPage({ summary, t }: { summary: ReturnType<typeof computeBudgetSummary>; t: TFn }) {
  const pricedRows = summary.lines.filter((l) => l.price > 0);
  const unpricedRows = summary.lines.filter((l) => l.price <= 0);

  return React.createElement(
    Page,
    { size: "A4", orientation: "landscape", style: s.page },
    React.createElement(Text, { style: s.sectionHeader }, t("pdf.budgetTitle")),
    React.createElement(
      Text,
      { style: { ...s.conceptText, fontWeight: "bold" } },
      `${t("pdf.budgetTotal")}: ${summary.total > 0 ? `${summary.total} ${summary.currency}` : t("pdf.noPrice")}`,
    ),
    React.createElement(Text, { style: s.conceptText }, t("pdf.budgetItems", { count: summary.lines.length })),
    pricedRows.length > 0
      ? React.createElement(
          View,
          { style: { ...s.tableHeader, marginTop: 16 } },
          React.createElement(Text, { style: { ...s.th, width: "30%" } }, t("pdf.budgetRoom")),
          React.createElement(Text, { style: { ...s.th, width: "30%" } }, t("pdf.budgetCategory")),
          React.createElement(Text, { style: { ...s.th, width: "40%" } }, t("pdf.budgetAmount")),
        )
      : null,
    ...pricedRows.map((line, i) =>
      React.createElement(
        View,
        { key: `p-${i}`, style: s.tableRow },
        React.createElement(Text, { style: { ...s.td, width: "30%" } }, line.roomName),
        React.createElement(Text, { style: { ...s.td, width: "30%" } }, `${line.category}: ${line.name}`),
        React.createElement(Text, { style: { ...s.td, width: "40%" } }, `${line.price} ${line.currency}`),
      ),
    ),
    unpricedRows.length > 0
      ? React.createElement(
          View,
          { style: { marginTop: 16, paddingHorizontal: 36 } },
          React.createElement(
            Text,
            { style: { ...s.conceptText, fontWeight: "bold", marginBottom: 6 } },
            t("pdf.budgetUnpricedTitle"),
          ),
          ...unpricedRows.slice(0, 24).map((line, i) =>
            React.createElement(
              Text,
              { key: `u-${i}`, style: { ...s.conceptText, fontSize: 9 } },
              `• ${line.roomName} — ${line.category}: ${line.name}`,
            ),
          ),
        )
      : null,
    footerEl(t),
  );
}

function ProjectDocument({
  project,
  locale,
  catalogImages,
  techPngs,
  elevationPngs,
  sections,
  rendersOnly = false,
}: {
  project: ProjectState;
  locale: VistaLocale;
  catalogImages: Map<number, string>;
  techPngs: Record<string, string>;
  elevationPngs: { id: string; png: string }[];
  sections: Record<PdfSectionKey, boolean>;
  rendersOnly?: boolean;
}) {
  const t: TFn = (key, vars) => translate(locale, key, vars);
  const approvedRooms = project.rooms.filter((r) => r.status === "approved" && r.renders.length > 0);
  const pages: React.ReactElement[] = [];

  pages.push(React.createElement(CoverPage, { key: "cover", project, t }));

  if (rendersOnly) {
    const gallery = React.createElement(RenderGalleryPage, { key: "gallery", rooms: approvedRooms, t });
    if (gallery) pages.push(gallery);

    for (const room of approvedRooms) {
      pages.push(React.createElement(RoomMainPage, { key: `room-${room.roomId}`, room, t }));
      const collage = React.createElement(RoomCollagePage, { key: `collage-${room.roomId}`, room });
      if (collage) pages.push(collage);
    }

    return React.createElement(Document, null, ...pages);
  }

  const catalogRows = collectCatalogRows(approvedRooms);
  const finishRows = collectFinishSchedule(approvedRooms, project.concept, locale);
  const budget = computeBudgetSummary(approvedRooms);
  const elevationCount = project.wallElevations?.elevations.length ?? 0;
  const anyTechnicalPlan = KEPT_PLAN_KEYS.some((k) => sections[k as PdfSectionKey]);
  const tocEntries = buildTocEntries(project, locale, {
    hasPlumbing: hasWetRooms(project.analysis),
    elevationCount,
    catalogCount: catalogRows.length,
    include: {
      renderGallery: sections.renderGallery,
      finishSchedule: sections.finishSchedule,
      technical: anyTechnicalPlan,
      elevations: sections.elevations,
      budget: sections.budget,
    },
  });

  pages.push(
    React.createElement(TocPage, {
      key: "toc",
      entries: tocEntries.map((e) => ({ section: e.section, title: e.title })),
      t,
    }),
  );

  const conceptPage = React.createElement(ConceptPage, { key: "concept", project, t });
  if (conceptPage) pages.push(conceptPage);

  if (sections.renderGallery) {
    const gallery = React.createElement(RenderGalleryPage, { key: "gallery", rooms: approvedRooms, t });
    if (gallery) pages.push(gallery);
  }

  for (const room of approvedRooms) {
    pages.push(React.createElement(RoomMainPage, { key: `room-${room.roomId}`, room, t }));
    const roomProducts = React.createElement(RoomProductsPage, {
      key: `products-${room.roomId}`,
      room,
      rows: collectRoomProductRows(room),
      imageMap: catalogImages,
      t,
    });
    if (roomProducts) pages.push(roomProducts);
    const collage = React.createElement(RoomCollagePage, { key: `collage-${room.roomId}`, room });
    if (collage) pages.push(collage);
  }

  const catalog = React.createElement(CatalogPage, { key: "catalog", rows: catalogRows, imageMap: catalogImages, t });
  if (catalog) pages.push(catalog);

  if (sections.finishSchedule) {
    pages.push(React.createElement(FinishSchedulePage, { key: "finish", rows: finishRows, t }));
  }

  if (project.technicalDrawings) {
    for (const key of KEPT_PLAN_KEYS) {
      if (!sections[key as PdfSectionKey]) continue;
      if (key === "plumbing" && !hasWetRooms(project.analysis)) continue;
      const png = techPngs[key];
      if (!png) continue;
      const plan = project.technicalDrawings[key];
      pages.push(
        React.createElement(TechnicalPlanPage, {
          key: `tech-${key}`,
          title: planTitle(
            { key: TECH_PLAN_KEY[key] ?? key, title: plan.title, titleRu: plan.title, svg: null },
            locale,
          ),
          svgDataUri: png,
          t,
        }),
      );
    }
  }

  if (sections.elevations) {
    for (const elev of elevationPngs) {
      const elevMeta = project.wallElevations!.elevations.find((e) => e.elevationId === elev.id);
      pages.push(
        React.createElement(TechnicalPlanPage, {
          key: `elev-${elev.id}`,
          title: elevMeta ? `${elevMeta.roomName} — ${elevMeta.wallLabel}` : elev.id,
          svgDataUri: elev.png,
          t,
        }),
      );
    }
  }

  pages.push(React.createElement(ContractorPage, { key: "contractor", project, t }));
  if (sections.budget) {
    pages.push(React.createElement(BudgetPage, { key: "budget", summary: budget, t }));
  }

  return React.createElement(Document, null, ...pages);
}

export interface AssemblePdfOptions {
  locale?: VistaLocale;
  /** Optional per-section include/exclude. Omitted sections default to included. */
  sections?: PdfSectionSelection;
  /** Interior renders only — cover, gallery, and per-room render pages. */
  rendersOnly?: boolean;
}

export async function assemblePDF(project: ProjectState, options?: AssemblePdfOptions): Promise<Buffer> {
  await ensurePdfFontsRegistered();
  const locale = options?.locale ?? resolveLocale(project);
  const rendersOnly = options?.rendersOnly === true;
  const sections = resolveSections(options?.sections);
  const approvedRooms = project.rooms.filter((r) => r.status === "approved" && r.renders.length > 0);

  if (rendersOnly) {
    const doc = React.createElement(ProjectDocument, {
      project,
      locale,
      sections,
      catalogImages: new Map<number, string>(),
      techPngs: {},
      elevationPngs: [],
      rendersOnly: true,
    });
    const buffer = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
    return Buffer.from(buffer);
  }

  const catalogRows = collectCatalogRows(approvedRooms);
  const roomProductRows = approvedRooms.flatMap(collectRoomProductRows);
  const catalogImages = await enrichProductImages(catalogRows, roomProductRows);

  // react-pdf cannot embed SVG, so rasterize every (selected) plan/elevation to
  // PNG first. Skip plans the user deselected to avoid needless rasterization.
  const techPngs: Record<string, string> = {};
  if (project.technicalDrawings) {
    const svgs = renderAllPlans(
      project.technicalDrawings,
      project.analysis,
      project.concept,
      approvedRooms,
      project.utilityEntryPoints ?? [],
    );
    const planStats = KEPT_PLAN_KEYS.reduce(
      (acc, key) => {
        const plan = project.technicalDrawings![key];
        acc[key] = {
          fixtures: plan.fixtures?.length ?? plan.lightingFixtures?.length ?? plan.plumbingFixtures?.length ?? 0,
          furniture: plan.furniture?.length ?? 0,
          zones: plan.flooringZones?.length ?? plan.roomZones?.length ?? 0,
          hasSvg: !!svgs[key],
        };
        return acc;
      },
      {} as Record<string, { fixtures: number; furniture: number; zones: number; hasSvg: boolean }>,
    );
    await Promise.all(
      KEPT_PLAN_KEYS.map(async (key) => {
        if (!sections[key as PdfSectionKey]) return;
        const svg = svgs[key];
        if (!svg) return;
        const png = await svgToPngDataUri(svg, PDF_PLAN_RASTER_WIDTH);
        if (png) techPngs[key] = png;
      }),
    );
  }

  const elevationPngs: { id: string; png: string }[] = [];
  if (project.wallElevations && sections.elevations) {
    const elevationSet = prepareApprovedWallElevations(
      project.wallElevations,
      approvedRooms,
      project.analysis,
    );
    const rendered = renderAllElevations(elevationSet);
    await Promise.all(
      rendered.map(async (elev) => {
        const png = await svgToPngDataUri(elev.svg, PDF_PLAN_RASTER_WIDTH);
        if (png) elevationPngs.push({ id: elev.id, png });
      }),
    );
  }

  const doc = React.createElement(ProjectDocument, {
    project,
    locale,
    sections,
    catalogImages,
    techPngs,
    elevationPngs,
  });
  const buffer = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
  return Buffer.from(buffer);
}
