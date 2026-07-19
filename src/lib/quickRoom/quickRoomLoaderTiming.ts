/** Cosmetic analyse step duration — no room-geometry API is called. */
export const QUICK_ROOM_COSMETIC_ANALYSE_MS = 4500;

/** Matches `page.analysingStructure` / `resolveGeneratePhase` in VistaHome. */
export const QUICK_ROOM_COSMETIC_ANALYSE_MESSAGE = "Analysing your room structure…";

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Holds FAL SSE progress until the cosmetic analyse window completes. */
export function createQuickRoomLoaderPhaseGate(onPhase?: (message: string) => void) {
  let gateOpen = false;
  let pendingPhaseMessage: string | null = null;

  return {
    emitCosmeticAnalyse: () => {
      onPhase?.(QUICK_ROOM_COSMETIC_ANALYSE_MESSAGE);
    },
    gatedEmit: (message: string) => {
      if (!gateOpen) {
        pendingPhaseMessage = message;
        return;
      }
      onPhase?.(message);
    },
    openGate: () => {
      gateOpen = true;
      if (pendingPhaseMessage) {
        onPhase?.(pendingPhaseMessage);
        pendingPhaseMessage = null;
      }
    },
    isGateOpen: () => gateOpen,
    pendingMessage: () => pendingPhaseMessage,
  };
}
