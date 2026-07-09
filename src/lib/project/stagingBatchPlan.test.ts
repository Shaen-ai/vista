import assert from "node:assert/strict";
import test from "node:test";
import { planStagingBatchMode } from "./stagingBatchPlan";

const PHOTO0 = "photo-0";
const PHOTO1 = "photo-1";

test("2 photos, 0 renders → master-only", () => {
  const { batchMode, workQueue } = planStagingBatchMode({
    photoIds: [PHOTO0, PHOTO1],
    rendersCount: 0,
    renderedPhotoIds: [],
    existingHeroHasBase64: false,
  });
  assert.equal(batchMode, "master-only");
  assert.equal(workQueue.length, 1);
  assert.equal(workQueue[0]!.photoId, PHOTO0);
  assert.equal(workQueue[0]!.mode, "master");
});

test("2 photos, 1 render, hero ready → append-secondary for photo 1", () => {
  const { batchMode, workQueue } = planStagingBatchMode({
    photoIds: [PHOTO0, PHOTO1],
    rendersCount: 1,
    renderedPhotoIds: [PHOTO0],
    existingHeroHasBase64: true,
  });
  assert.equal(batchMode, "append-secondary");
  assert.equal(workQueue.length, 1);
  assert.equal(workQueue[0]!.photoId, PHOTO1);
  assert.equal(workQueue[0]!.mode, "secondary");
});

test("2 photos, 2 renders, redo master with cascade → master-redo-cascade", () => {
  const { batchMode, workQueue } = planStagingBatchMode({
    photoIds: [PHOTO0, PHOTO1],
    rendersCount: 2,
    renderedPhotoIds: [PHOTO0, PHOTO1],
    redoPhotoId: PHOTO0,
    existingHeroHasBase64: true,
    allowMasterRedoCascade: true,
  });
  assert.equal(batchMode, "master-redo-cascade");
  assert.equal(workQueue.length, 2);
  assert.equal(workQueue[0]!.mode, "master");
  assert.equal(workQueue[1]!.mode, "secondary");
});

test("2 photos, 0 renders, redo master photoId → master-only (not cascade)", () => {
  const { batchMode, workQueue } = planStagingBatchMode({
    photoIds: [PHOTO0, PHOTO1],
    rendersCount: 0,
    renderedPhotoIds: [],
    redoPhotoId: PHOTO0,
    existingHeroHasBase64: false,
    allowMasterRedoCascade: true,
  });
  assert.equal(batchMode, "master-only");
  assert.equal(workQueue.length, 1);
  assert.equal(workQueue[0]!.mode, "master");
});

test("2 photos, 2 renders, redo master without cascade flag → master-only", () => {
  const { batchMode, workQueue } = planStagingBatchMode({
    photoIds: [PHOTO0, PHOTO1],
    rendersCount: 2,
    renderedPhotoIds: [PHOTO0, PHOTO1],
    redoPhotoId: PHOTO0,
    existingHeroHasBase64: true,
    allowMasterRedoCascade: false,
  });
  assert.equal(batchMode, "master-only");
  assert.equal(workQueue.length, 1);
});

test("2 photos, 1 render, redo master edit (no cascade) → master-only", () => {
  const { batchMode, workQueue } = planStagingBatchMode({
    photoIds: [PHOTO0, PHOTO1],
    rendersCount: 1,
    renderedPhotoIds: [PHOTO0],
    redoPhotoId: PHOTO0,
    existingHeroHasBase64: true,
    allowMasterRedoCascade: false,
  });
  assert.equal(batchMode, "master-only");
  assert.equal(workQueue.length, 1);
  assert.equal(workQueue[0]!.photoId, PHOTO0);
});

test("2 photos, 1 render, redoPhotoId = un-rendered secondary → secondary-redo for that photo", () => {
  // Contract generateNextViewpoint relies on: targeting a pending (never rendered)
  // secondary photo via redoPhotoId renders exactly that one view.
  const { batchMode, workQueue } = planStagingBatchMode({
    photoIds: [PHOTO0, PHOTO1],
    rendersCount: 1,
    renderedPhotoIds: [PHOTO0],
    redoPhotoId: PHOTO1,
    existingHeroHasBase64: true,
  });
  assert.equal(batchMode, "secondary-redo");
  assert.deepEqual(workQueue, [{ photoId: PHOTO1, mode: "secondary", globalIndex: 1 }]);
});

test("single photo first generate → full with one master", () => {
  const { batchMode, workQueue } = planStagingBatchMode({
    photoIds: [PHOTO0],
    rendersCount: 0,
    renderedPhotoIds: [],
    existingHeroHasBase64: false,
  });
  assert.equal(batchMode, "full");
  assert.equal(workQueue.length, 1);
  assert.equal(workQueue[0]!.mode, "master");
});
