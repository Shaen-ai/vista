"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Ruler, ShoppingBag } from "lucide-react";
import type { ProductPurchaseLink } from "@/app/store";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { formatAmdPrice } from "@/lib/formatAmdPrice";
import { catalogCategorySortKey, PRODUCT_DISPLAY_BAND } from "@/lib/productDisplayOrder";

const PRODUCT_BAND_I18N_KEYS: Record<number, string> = {
  [PRODUCT_DISPLAY_BAND.flooring]: "page.productBandFlooring",
  [PRODUCT_DISPLAY_BAND.walls]: "page.productBandWalls",
  [PRODUCT_DISPLAY_BAND.windowTreatments]: "page.productBandWindowTreatments",
  [PRODUCT_DISPLAY_BAND.lighting]: "page.productBandLighting",
  [PRODUCT_DISPLAY_BAND.furniture]: "page.productBandFurniture",
  [PRODUCT_DISPLAY_BAND.decor]: "page.productBandDecor",
  [PRODUCT_DISPLAY_BAND.other]: "page.productBandOther",
};

export function MadeProductsList({
  products,
  defaultExpanded = false,
  isMobile = false,
  className = "",
}: {
  products: ProductPurchaseLink[];
  defaultExpanded?: boolean;
  isMobile?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const title =
    products.length > 0
      ? t("page.productsInRenderCount", { count: products.length })
      : t("page.yourSelectedProducts");

  return (
    <div className={`w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--muted)]/40 transition-colors cursor-pointer"
        aria-expanded={expanded}
      >
        <span className="text-sm font-bold flex items-center gap-2 min-w-0">
          <ShoppingBag size={16} className="text-[var(--primary)] shrink-0" />
          <span className="truncate">{title}</span>
        </span>
        {expanded ? (
          <ChevronUp size={18} className="text-[var(--muted-foreground)] shrink-0" aria-hidden />
        ) : (
          <ChevronDown size={18} className="text-[var(--muted-foreground)] shrink-0" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-[var(--border)]">
          {products.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] pt-3">{t("page.noProductsInRender")}</p>
          ) : (
            <div className="flex flex-col gap-3 pt-3">
              {(() => {
                let lastBand: number | null = null;
                return products.map((link) => {
                  const band = catalogCategorySortKey(link.category ?? "", link.name);
                  const showHeader = band !== lastBand;
                  lastBand = band;
                  const bandKey =
                    PRODUCT_BAND_I18N_KEYS[band] ?? PRODUCT_BAND_I18N_KEYS[PRODUCT_DISPLAY_BAND.other];
                  return (
                    <div key={link.id}>
                      {showHeader && (
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)] mb-2 mt-1 first:mt-0">
                          {t(bandKey)}
                        </p>
                      )}
                      <div
                        className={`${isMobile ? "flex flex-col gap-2" : "flex items-center gap-3"} p-3 rounded-xl bg-[var(--muted)] border border-[var(--border)]`}
                      >
                        <div className="flex items-center gap-3 w-full">
                          {link.imageUrl && (
                            <div className="w-14 h-14 rounded-lg overflow-hidden bg-[var(--border)] flex-shrink-0">
                              <img
                                src={link.imageUrl}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{link.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-sm font-bold text-[var(--primary)]">
                                {formatAmdPrice(link.price)}
                              </span>
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
              <p className="text-[11px] text-[var(--muted-foreground)]">{t("page.productsSourcedFrom")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
