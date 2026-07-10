"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import {
  Search,
  Plus,
  X,
  Upload,
  Sparkles,
  Loader2,
  Image as ImageIcon,
  ShoppingBag,
  ExternalLink,
  Ruler,
  ArrowLeft,
  ArrowRight,
  Globe,
  ChevronDown,
  ChevronRight,
  Star,
  RefreshCw,
  Send,
  Paperclip,
  Clock,
  Camera,
  Home,
  Package,
  AlertCircle,
  PenTool,
  Download,
  Save,
  Check,
  Edit3,
} from "lucide-react";
import {
  useConsumerDesignStore,
  type MarketplaceProduct,
  type LiveSearchProduct,
  type InspirationProduct,
  type StyleInspirationImage,
  type ProductPurchaseLink,
  MAX_INSPIRATION_PRODUCTS,
  MAX_STYLE_INSPIRATIONS,
  getSelectedPhaseImage,
  getSelectedPhaseProducts,
  getPhaseVersions,
} from "@/app/store";
// Heavy, route-specific UI is code-split so the landing + quick-room routes
// don't ship the entire project-mode / annotation feature in their initial JS.
const ProjectModeContent = dynamic(() => import("@/app/ProjectMode"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center min-h-[60vh]">
      <Loader2 size={32} className="animate-spin text-[var(--primary)]" aria-hidden />
    </div>
  ),
});
const DrawingCanvas = dynamic(() => import("@/components/DrawingCanvas"), {
  ssr: false,
});
const StructuralBoundaryCanvas = dynamic(
  () => import("@/components/StructuralBoundaryCanvas"),
  { ssr: false },
);
import { useProjectPersistence } from "@/hooks/useProjectPersistence";
import { getAuthToken } from "@/lib/authApi";
import { ProjectTimeline } from "@/components/ProjectTimeline";
import { useProjectSessionRestore } from "@/hooks/useProjectSessionRestore";
import { subscribeToProjectSession } from "@/app/store";
import {
  applyStyleInspirationsToStore,
  fetchLaravelInspirationImages,
  hydrateStyleInspirationsFromLaravel,
  styleInspirationsToPatchPayload,
} from "@/lib/inspirationPersistence";
import { loadSessionBlobs, loadSessionMeta } from "@/lib/project/sessionStorage";
import "@/app/design.css";
import { useRouter } from "next/navigation";
import { getMarketplaceApiBase } from "@/lib/publicEnv";
import { compressImageFile } from "@/lib/compressImageClient";
import { LANDING_MODE_IMAGES } from "@/lib/landingModeAssets";
const CameraCapture = dynamic(
  () => import("@/components/CameraCapture").then((m) => m.CameraCapture),
  { ssr: false },
);
const GenerationDebugPanel = dynamic(
  () => import("@/components/GenerationDebugPanel").then((m) => m.GenerationDebugPanel),
  { ssr: false },
);
import { isArmeniaLocalScrapedExclusive } from "@/lib/scrapedAllowlist";
import { analyzeAndRedesign, runPhasedGeneration } from "@/lib/analyzeAndRedesign";
import type { GenerationClientTrace } from "@/lib/generationDebug";
import { catalogCategorySortKey, PRODUCT_DISPLAY_BAND } from "@/lib/productDisplayOrder";
import {
  normalizeRoomAnalysisOpenings,
  effectiveQuickRoomSpatialConfidence,
  quickRoomNeedsMandatorySpatialClarification,
  ROOM_TYPES,
  ROOM_SHAPES,
  CEILING_TYPES,
  type RoomAnalysis,
} from "@/lib/interiorDesignPrompts";
import { localizeRoomAnalysisForLocale } from "@/lib/roomAnalysisLocalization";
import RoomShapeEditor from "@/components/RoomShapeEditor";
import OpeningBoxEditor from "@/components/OpeningBoxEditor";
import {
  bboxFromPolygonEdges,
  roomShapeUsesPolygonEditor,
  syncPolygonEdgesForShape,
} from "@/lib/roomShapePolygon";
import { formatApiErrorMessage } from "@/lib/apiError";
import { sanitizeUserFacingMessage } from "@/lib/userFacingMessages";
import { track } from "@/lib/analytics";
import {
  handleAiServiceUnavailableClientError,
  throwIfAiServiceUnavailable,
} from "@/lib/aiServiceError";
import { SupportContactModal } from "@/components/SupportContactModal";
import { useVistaUiTheme } from "@/app/VistaThemeProvider";
import { VistaHeaderActions } from "@/components/VistaHeaderActions";
import {
  TOKEN_COSTS,
  authContextForApi,
  fetchTokenBalance,
  grantAnonymousTokens,
  startTokenTopUpCheckout,
  type TokenAction,
} from "@/lib/vistaTokens";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { useCatalogLabels } from "@/i18n/catalogLabels";
import {
  RoomRenderGalleryCard,
  RoomRenderGalleryGrid,
} from "@/components/RoomRenderGallery";
import {
  fetchCatalogBrowsePage,
  fetchCatalogSearchAllPages,
  fetchCatalogStats,
  getSidebarCatalogPreview,
} from "@/lib/defaultCatalogBrowse";
import {
  selectSidebarPreview,
  selectSidebarPreviewSections,
  type SidebarPreviewSection,
} from "@/lib/priorityCatalog";
import {
  CATALOG_MODAL_FILTERS,
  MODAL_FILTER_I18N,
  MODAL_FILTER_TO_API,
  postFilterModalProducts,
  type CatalogModalFilter,
} from "@/lib/catalogModalFilters";
import { DesignPhaseStepper, PhaseApprovalBar, PhaseVersionNav } from "@/components/DesignPhaseStepper";
import {
  classifyPinnedProductPhase,
  isDecorPhaseSkippableForStyle,
  type DesignPhase,
} from "@/lib/phaseRouter";

type GeneratePhase = "idle" | "analysing" | "designing" | "generating";

function resolveGeneratePhase(msg: string): GeneratePhase {
  if (msg.includes("Analysing")) return "analysing";
  if (msg.includes("Designing") || msg.includes("Preparing")) return "designing";
  return "generating";
}

