import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUICK_ROOM_COSMETIC_ANALYSE_MESSAGE,
  createQuickRoomLoaderPhaseGate,
} from "./quickRoomLoaderTiming";

test("createQuickRoomLoaderPhaseGate emits cosmetic analyse first", () => {
  const phases: string[] = [];
  const gate = createQuickRoomLoaderPhaseGate((msg) => phases.push(msg));
  gate.emitCosmeticAnalyse();
  assert.deepEqual(phases, [QUICK_ROOM_COSMETIC_ANALYSE_MESSAGE]);
});

test("createQuickRoomLoaderPhaseGate holds FAL messages until gate opens", () => {
  const phases: string[] = [];
  const gate = createQuickRoomLoaderPhaseGate((msg) => phases.push(msg));
  gate.emitCosmeticAnalyse();
  gate.gatedEmit("Locking room structure…");
  gate.gatedEmit("Rendering your interior…");
  assert.equal(gate.isGateOpen(), false);
  assert.equal(gate.pendingMessage(), "Rendering your interior…");
  assert.deepEqual(phases, [QUICK_ROOM_COSMETIC_ANALYSE_MESSAGE]);

  gate.openGate();
  assert.equal(gate.isGateOpen(), true);
  assert.deepEqual(phases, [
    QUICK_ROOM_COSMETIC_ANALYSE_MESSAGE,
    "Rendering your interior…",
  ]);
});

test("createQuickRoomLoaderPhaseGate forwards immediately after gate opens", () => {
  const phases: string[] = [];
  const gate = createQuickRoomLoaderPhaseGate((msg) => phases.push(msg));
  gate.openGate();
  gate.gatedEmit("Rendering your interior…");
  assert.deepEqual(phases, ["Rendering your interior…"]);
});
