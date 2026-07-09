import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeOrphanedGeneratingRoom,
  ORPHAN_GENERATION_ERROR,
  recoverOrphanedRoomsInState,
} from "./orphanGenerationRecovery";
import type { RoomResult } from "./types";

function room(partial: Partial<RoomResult> & Pick<RoomResult, "roomId">): RoomResult {
  return {
    roomId: partial.roomId,
    status: partial.status ?? "pending",
    brief: partial.brief ?? { roomName: partial.roomId, roomType: "bedroom" },
    renders: partial.renders ?? [],
    materials: partial.materials ?? [],
    editHistory: partial.editHistory ?? [],
    version: partial.version ?? 1,
    phases: partial.phases,
    generationStep: partial.generationStep,
    generationError: partial.generationError,
  } as RoomResult;
}

test("normalizeOrphanedGeneratingRoom leaves actively running rooms unchanged", () => {
  const r = room({ roomId: "r1", status: "generating", generationStep: "validate" });
  const out = normalizeOrphanedGeneratingRoom(r, true);
  assert.equal(out.orphan, false);
  assert.equal(out.room.status, "generating");
});

test("normalizeOrphanedGeneratingRoom fails orphaned generating room without renders", () => {
  const r = room({ roomId: "r1", status: "generating", generationStep: "validate" });
  const out = normalizeOrphanedGeneratingRoom(r, false);
  assert.equal(out.orphan, true);
  assert.equal(out.room.status, "pending");
  assert.equal(out.room.generationStep, "idle");
  assert.equal(out.room.generationError, ORPHAN_GENERATION_ERROR);
});

test("normalizeOrphanedGeneratingRoom fails orphaned room with partial renders to review", () => {
  const r = room({
    roomId: "r1",
    status: "generating",
    generationStep: "validate",
    renders: [{ angleIndex: 0, angleDescription: "View 1", base64: "abc", mimeType: "image/png" }],
  });
  const out = normalizeOrphanedGeneratingRoom(r, false);
  assert.equal(out.orphan, true);
  assert.equal(out.room.status, "review");
  assert.equal(out.room.renders.length, 1);
});

test("recoverOrphanedRoomsInState only touches orphaned rooms", () => {
  const rooms = [
    room({ roomId: "active", status: "generating", generationStep: "staging" }),
    room({ roomId: "stale", status: "generating", generationStep: "validate" }),
    room({ roomId: "done", status: "review", renders: [{ angleIndex: 0, angleDescription: "", base64: "x", mimeType: "image/png" }] }),
  ];
  const { rooms: next, recovered } = recoverOrphanedRoomsInState(rooms, (id) => id === "active");
  assert.equal(recovered, true);
  assert.equal(next[0]!.status, "generating");
  assert.equal(next[1]!.generationError, ORPHAN_GENERATION_ERROR);
  assert.equal(next[2]!.status, "review");
});
