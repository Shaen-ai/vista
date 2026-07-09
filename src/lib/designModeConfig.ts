/** Room design mode: custom = single-pass AI furnish; made = phased catalog products. */
export type DesignMode = "made" | "custom";

/** Flip to true to expose Ready-made (catalog phased) mode in project/quick-room UI. */
export const SHOW_MADE_DESIGN_MODE = false;

export const DEFAULT_DESIGN_MODE: DesignMode = "custom";

/** Runtime mode — coerces `made` → `custom` while the feature is hidden. */
export function resolveDesignMode(mode: DesignMode | undefined): DesignMode {
  const raw = mode === "made" || mode === "custom" ? mode : DEFAULT_DESIGN_MODE;
  if (!SHOW_MADE_DESIGN_MODE && raw === "made") return DEFAULT_DESIGN_MODE;
  return raw;
}

export function isCustomDesignMode(mode: DesignMode | undefined): boolean {
  return resolveDesignMode(mode) === "custom";
}

/** Custom mode skips catalog slot resolution and renders in one pass. */
export function isFreeRenderMode(mode: DesignMode | undefined): boolean {
  return isCustomDesignMode(mode);
}