function extensionForImageMime(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

function downloadImageDataUrl(dataUrl: string, filename: string) {
  track("design_result_downloaded");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function formatAMD(price: number): string {
  return price.toLocaleString("en-US") + " ֏";
}

const PRODUCT_BAND_I18N_KEYS: Record<number, string> = {
  [PRODUCT_DISPLAY_BAND.flooring]: "page.productBandFlooring",
  [PRODUCT_DISPLAY_BAND.walls]: "page.productBandWalls",
  [PRODUCT_DISPLAY_BAND.windowTreatments]: "page.productBandWindowTreatments",
  [PRODUCT_DISPLAY_BAND.lighting]: "page.productBandLighting",
  [PRODUCT_DISPLAY_BAND.furniture]: "page.productBandFurniture",
  [PRODUCT_DISPLAY_BAND.decor]: "page.productBandDecor",
  [PRODUCT_DISPLAY_BAND.other]: "page.productBandOther",
};

function marketplaceBadge(source: string) {
  const s = source.toLowerCase();
  if (s.includes("vega"))
    return <span className="cd-badge-vega text-[11px] font-semibold px-2 py-0.5 rounded-full">Vega</span>;
  if (s.includes("domus"))
    return <span className="cd-badge-domus text-[11px] font-semibold px-2 py-0.5 rounded-full">Domus</span>;
  if (s.includes("jysk"))
    return <span className="cd-badge-jysk text-[11px] font-semibold px-2 py-0.5 rounded-full">JYSK</span>;
  return (
    <span className="cd-market-badge-other text-[11px] font-semibold px-2 py-0.5 rounded-full">{source}</span>
  );
}

function liveProductStableId(productUrl: string, idx: number): number {
  let hash = 0;
  for (let i = 0; i < productUrl.length; i++) {
    hash = (Math.imul(31, hash) + productUrl.charCodeAt(i)) | 0;
  }
  return hash !== 0 ? hash : -(idx + 1);
}

function mapLiveToMarketplace(product: LiveSearchProduct, idx: number): MarketplaceProduct {
  return {
    id: liveProductStableId(product.product_url, idx),
    source_marketplace: product.source_marketplace,
    external_url: product.product_url,
    name: product.name,
    name_en: product.name,
    price: product.price,
    currency: product.currency,
    main_image_url: product.image_url,
    images: product.image_url ? [product.image_url] : null,
    width_cm: product.width_cm ? parseFloat(product.width_cm) : null,
    depth_cm: product.depth_cm ? parseFloat(product.depth_cm) : null,
    height_cm: product.height_cm ? parseFloat(product.height_cm) : null,
    has_dimensions: !!(product.width_cm || product.depth_cm || product.height_cm),
    category: product.category,
    category_en: product.category,
    brand: product.brand,
    priority: null,
  };
}

function selectedProductKey(product: MarketplaceProduct): string {
  return `${product.id}:${product.external_url || product.name}`;
}

const MOBILE_MEDIA_QUERY = "(max-width: 1024px)";

function subscribeMobileMediaQuery(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Product thumbnail with a placeholder fallback. Catalog images are hotlinked
 * from the retailer's site, so a URL can go dead (404) after the product goes
 * unavailable — onError swaps in the same ImageIcon shown for missing URLs.
 */
function ProductImage({
  src,
  alt,
  iconSize,
}: {
  src?: string | null;
  alt: string;
  iconSize: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <div className="w-full h-full flex items-center justify-center text-[var(--muted-foreground)]">
        <ImageIcon size={iconSize} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover"
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  );
}

function ProductCard({
  product,
  onAdd,
  isSelected,
}: {
  product: MarketplaceProduct;
  onAdd: () => void;
  isSelected: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="cd-product-card h-full flex flex-col rounded-xl overflow-hidden bg-[var(--card)] border border-[var(--border)]">
      <div className="relative aspect-[4/3] bg-[var(--muted)] overflow-hidden">
        <ProductImage
          src={product.main_image_url}
          alt={product.name_en || product.name}
          iconSize={32}
        />
        <div className="absolute top-2 left-2">{marketplaceBadge(product.source_marketplace)}</div>
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5 min-w-0">
        <p className="text-sm font-medium leading-tight line-clamp-2">{product.name_en || product.name}</p>
        {product.has_dimensions && (
          <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1">
            <Ruler size={12} />
            {[product.width_cm, product.depth_cm, product.height_cm].filter(Boolean).join(" × ")} {t("common.cm")}
          </p>
        )}
        <div className="flex flex-col gap-2 mt-auto min-w-0">
          <span className="text-sm font-bold text-[var(--primary)] tabular-nums leading-tight truncate">
            {formatAMD(product.price)}
          </span>
          <button
            onClick={onAdd}
            disabled={isSelected}
            className={`w-full flex items-center justify-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              isSelected
                ? "bg-[var(--primary)]/15 text-[var(--primary)] cursor-default"
                : "border border-[var(--primary)]/50 text-[var(--primary)] hover:bg-[var(--primary)]/10 cursor-pointer"
            }`}
          >
            {isSelected ? t("common.added") : <><Plus size={14} className="shrink-0" /> {t("common.add")}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectedProductChip({
  product,
  onRemove,
}: {
  product: MarketplaceProduct;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-[var(--muted)] border border-[var(--border)] group min-w-0">
      <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-lg overflow-hidden bg-[var(--border)] flex-shrink-0">
        <ProductImage src={product.main_image_url} alt="" iconSize={16} />
      </div>
      <div className="flex-1 min-w-0 py-0.5">
        <p className="text-xs sm:text-sm font-medium leading-snug line-clamp-2 break-words">
          {product.name_en || product.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
          <p className="text-xs font-bold text-[var(--primary)] tabular-nums">{formatAMD(product.price)}</p>
          {product.external_url && (
            <a
              href={product.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={10} />
              {t("components.viewOnStore")}
            </a>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 rounded-lg hover:bg-red-500/20 text-[var(--muted-foreground)] hover:text-red-400 transition-colors cursor-pointer flex-shrink-0"
        aria-label={t("components.removeProduct")}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function LiveProductCard({
  product,
  onAdd,
  isSelected,
  addDisabled = false,
}: {
  product: LiveSearchProduct;
  onAdd: () => void;
  isSelected: boolean;
  /** When true, live retailer rows lack scraped_products IDs — omit from Armenia+Local design board. */
  addDisabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="cd-product-card h-full flex flex-col rounded-xl overflow-hidden bg-[var(--card)] border border-[var(--border)]">
      <div className="relative aspect-[4/3] bg-[var(--muted)] overflow-hidden">
        <ProductImage src={product.image_url} alt={product.name} iconSize={32} />
        <div className="absolute top-2 left-2">
          <span className="cd-media-chip backdrop-blur-sm text-[10px] font-semibold px-2 py-0.5 rounded-full">
            {product.source_marketplace}
          </span>
        </div>
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5 min-w-0">
        <p className="text-sm font-medium leading-tight line-clamp-2">{product.name}</p>
        {product.brand && (
          <p className="text-xs text-[var(--muted-foreground)]">{product.brand}</p>
        )}
        {product.rating != null && (
          <div className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
            <Star size={11} className="text-yellow-400 fill-yellow-400" />
            <span>{product.rating.toFixed(1)}</span>
            {product.review_count != null && <span>({product.review_count})</span>}
          </div>
        )}
        <div className="flex flex-col gap-2 mt-auto min-w-0">
          <div className="min-w-0">
            <span className="text-sm font-bold text-[var(--primary)] tabular-nums leading-tight truncate block">
              {product.price.toLocaleString()} {product.currency}
            </span>
            {product.old_price != null && product.old_price > product.price && (
              <span className="text-[10px] text-[var(--muted-foreground)] line-through">
                {product.old_price.toLocaleString()} {product.currency}
              </span>
            )}
          </div>
          <div className="flex items-stretch gap-1.5 min-w-0">
            <a
              href={product.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-1.5 rounded-lg bg-[var(--muted)] hover:bg-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              title={t("components.viewOnStore")}
            >
              <ExternalLink size={13} />
            </a>
            <button
              onClick={onAdd}
              disabled={isSelected || addDisabled}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                isSelected
                  ? "bg-[var(--primary)]/15 text-[var(--primary)] cursor-default"
                  : addDisabled
                  ? "bg-[var(--muted)] text-[var(--muted-foreground)]/50 cursor-not-allowed"
                  : "border border-[var(--primary)]/50 text-[var(--primary)] hover:bg-[var(--primary)]/10 cursor-pointer"
              }`}
            >
              {isSelected ? t("common.added") : addDisabled ? t("common.catalog") : <><Plus size={14} className="shrink-0" /> {t("common.add")}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AllProductsModal({
  open,
  onClose,
  catalogTotalCount,
  liveProducts,
  selectedProducts,
  onAddCatalog,
  onAddLive,
  amLocalExclusive,
}: {
  open: boolean;
  onClose: () => void;
  catalogTotalCount: number;
  liveProducts: LiveSearchProduct[];
  selectedProducts: MarketplaceProduct[];
  onAddCatalog: (product: MarketplaceProduct) => void;
  onAddLive: (product: LiveSearchProduct, idx: number) => void;
  amLocalExclusive: boolean;
}) {
  const { t } = useTranslation();
  const [modalQuery, setModalQuery] = useState("");
  const [modalCategory, setModalCategory] = useState<CatalogModalFilter>("all");
  const [modalProducts, setModalProducts] = useState<MarketplaceProduct[]>([]);
  const [modalPage, setModalPage] = useState(1);
  const [modalLastPage, setModalLastPage] = useState(1);
  const [modalResultTotal, setModalResultTotal] = useState(0);
  const [modalLoading, setModalLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchGenRef = useRef(0);

  const loadedCount = modalProducts.length;
  const hasTextSearch = modalQuery.trim().length >= 2;
  const displayTotal = hasTextSearch
    ? modalResultTotal
    : (modalCategory === "all" && catalogTotalCount > 0) ? catalogTotalCount : modalResultTotal;

  const loadModalPage = useCallback(
    async (page: number, query: string, filter: CatalogModalFilter, replace: boolean) => {
      const gen = ++fetchGenRef.current;
      setModalLoading(true);
      try {
        const term = query.trim();
        const apiFilter = MODAL_FILTER_TO_API[filter];

        if (term.length >= 2) {
          const searchOpts: { product_family?: string; product_subtype?: string; product_subtypes?: string } = {};
          if (apiFilter) {
            if (apiFilter.product_family) searchOpts.product_family = apiFilter.product_family;
            if (apiFilter.product_subtypes) searchOpts.product_subtypes = apiFilter.product_subtypes;
            else if (apiFilter.product_subtype) searchOpts.product_subtype = apiFilter.product_subtype;
          }
          const rows = postFilterModalProducts(
            await fetchCatalogSearchAllPages(getMarketplaceApiBase(), term, searchOpts),
            filter,
          );
          if (gen !== fetchGenRef.current) return;
          setModalProducts(rows);
          setModalPage(1);
          setModalLastPage(1);
          setModalResultTotal(rows.length);
          return;
        }

        const result = await fetchCatalogBrowsePage(getMarketplaceApiBase(), {
          page,
          ...(apiFilter ?? {}),
        });
        if (gen !== fetchGenRef.current) return;

        setModalPage(result.currentPage);
        setModalLastPage(result.lastPage);
        setModalResultTotal(result.total);

        const filtered = postFilterModalProducts(result.products, filter);

        setModalProducts((prev) => {
          if (replace) return filtered;
          const seen = new Set(prev.map((p) => p.id));
          const merged = [...prev];
          for (const product of filtered) {
            if (seen.has(product.id)) continue;
            seen.add(product.id);
            merged.push(product);
          }
          return merged;
        });
      } finally {
        if (gen === fetchGenRef.current) setModalLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      setModalQuery("");
      setModalCategory("all");
      setModalProducts([]);
      setModalPage(1);
      setModalLastPage(1);
      setModalResultTotal(0);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = modalQuery.trim().length >= 2 || modalQuery.length > 0 ? 400 : 0;
    debounceRef.current = setTimeout(() => {
      void loadModalPage(1, modalQuery, modalCategory, true);
    }, delay);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, modalQuery, modalCategory, loadModalPage]);

  useEffect(() => {
    if (!open || modalQuery.trim().length >= 2) return;
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || modalLoading) return;
        if (modalPage >= modalLastPage) return;
        void loadModalPage(modalPage + 1, "", modalCategory, false);
      },
      { root, rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, modalQuery, modalCategory, modalPage, modalLastPage, modalLoading, loadModalPage]);

  const handleCategoryChange = useCallback((cat: CatalogModalFilter) => {
    setModalCategory(cat);
  }, []);

  if (!open) return null;

  const showLiveSection = !amLocalExclusive && liveProducts.length > 0 && !hasTextSearch && modalCategory === "all";
  const emptyCatalog = loadedCount === 0 && !modalLoading && !showLiveSection;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center cd-lightbox-overlay backdrop-blur-sm"
      style={{
        padding:
          "env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)",
      }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-4xl max-h-[min(92vh,920px)] flex flex-col bg-[var(--card)] border border-[var(--border)] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)]">
          <div className="min-w-0">
            <h2 className="text-base font-bold">{t("page.allProductsTitle")}</h2>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {displayTotal > 0
                ? t("page.allProductsShowingCount", { loaded: loadedCount, total: displayTotal })
                : t("page.allProductsCount", { count: loadedCount })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors cursor-pointer cd-lightbox-close"
            aria-label={t("common.close")}
          >
            <X size={22} />
          </button>
        </div>

        <div className="shrink-0 px-4 py-2 border-b border-[var(--border)]">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none"
            />
            <input
              type="search"
              value={modalQuery}
              onChange={(e) => setModalQuery(e.target.value)}
              placeholder={t("page.allProductsSearchPlaceholder")}
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-[var(--border)] bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
            />
          </div>
        </div>

        {/* Mobile: horizontal chips above the grid */}
        <div className="sm:hidden shrink-0 flex gap-1.5 px-4 py-2 overflow-x-auto border-b border-[var(--border)]" style={{ scrollbarWidth: "none" }}>
          {CATALOG_MODAL_FILTERS.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => handleCategoryChange(cat)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${
                modalCategory === cat
                  ? "bg-[var(--primary)]/15 border-[var(--primary)]/30 text-[var(--foreground)] font-semibold"
                  : "border-[var(--border)] text-[var(--muted-foreground)]"
              }`}
            >
              {t(MODAL_FILTER_I18N[cat])}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left filter rail — desktop only */}
          <div className="hidden sm:flex shrink-0 w-[148px] flex-col gap-0.5 py-2 px-2 border-r border-[var(--border)] overflow-y-auto custom-scrollbar">
            {CATALOG_MODAL_FILTERS.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => handleCategoryChange(cat)}
                className={`text-left text-sm px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  modalCategory === cat
                    ? "bg-[var(--primary)]/15 text-[var(--foreground)] font-semibold"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {t(MODAL_FILTER_I18N[cat])}
              </button>
            ))}
          </div>

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar">
            {loadedCount > 0 && (
              <div className="mb-4">
                {amLocalExclusive && modalCategory === "all" && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--primary)] mb-2">
                    Catalog
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {modalProducts.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      onAdd={() => onAddCatalog(p)}
                      isSelected={selectedProducts.some((s) => s.id === p.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {showLiveSection && (
              <div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {liveProducts.map((p, idx) => (
                    <LiveProductCard
                      key={`${p.source_key}-${p.product_url}-${idx}`}
                      product={p}
                      addDisabled={false}
                      onAdd={() => onAddLive(p, idx)}
                      isSelected={selectedProducts.some((s) => s.external_url === p.product_url)}
                    />
                  ))}
                </div>
              </div>
            )}

            {modalLoading && (
              <div className="flex justify-center py-4">
                <Loader2 size={24} className="animate-spin text-[var(--muted-foreground)]" />
              </div>
            )}

            {!modalLoading && !hasTextSearch && modalPage < modalLastPage && (
              <div ref={sentinelRef} className="h-8" aria-hidden />
            )}

            {emptyCatalog && (
              <div className="flex flex-col items-center justify-center py-16 text-[var(--muted-foreground)]">
                <ShoppingBag size={32} className="mb-3 opacity-40" />
                <p className="text-sm">{t("page.noProductsFound")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function appendStyleInspirationsToForm(
  form: FormData,
  styleInspirations: StyleInspirationImage[],
): void {
  for (const si of styleInspirations) {
    const ipBlob = new Blob([Uint8Array.from(atob(si.base64), (c) => c.charCodeAt(0))], {
      type: si.mimeType,
    });
    form.append("styleInspirationImages", ipBlob, "style-inspiration.jpg");
  }
}

async function appendStyleInspirationsToFormAsync(
  form: FormData,
  styleInspirations: StyleInspirationImage[],
): Promise<void> {
  for (const si of styleInspirations) {
    const ipBlob = await fetch(`data:${si.mimeType};base64,${si.base64}`).then((r) => r.blob());
    form.append("styleInspirationImages", ipBlob, "style-inspiration.jpg");
  }
}

function InspirationProductsPanel({
  products,
  onAddImage,
  onRemove,
  onUpdateLabel,
  isMobile = false,
}: {
  products: InspirationProduct[];
  onAddImage: (base64: string, mimeType: string) => void;
  onRemove: (id: string) => void;
  onUpdateLabel: (id: string, label: string) => void;
  isMobile?: boolean;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const isFull = products.length >= MAX_INSPIRATION_PRODUCTS;

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      void (async () => {
        for (const file of Array.from(files)) {
          if (!file.type.startsWith("image/")) continue;
          try {
            const { base64, mimeType } = await compressImageFile(file);
            onAddImage(base64, mimeType);
          } catch {
            /* skip bad file */
          }
        }
      })();
    },
    [onAddImage],
  );

  return (
    <div className="w-full">
      <div className={`${isMobile ? "flex flex-col items-stretch gap-2" : "flex items-center justify-between"} mb-2.5`}>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {t("project.inspirationOptional")} ({products.length}/{MAX_INSPIRATION_PRODUCTS})
        </p>
        {!isFull && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`text-xs font-semibold text-[var(--primary)] hover:underline cursor-pointer flex items-center gap-1 ${isMobile ? "self-start" : ""}`}
          >
            <Upload size={12} /> {t("project.addPhoto")}
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
      />

      {products.length === 0 ? (
        <div
          className="w-full py-6 rounded-xl border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[var(--primary)]/50 transition-all"
          onClick={() => fileRef.current?.click()}
        >
          <Package size={24} className="text-[var(--muted-foreground)] opacity-50" />
          <p className="text-[10px] text-[var(--muted-foreground)]">
            {t("project.inspirationHint")}
          </p>
        </div>
      ) : (
        <div className={`grid ${isMobile ? "grid-cols-3" : "grid-cols-5"} gap-2`}>
          {products.map((product) => {
            const src = product.base64
              ? `data:${product.mimeType};base64,${product.base64}`
              : product.thumbnailUrl || product.url;
            return (
              <div
                key={product.id}
                className="relative group rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--muted)]"
              >
                <div className="aspect-square overflow-hidden">
                  {src ? (
                    <img
                      src={src}
                      alt={product.label || t("components.productLabel")}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--muted-foreground)]">
                      <Package size={20} />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onRemove(product.id)}
                  className={`absolute top-1 right-1 ${isMobile ? "p-1.5 opacity-100" : "p-0.5 opacity-0 group-hover:opacity-100"} rounded-full cd-media-icon-btn transition-colors cursor-pointer`}
                >
                  <X size={isMobile ? 14 : 12} />
                </button>
                <input
                  type="text"
                  value={product.label}
                  onChange={(e) => onUpdateLabel(product.id, e.target.value)}
                  placeholder={t("common.label")}
                  className={`w-full px-1.5 py-1 ${isMobile ? "text-xs" : "text-[10px]"} bg-transparent border-t border-[var(--border)] focus:outline-none focus:bg-[var(--muted)] placeholder:text-[var(--muted-foreground)]`}
                />
              </div>
            );
          })}
          {!isFull && (
            <div
              className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--border)] aspect-square cursor-pointer hover:border-[var(--primary)]/50 transition-all"
              onClick={() => fileRef.current?.click()}
            >
              <Plus size={16} className="text-[var(--muted-foreground)]" />
              <span className="text-[9px] text-[var(--muted-foreground)]">{t("common.add")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StyleInspirationPanel({
  images,
  onAddImage,
  onRemove,
  isMobile = false,
}: {
  images: StyleInspirationImage[];
  onAddImage: (base64: string, mimeType: string) => void;
  onRemove: (id: string) => void;
  isMobile?: boolean;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const isFull = images.length >= MAX_STYLE_INSPIRATIONS;

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      void (async () => {
        for (const file of Array.from(files)) {
          if (!file.type.startsWith("image/")) continue;
          try {
            const { base64, mimeType } = await compressImageFile(file);
            onAddImage(base64, mimeType);
          } catch {
            /* skip bad file */
          }
        }
      })();
    },
    [onAddImage],
  );

  return (
    <div className="w-full">
      <div className={`${isMobile ? "flex flex-col items-stretch gap-2" : "flex items-center justify-between"} mb-2.5`}>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          {t("project.styleInspirationOptional")} ({images.length}/{MAX_STYLE_INSPIRATIONS})
        </p>
        {!isFull && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`text-xs font-semibold text-[var(--primary)] hover:underline cursor-pointer flex items-center gap-1 ${isMobile ? "self-start" : ""}`}
          >
            <Upload size={12} /> {t("project.addPhoto")}
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
      />

      {images.length === 0 ? (
        <div
          className="w-full py-6 rounded-xl border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[var(--primary)]/50 transition-all"
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon size={24} className="text-[var(--muted-foreground)] opacity-50" />
          <p className="text-[10px] text-[var(--muted-foreground)] text-center px-4">
            {t("project.styleInspirationHint")}
          </p>
        </div>
      ) : (
        <div className={`grid ${isMobile ? "grid-cols-2" : "grid-cols-4"} gap-2`}>
          {images.map((image) => (
            <div
              key={image.id}
              className="relative group rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--muted)]"
            >
              <div className="aspect-square overflow-hidden">
                <img
                  src={`data:${image.mimeType};base64,${image.base64}`}
                  alt={t("project.styleInspirationOptional")}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
              <button
                onClick={() => onRemove(image.id)}
                className={`absolute top-1 right-1 ${isMobile ? "p-1.5 opacity-100" : "p-0.5 opacity-0 group-hover:opacity-100"} rounded-full cd-media-icon-btn transition-colors cursor-pointer`}
              >
                <X size={isMobile ? 14 : 12} />
              </button>
            </div>
          ))}
          {!isFull && (
            <div
              className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--border)] aspect-square cursor-pointer hover:border-[var(--primary)]/50 transition-all"
              onClick={() => fileRef.current?.click()}
            >
              <Plus size={16} className="text-[var(--muted-foreground)]" />
              <span className="text-[9px] text-[var(--muted-foreground)]">{t("common.add")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type VistaHomeVariant = "landing" | "quick-workspace" | "project-workspace";

export interface VistaHomePageProps {
  variant?: VistaHomeVariant;
  hubPath?: string;
}

export function VistaHomePage({ variant = "landing", hubPath }: VistaHomePageProps = {}) {
  const router = useRouter();
  const {
    searchQuery,
    searchResults,
    searchLoading,
    selectedCountry,
    searchMode,
    liveSearchResults,
    liveSearchSources,
    liveSearchLoading,
    selectedProducts,
    roomImageBase64,
    roomImageMimeType,
    quickRoomExtraPhotos,
    quickRoomAnalysis,
    quickRoomAnalyzing,
    quickRoomAnalyzeError,
    textPrompt,
    selectedStyle,
    designMode,
    generatedImageBase64,
    generatedImageMimeType,
    designBrief,
    designHistory,
    isGenerating,
    error,
    productLinks,
    tokenBalance,
    setTokenBalance,
    setSearchQuery,
    setSearchResults,
    setSearchLoading,
    setLiveSearchResults,
    setLiveSearchSources,
    setLiveSearchLoading,
    addProduct,
    removeProduct,
    setRoomImage,
    addQuickRoomExtraPhoto,
    removeQuickRoomExtraPhoto,
    setQuickRoomAnalysis,
    setQuickRoomAnalyzing,
    setQuickRoomAnalyzeError,
    setTextPrompt,
    setSelectedStyle,
    setGeneratedImage,
    setDesignBrief,
    pushDesignVersion,
    restoreDesignVersion,
    lastRoomGeometry,
    lastGeometryExtractionFailed,
    setLastRoomGeometry,
    setIsGenerating,
    setError,
    setProductLinks,
    setUsedScrapedProducts,
    inspirationProducts,
    addInspirationProduct,
    removeInspirationProduct,
    updateInspirationProductLabel,
    styleInspirations,
    addStyleInspiration,
    removeStyleInspiration,
    phasedDesignActive,
    phasedCurrentPhase,
    phasedStatus,
    phasedRetryCount,
    phase1Versions,
    phase1SelectedIndex,
    phase2Versions,
    phase2SelectedIndex,
    phase3Versions,
    phase3SelectedIndex,
    phasedAllProductLinks,
    phasedError,
    phasedFinalViews,
    startPhasedDesign,
    setPhasedPhase,
    setPhasedStatus,
    setPhaseResult,
    setPhaseSelectedIndex,
    approvePhase,
    setPhasedAllProductLinks,
    setPhasedAllProductIds,
    setPhasedFinalViews,
    removePhasedFinalView,
    setPhasedError,
    resetPhasedDesign,
    viewpointTracks,
    setViewpointTrackResult,
  } = useConsumerDesignStore();

  const {
    vistaMode,
    projectStep,
    floorPlanBase64,
    floorPlanMimeType,
    roomPhotos,
    projectPreferences,
    projectId,
    projectAnalysis,
    projectConcept,
    projectRooms,
    currentProjectRoomIndex,
    projectLoading,
    projectError,
    hasPdf,
    setVistaMode,
    setProjectStep,
    setFloorPlan,
    addRoomPhoto,
    removeRoomPhoto,
    updateRoomPhotoLabel,
    setPhotoRoomMatch,
    setPhotoStructuralLineMap,
    setPhotoObjectRemovalMask,
    setPhotoOpeningAnalysis,
    setProjectPreferences,
    setProjectData,
    setProjectRooms,
    setCurrentProjectRoomIndex,
    setProjectLoading,
    setProjectError,
    setHasPdf,
    resetProject,
  } = useConsumerDesignStore();

  const { currentProjectDbId } = useConsumerDesignStore();

  const [uiTheme, setUiTheme] = useVistaUiTheme();
  const { t, locale } = useTranslation();
  const { quickStyles, roomTypeLabel, roomShapeLabel, ceilingTypeLabel } = useCatalogLabels();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extraFileInputRef = useRef<HTMLInputElement>(null);
  const chatImageRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedProductsListRef = useRef<HTMLDivElement>(null);
  const prevSelectedCountRef = useRef(0);
  const quickRoomLocalizedRef = useRef<string | null>(null);
  const sidebarPreloadedRef = useRef(false);
  const isWorkspace = variant !== "landing";
  /** Catalog sidebar search/preload runs only in Quick Room — not Full Project. */
  const catalogSidebarEnabled = variant === "quick-workspace";
  const [showLanding, setShowLanding] = useState(variant === "landing");
  const { restoring: restoringProjectSession } = useProjectSessionRestore({
    skip: variant !== "project-workspace",
  });

  useEffect(() => {
    if (variant !== "project-workspace" && variant !== "quick-workspace") return;
    const unsub = subscribeToProjectSession();
    return unsub;
  }, [variant]);

  useEffect(() => {
    if (variant !== "quick-workspace") return;
    let cancelled = false;
    void (async () => {
      const meta = loadSessionMeta("quick");
      if (!meta || cancelled) return;
      const blobs = await loadSessionBlobs();
      if (cancelled) return;

      const store = useConsumerDesignStore.getState();
      if (meta.projectDbId) {
        store.setCurrentProjectDbId(meta.projectDbId);
      }

      const projectDbId = meta.projectDbId ?? store.currentProjectDbId;
      if (projectDbId && getAuthToken()) {
        const laravelImages = await fetchLaravelInspirationImages(projectDbId);
        if (!cancelled && laravelImages.length > 0) {
          await hydrateStyleInspirationsFromLaravel(laravelImages);
          return;
        }
      }
      if (!cancelled) {
        applyStyleInspirationsToStore(blobs?.styleInspirations);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [variant]);

  useEffect(() => {
    if (variant === "quick-workspace") {
      useConsumerDesignStore.getState().setVistaMode("quick");
      setShowLanding(false);
    } else if (variant === "project-workspace") {
      const store = useConsumerDesignStore.getState();
      store.setVistaMode("project");
      setShowLanding(false);
      if (!store.projectId && !store.currentProjectDbId) {
        store.setProjectStep("upload");
      }
    }
  }, [variant]);
  const [landingSelectedMode, setLandingSelectedMode] = useState<"quick" | "project">("quick");
  const [isDragging, setIsDragging] = useState(false);
  const [editFeedback, setEditFeedback] = useState("");
  const [phaseEditFeedback, setPhaseEditFeedback] = useState("");
  const [phaseEditOpen, setPhaseEditOpen] = useState(false);
  const [chatAttachment, setChatAttachment] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [markerMode, setMarkerMode] = useState(false);
  const [annotatedImageBase64, setAnnotatedImageBase64] = useState<string | null>(null);
  const [annotatedImageMimeType, setAnnotatedImageMimeType] = useState<string | null>(null);
  const [phasedMarkerMode, setPhasedMarkerMode] = useState(false);
  const [phasedAnnotatedBase64, setPhasedAnnotatedBase64] = useState<string | null>(null);
  const [phasedAnnotatedMimeType, setPhasedAnnotatedMimeType] = useState<string | null>(null);
  const [structuralLineMap, setStructuralLineMap] = useState<{
    base64: string;
    mimeType: string;
    strokeOnly: boolean;
  } | null>(null);
  const [objectRemovalMask, setObjectRemovalMask] = useState<{
    base64: string;
    mimeType: string;
  } | null>(null);
  const [proModeOpen, setProModeOpen] = useState(false);
  const [phasedSlotNotices, setPhasedSlotNotices] = useState<string[]>([]);

  const resetPhasedAnnotation = useCallback(() => {
    setPhasedMarkerMode(false);
    setPhasedAnnotatedBase64(null);
    setPhasedAnnotatedMimeType(null);
  }, []);
  // useSyncExternalStore keeps hydration clean: the server snapshot (false)
  // matches the SSR HTML, then React re-syncs to the real viewport right after.
  const isMobile = useSyncExternalStore(
    subscribeMobileMediaQuery,
    () => window.matchMedia(MOBILE_MEDIA_QUERY).matches,
    () => false,
  );
  const [mobileTab, setMobileTab] = useState<"search" | "design" | "selected">("design");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [roomCameraOpen, setRoomCameraOpen] = useState(false);
  const [topUpRedirecting, setTopUpRedirecting] = useState(false);
  const [allProductsModalOpen, setAllProductsModalOpen] = useState(false);
  const [catalogTotalCount, setCatalogTotalCount] = useState(0);
  const [saveDesignModalOpen, setSaveDesignModalOpen] = useState(false);
  const [saveDesignName, setSaveDesignName] = useState("");
  const [saveDesignSaving, setSaveDesignSaving] = useState(false);
  const [saveDesignDone, setSaveDesignDone] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const {
    loadProjects,
    createProject,
    addVersion,
    addMessage,
    renameProject,
    saveInspirationImages,
    isAuthenticated: isPersistenceAuthenticated,
  } = useProjectPersistence();

  useEffect(() => {
    if (getAuthToken()) {
      void loadProjects();
    }
  }, [loadProjects]);


  const refreshTokenBalance = useCallback(async () => {
    try {
      const data = await fetchTokenBalance();
      setTokenBalance(data.balance);
    } catch {
      /* ignore */
    }
  }, [setTokenBalance]);

  useEffect(() => {
    grantAnonymousTokens()
      .then((data) => setTokenBalance(data.balance))
      .catch(() => refreshTokenBalance());
  }, [setTokenBalance, refreshTokenBalance]);
  const [quickAnalyzeNonce, setQuickAnalyzeNonce] = useState(0);
  const [quickRoomFactsExpanded, setQuickRoomFactsExpanded] = useState(false);
  const [generatePhase, setGeneratePhase] = useState<GeneratePhase>("idle");
  const [generationDebug, setGenerationDebug] = useState<GenerationClientTrace | null>(null);
  const [phasedProgressText, setPhasedProgressText] = useState("");
  const quickAnalyzeRunIdRef = useRef(0);

  const generatePhaseMessage =
    generatePhase === "analysing"
      ? t("page.analysingStructure")
      : generatePhase === "designing"
        ? t("page.designingInterior")
        : generatePhase === "generating"
          ? t("page.generatingDesign")
          : "";

  const generateButtonLoadingMessage =
    topUpRedirecting
      ? t("tokens.fillBalance")
      : phasedDesignActive && isGenerating && phasedProgressText
        ? phasedProgressText
        : phasedDesignActive && isGenerating
          ? t("page.generatingDesign")
          : generatePhaseMessage;

  useEffect(() => {
    setStructuralLineMap(null);
    setObjectRemovalMask(null);
    setProModeOpen(false);
  }, [roomImageBase64]);

  useEffect(() => {
    if (locale === "en" || !quickRoomAnalysis) return;
    const fingerprint = JSON.stringify(quickRoomAnalysis);
    if (quickRoomLocalizedRef.current === fingerprint) return;
    const localized = localizeRoomAnalysisForLocale(quickRoomAnalysis, locale);
    const localizedFingerprint = JSON.stringify(localized);
    quickRoomLocalizedRef.current = localizedFingerprint;
    if (localizedFingerprint !== fingerprint) {
      setQuickRoomAnalysis(localized);
    }
  }, [locale, quickRoomAnalysis, setQuickRoomAnalysis]);

  useEffect(() => {
    if (!showLanding) {
      setMobileTab("design");
    }
  }, [showLanding]);

  useEffect(() => {
    if (!isMobile) {
      setKeyboardOpen(false);
      return;
    }
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        setKeyboardOpen(true);
      }
    };
    const onFocusOut = () => {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
          setKeyboardOpen(false);
        }
      });
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [isMobile]);

  useEffect(() => {
    if (!lightboxSrc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightboxSrc(null); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxSrc]);

  const doLiveSearch = useCallback(
    async (q: string) => {
      const term = q.trim();
      if (!term || term.length < 2) {
        setLiveSearchResults([]);
        setLiveSearchSources([]);
        return;
      }
      if (isArmeniaLocalScrapedExclusive(selectedCountry, searchMode)) {
        setLiveSearchResults([]);
        setLiveSearchSources([]);
        return;
      }
      setLiveSearchLoading(true);
      try {
        const res = await fetch(`${getMarketplaceApiBase()}/live-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: term,
            country: selectedCountry,
            mode: searchMode,
          }),
        });
        if (!res.ok) throw new Error(t("page.liveSearchFailed"));
        const json = await res.json();
        setLiveSearchResults(json.results ?? []);
        setLiveSearchSources(json.sources ?? []);
      } catch {
        setLiveSearchResults([]);
        setLiveSearchSources([]);
      } finally {
        setLiveSearchLoading(false);
      }
    },
    [selectedCountry, searchMode, setLiveSearchResults, setLiveSearchSources, setLiveSearchLoading, t]
  );

  const doSearch = useCallback(
    async (q: string) => {
      if (!catalogSidebarEnabled) return;

      const term = q.trim();
      const amEx = isArmeniaLocalScrapedExclusive(selectedCountry, searchMode);

      if (!term || term.length < 2) {
        if (amEx) {
          if (sidebarPreloadedRef.current) return;
          sidebarPreloadedRef.current = true;
          setSearchLoading(true);
          setLiveSearchResults([]);
          setLiveSearchSources([]);
          setLiveSearchLoading(false);
          try {
            setSearchResults(await getSidebarCatalogPreview(getMarketplaceApiBase()));
          } catch {
            setSearchResults([]);
          } finally {
            setSearchLoading(false);
          }
          return;
        }
        setSearchResults([]);
        setLiveSearchResults([]);
        setLiveSearchSources([]);
        return;
      }

      setSearchLoading(true);
      if (amEx) {
        setLiveSearchResults([]);
        setLiveSearchSources([]);
        setLiveSearchLoading(false);
      } else {
        setLiveSearchLoading(true);
      }

      const dbSearchPromise = fetchCatalogSearchAllPages(getMarketplaceApiBase(), term)
        .then((rows) => setSearchResults(rows))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));

      const liveSearchPromise = amEx ? Promise.resolve() : doLiveSearch(term);

      await Promise.allSettled([dbSearchPromise, liveSearchPromise]);
    },
    [catalogSidebarEnabled, selectedCountry, searchMode, setSearchResults, setSearchLoading, setLiveSearchResults, setLiveSearchSources, setLiveSearchLoading, doLiveSearch],
  );

  const runSearchNow = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    void doSearch(searchQuery);
  }, [doSearch, searchQuery]);

  useEffect(() => {
    if (!catalogSidebarEnabled) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      void doSearch(searchQuery);
    }, 600);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [catalogSidebarEnabled, searchQuery, doSearch]);

  useEffect(() => {
    if (selectedProducts.length > prevSelectedCountRef.current) {
      const list = selectedProductsListRef.current;
      if (list) {
        requestAnimationFrame(() => {
          list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
        });
      }
    }
    prevSelectedCountRef.current = selectedProducts.length;
  }, [selectedProducts.length]);

  // Re-search when country or mode changes (if there's already a query)
  useEffect(() => {
    if (!catalogSidebarEnabled) return;
    if (searchQuery.trim().length >= 2) {
      void doLiveSearch(searchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogSidebarEnabled, selectedCountry, searchMode]);

  useEffect(() => {
    if (!catalogSidebarEnabled) return;
    void fetchCatalogStats(getMarketplaceApiBase()).then((stats) => {
      setCatalogTotalCount(stats.totalAll);
    });
  }, [catalogSidebarEnabled, selectedCountry, searchMode]);

  // Quick room: preload per-shop browse preview for sidebar + generation allowlist.
  // Gate on the stable `variant` prop, not the async-updated `vistaMode`, so the burst
  // never fires on the project workspace (or landing) — including the transient where the
  // store default vistaMode="quick" applies before the variant effect flips it.
  // `getSidebarCatalogPreview` memoizes + dedupes the request burst (incl. StrictMode's
  // double mount), so the catalog loads exactly once with no skeleton flicker.
  useEffect(() => {
    if (!catalogSidebarEnabled || searchResults.length > 0) return;
    void (async () => {
      setSearchLoading(true);
      try {
        setSearchResults(await getSidebarCatalogPreview(getMarketplaceApiBase()));
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogSidebarEnabled, selectedCountry, searchMode]);

  const handleImageFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      void compressImageFile(file)
        .then(({ base64, mimeType }) => setRoomImage(base64, mimeType))
        .catch(() => {});
    },
    [setRoomImage],
  );

  const handleExtraImageFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      void compressImageFile(file)
        .then(({ base64, mimeType }) => addQuickRoomExtraPhoto(base64, mimeType))
        .catch(() => {});
    },
    [addQuickRoomExtraPhoto],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleImageFile(file);
    },
    [handleImageFile]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImageFile(file);
      e.target.value = "";
    },
    [handleImageFile]
  );

  const patchQuickRoomAnalysis = useCallback(
    (partial: Omit<Partial<RoomAnalysis>, "estimated_dimensions"> & {
      estimated_dimensions?: Partial<RoomAnalysis["estimated_dimensions"]>;
      polygon_edges?: RoomAnalysis["polygon_edges"];
    }) => {
      useConsumerDesignStore.setState((s) => {
        const prev = s.quickRoomAnalysis;
        if (!prev) return {};
        const merged: RoomAnalysis = {
          ...prev,
          ...partial,
          estimated_dimensions: {
            ...prev.estimated_dimensions,
            ...(partial.estimated_dimensions ?? {}),
          },
        };
        const next = normalizeRoomAnalysisOpenings(merged);
        return {
          quickRoomAnalysis: next,
        };
      });
    },
    [],
  );

  const runQuickRoomAnalyze = useCallback(async () => {
    if (!roomImageBase64 || !roomImageMimeType) return;
    const runId = ++quickAnalyzeRunIdRef.current;
    setQuickRoomAnalyzing(true);
    setQuickRoomAnalyzeError(null);
    setQuickRoomFactsExpanded(false);
    try {
      const form = new FormData();
      const blob = await fetch(`data:${roomImageMimeType};base64,${roomImageBase64}`).then((r) => r.blob());
      form.set("roomImage", blob, "room.jpg");
      form.set("locale", locale);

      const res = await fetch("/api/interior-design/analyze", { method: "POST", body: form });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error(t("page.invalidAnalyzeResponse"));
      }
      if (runId !== quickAnalyzeRunIdRef.current) return;
      const errObj =
        typeof json === "object" && json !== null && "error" in json
          ? (json as { error?: unknown }).error
          : undefined;
      const msg = typeof errObj === "string" && errObj.trim() ? errObj.trim() : t("page.roomAnalysisFailed");
      if (!res.ok || typeof json !== "object" || json === null || !(json as { data?: unknown }).data) {
        const code =
          typeof json === "object" && json !== null && "code" in json
            ? (json as { code?: string }).code
            : undefined;
        throwIfAiServiceUnavailable({ error: msg, code });
        throw new Error(msg);
      }
      setQuickRoomAnalysis(
        localizeRoomAnalysisForLocale(
          normalizeRoomAnalysisOpenings((json as { data: unknown }).data),
          locale,
        ),
      );
    } catch (e) {
      if (runId !== quickAnalyzeRunIdRef.current) return;
      if (openSupportModalForAiError(e)) {
        setQuickRoomAnalyzeError(null);
      } else {
        setQuickRoomAnalyzeError(e instanceof Error ? e.message : t("page.analysisFailed"));
      }
      setQuickRoomAnalysis(null);
    } finally {
      if (runId === quickAnalyzeRunIdRef.current) setQuickRoomAnalyzing(false);
    }
  }, [
    roomImageBase64,
    roomImageMimeType,
    setQuickRoomAnalyzing,
    setQuickRoomAnalyzeError,
    setQuickRoomAnalysis,
    t,
    locale,
  ]);

  useEffect(() => {
    if (vistaMode !== "quick") return;
    if (!roomImageBase64 || !roomImageMimeType) return;
    void runQuickRoomAnalyze();
  }, [vistaMode, roomImageBase64, roomImageMimeType, quickAnalyzeNonce, runQuickRoomAnalyze]);

  const amLocalExclusive = isArmeniaLocalScrapedExclusive(selectedCountry, searchMode);

  const sidebarPreviewSections = useMemo(
    () => selectSidebarPreviewSections(searchResults),
    [searchResults],
  );

  const sidebarPreviewProducts = useMemo(
    () => selectSidebarPreview(searchResults),
    [searchResults],
  );

  const browseProductCount =
    (catalogTotalCount > 0 ? catalogTotalCount : searchResults.length) +
    (amLocalExclusive ? 0 : liveSearchResults.length);

  const showAllProductsButton =
    browseProductCount > sidebarPreviewProducts.length &&
    (sidebarPreviewProducts.length > 0 || browseProductCount > 0);

  const sidebarSectionTitle = useCallback(
    (section: SidebarPreviewSection) => {
      switch (section.kind) {
        case "sofa":
          return t("page.sidebarSectionSofas");
        case "armchair":
          return t("page.sidebarSectionArmchairs");
        case "table":
          return t("page.sidebarSectionTables");
        case "chair":
          return t("page.sidebarSectionChairs");
        case "laminateFlooring":
          return t("page.sidebarSectionLaminateFlooring");
        case "tileFlooring":
          return t("page.sidebarSectionTileFlooring");
        default:
          return t("page.sidebarSectionMore");
      }
    },
    [t],
  );

  const handleAddLiveProduct = useCallback(
    (product: LiveSearchProduct, idx: number) => {
      track("product_added_to_design", { source: "live", product_name: product.name });
      addProduct(mapLiveToMarketplace(product, idx));
    },
    [addProduct],
  );

  const handleAddCatalogProduct = useCallback(
    (product: MarketplaceProduct) => {
      track("product_added_to_design", { source: "catalog", product_id: product.id, product_name: product.name });
      addProduct(product);
    },
    [addProduct],
  );

  const quickRoomSpatialReady =
    vistaMode !== "quick" ||
    !roomImageBase64 ||
    Boolean(
      quickRoomAnalysis &&
        !quickRoomAnalyzing &&
        !quickRoomAnalyzeError,
    );

  const generateFormReady =
    !!roomImageBase64 &&
    !!textPrompt.trim() &&
    !isGenerating &&
    quickRoomSpatialReady;

  const insufficientTokensForGenerate =
    tokenBalance !== null && tokenBalance < TOKEN_COSTS.generate;

  const userHasDecorPins = useMemo(
    () => selectedProducts.some((product) => classifyPinnedProductPhase(product) === "decor"),
    [selectedProducts],
  );
  const phase3Skippable = !userHasDecorPins && isDecorPhaseSkippableForStyle(selectedStyle);

  const handleGenerate = useCallback(async (opts?: {
    promptOverride?: string;
    feedbackText?: string;
    attachmentOverride?: { base64: string; mimeType: string } | null;
    keepRoomShape?: boolean;
    tokenAction?: TokenAction;
  }) => {
    const tokenAction: TokenAction = opts?.tokenAction ?? "generate";
    const actionCost = TOKEN_COSTS[tokenAction];
    const prompt = opts?.promptOverride ?? textPrompt.trim();
    const imgB64 = opts?.attachmentOverride?.base64 ?? roomImageBase64;
    const imgMime = opts?.attachmentOverride?.mimeType ?? roomImageMimeType;
    if (!imgB64 || !prompt || isGenerating) return;
    if (tokenBalance !== null && tokenBalance < actionCost) {
      setError(t("tokens.insufficientBalance", { cost: actionCost, balance: tokenBalance }));
      track("design_generate_blocked", { mode: "quick", reason: "balance", token_action: tokenAction });
      return;
    }
    const generateStartedAt = Date.now();
    track("design_generate_started", { mode: "quick", token_action: tokenAction });

    if (isPersistenceAuthenticated() && !useConsumerDesignStore.getState().currentProjectDbId) {
      await createProject({
        mode: "quick_room",
        title: prompt.slice(0, 80) || undefined,
        style: selectedStyle,
        roomImageBase64: imgB64,
        roomImageMime: imgMime,
        roomAnalysis: (quickRoomAnalysis ?? undefined) as Record<string, unknown> | undefined,
        roomGeometry: (lastRoomGeometry ?? undefined) as Record<string, unknown> | undefined,
      });
      await loadProjects();
    }

    const projectDbId = useConsumerDesignStore.getState().currentProjectDbId;
    const styleInspirationPayload = styleInspirationsToPatchPayload(styleInspirations);
    if (projectDbId && isPersistenceAuthenticated() && styleInspirationPayload.length > 0) {
      void saveInspirationImages(projectDbId, styleInspirationPayload);
    }

    if (generatedImageBase64 && generatedImageMimeType) {
      pushDesignVersion({
        id: `v-${Date.now()}`,
        imageBase64: generatedImageBase64,
        imageMimeType: generatedImageMimeType,
        brief: designBrief,
        feedback: opts?.feedbackText ?? null,
        timestamp: Date.now(),
      });
    }

    setIsGenerating(true);
    setGeneratePhase("generating");
    setError(null);
    setGenerationDebug(null);
    setDesignBrief(null);
    setProductLinks([]);
    setUsedScrapedProducts([]);

    try {
      const blob = await fetch(`data:${imgMime};base64,${imgB64}`).then((r) => r.blob());

      const isCustom = designMode === "custom";
      const buildGenerateFormData = async () => {
        const form = new FormData();
        form.set("textPrompt", prompt);
        form.set("style", selectedStyle);
        form.set("countryCode", selectedCountry);
        form.set("searchMode", searchMode);
        form.set("designMode", designMode);
        // Custom mode is a free render with no catalog tie — don't trigger the
        // scraped-catalog path (quickRoomMode) or send any product constraints.
        if (!isCustom) {
          form.set("quickRoomMode", "true");
        }
        form.set("roomImage", blob, "room.jpg");

        for (const extra of quickRoomExtraPhotos) {
          const extraBlob = await fetch(`data:${extra.mimeType};base64,${extra.base64}`).then((r) => r.blob());
          form.append("extraRoomImages", extraBlob, "extra-room.jpg");
        }

        if (opts?.keepRoomShape) {
          form.set("keepRoomShape", "true");
          if (quickRoomAnalysis) {
            form.set("roomAnalysis", JSON.stringify(quickRoomAnalysis));
          }
          if (designBrief) {
            const editContextParts = [
              designBrief.cameraAngle ? `Previous camera angle: ${designBrief.cameraAngle}` : "",
              designBrief.composition ? `Previous composition: ${designBrief.composition}` : "",
              "Preserve the exact camera angle, perspective, and spatial composition from the previous render. Apply only the user's requested design changes.",
            ].filter(Boolean);
            if (editContextParts.length > 0) {
              form.set("editContext", editContextParts.join("\n"));
            }
          }
        } else if (!opts?.attachmentOverride?.base64 && quickRoomAnalysis) {
          form.set("roomAnalysis", JSON.stringify(quickRoomAnalysis));
        }

        const doorDesign = designBrief?.doorDesign?.trim();
        if (doorDesign) form.set("doorDesign", doorDesign);

        if (!isCustom && selectedProducts.length > 0) {
          form.set("designBoardProductIds", JSON.stringify(selectedProducts.map((p) => p.id)));
        }

        const allowlistIds = [
          ...new Set([
            ...selectedProducts.map((p) => p.id),
            ...searchResults.map((p) => p.id),
          ]),
        ].filter((id) => Number.isFinite(id) && id > 0);
        if (!isCustom && allowlistIds.length > 0) {
          form.set("catalogAllowlistIds", JSON.stringify(allowlistIds.slice(0, 120)));
        }

        if (!isCustom && inspirationProducts.length > 0) {
          for (const ip of inspirationProducts) {
            if (ip.base64 && ip.mimeType) {
              const ipBlob = await fetch(`data:${ip.mimeType};base64,${ip.base64}`).then((r) => r.blob());
              form.append("inspirationImages", ipBlob, "inspiration.jpg");
              form.append("inspirationLabels", ip.label || "");
            }
          }
          for (const ip of inspirationProducts) {
            if (!ip.base64 && ip.url) {
              form.append("inspirationUrls", ip.url);
              form.append("inspirationLabels", ip.label || "");
            }
          }
        }

        if (styleInspirations.length > 0) {
          await appendStyleInspirationsToFormAsync(form, styleInspirations);
        }

        if (structuralLineMap?.base64) {
          form.set("structuralLineMapBase64", structuralLineMap.base64);
          form.set("structuralLineMapMime", structuralLineMap.mimeType);
          if (structuralLineMap.strokeOnly) {
            form.set("structuralLineStrokeOnly", "true");
          }
        }

        if (objectRemovalMask?.base64) {
          form.set("objectRemovalMaskBase64", objectRemovalMask.base64);
          form.set("objectRemovalMaskMime", objectRemovalMask.mimeType);
        }

        return form;
      };

      type GenerateJson = {
        error?: string;
        code?: string;
        balance?: number;
        data?: {
          images?: Array<{ base64?: string; mimeType?: string }>;
          designBrief?: {
            subject?: string;
            style?: string;
            arrangement?: string;
            fullPrompt?: string;
            selectedCatalogIds?: string[];
            roomType?: string;
            room_type?: string;
            cameraAngle?: string;
            camera_angle?: string;
            composition?: string;
            doorDesign?: string;
            door_design?: string;
          };
          productLinks?: ProductPurchaseLink[];
          usedProducts?: ProductPurchaseLink[];
          selectedCatalogIds?: string[];
          plannedCatalogIds?: string[];
        };
      };

      const { authHeaders } = authContextForApi();
      const {
        geometry: returnedGeometry,
        geometryExtractionFailed: returnedGeoFailed,
        json: jsonUnknown,
        res,
        debug,
      } = await analyzeAndRedesign({
        onPhase: (msg) => setGeneratePhase(resolveGeneratePhase(msg)),
        roomImageBlob: blob,
        buildGenerateFormData,
        skipGeometry: opts?.keepRoomShape,
        preloadedGeometry: opts?.keepRoomShape
          ? { geometry: lastRoomGeometry, failed: lastGeometryExtractionFailed }
          : undefined,
        tokenAction,
        requestHeaders: authHeaders,
        onDebug: setGenerationDebug,
      });
      setGenerationDebug(debug);
      const json = jsonUnknown as GenerateJson;

      if (!res.ok || json.error) {
        void refreshTokenBalance();
        throwIfAiServiceUnavailable(json);
        throw new Error(formatApiErrorMessage(json.error, t("page.generationFailed")));
      }

      if (typeof json.balance === "number") {
        setTokenBalance(json.balance);
      } else {
        void refreshTokenBalance();
      }

      const images = json.data?.images;
      if (images?.[0]) {
        setGeneratedImage(images[0].base64 ?? null, images[0].mimeType ?? null);
      }
      track("design_generate_succeeded", {
        mode: "quick",
        token_action: tokenAction,
        duration_ms: Date.now() - generateStartedAt,
      });
      setMarkerMode(false);
      setAnnotatedImageBase64(null);
      setAnnotatedImageMimeType(null);

      if (json.data?.designBrief) {
        const b = json.data.designBrief;
        setDesignBrief({
          subject: b.subject ?? "",
          style: b.style ?? "",
          arrangement: b.arrangement ?? "",
          fullPrompt: b.fullPrompt ?? "",
          roomType: b.roomType ?? b.room_type ?? "",
          cameraAngle: b.cameraAngle ?? b.camera_angle ?? "",
          composition: b.composition ?? "",
          doorDesign: b.doorDesign ?? b.door_design ?? "",
        });
      }

      if (!opts?.keepRoomShape) {
        setLastRoomGeometry(returnedGeometry, returnedGeoFailed);
        if (returnedGeometry?.polygon_edges?.length && quickRoomAnalysis) {
          const bbox = bboxFromPolygonEdges(
            quickRoomAnalysis.room_shape,
            returnedGeometry.polygon_edges,
          );
          patchQuickRoomAnalysis({
            polygon_edges: returnedGeometry.polygon_edges,
            estimated_dimensions: { width: bbox.width, depth: bbox.depth },
          });
        }
      }

      if (json.data?.productLinks) {
        setProductLinks(json.data.productLinks);
      }

      const generatedBase64 = images?.[0]?.base64;
      const generatedMime = images?.[0]?.mimeType ?? "image/png";
      if (generatedBase64 && isPersistenceAuthenticated() && useConsumerDesignStore.getState().currentProjectDbId) {
        const versionType = opts?.feedbackText
          ? "edited"
          : tokenAction === "regenerate"
            ? "regenerated"
            : "generated";
        await addVersion({
          base64: generatedBase64,
          mimeType: generatedMime,
          promptUsed: prompt,
          feedback: opts?.feedbackText ?? null,
          designBrief: json.data?.designBrief ?? null,
          productsUsed: json.data?.productLinks ?? null,
          roomGeometry: (returnedGeometry ?? null) as Record<string, unknown> | null,
          type: versionType,
        });
        await addMessage({
          role: "user",
          contentType: "text",
          text: prompt,
        });
        await loadProjects();
      }
    } catch (err) {
      void refreshTokenBalance();
      track("design_generate_failed", {
        mode: "quick",
        token_action: tokenAction,
        duration_ms: Date.now() - generateStartedAt,
        error_message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      if (openSupportModalForAiError(err)) return;
      const raw = err instanceof Error ? err.message : "";
      setError(
        /timed out at the edge|gateway time-out|error 504/i.test(raw)
          ? t("page.gatewayTimeout")
          : sanitizeUserFacingMessage(raw) || t("common.error"),
      );
      if (err instanceof Error && /Invalid JSON|HTML error page|timed out/i.test(err.message)) {
        console.error("[vista:generate] client error:", err.message);
      }
    } finally {
      setIsGenerating(false);
      setGeneratePhase("idle");
    }
  }, [
    textPrompt,
    selectedStyle,
    designMode,
    roomImageBase64,
    roomImageMimeType,
    quickRoomAnalysis,
    isGenerating,
    generatedImageBase64,
    generatedImageMimeType,
    designBrief,
    selectedProducts,
    searchResults,
    inspirationProducts,
    styleInspirations,
    selectedCountry,
    searchMode,
    vistaMode,
    lastRoomGeometry,
    lastGeometryExtractionFailed,
    pushDesignVersion,
    setIsGenerating,
    setError,
    setGeneratedImage,
    setDesignBrief,
    setProductLinks,
    setLastRoomGeometry,
    patchQuickRoomAnalysis,
    tokenBalance,
    setTokenBalance,
    refreshTokenBalance,
    createProject,
    addVersion,
    addMessage,
    loadProjects,
    isPersistenceAuthenticated,
    saveInspirationImages,
    t,
  ]);

  const handleRegenerate = useCallback(() => {
    const prompt = designBrief?.fullPrompt || textPrompt.trim();
    if (prompt) handleGenerate({ promptOverride: prompt, tokenAction: "regenerate" });
  }, [designBrief, textPrompt, handleGenerate]);

  // --- Phased design handlers ---

  const handleStartPhasedDesign = useCallback(async () => {
    if (!roomImageBase64 || !roomImageMimeType || !textPrompt.trim() || isGenerating) return;
    track("design_generate_started", { mode: "phased", phase: "base" });
    startPhasedDesign();
    setIsGenerating(true);
    setError(null);
    setPhasedSlotNotices([]);
    setPhasedProgressText("Selecting materials & lighting...");

    try {
      const blob = await fetch(`data:${roomImageMimeType};base64,${roomImageBase64}`).then((r) => r.blob());
      const { authHeaders } = authContextForApi();

      const buildForm = () => {
        const form = new FormData();
        form.set("textPrompt", textPrompt.trim());
        form.set("style", selectedStyle);
        form.set("countryCode", selectedCountry);
        form.set("searchMode", searchMode);
        form.set("roomImage", blob, "room.jpg");
        if (quickRoomAnalysis) form.set("roomAnalysis", JSON.stringify(quickRoomAnalysis));
        if (designBrief?.doorDesign?.trim()) {
          form.set("doorDesign", designBrief.doorDesign.trim());
        }
        if (selectedProducts.length > 0) {
          form.set("designBoardProductIds", JSON.stringify(selectedProducts.map((p) => p.id)));
        }
        const allowlistIds = [...new Set([...selectedProducts.map((p) => p.id), ...searchResults.map((p) => p.id)])]
          .filter((id) => Number.isFinite(id) && id > 0);
        if (allowlistIds.length > 0) form.set("catalogAllowlistIds", JSON.stringify(allowlistIds.slice(0, 120)));
        if (inspirationProducts.length > 0) {
          for (const ip of inspirationProducts) {
            if (ip.base64 && ip.mimeType) {
              const ipBlob = new Blob([Uint8Array.from(atob(ip.base64), (c) => c.charCodeAt(0))], { type: ip.mimeType });
              form.append("inspirationImages", ipBlob, "inspiration.jpg");
              form.append("inspirationLabels", ip.label || "");
            }
          }
        }
        if (styleInspirations.length > 0) {
          appendStyleInspirationsToForm(form, styleInspirations);
        }
        form.set("tokenAction", "generate");
        return form;
      };

      setPhasedStatus("generating");
      const result = await runPhasedGeneration({
        phase: "base",
        formData: buildForm(),
        onProgress: (status) => {
          setPhasedProgressText(status);
          if (status.startsWith("Selecting")) setPhasedStatus("selecting");
          else if (status.startsWith("Generating")) setPhasedStatus("generating");
        },
        requestHeaders: authHeaders,
      });

      setPhaseResult("base", result.image, result.confirmedProducts);
      track("design_generate_succeeded", { mode: "phased", phase: "base" });
      setPhasedAllProductLinks(result.productLinks);
      setPhasedAllProductIds(result.allPhaseProductIds);
      if (result.imaginedSlots?.length) {
        setPhasedSlotNotices(result.imaginedSlots.map((s) => t("page.slotNoticeImagined", { label: s.label })));
      }
      if (typeof result.balance === "number") setTokenBalance(result.balance);

      // Fire off parallel base-phase generation for each extra photo (background).
      const snapshot = useConsumerDesignStore.getState();
      const extras = snapshot.quickRoomExtraPhotos ?? [];
      if (extras.length > 0) {
        void Promise.allSettled(
          extras.map(async (photo) => {
            try {
              const extraBlob = await fetch(`data:${photo.mimeType};base64,${photo.base64}`).then((r) => r.blob());
              const form = buildForm();
              form.set("roomImage", extraBlob, "room.jpg");
              const extraResult = await runPhasedGeneration({
                phase: "base",
                formData: form,
                onProgress: () => {},
                requestHeaders: authHeaders,
              });
              setViewpointTrackResult(photo.id, "base", {
                id: `pv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                image: extraResult.image,
                products: extraResult.confirmedProducts,
                timestamp: Date.now(),
              });
            } catch (err) {
              console.warn(`Extra viewpoint base generation failed for ${photo.id}:`, err);
            }
          }),
        );
      }
    } catch (err) {
      track("design_generate_failed", {
        mode: "phased",
        phase: "base",
        error_message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      if (openSupportModalForAiError(err)) return;
      setPhasedError(err instanceof Error ? err.message : "Phase 1 generation failed.");
    } finally {
      setIsGenerating(false);
      setPhasedProgressText("");
    }
  }, [
    roomImageBase64, roomImageMimeType, textPrompt, isGenerating, selectedStyle,
    selectedCountry, searchMode, quickRoomAnalysis, selectedProducts, searchResults,
    inspirationProducts, styleInspirations, startPhasedDesign, setIsGenerating, setError, setPhasedStatus,
    setPhaseResult, setPhasedAllProductLinks, setPhasedAllProductIds, setPhasedError, setTokenBalance,
    setViewpointTrackResult,
  ]);

  const handleGenerateClick = useCallback(async () => {
    if (!generateFormReady || isGenerating || topUpRedirecting) return;

    if (insufficientTokensForGenerate) {
      setTopUpRedirecting(true);
      setError(null);
      try {
        const url = await startTokenTopUpCheckout(locale, selectedCountry);
        window.location.href = url;
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("tokens.couldNotStartCheckout");
        if (/sign in/i.test(msg)) {
          window.location.href = "/login?next=/";
          return;
        }
        setError(msg);
        setTopUpRedirecting(false);
      }
      return;
    }

    if (designMode === "custom") {
      void handleGenerate({ tokenAction: "generate" });
    } else {
      void handleStartPhasedDesign();
    }
  }, [
    designMode,
    generateFormReady,
    handleGenerate,
    handleStartPhasedDesign,
    insufficientTokensForGenerate,
    isGenerating,
    locale,
    selectedCountry,
    t,
    topUpRedirecting,
  ]);

  const handleApprovePhase = useCallback(async () => {
    if (isGenerating) return;
    resetPhasedAnnotation();
    const currentPhase = phasedCurrentPhase as DesignPhase;
    approvePhase(currentPhase);

    const snapshot = useConsumerDesignStore.getState();
    const approvedImage = getSelectedPhaseImage(snapshot, currentPhase);

    let nextPhase: DesignPhase;
    if (currentPhase === "base") nextPhase = "furniture";
    else if (currentPhase === "furniture") nextPhase = "decor";
    else {
      const finalImage =
        approvedImage
        ?? getSelectedPhaseImage(snapshot, "decor")
        ?? getSelectedPhaseImage(snapshot, "furniture")
        ?? getSelectedPhaseImage(snapshot, "base");
      if (finalImage) {
        setGeneratedImage(finalImage.base64, finalImage.mimeType);
        setProductLinks(phasedAllProductLinks);
      }
      setPhasedPhase("complete");
      track("design_generate_succeeded", { mode: "phased", phase: "complete" });

      // Assemble final views from per-viewpoint tracks — each track has its own
      // fully phased pipeline, so no re-shoot needed. Primary comes from the main
      // phase state; extras come from viewpointTracks.
      const extraPhotos = snapshot.quickRoomExtraPhotos ?? [];
      const tracks = snapshot.viewpointTracks ?? {};
      if (finalImage && extraPhotos.length > 0 && Object.keys(tracks).length > 0) {
        const primaryView = {
          id: `view-primary-${Date.now()}`,
          base64: finalImage.base64,
          mimeType: finalImage.mimeType,
        };
        const extraViews = extraPhotos
          .map((photo, i) => {
            const track = tracks[photo.id];
            if (!track) return null;
            const terminal =
              track.phase3Versions[track.phase3SelectedIndex] ??
              track.phase2Versions[track.phase2SelectedIndex] ??
              track.phase1Versions[track.phase1SelectedIndex];
            if (!terminal?.image) return null;
            return {
              id: `view-extra-${Date.now()}-${i}`,
              base64: terminal.image.base64,
              mimeType: terminal.image.mimeType,
            };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);
        setPhasedFinalViews([primaryView, ...extraViews]);
      }
      return;
    }

    setPhasedPhase(nextPhase);
    setIsGenerating(true);
    setPhasedStatus("generating");
    track("design_generate_started", { mode: "phased", phase: nextPhase });

    try {
      const previousImage = approvedImage;
      if (!previousImage) throw new Error("No previous phase image available.");

      const prevBlob = await fetch(`data:${previousImage.mimeType};base64,${previousImage.base64}`).then((r) => r.blob());
      const roomBlob = roomImageBase64 && roomImageMimeType
        ? await fetch(`data:${roomImageMimeType};base64,${roomImageBase64}`).then((r) => r.blob())
        : undefined;

      const { authHeaders } = authContextForApi();
      const form = new FormData();
      form.set("textPrompt", textPrompt.trim());
      form.set("style", selectedStyle);
      form.set("countryCode", selectedCountry);
      form.set("searchMode", searchMode);
      if (roomBlob) form.set("roomImage", roomBlob, "room.jpg");
      if (quickRoomAnalysis) form.set("roomAnalysis", JSON.stringify(quickRoomAnalysis));
      if (designBrief?.doorDesign?.trim()) {
        form.set("doorDesign", designBrief.doorDesign.trim());
      }
      if (selectedProducts.length > 0) {
        form.set("designBoardProductIds", JSON.stringify(selectedProducts.map((p) => p.id)));
      }
      const allowlistIds = [...new Set([...selectedProducts.map((p) => p.id), ...searchResults.map((p) => p.id)])]
        .filter((id) => Number.isFinite(id) && id > 0);
      if (allowlistIds.length > 0) form.set("catalogAllowlistIds", JSON.stringify(allowlistIds.slice(0, 120)));
      if (inspirationProducts.length > 0) {
        for (const ip of inspirationProducts) {
          if (ip.base64 && ip.mimeType) {
            const ipBlob = new Blob([Uint8Array.from(atob(ip.base64), (c) => c.charCodeAt(0))], { type: ip.mimeType });
            form.append("inspirationImages", ipBlob, "inspiration.jpg");
            form.append("inspirationLabels", ip.label || "");
          }
        }
      }
      if (styleInspirations.length > 0) {
        appendStyleInspirationsToForm(form, styleInspirations);
      }
      form.set("tokenAction", "none");

      const previousProducts = currentPhase === "base"
        ? getSelectedPhaseProducts(snapshot, "base")
        : [
            ...getSelectedPhaseProducts(snapshot, "base"),
            ...getSelectedPhaseProducts(snapshot, "furniture"),
          ];

      const result = await runPhasedGeneration({
        phase: nextPhase,
        formData: form,
        previousPhaseImage: prevBlob,
        previousPhaseProducts: previousProducts,
        onProgress: () => {},
        requestHeaders: authHeaders,
      });

      setPhaseResult(nextPhase, result.image, result.confirmedProducts);
      track("design_generate_succeeded", { mode: "phased", phase: nextPhase });
      setPhasedAllProductLinks(result.productLinks);
      setPhasedAllProductIds(result.allPhaseProductIds);
      if (result.imaginedSlots?.length) {
        const notices = result.imaginedSlots.map((s) => t("page.slotNoticeImagined", { label: s.label }));
        setPhasedSlotNotices((prev) => [...new Set([...prev, ...notices])]);
      }
      if (typeof result.balance === "number") setTokenBalance(result.balance);

      // Parallel generation for extra viewpoint photos.
      const extras = snapshot.quickRoomExtraPhotos ?? [];
      const tracks = snapshot.viewpointTracks ?? {};
      if (extras.length > 0) {
        void Promise.allSettled(
          extras.map(async (photo) => {
            try {
              const track = tracks[photo.id];
              const fieldMap = { base: "phase1", furniture: "phase2", decor: "phase3" } as const;
              const prevPhase: DesignPhase = nextPhase === "furniture" ? "base" : "furniture";
              const prevField = fieldMap[prevPhase];
              const prevVersions = track?.[`${prevField}Versions` as const];
              const prevIdx = track?.[`${prevField}SelectedIndex` as const] ?? 0;
              const prevTrackImg = prevVersions?.[prevIdx]?.image;
              if (!prevTrackImg) return;
              const extraPrevBlob = await fetch(`data:${prevTrackImg.mimeType};base64,${prevTrackImg.base64}`).then((r) => r.blob());
              const extraRoomBlob = await fetch(`data:${photo.mimeType};base64,${photo.base64}`).then((r) => r.blob());
              const extraForm = new FormData();
              extraForm.set("textPrompt", textPrompt.trim());
              extraForm.set("style", selectedStyle);
              extraForm.set("countryCode", selectedCountry);
              extraForm.set("searchMode", searchMode);
              extraForm.set("roomImage", extraRoomBlob, "room.jpg");
              if (quickRoomAnalysis) extraForm.set("roomAnalysis", JSON.stringify(quickRoomAnalysis));
              extraForm.set("tokenAction", "none");
              const extraResult = await runPhasedGeneration({
                phase: nextPhase,
                formData: extraForm,
                previousPhaseImage: extraPrevBlob,
                previousPhaseProducts: previousProducts,
                onProgress: () => {},
                requestHeaders: authHeaders,
              });
              setViewpointTrackResult(photo.id, nextPhase, {
                id: `pv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                image: extraResult.image,
                products: extraResult.confirmedProducts,
                timestamp: Date.now(),
              });
            } catch (err) {
              console.warn(`Extra viewpoint ${nextPhase} generation failed for ${photo.id}:`, err);
            }
          }),
        );
      }
    } catch (err) {
      track("design_generate_failed", {
        mode: "phased",
        phase: nextPhase,
        error_message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      if (openSupportModalForAiError(err)) return;
      setPhasedError(err instanceof Error ? err.message : `Phase "${nextPhase}" generation failed.`);
    } finally {
      setIsGenerating(false);
    }
  }, [
    isGenerating, phasedCurrentPhase, phasedAllProductLinks,
    roomImageBase64, roomImageMimeType, textPrompt, selectedStyle, selectedCountry,
    searchMode, quickRoomAnalysis, lastRoomGeometry, selectedProducts, searchResults, inspirationProducts, styleInspirations,
    approvePhase, setIsGenerating, setPhasedPhase, setPhasedStatus, setPhaseResult,
    setPhasedAllProductLinks, setPhasedAllProductIds, setPhasedFinalViews, setPhasedError, setTokenBalance, setGeneratedImage, setProductLinks,
    resetPhasedAnnotation, setViewpointTrackResult,
  ]);

  const handleRedoPhase = useCallback(async () => {
    if (isGenerating) return;
    resetPhasedAnnotation();
    const currentPhase = phasedCurrentPhase as DesignPhase;
    setPhasedStatus("generating");
    setIsGenerating(true);

    try {
      const snapshot = useConsumerDesignStore.getState();
      const { authHeaders } = authContextForApi();
      const roomBlob = roomImageBase64 && roomImageMimeType
        ? await fetch(`data:${roomImageMimeType};base64,${roomImageBase64}`).then((r) => r.blob())
        : null;

      let prevBlob: Blob | undefined;
      const phase1Image = getSelectedPhaseImage(snapshot, "base");
      const phase2Image = getSelectedPhaseImage(snapshot, "furniture");
      if (currentPhase === "furniture" && phase1Image) {
        prevBlob = await fetch(`data:${phase1Image.mimeType};base64,${phase1Image.base64}`).then((r) => r.blob());
      } else if (currentPhase === "decor" && phase2Image) {
        prevBlob = await fetch(`data:${phase2Image.mimeType};base64,${phase2Image.base64}`).then((r) => r.blob());
      }

      const form = new FormData();
      form.set("textPrompt", textPrompt.trim());
      form.set("style", selectedStyle);
      form.set("countryCode", selectedCountry);
      form.set("searchMode", searchMode);
      if (roomBlob) form.set("roomImage", roomBlob, "room.jpg");
      if (quickRoomAnalysis) form.set("roomAnalysis", JSON.stringify(quickRoomAnalysis));
      if (designBrief?.doorDesign?.trim()) {
        form.set("doorDesign", designBrief.doorDesign.trim());
      }
      if (selectedProducts.length > 0) {
        form.set("designBoardProductIds", JSON.stringify(selectedProducts.map((p) => p.id)));
      }
      if (inspirationProducts.length > 0) {
        for (const ip of inspirationProducts) {
          if (ip.base64 && ip.mimeType) {
            const ipBlob = new Blob([Uint8Array.from(atob(ip.base64), (c) => c.charCodeAt(0))], { type: ip.mimeType });
            form.append("inspirationImages", ipBlob, "inspiration.jpg");
            form.append("inspirationLabels", ip.label || "");
          }
        }
      }
      if (styleInspirations.length > 0) {
        appendStyleInspirationsToForm(form, styleInspirations);
      }
      form.set("tokenAction", "regenerate");

      const phase1Products = getSelectedPhaseProducts(snapshot, "base");
      const phase2Products = getSelectedPhaseProducts(snapshot, "furniture");
      const previousProducts = currentPhase === "furniture"
        ? phase1Products
        : [...phase1Products, ...phase2Products];

      const result = await runPhasedGeneration({
        phase: currentPhase,
        formData: form,
        previousPhaseImage: prevBlob,
        previousPhaseProducts: currentPhase !== "base" ? previousProducts : undefined,
        onProgress: () => {},
        requestHeaders: authHeaders,
      });

      setPhaseResult(currentPhase, result.image, result.confirmedProducts);
      setPhasedAllProductLinks(result.productLinks);
      setPhasedAllProductIds(result.allPhaseProductIds);
      if (result.imaginedSlots?.length) {
        const notices = result.imaginedSlots.map((s) => t("page.slotNoticeImagined", { label: s.label }));
        setPhasedSlotNotices((prev) => [...new Set([...prev, ...notices])]);
      }
      if (typeof result.balance === "number") setTokenBalance(result.balance);
    } catch (err) {
      if (openSupportModalForAiError(err)) return;
      setPhasedError(err instanceof Error ? err.message : "Redo failed.");
    } finally {
      setIsGenerating(false);
    }
  }, [
    isGenerating, phasedCurrentPhase,
    roomImageBase64, roomImageMimeType, textPrompt, selectedStyle,
    selectedCountry, searchMode, quickRoomAnalysis, selectedProducts, inspirationProducts, styleInspirations,
    setIsGenerating, setPhasedStatus, setPhaseResult, setPhasedAllProductLinks, setPhasedAllProductIds, setPhasedError, setTokenBalance,
    resetPhasedAnnotation,
  ]);

  const handlePhaseEditSubmit = useCallback(async () => {
    const feedback = phaseEditFeedback.trim();
    if (!feedback || isGenerating) return;
    const currentPhase = phasedCurrentPhase as DesignPhase;
    const annotatedBase64 = phasedAnnotatedBase64;
    const annotatedMimeType = phasedAnnotatedMimeType;
    const hasPhasedAnnotation = Boolean(annotatedBase64 && annotatedMimeType);
    setPhasedStatus("generating");
    setIsGenerating(true);
    setPhaseEditFeedback("");
    setPhaseEditOpen(false);
    resetPhasedAnnotation();

    try {
      const snapshot = useConsumerDesignStore.getState();
      const { authHeaders } = authContextForApi();
      let roomBlob = roomImageBase64 && roomImageMimeType
        ? await fetch(`data:${roomImageMimeType};base64,${roomImageBase64}`).then((r) => r.blob())
        : null;

      let prevBlob: Blob | undefined;
      const phase1Image = getSelectedPhaseImage(snapshot, "base");
      const phase2Image = getSelectedPhaseImage(snapshot, "furniture");
      if (hasPhasedAnnotation) {
        const annotatedBlob = await fetch(
          `data:${annotatedMimeType};base64,${annotatedBase64}`,
        ).then((r) => r.blob());
        if (currentPhase === "base") {
          roomBlob = annotatedBlob;
        } else {
          prevBlob = annotatedBlob;
        }
      } else if (currentPhase === "furniture" && phase1Image) {
        prevBlob = await fetch(`data:${phase1Image.mimeType};base64,${phase1Image.base64}`).then((r) => r.blob());
      } else if (currentPhase === "decor" && phase2Image) {
        prevBlob = await fetch(`data:${phase2Image.mimeType};base64,${phase2Image.base64}`).then((r) => r.blob());
      }

      const annotationHint = hasPhasedAnnotation
        ? "\n\nApply the refinement to the areas marked in red on the reference image."
        : "";
      const editedPrompt = `${textPrompt.trim()}\n\nUser refinement: ${feedback}${annotationHint}`;
      const form = new FormData();
      form.set("textPrompt", editedPrompt);
      form.set("style", selectedStyle);
      form.set("countryCode", selectedCountry);
      form.set("searchMode", searchMode);
      if (roomBlob) form.set("roomImage", roomBlob, "room.jpg");
      if (quickRoomAnalysis) form.set("roomAnalysis", JSON.stringify(quickRoomAnalysis));
      if (designBrief?.doorDesign?.trim()) {
        form.set("doorDesign", designBrief.doorDesign.trim());
      }
      if (selectedProducts.length > 0) {
        form.set("designBoardProductIds", JSON.stringify(selectedProducts.map((p) => p.id)));
      }
      if (inspirationProducts.length > 0) {
        for (const ip of inspirationProducts) {
          if (ip.base64 && ip.mimeType) {
            const ipBlob = new Blob([Uint8Array.from(atob(ip.base64), (c) => c.charCodeAt(0))], { type: ip.mimeType });
            form.append("inspirationImages", ipBlob, "inspiration.jpg");
            form.append("inspirationLabels", ip.label || "");
          }
        }
      }
      if (styleInspirations.length > 0) {
        appendStyleInspirationsToForm(form, styleInspirations);
      }
      form.set("tokenAction", "edit");

      const phase1Products = getSelectedPhaseProducts(snapshot, "base");
      const phase2Products = getSelectedPhaseProducts(snapshot, "furniture");
      const previousProducts = currentPhase === "furniture"
        ? phase1Products
        : [...phase1Products, ...phase2Products];

      const result = await runPhasedGeneration({
        phase: currentPhase,
        formData: form,
        previousPhaseImage: prevBlob,
        previousPhaseProducts: currentPhase !== "base" ? previousProducts : undefined,
        onProgress: () => {},
        requestHeaders: authHeaders,
      });

      setPhaseResult(currentPhase, result.image, result.confirmedProducts);
      setPhasedAllProductLinks(result.productLinks);
      setPhasedAllProductIds(result.allPhaseProductIds);
      if (result.imaginedSlots?.length) {
        const notices = result.imaginedSlots.map((s) => t("page.slotNoticeImagined", { label: s.label }));
        setPhasedSlotNotices((prev) => [...new Set([...prev, ...notices])]);
      }
      if (typeof result.balance === "number") setTokenBalance(result.balance);
    } catch (err) {
      if (openSupportModalForAiError(err)) return;
      setPhasedError(err instanceof Error ? err.message : "Edit failed.");
    } finally {
      setIsGenerating(false);
    }
  }, [
    phaseEditFeedback, isGenerating, phasedCurrentPhase,
    phasedAnnotatedBase64, phasedAnnotatedMimeType,
    roomImageBase64, roomImageMimeType, textPrompt, selectedStyle,
    selectedCountry, searchMode, quickRoomAnalysis, selectedProducts, inspirationProducts, styleInspirations,
    setIsGenerating, setPhasedStatus, setPhaseResult, setPhasedAllProductLinks, setPhasedAllProductIds, setPhasedError, setTokenBalance,
    resetPhasedAnnotation,
  ]);

  const handleSkipDecor = useCallback(() => {
    if (!phase3Skippable) return;
    approvePhase("furniture");
    const snapshot = useConsumerDesignStore.getState();
    const finalImage =
      getSelectedPhaseImage(snapshot, "furniture")
      ?? getSelectedPhaseImage(snapshot, "base");
    if (finalImage) {
      setGeneratedImage(finalImage.base64, finalImage.mimeType);
      setProductLinks(phasedAllProductLinks);
    }
    setPhasedPhase("complete");
  }, [approvePhase, phasedAllProductLinks, phase3Skippable, setPhasedPhase, setGeneratedImage, setProductLinks]);

  const phasedVersionSnapshot = useMemo(
    () => ({
      phase1Versions,
      phase2Versions,
      phase3Versions,
      phase1SelectedIndex,
      phase2SelectedIndex,
      phase3SelectedIndex,
    }),
    [
      phase1Versions,
      phase2Versions,
      phase3Versions,
      phase1SelectedIndex,
      phase2SelectedIndex,
      phase3SelectedIndex,
    ],
  );

  const currentPhaseVersions = useMemo(() => {
    if (phasedCurrentPhase === "idle" || phasedCurrentPhase === "complete") return [];
    return getPhaseVersions(phasedVersionSnapshot, phasedCurrentPhase);
  }, [phasedCurrentPhase, phasedVersionSnapshot]);

  const currentPhaseSelectedIndex = useMemo(() => {
    if (phasedCurrentPhase === "base") return phase1SelectedIndex;
    if (phasedCurrentPhase === "furniture") return phase2SelectedIndex;
    if (phasedCurrentPhase === "decor") return phase3SelectedIndex;
    return 0;
  }, [phasedCurrentPhase, phase1SelectedIndex, phase2SelectedIndex, phase3SelectedIndex]);

  const currentPhaseImage = useMemo(() => {
    if (phasedCurrentPhase === "idle" || phasedCurrentPhase === "complete") return null;
    return getSelectedPhaseImage(phasedVersionSnapshot, phasedCurrentPhase);
  }, [phasedCurrentPhase, phasedVersionSnapshot]);

  const handlePhaseVersionPrevious = useCallback(() => {
    if (phasedCurrentPhase === "idle" || phasedCurrentPhase === "complete") return;
    setPhaseSelectedIndex(phasedCurrentPhase, currentPhaseSelectedIndex - 1);
  }, [phasedCurrentPhase, currentPhaseSelectedIndex, setPhaseSelectedIndex]);

  const handlePhaseVersionNext = useCallback(() => {
    if (phasedCurrentPhase === "idle" || phasedCurrentPhase === "complete") return;
    setPhaseSelectedIndex(phasedCurrentPhase, currentPhaseSelectedIndex + 1);
  }, [phasedCurrentPhase, currentPhaseSelectedIndex, setPhaseSelectedIndex]);

  const showFinalResult = Boolean(
    generatedImageBase64
    && generatedImageMimeType
    && (!phasedDesignActive || phasedCurrentPhase === "complete"),
  );

  const handleDownloadGenerated = useCallback(() => {
    if (!generatedImageBase64 || !generatedImageMimeType) return;
    const ext = extensionForImageMime(generatedImageMimeType);
    downloadImageDataUrl(
      `data:${generatedImageMimeType};base64,${generatedImageBase64}`,
      `vista-interior-${Date.now()}.${ext}`,
    );
  }, [generatedImageBase64, generatedImageMimeType]);

  const generateAutoDesignName = useCallback(() => {
    const style = selectedStyle || designBrief?.arrangement || "";
    const room = designBrief?.roomType || "";
    const parts: string[] = [];
    if (style) parts.push(style.charAt(0).toUpperCase() + style.slice(1));
    if (room) parts.push(room.charAt(0).toUpperCase() + room.slice(1));
    if (parts.length === 0) parts.push("Design");
    const dateStr = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${parts.join(" · ")} — ${dateStr}`;
  }, [selectedStyle, designBrief]);

  const handleOpenSaveDesign = useCallback(() => {
    setSaveDesignName(generateAutoDesignName());
    setSaveDesignDone(false);
    setSaveDesignModalOpen(true);
  }, [generateAutoDesignName]);

  const openSupportModalForAiError = useCallback((err: unknown): boolean => {
    return handleAiServiceUnavailableClientError(err, () => setSupportModalOpen(true));
  }, []);

  const handleCustomInquiry = useCallback(() => {
    const message = t("page.customResultInquiryMessage");
    const phone = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || "").replace(/[^\d]/g, "");
    const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "";
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : email
        ? `mailto:${email}?subject=${encodeURIComponent(t("page.customResultCta"))}&body=${encodeURIComponent(message)}`
        : "";
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [t]);

  const handleSaveDesign = useCallback(async () => {
    const title = saveDesignName.trim() || generateAutoDesignName();
    setSaveDesignSaving(true);

    const projectId = useConsumerDesignStore.getState().currentProjectDbId;

    if (projectId) {
      await renameProject(projectId, title);
    } else if (isPersistenceAuthenticated()) {
      const newId = await createProject({
        mode: "quick_room",
        title,
        style: selectedStyle,
        roomImageBase64: roomImageBase64,
        roomImageMime: roomImageMimeType,
      });
      if (newId && generatedImageBase64) {
        await addVersion({
          base64: generatedImageBase64,
          mimeType: generatedImageMimeType ?? "image/png",
          designBrief: designBrief as Record<string, unknown> | null,
          productsUsed: productLinks as unknown[] | null,
          type: "generated",
        });
      }
    }

    await loadProjects();
    setSaveDesignSaving(false);
    setSaveDesignDone(true);
    setTimeout(() => setSaveDesignModalOpen(false), 1200);
  }, [
    saveDesignName, generateAutoDesignName, renameProject, isPersistenceAuthenticated,
    createProject, addVersion, loadProjects, selectedStyle, roomImageBase64,
    roomImageMimeType, generatedImageBase64, generatedImageMimeType, designBrief, productLinks,
  ]);

  const handleDownloadLightbox = useCallback(() => {
    if (!lightboxSrc) return;
    const match = lightboxSrc.match(/^data:([^;]+);base64,/);
    const mime = match?.[1] ?? "image/png";
    const ext = extensionForImageMime(mime);
    downloadImageDataUrl(lightboxSrc, `vista-interior-${Date.now()}.${ext}`);
  }, [lightboxSrc]);

  const handleEditSubmit = useCallback(() => {
    const feedback = editFeedback.trim();
    if (!feedback) return;
    const base = designBrief?.fullPrompt || textPrompt.trim();
    const newPrompt = base
      ? `${base}\n\nUser refinement: ${feedback}`
      : feedback;
    const attachment = chatAttachment ?? undefined;
    setEditFeedback("");
    setChatAttachment(null);

    const hasAnnotation = annotatedImageBase64 && annotatedImageMimeType;
    const useGeneratedAsRef = !attachment && generatedImageBase64 && generatedImageMimeType;
    handleGenerate({
      promptOverride: newPrompt,
      feedbackText: feedback,
      tokenAction: "edit",
      attachmentOverride: hasAnnotation
        ? { base64: annotatedImageBase64!, mimeType: annotatedImageMimeType! }
        : useGeneratedAsRef
          ? { base64: generatedImageBase64!, mimeType: generatedImageMimeType! }
          : attachment,
      keepRoomShape: !!(hasAnnotation || useGeneratedAsRef),
    });
  }, [editFeedback, chatAttachment, designBrief, textPrompt, generatedImageBase64, generatedImageMimeType, annotatedImageBase64, annotatedImageMimeType, handleGenerate]);

  const handleChatImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [meta, base64] = result.split(",");
      const mimeType = meta?.match(/:(.*?);/)?.[1] ?? "image/jpeg";
      setChatAttachment({ base64: base64!, mimeType, preview: result });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handleSelectMode = (mode: "quick" | "project") => {
    const hubMode = mode === "quick" ? "quick_room" : "project";
    const hub = mode === "quick" ? "/quick" : "/project";
    const workspace = mode === "quick" ? "/quick/new" : "/project/new";
    // Navigate instantly using the already-loaded project list (a mount effect
    // keeps `savedProjects` fresh in the background). Awaiting a network round-trip
    // here froze the card on click; the destination route re-loads projects anyway.
    const count = useConsumerDesignStore
      .getState()
      .savedProjects.filter((p) => p.mode === hubMode).length;
    router.push(count === 0 ? workspace : hub);
    if (getAuthToken()) {
      void loadProjects({ mode: hubMode });
    }
  };

  if (variant === "project-workspace" && restoringProjectSession) {
    return (
      <div
        className={`cd-page${uiTheme === "light" ? " cd-page--light" : ""} flex flex-col items-center justify-center min-h-screen gap-4`}
        suppressHydrationWarning
      >
        <Loader2 size={40} className="animate-spin text-[var(--primary)]" aria-hidden />
        <p className="text-sm text-[var(--muted-foreground)]">{t("project.resumingSession")}</p>
      </div>
    );
  }

  return (
    <div className={`cd-page${uiTheme === "light" ? " cd-page--light" : ""}${keyboardOpen ? " cd-page--keyboard-open" : ""}`} suppressHydrationWarning>
      {/* ── Editorial header ── */}
      <header className="cd-editorial-header">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink">
          {isWorkspace ? (
            <button
              type="button"
              className="cd-back-link"
              onClick={() => {
                if (hubPath) {
                  const hubMode = hubPath === "/quick" ? "quick_room" : "project";
                  const count = useConsumerDesignStore
                    .getState()
                    .savedProjects.filter((p) => p.mode === hubMode).length;
                  router.push(count === 0 ? "/" : hubPath);
                } else {
                  router.push("/");
                }
              }}
              aria-label={t("common.back")}
            >
              <ArrowLeft size={14} aria-hidden />
              <span>{t("common.back")}</span>
            </button>
          ) : (
            <h1 className="cd-brand-logo">vista</h1>
          )}
        </div>

        <VistaHeaderActions
          tokenBalance={tokenBalance}
          onBalanceChange={setTokenBalance}
          uiTheme={uiTheme}
          onThemeChange={setUiTheme}
        />
      </header>

      {/* ── Landing / mode selection ── */}
      {showLanding && (
        <div className="cd-landing">
          <div className="cd-landing-inner cd-landing-animate">
              <>
            {/* Step label */}
            <div className="cd-step-label">
              <span className="cd-step-label-line" />
              <span className="cd-step-label-text">{t("landing.stepLabel")}</span>
              <span className="cd-step-label-line" />
            </div>

            {/* Headline */}
            <h2 className="cd-landing-headline">
              {t("landing.headline")}
            </h2>

            {/* Mode toggle */}
            <div className="cd-mode-toggle">
              <button
                className={`cd-mode-toggle-btn${landingSelectedMode === "quick" ? " cd-mode-toggle-btn--active" : ""}`}
                onClick={() => setLandingSelectedMode("quick")}
              >
                {t("page.modeQuickRoom")}
              </button>
              <button
                className={`cd-mode-toggle-btn${landingSelectedMode === "project" ? " cd-mode-toggle-btn--active" : ""}`}
                onClick={() => setLandingSelectedMode("project")}
              >
                {t("page.modeFullProject")}
              </button>
            </div>

            {/* Mode list — mobile / tablet (CSS toggled; both in DOM for SSR) */}
            <div className="cd-mode-list">
              <button
                type="button"
                className={`cd-mode-list-item${landingSelectedMode === "quick" ? " cd-mode-list-item--selected" : ""}`}
                onClick={() => handleSelectMode("quick")}
              >
                <div className="cd-mode-list-thumb">
                  <img src={LANDING_MODE_IMAGES.quick} alt="" loading="eager" />
                </div>
                <div className="cd-mode-list-body">
                  <p className="cd-mode-list-title">{t("landing.quickCardTitle")}</p>
                  <p className="cd-mode-list-desc">{t("landing.quickCardDesc")}</p>
                  <div className="cd-mode-list-meta">
                    {t("landing.quickCardPrice")}
                    <span className="cd-diamond-sm" />
                  </div>
                </div>
                <ChevronRight size={16} className="cd-mode-list-chevron" aria-hidden />
              </button>
              <button
                type="button"
                className={`cd-mode-list-item${landingSelectedMode === "project" ? " cd-mode-list-item--selected" : ""}`}
                onClick={() => handleSelectMode("project")}
              >
                <div className="cd-mode-list-thumb">
                  <img src={LANDING_MODE_IMAGES.project} alt="" loading="eager" />
                </div>
                <div className="cd-mode-list-body">
                  <p className="cd-mode-list-title">{t("landing.projectCardTitle")}</p>
                  <p className="cd-mode-list-desc">{t("landing.projectCardDesc")}</p>
                  <div className="cd-mode-list-meta">
                    {t("landing.projectCardPrice")}
                    <span className="cd-diamond-sm" />
                  </div>
                </div>
                <ChevronRight size={16} className="cd-mode-list-chevron" aria-hidden />
              </button>
            </div>

            {/* Mode cards — desktop (CSS toggled) */}
            <div className="cd-mode-cards">
              {/* Quick Room card */}
              <div
                className={`cd-mode-card${landingSelectedMode === "quick" ? " cd-mode-card--selected" : ""}`}
                onClick={() => handleSelectMode("quick")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && handleSelectMode("quick")}
              >
                <div className="cd-mode-card-photo">
                  <img
                    src={LANDING_MODE_IMAGES.quick}
                    alt="Quick room before and after design"
                    loading="eager"
                  />
                  <span className="cd-mode-card-badge">
                    {t("landing.quickCardBadge")}
                  </span>
                </div>
                <div className="cd-mode-card-body">
                  <h3 className="cd-mode-card-title">
                    {t("landing.quickCardTitle")}
                  </h3>
                  <p className="cd-mode-card-desc">
                    {t("landing.quickCardDesc")}
                  </p>
                  <div className="cd-mode-card-divider" />
                  <div className="cd-mode-card-meta">
                    <span className="cd-mode-card-price">
                      {t("landing.quickCardPrice")}
                      <span className="cd-diamond-sm" />
                    </span>
                  </div>
                </div>
              </div>

              {/* Full Project card */}
              <div
                className={`cd-mode-card${landingSelectedMode === "project" ? " cd-mode-card--selected" : ""}`}
                onClick={() => handleSelectMode("project")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && handleSelectMode("project")}
              >
                <div className="cd-mode-card-photo" style={{ background: "linear-gradient(135deg, #b8a898 0%, #9c8878 40%, #7e6858 100%)" }}>
                  <img
                    src={LANDING_MODE_IMAGES.project}
                    alt="Whole apartment floor plan design"
                    loading="eager"
                  />
                  <span className="cd-mode-card-badge">
                    {t("landing.projectCardBadge")}
                  </span>
                </div>
                <div className="cd-mode-card-body">
                  <h3 className="cd-mode-card-title">
                    {t("landing.projectCardTitle")}
                  </h3>
                  <p className="cd-mode-card-desc">
                    {t("landing.projectCardDesc")}
                  </p>
                  <div className="cd-mode-card-divider" />
                  <div className="cd-mode-card-meta">
                    <span className="cd-mode-card-price">
                      {t("landing.projectCardPrice")}
                      <span className="cd-diamond-sm" />
                    </span>
                    <span className="cd-mode-card-stat">{t("landing.projectCardMeta")}</span>
                  </div>
                </div>
              </div>
            </div>
              </>
          </div>
        </div>
      )}

      {!showLanding && (variant !== "project-workspace" && vistaMode !== "project" ? (
      <div className={`cd-main-grid cd-main-grid--mobile-tabs flex-1 min-h-0 overflow-hidden ${isMobile ? "flex flex-col h-full" : "grid grid-cols-[minmax(240px,320px)_minmax(0,1fr)_minmax(240px,380px)]"}`}>
        {isMobile && (
          <div className="cd-mobile-tab-bar fixed bottom-0 left-0 right-0 z-50 flex border-t border-[var(--border)] bg-[var(--card)]" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <button
              onClick={() => setMobileTab("search")}
              className={`cd-mobile-tab-btn flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${mobileTab === "search" ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}
            >
              <Search size={18} />
              {t("page.tabSearch")}
            </button>
            <button
              onClick={() => setMobileTab("design")}
              className={`cd-mobile-tab-btn flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${mobileTab === "design" ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}
            >
              <Sparkles size={18} />
              {t("page.tabDesign")}
            </button>
            <button
              onClick={() => setMobileTab("selected")}
              className={`cd-mobile-tab-btn flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${mobileTab === "selected" ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}
            >
              <ShoppingBag size={18} />
              <span>{t("page.tabSelected")}</span>
              {selectedProducts.length > 0 && (
                <span className="cd-mobile-tab-badge">
                  {selectedProducts.length}
                </span>
              )}
            </button>
          </div>
        )}
        <aside className={`cd-sidebar flex flex-col flex-1 min-h-0 min-w-0 h-full border-r border-[var(--border)] bg-[var(--card)] overflow-hidden ${isMobile && mobileTab !== "search" ? "hidden" : ""} ${isMobile ? "pb-20" : ""}`}>
          {isMobile && (
            <div className="cd-panel-head">
              <h2 className="cd-panel-head-title">{t("page.catalogTitle")}</h2>
              <div className="flex items-center gap-2 shrink-0">
                {browseProductCount > 0 && (
                  <span className="cd-panel-count">{browseProductCount}</span>
                )}
                <button
                  type="button"
                  className="cd-panel-done-btn"
                  onClick={() => setMobileTab("design")}
                >
                  {t("common.done")}
                </button>
              </div>
            </div>
          )}
          {/* Project timeline (saved projects) */}
          {currentProjectDbId && !isMobile && (
            <div className="border-b border-[var(--border)] max-h-[40%] overflow-y-auto">
              <ProjectTimeline />
            </div>
          )}
          {/* Search input */}
          <div className="p-3 border-b border-[var(--border)]">
            <div className="flex gap-2 items-stretch">
              <div className="relative flex-1 min-w-0">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] pointer-events-none" />
                <input
                  type="search"
                  enterKeyHint="search"
                  placeholder={t("page.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runSearchNow();
                    }
                  }}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)] transition-all"
                />
              </div>
              <button
                type="button"
                onClick={runSearchNow}
                disabled={liveSearchLoading && searchLoading}
                title={t("page.searchProducts")}
                className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--foreground)] text-[var(--background)] hover:opacity-85 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:pointer-events-none disabled:opacity-55 transition-[transform,opacity] duration-150 cursor-pointer"
                aria-label={t("page.searchProducts")}
              >
                {t("common.search")}
              </button>
            </div>

            {/* Sources info */}
            {liveSearchSources.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {liveSearchSources.map((s) => (
                  <span
                    key={s.key}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      s.status === "ok"
                        ? "bg-green-500/10 text-green-400"
                        : "bg-red-500/10 text-red-400"
                    }`}
                  >
                    {s.name} ({s.count})
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Results — up to 50 in sidebar; full catalog + live in modal */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-3 custom-scrollbar">
              {searchLoading || liveSearchLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="cd-skeleton aspect-[3/4] rounded-xl" />
                  ))}
                </div>
              ) : sidebarPreviewProducts.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {amLocalExclusive && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--primary)]">
                      Catalog
                    </p>
                  )}
                  {sidebarPreviewSections.map((section) => (
                    <div key={section.kind}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
                        {sidebarSectionTitle(section)}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {section.products.map((p) => (
                          <ProductCard
                            key={p.id}
                            product={p}
                            onAdd={() => handleAddCatalogProduct(p)}
                            isSelected={selectedProducts.some((s) => s.id === p.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : browseProductCount > 0 && sidebarPreviewProducts.length === 0 && searchResults.length > 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-[var(--muted-foreground)] text-center px-3">
                  <ShoppingBag size={28} className="mb-2 opacity-40" />
                  <p className="text-sm font-medium">{t("page.moreProductsInCatalog")}</p>
                  <p className="text-xs mt-1">{t("page.moreProductsInCatalogHint", { count: searchResults.length })}</p>
                </div>
              ) : browseProductCount > 0 && !amLocalExclusive ? (
                <div className="flex flex-col items-center justify-center py-10 text-[var(--muted-foreground)] text-center px-3">
                  <Globe size={28} className="mb-2 opacity-40" />
                  <p className="text-sm font-medium">{t("page.liveResultsAvailable")}</p>
                  <p className="text-xs mt-1">{t("page.liveResultsAvailableHint", { count: liveSearchResults.length })}</p>
                </div>
              ) : browseProductCount === 0 && searchQuery.trim().length >= 2 ? (
                <div className="flex flex-col items-center justify-center py-12 text-[var(--muted-foreground)]">
                  <ShoppingBag size={32} className="mb-3 opacity-40" />
                  <p className="text-sm">{t("page.noProductsFound")}</p>
                  <p className="text-xs mt-1">{t("page.tryDifferentKeywords")}</p>
                </div>
              ) : browseProductCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-[var(--muted-foreground)]">
                  {amLocalExclusive ? (
                    <>
                      <Package size={32} className="mb-3 opacity-40" />
                      <p className="text-sm font-medium">{t("page.catalogTitle")}</p>
                      <p className="text-xs mt-1 text-center px-4">
                        {t("page.catalogHint")}
                      </p>
                    </>
                  ) : (
                    <>
                      <Globe size={32} className="mb-3 opacity-40" />
                      <p className="text-sm font-medium">{t("page.searchMarketplaces")}</p>
                      <p className="text-xs mt-1 text-center px-4">
                        {t("page.searchMarketplacesHint")}
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {showAllProductsButton && !searchLoading && !liveSearchLoading && (
              <div className="shrink-0 p-3 pt-0 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setAllProductsModalOpen(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold border border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--foreground)] hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/15 transition-colors cursor-pointer"
                >
                  <ShoppingBag size={16} className="shrink-0 text-[var(--primary)]" />
                  {t("page.showAllProducts", { count: browseProductCount })}
                </button>
              </div>
            )}
          </div>
        </aside>

        <main className={`flex flex-col min-h-0 min-w-0 overflow-y-auto custom-scrollbar ${isMobile && mobileTab !== "design" ? "hidden" : ""} ${isMobile ? "pb-20" : ""}`}>
          <div className={`flex-1 flex flex-col items-center gap-6 max-w-2xl mx-auto w-full ${isMobile ? "p-4" : "p-6"}`}>
            {/* Mode step label */}
            <div className="cd-step-label w-full">
              <span className="cd-step-label-line" />
              <span className="cd-step-label-text">{t("landing.quickCardBadge")}</span>
              <span className="cd-step-label-line" />
            </div>

            {isMobile && browseProductCount > 0 && (
              <button
                type="button"
                className="cd-browse-catalog-chip self-start"
                onClick={() => setMobileTab("search")}
              >
                <ShoppingBag size={14} />
                {t("page.browseCatalog", { count: browseProductCount })}
              </button>
            )}

            {!roomImageBase64 ? (
              <div
                className={`cd-dropzone w-full ${isMobile ? "cd-dropzone--compact" : "aspect-[16/10]"} flex flex-col items-center justify-center gap-4 ${isMobile ? "p-4" : "p-8"} text-center ${isDragging ? "cd-dropzone--active" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="cd-upload-icon-wrap">
                  <Upload size={isMobile ? 18 : 24} />
                </div>
                <div>
                  <p className="cd-upload-title">{t("page.uploadRoomPhoto")}</p>
                  <p className="cd-upload-desc mt-2">{t("page.uploadHint")}</p>
                </div>
                <div className="cd-upload-actions flex flex-wrap gap-3 justify-center" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm font-medium text-[var(--foreground)] active:scale-95 transition-transform"
                  >
                    <Upload size={16} />
                    {t("page.browsePhotos")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoomCameraOpen(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm font-medium text-[var(--foreground)] active:scale-95 transition-transform"
                  >
                    <Camera size={16} />
                    {t("page.takePhoto")}
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onFileSelect}
                  className="hidden"
                />
              </div>
            ) : (
              <div className="w-full relative rounded-2xl overflow-hidden border border-[var(--border)]">
                <img
                  src={`data:${roomImageMimeType};base64,${roomImageBase64}`}
                  alt={t("page.roomAlt")}
                  className="w-full object-cover max-h-[400px]"
                />
                {!generatedImageBase64 && (
                  <button
                    onClick={() => setRoomImage(null, null)}
                    className={`absolute top-3 right-3 ${isMobile ? "p-3" : "p-2"} rounded-full cd-media-icon-btn transition-colors cursor-pointer`}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            )}

            {roomImageBase64 && vistaMode === "quick" && (
              <div className="w-full flex items-center gap-2 flex-wrap">
                {quickRoomExtraPhotos.map((photo) => (
                  <div key={photo.id} className="relative w-20 h-20 rounded-xl overflow-hidden border border-[var(--border)] shrink-0">
                    <img
                      src={`data:${photo.mimeType};base64,${photo.base64}`}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    {!generatedImageBase64 && (
                      <button
                        onClick={() => removeQuickRoomExtraPhoto(photo.id)}
                        className="absolute top-1 right-1 p-0.5 rounded-full bg-black/50 text-white cursor-pointer"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
                {quickRoomExtraPhotos.length < 5 && !generatedImageBase64 && (
                  <button
                    type="button"
                    onClick={() => extraFileInputRef.current?.click()}
                    className="w-20 h-20 rounded-xl border border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-1 text-[var(--muted-foreground)] hover:border-[var(--primary)]/60 hover:text-[var(--primary)] transition-colors cursor-pointer shrink-0 text-xs"
                  >
                    <Plus size={18} />
                    <span>{t("page.addAngle")}</span>
                  </button>
                )}
                <input
                  ref={extraFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files) {
                      Array.from(files).forEach((file) => handleExtraImageFile(file));
                    }
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </div>
            )}

            {roomImageBase64 && vistaMode === "quick" && (
              <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 p-4 flex flex-col gap-3">
                {quickRoomAnalyzing && (
                  <div className="flex items-center gap-2.5 text-sm text-[var(--muted-foreground)]">
                    <Loader2 className="animate-spin shrink-0" size={18} />
                    <span>{t("page.scanningGeometry")}</span>
                  </div>
                )}
                {quickRoomAnalyzeError && !quickRoomAnalyzing && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-red-400 flex items-start gap-2">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" />
                      {quickRoomAnalyzeError}
                    </p>
                    <button
                      type="button"
                      onClick={() => setQuickAnalyzeNonce((n) => n + 1)}
                      className="self-start text-sm font-semibold text-[var(--primary)] underline-offset-2 hover:underline cursor-pointer"
                    >
                      {t("page.retryScan")}
                    </button>
                  </div>
                )}
                {quickRoomAnalysis && !quickRoomAnalyzing && !quickRoomAnalyzeError && (
                  <>
                    {(() => {
                      const qa = quickRoomAnalysis;
                      const mandatoryGate = quickRoomNeedsMandatorySpatialClarification(qa);
                      const dims = qa.estimated_dimensions;
                      const showEditor = quickRoomFactsExpanded;

                      const lowNote = (spatial: boolean) =>
                        spatial ? (
                          <span className="text-amber-500/90 flex items-center gap-1 shrink-0" title={t("page.aiUnsureVerify")}>
                            <AlertCircle size={13} /> {t("common.review")}
                          </span>
                        ) : null;

                      return (
                        <>
                          {!showEditor ? (
                            <button
                              type="button"
                              onClick={() => setQuickRoomFactsExpanded(true)}
                              className="w-full flex items-center justify-between gap-3 text-left px-3 py-2.5 rounded-lg bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)]/40 transition-colors cursor-pointer"
                            >
                              <span className="text-sm font-medium truncate">
                                {t("page.roomScanSummary", {
                                  roomType: roomTypeLabel(qa.room_type),
                                  width: dims.width.toFixed(1),
                                  depth: dims.depth.toFixed(1),
                                  height: dims.height.toFixed(1),
                                  windowCount: qa.window_count,
                                  doorCount: qa.door_count,
                                })}
                              </span>
                              <span className="flex items-center gap-2 shrink-0">
                                {mandatoryGate ? lowNote(true) : null}
                                <ChevronDown size={18} className="text-[var(--muted-foreground)]" />
                              </span>
                            </button>
                          ) : (
                            <div className="flex flex-col gap-3">
                              <button
                                type="button"
                                onClick={() => setQuickRoomFactsExpanded(false)}
                                className="self-end flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
                              >
                                <ChevronDown size={14} className="rotate-180" /> {t("common.collapse")}
                              </button>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-[var(--muted-foreground)]">{t("page.roomType")}</span>
                                  <select
                                    value={qa.room_type}
                                    onChange={(e) => patchQuickRoomAnalysis({ room_type: e.target.value })}
                                    className="rounded-lg px-3 py-2 text-sm bg-[var(--card)] border border-[var(--border)]"
                                  >
                                    {!(ROOM_TYPES as readonly string[]).includes(qa.room_type) ? (
                                      <option value={qa.room_type}>{roomTypeLabel(qa.room_type)}</option>
                                    ) : null}
                                    {ROOM_TYPES.map((rt) => (
                                      <option key={rt} value={rt}>
                                        {roomTypeLabel(rt)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-[var(--muted-foreground)]">{t("page.roomShape")}</span>
                                    {!qa.confidence || qa.confidence.room_type !== "high" ? lowNote(true) : null}
                                  </span>
                                  <select
                                    value={qa.room_shape}
                                    onChange={(e) => {
                                      const nextShape = e.target.value;
                                      const syncedEdges = syncPolygonEdgesForShape(
                                        nextShape,
                                        dims.width,
                                        dims.depth,
                                        nextShape === qa.room_shape ? qa.polygon_edges : undefined,
                                      );
                                      patchQuickRoomAnalysis({
                                        room_shape: nextShape,
                                        polygon_edges: syncedEdges,
                                      });
                                    }}
                                    className="rounded-lg px-3 py-2 text-sm bg-[var(--card)] border border-[var(--border)]"
                                  >
                                    {!(ROOM_SHAPES as readonly string[]).includes(qa.room_shape) ? (
                                      <option value={qa.room_shape}>{roomShapeLabel(qa.room_shape)}</option>
                                    ) : null}
                                    {ROOM_SHAPES.map((shape) => (
                                      <option key={shape} value={shape}>
                                        {roomShapeLabel(shape)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              {roomShapeUsesPolygonEditor(qa.room_shape) &&
                              qa.polygon_edges &&
                              qa.polygon_edges.length > 0 ? (
                                <>
                                <p className="text-xs text-[var(--muted-foreground)]">{t("page.polygonFootprintHint")}</p>
                                <RoomShapeEditor
                                  roomShape={qa.room_shape}
                                  edges={qa.polygon_edges}
                                  ceilingHeight={dims.height}
                                  lowConfidence={effectiveQuickRoomSpatialConfidence(qa, "dimensions") !== "high"}
                                  lowConfidenceLabel={t("common.review")}
                                  edgeLabel={(label) => t("page.edgeLengthM", { edge: label })}
                                  ceilingLabel={t("page.ceilingM")}
                                  onEdgesChange={(nextEdges) => {
                                    const bbox = bboxFromPolygonEdges(qa.room_shape, nextEdges);
                                    patchQuickRoomAnalysis({
                                      polygon_edges: nextEdges,
                                      estimated_dimensions: {
                                        width: bbox.width,
                                        depth: bbox.depth,
                                      },
                                    });
                                  }}
                                  onCeilingChange={(val) => {
                                    patchQuickRoomAnalysis({ estimated_dimensions: { height: val } });
                                  }}
                                />
                                </>
                              ) : (
                                <div className="grid gap-3 sm:grid-cols-3">
                                  {(["width", "depth", "height"] as const).map((k) => (
                                    <label key={k} className="flex flex-col gap-1">
                                      <span className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-medium text-[var(--muted-foreground)]">
                                          {k === "width" ? t("page.widthM") : k === "depth" ? t("page.depthM") : t("page.ceilingM")}
                                        </span>
                                        {effectiveQuickRoomSpatialConfidence(qa, "dimensions") !== "high" ? lowNote(true) : null}
                                      </span>
                                      <input
                                        type="number"
                                        step={0.1}
                                        min={0}
                                        value={dims[k]}
                                        onChange={(e) => {
                                          const v = parseFloat(e.target.value);
                                          const val = Number.isFinite(v) ? v : 0;
                                          if (k === "width") {
                                            patchQuickRoomAnalysis({ estimated_dimensions: { width: val } });
                                          } else if (k === "depth") {
                                            patchQuickRoomAnalysis({ estimated_dimensions: { depth: val } });
                                          } else {
                                            patchQuickRoomAnalysis({ estimated_dimensions: { height: val } });
                                          }
                                        }}
                                        className="rounded-lg px-3 py-2 text-sm bg-[var(--card)] border border-[var(--border)]"
                                      />
                                    </label>
                                  ))}
                                </div>
                              )}

                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex flex-col gap-1">
                                  <span className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-[var(--muted-foreground)]">{t("page.windows")}</span>
                                    {effectiveQuickRoomSpatialConfidence(qa, "window_count") !== "high"
                                      ? lowNote(true)
                                      : null}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={20}
                                    step={1}
                                    value={qa.window_count}
                                    onChange={(e) => {
                                      const n = Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0));
                                      patchQuickRoomAnalysis({ window_count: n });
                                    }}
                                    className="rounded-lg px-3 py-2 text-sm bg-[var(--card)] border border-[var(--border)]"
                                  />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-[var(--muted-foreground)]">{t("page.doors")}</span>
                                    {effectiveQuickRoomSpatialConfidence(qa, "door_count") !== "high"
                                      ? lowNote(true)
                                      : null}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={20}
                                    step={1}
                                    value={qa.door_count}
                                    onChange={(e) => {
                                      const n = Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0));
                                      patchQuickRoomAnalysis({ door_count: n });
                                    }}
                                    className="rounded-lg px-3 py-2 text-sm bg-[var(--card)] border border-[var(--border)]"
                                  />
                                </label>
                              </div>

                              {process.env.NEXT_PUBLIC_VISTA_OPENING_EDITOR === "1" &&
                                roomImageBase64 &&
                                roomImageMimeType &&
                                !generatedImageBase64 && (
                                  <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-[var(--muted-foreground)]">
                                      {t("page.openingBoxesHint")}
                                    </span>
                                    <OpeningBoxEditor
                                      imageBase64={roomImageBase64}
                                      imageMimeType={roomImageMimeType}
                                      windowBoxes={qa.window_boxes ?? []}
                                      doorBoxes={qa.door_boxes ?? []}
                                      windowLabel={t("page.windows")}
                                      doorLabel={t("page.doors")}
                                      onChange={({ window_boxes, door_boxes }) =>
                                        patchQuickRoomAnalysis({ window_boxes, door_boxes })
                                      }
                                    />
                                  </div>
                                )}

                              <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-[var(--muted-foreground)]">
                                  {t("page.ceilingType")}
                                </span>
                                <select
                                  value={qa.ceiling_type}
                                  onChange={(e) => patchQuickRoomAnalysis({ ceiling_type: e.target.value })}
                                  className="rounded-lg px-3 py-2 text-sm bg-[var(--card)] border border-[var(--border)]"
                                >
                                  {!(CEILING_TYPES as readonly string[]).includes(qa.ceiling_type) ? (
                                    <option value={qa.ceiling_type}>{ceilingTypeLabel(qa.ceiling_type)}</option>
                                  ) : null}
                                  {CEILING_TYPES.map((ct) => (
                                    <option key={ct} value={ct}>
                                      {ceilingTypeLabel(ct)}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-[var(--muted-foreground)]">
                                  {t("page.windowPositions")}
                                </span>
                                <textarea
                                  rows={2}
                                  value={qa.window_positions.join("\n")}
                                  onChange={(e) => {
                                    const lines = e.target.value
                                      .split("\n")
                                      .map((s) => s.trim())
                                      .filter(Boolean);
                                    patchQuickRoomAnalysis({ window_positions: lines });
                                  }}
                                  className="rounded-lg px-3 py-2 text-xs font-mono bg-[var(--card)] border border-[var(--border)] resize-y min-h-[48px]"
                                />
                              </label>

                              <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-[var(--muted-foreground)]">
                                  {t("page.doorPositions")}
                                </span>
                                <textarea
                                  rows={2}
                                  value={qa.door_positions.join("\n")}
                                  onChange={(e) => {
                                    const lines = e.target.value
                                      .split("\n")
                                      .map((s) => s.trim())
                                      .filter(Boolean);
                                    patchQuickRoomAnalysis({ door_positions: lines });
                                  }}
                                  className="rounded-lg px-3 py-2 text-xs font-mono bg-[var(--card)] border border-[var(--border)] resize-y min-h-[48px]"
                                />
                              </label>

                              <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-[var(--muted-foreground)]">
                                  {t("page.structuralElements")}
                                </span>
                                <textarea
                                  rows={2}
                                  value={qa.structural_elements.join("\n")}
                                  onChange={(e) => {
                                    const lines = e.target.value
                                      .split("\n")
                                      .map((s) => s.trim())
                                      .filter(Boolean);
                                    patchQuickRoomAnalysis({ structural_elements: lines });
                                  }}
                                  className="rounded-lg px-3 py-2 text-xs font-mono bg-[var(--card)] border border-[var(--border)] resize-y min-h-[48px]"
                                />
                              </label>

                            </div>
                          )}
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            )}

            <div className="w-full">
              <div className="cd-work-divider mb-3">
                <span className="cd-work-divider-text">{t("page.style")}</span>
              </div>
              <div className={isMobile ? "cd-style-pills-scroll" : "flex flex-wrap gap-2"}>
                {quickStyles.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStyle(s.id)}
                    className={`cd-style-pill px-4 py-1.5 rounded-full text-sm font-medium border cursor-pointer ${
                      selectedStyle === s.id
                        ? "cd-style-pill--active"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {roomImageBase64 && roomImageMimeType && (
              <div className="w-full">
                <div className="cd-work-divider mb-3">
                  <span className="cd-work-divider-text">{t("components.proModeStructuralTitle")}</span>
                </div>
                {!proModeOpen && !structuralLineMap && !objectRemovalMask ? (
                  <button
                    type="button"
                    onClick={() => setProModeOpen(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-[var(--primary)]/40 text-sm font-medium text-[var(--foreground)] hover:border-[var(--primary)] cursor-pointer w-full justify-center"
                  >
                    <PenTool size={16} />
                    {t("components.proModeStructuralOpen")}
                  </button>
                ) : proModeOpen ? (
                  <StructuralBoundaryCanvas
                    imageSrc={`data:${roomImageMimeType};base64,${roomImageBase64}`}
                    onExport={(result) => {
                      if (result.hasStructuralLines) {
                        setStructuralLineMap({
                          base64: result.strokeMapBase64,
                          mimeType: result.strokeMapMimeType,
                          strokeOnly: true,
                        });
                      } else {
                        setStructuralLineMap(null);
                      }
                      if (result.hasRemovalMask && result.removalMaskBase64) {
                        setObjectRemovalMask({
                          base64: result.removalMaskBase64,
                          mimeType: result.removalMaskMimeType ?? "image/png",
                        });
                      } else {
                        setObjectRemovalMask(null);
                      }
                      setProModeOpen(false);
                    }}
                    onSkip={() => {
                      setStructuralLineMap(null);
                      setObjectRemovalMask(null);
                      setProModeOpen(false);
                    }}
                    onFinish={() => setProModeOpen(false)}
                  />
                ) : (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--muted)] border border-[var(--border)]">
                    <span className="text-sm text-[var(--foreground)]">{t("components.proModeStructuralDone")}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setStructuralLineMap(null);
                        setObjectRemovalMask(null);
                        setProModeOpen(true);
                      }}
                      className="text-xs font-medium text-[var(--primary)] hover:underline cursor-pointer"
                    >
                      {t("common.edit")}
                    </button>
                  </div>
                )}
              </div>
            )}

            <InspirationProductsPanel
              products={inspirationProducts}
              onAddImage={(base64, mimeType) => {
                track("product_added_to_design", { source: "upload" });
                addInspirationProduct({
                  base64,
                  mimeType,
                  url: null,
                  label: "",
                  thumbnailUrl: null,
                });
              }}
              onRemove={removeInspirationProduct}
              onUpdateLabel={updateInspirationProductLabel}
              isMobile={isMobile}
            />

            <StyleInspirationPanel
              images={styleInspirations}
              onAddImage={(base64, mimeType) => addStyleInspiration({ base64, mimeType })}
              onRemove={removeStyleInspiration}
              isMobile={isMobile}
            />

            <div className="w-full flex flex-col gap-3">
              <textarea
                value={textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                placeholder={t("page.describeStylePlaceholder")}
                rows={3}
                className="w-full px-4 py-3 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)] transition-all resize-none"
              />
              <button
                type="button"
                onClick={() => void handleGenerateClick()}
                disabled={!generateFormReady || isGenerating || topUpRedirecting}
                className={`cd-generate-btn w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-base font-bold transition-all cursor-pointer ${
                  generateFormReady && !isGenerating && !topUpRedirecting
                    ? "bg-[var(--primary)] text-white hover:brightness-110 shadow-lg shadow-[var(--primary)]/20"
                    : "bg-[var(--muted)] text-[var(--muted-foreground)] cursor-not-allowed"
                }`}
              >
                {isGenerating || topUpRedirecting ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    {generateButtonLoadingMessage}
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    {t("page.generateDesign")}
                  </>
                )}
              </button>
            </div>

            {error && (
              <div className="w-full px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            {process.env.NODE_ENV === "development" && (
              <GenerationDebugPanel trace={generationDebug} />
            )}

            {/* --- Phased Design UI --- */}
            {phasedDesignActive && phasedCurrentPhase !== "idle" && phasedCurrentPhase !== "complete" && (
              <div className="w-full flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <DesignPhaseStepper
                  currentPhase={phasedCurrentPhase}
                  status={phasedStatus}
                  retryCount={phasedRetryCount}
                  onSkipDecor={phase3Skippable ? handleSkipDecor : undefined}
                  showSkipDecor={phase3Skippable && phasedCurrentPhase === "furniture" && phasedStatus === "done"}
                />

                {phasedSlotNotices.length > 0 && (
                  <div
                    className={`px-4 py-3 rounded-xl text-sm space-y-2 ${
                      uiTheme === "light"
                        ? "bg-amber-100 border border-amber-400/70 text-amber-950"
                        : "bg-amber-500/20 border border-amber-500/45 text-amber-50"
                    }`}
                  >
                    {phasedSlotNotices.map((notice) => (
                      <p key={notice} className="flex items-start gap-2 leading-snug">
                        <AlertCircle
                          size={16}
                          className={`shrink-0 mt-0.5 ${uiTheme === "light" ? "text-amber-700" : "text-amber-400"}`}
                        />
                        {notice}
                      </p>
                    ))}
                  </div>
                )}

                {phasedError && (
                  <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    {phasedError}
                    <button onClick={handleRedoPhase} className="ml-2 underline text-red-300 hover:text-red-200">
                      Retry
                    </button>
                  </div>
                )}

                {currentPhaseImage && phasedStatus === "done" && (
                  <>
                    {phasedMarkerMode ? (
                      <DrawingCanvas
                        imageSrc={`data:${currentPhaseImage.mimeType};base64,${currentPhaseImage.base64}`}
                        onAnnotatedImage={(base64, mime) => {
                          setPhasedAnnotatedBase64(base64);
                          setPhasedAnnotatedMimeType(mime);
                        }}
                        onFinish={() => {
                          setPhasedMarkerMode(false);
                          setPhaseEditOpen(true);
                        }}
                        className="cd-reveal"
                      />
                    ) : (
                      <div
                        className="relative w-full rounded-xl overflow-hidden border border-[var(--border)] cursor-pointer hover:shadow-lg transition-shadow"
                        onClick={() => setLightboxSrc(`data:${currentPhaseImage.mimeType};base64,${currentPhaseImage.base64}`)}
                      >
                        <img
                          src={`data:${currentPhaseImage.mimeType};base64,${currentPhaseImage.base64}`}
                          alt={`Phase ${phasedCurrentPhase} result`}
                          className="w-full h-auto"
                        />
                      </div>
                    )}
                    <PhaseVersionNav
                      selectedIndex={currentPhaseSelectedIndex}
                      totalVersions={currentPhaseVersions.length}
                      onPrevious={handlePhaseVersionPrevious}
                      onNext={handlePhaseVersionNext}
                      disabled={isGenerating}
                    />
                    <PhaseApprovalBar
                      currentPhase={phasedCurrentPhase as DesignPhase}
                      onApprove={handleApprovePhase}
                      onRedo={handleRedoPhase}
                      onEditPrompt={() => setPhaseEditOpen((v) => !v)}
                      onSkip={phase3Skippable && phasedCurrentPhase === "furniture" ? handleSkipDecor : undefined}
                      isLoading={isGenerating}
                    />
                    <div className={`flex gap-3 ${isMobile ? "w-full" : ""}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setPhasedMarkerMode((on) => {
                            if (on && phasedAnnotatedBase64) setPhaseEditOpen(true);
                            return !on;
                          });
                        }}
                        disabled={isGenerating}
                        className={`${isMobile ? "flex-1" : ""} px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 ${
                          phasedMarkerMode
                            ? "bg-[var(--primary)] text-white"
                            : "bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]/50"
                        }`}
                        title={t("components.drawOnImage")}
                      >
                        <PenTool size={18} />
                        {!isMobile && t("common.mark")}
                      </button>
                    </div>
                    {phaseEditOpen && (
                      <div className="flex flex-col gap-2 mt-1">
                        {phasedAnnotatedBase64 && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/30">
                            <img
                              src={`data:image/png;base64,${phasedAnnotatedBase64}`}
                              alt={t("components.attachReference")}
                              className="w-10 h-10 rounded object-cover border border-[var(--primary)]/40 shrink-0"
                            />
                            <p className="text-xs text-[var(--primary)] font-medium flex-1">{t("components.markedAreasSent")}</p>
                            <button
                              type="button"
                              onClick={() => {
                                setPhasedAnnotatedBase64(null);
                                setPhasedAnnotatedMimeType(null);
                              }}
                              className={`${isMobile ? "p-1.5" : "p-0.5"} rounded-full cd-media-icon-btn transition-colors cursor-pointer shrink-0`}
                            >
                              <X size={isMobile ? 14 : 12} />
                            </button>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={phaseEditFeedback}
                            onChange={(e) => setPhaseEditFeedback(e.target.value)}
                            placeholder={t("page.describeChangesPlaceholder")}
                            className="flex-1 px-4 py-3 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)] transition-all"
                            onKeyDown={(e) => { if (e.key === "Enter" && phaseEditFeedback.trim()) handlePhaseEditSubmit(); }}
                            disabled={isGenerating}
                            autoFocus
                          />
                          <button
                            onClick={handlePhaseEditSubmit}
                            disabled={!phaseEditFeedback.trim() || isGenerating}
                            className="px-5 py-3 rounded-xl bg-[var(--primary)] text-white font-semibold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
                          >
                            <Send size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {isGenerating && !currentPhaseImage && (
                  <div className="w-full aspect-[16/10] cd-skeleton rounded-xl" />
                )}
              </div>
            )}

            {showFinalResult && (
              <div className="w-full flex flex-col gap-4">
                {/* Room type & camera angle only — no long AI finish description */}
                {designBrief && (designBrief.roomType || designBrief.cameraAngle) && (
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-[var(--primary)]/5 border border-[var(--primary)]/20">
                    {designBrief.roomType && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--foreground)] bg-[var(--muted)] px-2.5 py-1 rounded-full">
                        <Home size={12} className="text-[var(--primary)]" />
                        {roomTypeLabel(designBrief.roomType)}
                      </span>
                    )}
                    {designBrief.cameraAngle && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--foreground)] bg-[var(--muted)] px-2.5 py-1 rounded-full">
                        <Camera size={12} className="text-[var(--primary)]" />
                        {designBrief.cameraAngle}
                      </span>
                    )}
                  </div>
                )}

                {/* Generated images — compact grid when multiple angles, capped single hero otherwise */}
                {markerMode ? (
                  <DrawingCanvas
                    imageSrc={`data:${generatedImageMimeType};base64,${generatedImageBase64}`}
                    onAnnotatedImage={(base64, mime) => {
                      setAnnotatedImageBase64(base64);
                      setAnnotatedImageMimeType(mime);
                    }}
                    onFinish={() => setMarkerMode(false)}
                    className="cd-reveal"
                  />
                ) : phasedFinalViews.length > 1 ? (
                  <RoomRenderGalleryGrid className="cd-reveal">
                    {phasedFinalViews.map((view, i) => {
                      const isActive = view.base64 === generatedImageBase64;
                      return (
                        <RoomRenderGalleryCard
                          key={view.id}
                          src={`data:${view.mimeType};base64,${view.base64}`}
                          alt={t("page.generatedInterior")}
                          viewLabel={`View ${i + 1}`}
                          isActive={isActive}
                          activeLabel={t("page.activeRender")}
                          setActiveLabel={t("page.setActiveRender")}
                          onSetActive={() => !isGenerating && setGeneratedImage(view.base64, view.mimeType)}
                          onOpen={() =>
                            !isGenerating &&
                            setLightboxSrc(`data:${view.mimeType};base64,${view.base64}`)
                          }
                          onRemove={() => removePhasedFinalView(view.id)}
                          canRemove={!isGenerating}
                          removeLabel={t("page.removeRenderImage")}
                          disabled={isGenerating}
                          borderClassName={
                            isActive
                              ? "border-[var(--primary)] ring-1 ring-[var(--primary)]"
                              : "border-[var(--border)]"
                          }
                        />
                      );
                    })}
                  </RoomRenderGalleryGrid>
                ) : (
                  <div
                    className="cd-reveal rounded-2xl overflow-hidden border border-[var(--border)] cursor-pointer hover:shadow-lg transition-shadow relative"
                    onClick={() =>
                      !isGenerating &&
                      setLightboxSrc(`data:${generatedImageMimeType};base64,${generatedImageBase64}`)
                    }
                  >
                    <img
                      src={`data:${generatedImageMimeType};base64,${generatedImageBase64}`}
                      alt={t("page.generatedInterior")}
                      className={`w-full max-h-[55vh] object-contain transition-opacity ${isGenerating ? "opacity-50" : ""}`}
                    />
                    {isGenerating && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 rounded-2xl">
                        <Loader2 size={32} className="animate-spin text-white" />
                        <p className="text-white text-sm font-medium mt-2">{t("page.generatingNewDesign")}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className={`flex gap-3 ${isMobile ? "flex-col" : ""}`}>
                  <button
                    onClick={handleRegenerate}
                    disabled={isGenerating || (tokenBalance !== null && tokenBalance < TOKEN_COSTS.regenerate)}
                    className={`${isMobile ? "w-full" : "flex-1"} py-3 rounded-xl bg-orange-500 text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50`}
                  >
                    <RefreshCw size={18} /> {t("tokens.regenerate")}
                  </button>
                  <div className={`flex gap-3 ${isMobile ? "w-full" : ""}`}>
                  <button
                    type="button"
                    onClick={handleDownloadGenerated}
                    disabled={isGenerating}
                    className={`${isMobile ? "flex-1" : ""} px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]/50`}
                    title={t("page.downloadDesign")}
                  >
                    <Download size={18} />
                    {!isMobile && t("page.downloadDesign")}
                  </button>
                  <button
                    onClick={() => setMarkerMode((on) => !on)}
                    disabled={isGenerating}
                    className={`${isMobile ? "flex-1" : ""} px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 ${
                      markerMode
                        ? "bg-[var(--primary)] text-white"
                        : "bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]/50"
                    }`}
                    title={t("components.drawOnImage")}
                  >
                    <PenTool size={18} />
                    {!isMobile && t("common.mark")}
                  </button>
                  </div>
                </div>

                {/* Chat-style edit input with image attachment */}
                <div className="flex flex-col gap-2">
                  {annotatedImageBase64 && !chatAttachment && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/30">
                      <img
                        src={`data:image/png;base64,${annotatedImageBase64}`}
                        alt={t("components.attachReference")}
                        className="w-10 h-10 rounded object-cover border border-[var(--primary)]/40 shrink-0"
                      />
                      <p className="text-xs text-[var(--primary)] font-medium flex-1">{t("components.markedAreasSent")}</p>
                      <button
                        onClick={() => { setAnnotatedImageBase64(null); setAnnotatedImageMimeType(null); }}
                        className={`${isMobile ? "p-1.5" : "p-0.5"} rounded-full cd-media-icon-btn transition-colors cursor-pointer shrink-0`}
                      >
                        <X size={isMobile ? 14 : 12} />
                      </button>
                    </div>
                  )}
                  {chatAttachment && (
                    <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--border)]">
                      <img src={chatAttachment.preview} alt={t("components.attachReference")} className="w-full h-full object-cover" />
                      <button
                        onClick={() => setChatAttachment(null)}
                        className={`absolute top-1 right-1 ${isMobile ? "p-1.5" : "p-0.5"} rounded-full cd-media-icon-btn transition-colors cursor-pointer`}
                      >
                        <X size={isMobile ? 14 : 12} />
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => chatImageRef.current?.click()}
                      disabled={isGenerating}
                      className="shrink-0 px-3 py-3 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/50 transition-all cursor-pointer disabled:opacity-50"
                      title={t("components.attachReference")}
                    >
                      <Paperclip size={16} />
                    </button>
                    <input ref={chatImageRef} type="file" accept="image/*" onChange={handleChatImageSelect} className="hidden" />
                    <input
                      type="text"
                      value={editFeedback}
                      onChange={(e) => setEditFeedback(e.target.value)}
                      placeholder={t("page.describeChangesPlaceholder")}
                      className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)] transition-all"
                      onKeyDown={(e) => { if (e.key === "Enter" && editFeedback.trim()) handleEditSubmit(); }}
                      disabled={isGenerating}
                    />
                    <button
                      onClick={handleEditSubmit}
                      disabled={
                        !editFeedback.trim() ||
                        isGenerating ||
                        (tokenBalance !== null && tokenBalance < TOKEN_COSTS.edit)
                      }
                      className="shrink-0 px-4 sm:px-5 py-3 rounded-xl bg-[var(--primary)] text-white font-semibold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
                      title={t("tokens.editWithChat")}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>

                {/* Version history */}
                {designHistory.length > 0 && (
                  <div className="w-full">
                    <div className="flex items-center gap-2 mb-3">
                      <Clock size={14} className="text-[var(--muted-foreground)]" />
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        {t("page.previousVersions", { count: designHistory.length })}
                      </h4>
                    </div>
                    <div className={`grid ${isMobile ? "grid-cols-2" : "grid-cols-3"} gap-3`}>
                      {designHistory.map((v) => (
                        <div key={v.id} className="group relative">
                          <div
                            className="rounded-xl overflow-hidden border border-[var(--border)] cursor-pointer hover:border-[var(--primary)]/50 transition-all hover:shadow-md"
                            onClick={() => setLightboxSrc(`data:${v.imageMimeType};base64,${v.imageBase64}`)}
                          >
                            <img
                              src={`data:${v.imageMimeType};base64,${v.imageBase64}`}
                              alt={v.brief?.subject || t("page.previousDesign")}
                              className="w-full aspect-[4/3] object-cover"
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); restoreDesignVersion(v.id); }}
                              className={`absolute top-2 right-2 px-2 py-1 rounded-md bg-black/70 text-white text-[10px] font-medium hover:bg-black/90 cursor-pointer ${isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100 transition-opacity"}`}
                              title={t("components.useVersionAsRef")}
                            >
                              {t("components.useAsRef")}
                            </button>
                          </div>
                          <div className="mt-1.5 px-0.5">
                            <p className="text-[11px] font-medium truncate">{v.brief?.subject || t("page.design")}</p>
                            {v.feedback && (
                              <p className="text-[10px] text-[var(--muted-foreground)] truncate">{t("page.editQuote", { feedback: v.feedback })}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showFinalResult && designMode === "made" && (
              <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                  <ShoppingBag size={16} className="text-[var(--primary)]" />
                  {productLinks.length > 0 ? t("page.productsInRender") : t("page.yourSelectedProducts")}
                </h3>
                {productLinks.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">{t("page.noProductsInRender")}</p>
                ) : (
                <div className="flex flex-col gap-3">
                  {(() => {
                    const list = productLinks;
                    const showBands = list.length > 0;
                    let lastBand: number | null = null;
                    return list.map((link) => {
                      const band = catalogCategorySortKey(link.category ?? "", link.name);
                      const showHeader = showBands && band !== lastBand;
                      lastBand = band;
                      const bandKey = PRODUCT_BAND_I18N_KEYS[band] ?? PRODUCT_BAND_I18N_KEYS[PRODUCT_DISPLAY_BAND.other];
                      return (
                        <div key={link.id}>
                          {showHeader && (
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2 mt-1 first:mt-0">
                              {t(bandKey)}
                            </p>
                          )}
                          <div className={`${isMobile ? "flex flex-col gap-2" : "flex items-center gap-3"} p-3 rounded-xl bg-[var(--muted)] border border-[var(--border)]`}>
                            <div className="flex items-center gap-3 w-full">
                        {link.imageUrl && (
                          <div className="w-14 h-14 rounded-lg overflow-hidden bg-[var(--border)] flex-shrink-0">
                            <img src={link.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{link.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-sm font-bold text-[var(--primary)]">{formatAMD(link.price)}</span>
                            {link.dimensions && (
                              <span className="text-xs text-[var(--muted-foreground)] flex items-center gap-1">
                                <Ruler size={10} />
                                {link.dimensions}
                              </span>
                            )}
                          </div>
                        </div>
                        {!isMobile && (
                          <a
                            href={link.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold hover:brightness-110 transition-all flex-shrink-0"
                          >
                            <ExternalLink size={12} />
                            {t("components.viewOnMarketplace", { marketplace: link.sourceMarketplace })}
                          </a>
                        )}
                      </div>
                      {isMobile && (
                        <a
                          href={link.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-[var(--primary)] text-white text-xs font-semibold hover:brightness-110 transition-all w-full"
                        >
                          <ExternalLink size={12} />
                          {t("components.viewOnMarketplace", { marketplace: link.sourceMarketplace })}
                        </a>
                      )}
                    </div>
                        </div>
                      );
                    });
                  })()}
                </div>
                )}
                {productLinks.length > 0 && (
                  <p className="text-[11px] text-[var(--muted-foreground)] mt-3">
                    {t("page.productsSourcedFrom")}
                  </p>
                )}

                {/* Save Design button */}
                <button
                  type="button"
                  onClick={handleOpenSaveDesign}
                  disabled={saveDesignDone}
                  className="mt-4 w-full py-3 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer disabled:opacity-60"
                >
                  {saveDesignDone ? <Check size={18} /> : <Save size={18} />}
                  {saveDesignDone ? t("page.designSaved") : t("page.saveDesign")}
                </button>
              </div>
            )}

            {showFinalResult && designMode === "custom" && (
              <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <Sparkles size={16} className="text-[var(--primary)]" />
                  {t("page.customResultTitle")}
                </h3>
                <p className="text-sm text-[var(--muted-foreground)] mb-4">
                  {t("page.customResultBlurb")}
                </p>
                <button
                  type="button"
                  onClick={handleCustomInquiry}
                  className="w-full py-3 rounded-xl bg-[var(--primary)] text-white font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all cursor-pointer"
                >
                  <Send size={18} />
                  {t("page.customResultCta")}
                </button>

                {/* Save Design button */}
                <button
                  type="button"
                  onClick={handleOpenSaveDesign}
                  disabled={saveDesignDone}
                  className="mt-3 w-full py-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] font-bold flex items-center justify-center gap-2 hover:brightness-105 transition-all cursor-pointer disabled:opacity-60"
                >
                  {saveDesignDone ? <Check size={18} /> : <Save size={18} />}
                  {saveDesignDone ? t("page.designSaved") : t("page.saveDesign")}
                </button>
              </div>
            )}

            {isGenerating && !showFinalResult && !phasedDesignActive && (
              <div className="w-full aspect-[16/10] cd-skeleton rounded-2xl" />
            )}
          </div>
        </main>

        <aside className={`cd-sidebar cd-sidebar--selected flex flex-col flex-1 min-h-0 min-w-0 h-full border-l border-[var(--border)] bg-[var(--card)] overflow-hidden ${isMobile && mobileTab !== "selected" ? "hidden" : ""} ${isMobile ? "pb-20" : ""}`}>
          <div className="cd-panel-head">
            <h2 className="cd-panel-head-title">{t("page.selectedProducts")}</h2>
            <div className="flex items-center gap-2 shrink-0">
              <span className="cd-panel-count">{selectedProducts.length}</span>
              {isMobile && (
                <button
                  type="button"
                  className="cd-panel-done-btn"
                  onClick={() => setMobileTab("design")}
                >
                  {t("common.done")}
                </button>
              )}
            </div>
          </div>

          <div
            ref={selectedProductsListRef}
            className="cd-selected-products-list custom-scrollbar p-3"
          >
            {selectedProducts.length > 0 ? (
              <div className="flex flex-col gap-2 pb-1">
                {selectedProducts.map((p) => (
                  <SelectedProductChip
                    key={selectedProductKey(p)}
                    product={p}
                    onRemove={() => removeProduct(p.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--muted-foreground)]">
                <ShoppingBag size={32} className="mb-3 opacity-40" />
                <p className="text-sm font-medium">{t("page.noProductsYet")}</p>
                <p className="text-xs mt-1 text-center px-4">
                  {t("page.searchAndAddProducts")}
                </p>
                {isMobile ? (
                  <button
                    type="button"
                    className="cd-browse-catalog-chip mt-3"
                    onClick={() => setMobileTab("search")}
                  >
                    <Search size={14} />
                    {t("page.tabSearch")}
                  </button>
                ) : (
                  <ArrowRight size={14} className="mt-2 opacity-30 rotate-180" />
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
      ) : (
      <ProjectModeContent
        isMobile={isMobile}
        projectStep={projectStep}
        floorPlanBase64={floorPlanBase64}
        floorPlanMimeType={floorPlanMimeType}
        roomPhotos={roomPhotos}
        projectPreferences={projectPreferences}
        projectId={projectId}
        projectAnalysis={projectAnalysis}
        projectConcept={projectConcept}
        projectRooms={projectRooms}
        currentProjectRoomIndex={currentProjectRoomIndex}
        projectLoading={projectLoading}
        projectError={projectError}
        hasPdf={hasPdf}
        inspirationProducts={inspirationProducts}
        setProjectStep={setProjectStep}
        setFloorPlan={setFloorPlan}
        addRoomPhoto={addRoomPhoto}
        removeRoomPhoto={removeRoomPhoto}
        updateRoomPhotoLabel={updateRoomPhotoLabel}
        setPhotoRoomMatch={setPhotoRoomMatch}
        setPhotoStructuralLineMap={setPhotoStructuralLineMap}
        setPhotoObjectRemovalMask={setPhotoObjectRemovalMask}
        setPhotoOpeningAnalysis={setPhotoOpeningAnalysis}
        setProjectPreferences={setProjectPreferences}
        setProjectData={setProjectData}
        setProjectRooms={setProjectRooms}
        setCurrentProjectRoomIndex={setCurrentProjectRoomIndex}
        setProjectLoading={setProjectLoading}
        setProjectError={setProjectError}
        setHasPdf={setHasPdf}
        addInspirationProduct={addInspirationProduct}
        removeInspirationProduct={removeInspirationProduct}
        updateInspirationProductLabel={updateInspirationProductLabel}
        resetProject={resetProject}
        setLightboxSrc={setLightboxSrc}
        catalogCountryCode={selectedCountry}
        catalogSearchMode={searchMode}
        onAiServiceUnavailable={() => setSupportModalOpen(true)}
      />
      ))}

      {roomCameraOpen && (
        <CameraCapture
          open={roomCameraOpen}
          onClose={() => setRoomCameraOpen(false)}
          onCapture={handleImageFile}
        />
      )}

      <SupportContactModal open={supportModalOpen} onClose={() => setSupportModalOpen(false)} />

      <AllProductsModal
        open={allProductsModalOpen}
        onClose={() => setAllProductsModalOpen(false)}
        catalogTotalCount={catalogTotalCount}
        liveProducts={liveSearchResults}
        selectedProducts={selectedProducts}
        onAddCatalog={handleAddCatalogProduct}
        onAddLive={handleAddLiveProduct}
        amLocalExclusive={amLocalExclusive}
      />

      {/* Save Design modal */}
      {saveDesignModalOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center backdrop-blur-sm bg-black/40"
          onClick={() => !saveDesignSaving && setSaveDesignModalOpen(false)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {saveDesignDone ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Check size={24} className="text-green-500" />
                </div>
                <p className="text-sm font-semibold text-[var(--foreground)]">{t("page.designSaved")}</p>
              </div>
            ) : (
              <>
                <h3 className="text-base font-bold mb-4 flex items-center gap-2">
                  <Save size={18} className="text-[var(--primary)]" />
                  {t("page.saveDesign")}
                </h3>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                  {t("page.designName")}
                </label>
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="text"
                    value={saveDesignName}
                    onChange={(e) => setSaveDesignName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !saveDesignSaving) handleSaveDesign(); }}
                    placeholder={t("page.designNamePlaceholder")}
                    className="flex-1 px-4 py-3 rounded-xl bg-[var(--muted)] border border-[var(--border)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)] transition-all"
                    autoFocus
                    disabled={saveDesignSaving}
                  />
                  <button
                    type="button"
                    onClick={() => setSaveDesignName(generateAutoDesignName())}
                    className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    title={t("page.autoName")}
                  >
                    <Edit3 size={16} />
                  </button>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setSaveDesignModalOpen(false)}
                    disabled={saveDesignSaving}
                    className="flex-1 py-3 rounded-xl font-bold border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--border)] transition-all cursor-pointer disabled:opacity-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveDesign}
                    disabled={saveDesignSaving}
                    className="flex-1 py-3 rounded-xl font-bold bg-[var(--primary)] text-white hover:brightness-110 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saveDesignSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    {t("page.saveDesign")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Lightbox modal */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-sm cd-lightbox-overlay"
          style={{ padding: "env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)" }}
          onClick={() => setLightboxSrc(null)}
        >
          <div
            className="absolute flex items-center gap-2 touch-manipulation"
            style={{ top: "max(1.25rem, env(safe-area-inset-top, 1.25rem))", right: "max(1.25rem, env(safe-area-inset-right, 1.25rem))" }}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDownloadLightbox(); }}
              className="p-3 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors cursor-pointer cd-lightbox-close"
              title={t("page.downloadDesign")}
            >
              <Download size={22} />
            </button>
            <button
              type="button"
              onClick={() => setLightboxSrc(null)}
              className="p-3 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors cursor-pointer cd-lightbox-close"
            >
              <X size={24} />
            </button>
          </div>
          <img
            src={lightboxSrc}
            alt={t("page.fullSizeDesign")}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
