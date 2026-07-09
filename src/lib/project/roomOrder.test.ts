import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectInFlightRoomIds,
  isRoomGenerationSettled,
  mergePolledRenders,
  nextHubRoomId,
  normalizeStaleGeneratingRooms,
  resolveRoomGenerationDisplay,
  roomGenerationProgressLabel,
  shouldClearGeneratingRoomId,
} from "./roomOrder";

test("normalizeStaleGeneratingRooms resets empty generating rooms to pending", () => {
  const rooms = [{ roomId: "room-1", status: "generating", renders: [] }];
  const out = normalizeStaleGeneratingRooms(rooms);
  assert.equal(out[0]?.status, "pending");
});

test("normalizeStaleGeneratingRooms keeps partial work as review", () => {
  const rooms = [
    {
      roomId: "room-1",
      status: "generating",
      renders: [{ base64: "abc" }],
    },
  ];
  const out = normalizeStaleGeneratingRooms(rooms);
  assert.equal(out[0]?.status, "review");
});

test("normalizeStaleGeneratingRooms leaves non-generating rooms unchanged", () => {
  const rooms = [{ roomId: "room-1", status: "approved", renders: [] }];
  const out = normalizeStaleGeneratingRooms(rooms);
  assert.equal(out[0]?.status, "approved");
});

test("isRoomGenerationSettled is true when renders exist even if status is generating", () => {
  assert.equal(
    isRoomGenerationSettled({ status: "generating", renders: [{ base64: "x" }] }),
    true,
  );
});

test("isRoomGenerationSettled is true on generationError", () => {
  assert.equal(
    isRoomGenerationSettled({ status: "generating", renders: [], generationError: "fail" }),
    true,
  );
});

test("isRoomGenerationSettled is false while actively generating", () => {
  assert.equal(isRoomGenerationSettled({ status: "generating", renders: [] }), false);
});

test("shouldClearGeneratingRoomId clears stale Redis generating with partial renders", () => {
  const raw = { status: "generating", renders: [{ base64: "abc" }] };
  const normalized = normalizeStaleGeneratingRooms([{ roomId: "r1", ...raw }])[0]!;
  assert.equal(shouldClearGeneratingRoomId(raw, normalized), true);
});

test("shouldClearGeneratingRoomId keeps tracking while server still reports generating", () => {
  const raw = { status: "generating", renders: [] };
  const normalized = normalizeStaleGeneratingRooms([{ roomId: "r1", ...raw }])[0]!;
  assert.equal(shouldClearGeneratingRoomId(raw, normalized), false);
});

test("nextHubRoomId prefers rooms not currently generating", () => {
  const order = ["a", "b", "c"];
  const rooms = [
    { roomId: "a", status: "pending" },
    { roomId: "b", status: "pending" },
    { roomId: "c", status: "pending" },
  ];
  const generating = new Set(["b"]);
  assert.equal(nextHubRoomId(order, rooms, generating, "a"), "c");
});

test("nextHubRoomId falls back to generating room when it is the only option", () => {
  const order = ["a"];
  const rooms = [{ roomId: "a", status: "pending" }];
  const generating = new Set(["a"]);
  assert.equal(nextHubRoomId(order, rooms, generating, "a"), "a");
});

test("roomGenerationProgressLabel maps staging steps", () => {
  const t = (key: string) => key;
  assert.match(
    roomGenerationProgressLabel({ generationStep: "staging", viewpointTargetCount: 2, renders: [] }, t),
    /project\.generationRendering/,
  );
  assert.match(
    roomGenerationProgressLabel({ generationStep: "validate", viewpointTargetCount: 2, renders: [1] }, t),
    /project\.generationValidating/,
  );
  assert.match(
    roomGenerationProgressLabel({ generationStep: "prep" }, t),
    /project\.preparingRoom/,
  );
});

test("resolveRoomGenerationDisplay prefers live SSE progress over step estimate", () => {
  const t = (key: string) => key;
  const display = resolveRoomGenerationDisplay(
    { generationStep: "prep", renders: [], viewpointTargetCount: 2 },
    t,
    { progress: 0.72, message: "Staging view 2 of 2…", updatedAt: Date.now() },
  );
  assert.equal(display.progress, 0.72);
  assert.equal(display.message, "Staging view 2 of 2…");
});

test("resolveRoomGenerationDisplay falls back to step-based progress", () => {
  const t = (key: string) => key;
  const display = resolveRoomGenerationDisplay(
    { generationStep: "staging", renders: [1], viewpointTargetCount: 2 },
    t,
  );
  assert.ok(display.progress >= 0.45);
  assert.match(display.message, /project\.generationRendering/);
});

test("normalizeStaleGeneratingRooms leaves tracked generating rooms unchanged", () => {
  const rooms = [{ roomId: "room-1", status: "generating", renders: [] }];
  const out = normalizeStaleGeneratingRooms(rooms, new Set(["room-1"]));
  assert.equal(out[0]?.status, "generating");
});

test("mergePolledRenders keeps prev base64 during same generation attempt", () => {
  const prev = [{ base64: "old", mimeType: "image/jpeg" }];
  const polled = [{ mimeType: "image/jpeg", angleIndex: 0 }];
  const out = mergePolledRenders(prev, polled, 2, 2);
  assert.equal(out[0]?.base64, "old");
});

test("mergePolledRenders drops prev base64 when generation attempt advanced", () => {
  const prev = [{ base64: "old", mimeType: "image/jpeg" }];
  const polled = [{ mimeType: "image/jpeg", angleIndex: 0 }];
  const out = mergePolledRenders(prev, polled, 1, 2);
  assert.equal(out[0]?.base64, "");
});

test("mergePolledRenders prefers polled base64 when present", () => {
  const prev = [{ base64: "old", mimeType: "image/jpeg" }];
  const polled = [{ base64: "new", mimeType: "image/jpeg" }];
  const out = mergePolledRenders(prev, polled, 1, 2);
  assert.equal(out[0]?.base64, "new");
});

test("detectInFlightRoomIds finds generating status and active steps", () => {
  const ids = detectInFlightRoomIds([
    { roomId: "a", status: "generating" },
    { roomId: "b", status: "review", generationStep: "staging" },
    { roomId: "e", status: "review", generationStep: "validate" },
    { roomId: "c", status: "review", generationStep: "complete" },
    { roomId: "d", status: "pending" },
  ]);
  assert.deepEqual(ids.sort(), ["a", "b", "e"]);
});

test("resolveRoomGenerationDisplay marks stale staging", () => {
  const t = (key: string) => key;
  const display = resolveRoomGenerationDisplay(
    { generationStep: "staging", renders: [], viewpointTargetCount: 2 },
    t,
    { progress: 0.6, message: "Running…", updatedAt: Date.now() - 60_000 },
  );
  assert.equal(display.isStaleStaging, true);
});
