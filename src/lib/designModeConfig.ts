import { hasLocalProductCatalog } from "@/lib/catalogCountryCapabilities";

/** Room design mode: custom = single-pass AI furnish; made = phased catalog products. */
export type DesignMode = "made" | "custom";

export type DesignModeCatalogContext = {
  countryCode: string;
  searchMode?: string;
};

/** Flip to true to expose Ready-made (catalog phased) mode where local catalog exists. */
export const SHOW_MADE_DESIGN_MODE = true;

export const DEFAULT_DESIGN_MODE: DesignMode = "custom";

/** True when Made/Custom toggle may be shown (Armenia + local catalog today). */
export function isMadeDesignModeAvailable(
  countryCode: string,
  searchMode: string = "local",
): boolean {
  return SHOW_MADE_DESIGN_MODE && hasLocalProductCatalog(countryCode, searchMode);
}

export function designModeCatalogFromPreferences(prefs?: {
  countryCode?: string;
  searchMode?: string;
}): DesignModeCatalogContext {
  return {
    countryCode: prefs?.countryCode ?? "",
    searchMode: prefs?.searchMode ?? "local",
  };
}

/** Runtime mode — coerces `made` → `custom` when Made is unavailable for the catalog context. */
export function resolveDesignMode(
  mode: DesignMode | undefined,
  catalog?: DesignModeCatalogContext,
): DesignMode {
  const raw = mode === "made" || mode === "custom" ? mode : DEFAULT_DESIGN_MODE;
  if (!SHOW_MADE_DESIGN_MODE && raw === "made") return DEFAULT_DESIGN_MODE;
  if (
    catalog &&
    raw === "made" &&
    !isMadeDesignModeAvailable(catalog.countryCode, catalog.searchMode ?? "local")
  ) {
    return DEFAULT_DESIGN_MODE;
  }
  return raw;
}

export function isCustomDesignMode(
  mode: DesignMode | undefined,
  catalog?: DesignModeCatalogContext,
): boolean {
  return resolveDesignMode(mode, catalog) === "custom";
}

/** Custom mode skips catalog slot resolution and renders in one pass. */
export function isFreeRenderMode(
  mode: DesignMode | undefined,
  catalog?: DesignModeCatalogContext,
): boolean {
  return isCustomDesignMode(mode, catalog);
}

/** Parse raw request designMode + country into effective mode for generation. */
export function resolveDesignModeForRequest(
  rawDesignMode: string | null | undefined,
  countryCode: string,
  searchMode: string,
): DesignMode {
  const mode = String(rawDesignMode ?? "custom").trim() === "made" ? "made" : "custom";
  return resolveDesignMode(mode, { countryCode, searchMode });
}
