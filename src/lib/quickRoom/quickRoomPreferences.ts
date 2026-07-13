import type { QuickRoomPlacementMode } from "@/lib/quickRoom/placementMode";
import { useConsumerDesignStore } from "@/app/store";

export type QuickRoomOptionsPayload = {
  designMode: "made" | "custom";
  placementMode: QuickRoomPlacementMode;
  searchMode: string;
  selectedCountry: string;
  selectedStyle: string;
  selectedProductIds: number[];
};

export type QuickRoomPhasedStatePayload = {
  phasedDesignActive: boolean;
  phasedCurrentPhase: string;
  phase1SelectedIndex: number;
  phase2SelectedIndex: number;
  phase3SelectedIndex: number;
};

export type QuickRoomPreferencesPatch = {
  draftPrompt?: string;
  quickRoomOptions?: Partial<QuickRoomOptionsPayload>;
  quickRoomPhasedState?: Partial<QuickRoomPhasedStatePayload>;
};

export function buildQuickRoomOptionsFromStore(): QuickRoomOptionsPayload {
  const s = useConsumerDesignStore.getState();
  return {
    designMode: s.designMode,
    placementMode: s.placementMode,
    searchMode: s.searchMode,
    selectedCountry: s.selectedCountry,
    selectedStyle: s.selectedStyle,
    selectedProductIds: s.selectedProducts.map((p) => p.id),
  };
}

export function buildQuickRoomPhasedStateFromStore(): QuickRoomPhasedStatePayload {
  const s = useConsumerDesignStore.getState();
  return {
    phasedDesignActive: s.phasedDesignActive,
    phasedCurrentPhase: s.phasedCurrentPhase,
    phase1SelectedIndex: s.phase1SelectedIndex,
    phase2SelectedIndex: s.phase2SelectedIndex,
    phase3SelectedIndex: s.phase3SelectedIndex,
  };
}

export function applyQuickRoomOptionsFromPreferences(
  options: Partial<QuickRoomOptionsPayload> | undefined,
): void {
  if (!options) return;
  const store = useConsumerDesignStore.getState();
  if (options.designMode) store.setDesignMode(options.designMode);
  if (options.placementMode) store.setPlacementMode(options.placementMode);
  if (options.searchMode) store.setSearchMode(options.searchMode as never);
  if (options.selectedCountry) store.setSelectedCountry(options.selectedCountry);
  if (options.selectedStyle) store.setSelectedStyle(options.selectedStyle);
  if (Array.isArray(options.selectedProductIds)) {
    // Product objects are restored separately when possible; ids kept in prefs for reference.
    void options.selectedProductIds;
  }
}

export function applyQuickRoomPhasedStateFromPreferences(
  state: Partial<QuickRoomPhasedStatePayload> | undefined,
): void {
  if (!state) return;
  useConsumerDesignStore.setState({
    ...(state.phasedDesignActive !== undefined ? { phasedDesignActive: state.phasedDesignActive } : {}),
    ...(state.phasedCurrentPhase !== undefined
      ? { phasedCurrentPhase: state.phasedCurrentPhase as never }
      : {}),
    ...(state.phase1SelectedIndex !== undefined ? { phase1SelectedIndex: state.phase1SelectedIndex } : {}),
    ...(state.phase2SelectedIndex !== undefined ? { phase2SelectedIndex: state.phase2SelectedIndex } : {}),
    ...(state.phase3SelectedIndex !== undefined ? { phase3SelectedIndex: state.phase3SelectedIndex } : {}),
  });
}
