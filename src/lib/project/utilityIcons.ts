/**
 * Single source of truth for utility-entry-point icons so the side panel
 * (ProjectMode) and the floor-plan canvas markers (FloorPlanHub) never drift.
 */
import { Droplets, Zap, Flame, type LucideIcon } from "lucide-react";
import type { UtilityPointType } from "./types";

export const UTILITY_ICONS: Record<UtilityPointType, LucideIcon> = {
  water_inlet: Droplets,
  water_drain_stack: Droplets,
  electrical_panel: Zap,
  gas_inlet: Flame,
};
