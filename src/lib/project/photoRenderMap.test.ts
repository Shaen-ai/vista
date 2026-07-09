import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRedoIndividualView,
  resolvePhotoIdForRenderIndex,
  sortRoomPhotoIds,
} from "./photoRenderMap";
import type { RoomResult } from "./types";

test("sortRoomPhotoIds puts viewpoint-marked photos first", () => {
  const sorted = sortRoomPhotoIds([
    { id: "b", viewpoint: undefined },
    { id: "a", viewpoint: { x: 1, y: 2, angleDeg: 0 } },
    { id: "c", viewpoint: { x: 3, y: 4, angleDeg: 90 } },
  ]);
  assert.deepEqual(sorted, ["a", "c", "b"]);
});

test("resolvePhotoIdForRenderIndex prefers photoRenderMap", () => {
  const room = {
    photoRenderMap: { "photo-2": 1, "photo-1": 0 },
    primaryPhotoId: "photo-1",
  } satisfies Pick<RoomResult, "photoRenderMap" | "primaryPhotoId">;
  assert.equal(resolvePhotoIdForRenderIndex(room, 0), "photo-1");
  assert.equal(resolvePhotoIdForRenderIndex(room, 1), "photo-2");
});

test("resolvePhotoIdForRenderIndex falls back to room photo order", () => {
  const room = {
    photoRenderMap: { "photo-hero": 0 },
    primaryPhotoId: "photo-hero",
  } satisfies Pick<RoomResult, "photoRenderMap" | "primaryPhotoId">;
  assert.equal(
    resolvePhotoIdForRenderIndex(room, 1, ["photo-hero", "photo-secondary"]),
    "photo-secondary",
  );
});

test("canRedoIndividualView is true for multi-view rooms", () => {
  assert.equal(
    canRedoIndividualView({ renders: [{}, {}] as RoomResult["renders"], viewpointTargetCount: 2 }),
    true,
  );
  assert.equal(
    canRedoIndividualView({ renders: [{}] as RoomResult["renders"], viewpointTargetCount: 1 }),
    false,
  );
});
