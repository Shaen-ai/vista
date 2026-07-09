export type StagingBatchMode =
  | "full"
  | "master-only"
  | "append-secondary"
  | "master-redo-cascade"
  | "secondary-redo";

export type StagingWorkMode = "master" | "secondary";

export type StagingWorkItem = {
  photoId: string;
  mode: StagingWorkMode;
  globalIndex: number;
};

export type PlanStagingBatchModeInput = {
  photoIds: string[];
  rendersCount: number;
  renderedPhotoIds: string[];
  redoPhotoId?: string;
  existingHeroHasBase64: boolean;
  /** Master regenerate (not edit) when secondaries already exist — re-chain all views */
  allowMasterRedoCascade?: boolean;
};

export function planStagingBatchMode(input: PlanStagingBatchModeInput): {
  batchMode: StagingBatchMode;
  workQueue: StagingWorkItem[];
} {
  const {
    photoIds,
    rendersCount,
    renderedPhotoIds,
    redoPhotoId,
    existingHeroHasBase64,
    allowMasterRedoCascade = false,
  } = input;

  const renderedSet = new Set(renderedPhotoIds);
  const masterPhotoId = photoIds[0];
  const multiView = photoIds.length > 1;

  if (!masterPhotoId) {
    return { batchMode: "full", workQueue: [] };
  }

  const isMasterRedo = !!redoPhotoId && redoPhotoId === masterPhotoId && multiView;
  const isSecondaryRedo = !!redoPhotoId && redoPhotoId !== masterPhotoId;
  const hasRenderedSecondaries = photoIds.slice(1).some((id) => renderedSet.has(id));

  const appendSecondary =
    !redoPhotoId &&
    multiView &&
    existingHeroHasBase64 &&
    photoIds.length > rendersCount &&
    photoIds.some((id) => !renderedSet.has(id));

  const toWorkItem = (photoId: string, mode: StagingWorkMode): StagingWorkItem => ({
    photoId,
    mode,
    globalIndex: photoIds.indexOf(photoId),
  });

  if (isMasterRedo && allowMasterRedoCascade && hasRenderedSecondaries) {
    return {
      batchMode: "master-redo-cascade",
      workQueue: photoIds.map((id, i) => toWorkItem(id, i === 0 ? "master" : "secondary")),
    };
  }

  if (isMasterRedo) {
    return {
      batchMode: "master-only",
      workQueue: [toWorkItem(masterPhotoId, "master")],
    };
  }

  if (isSecondaryRedo && redoPhotoId) {
    return {
      batchMode: "secondary-redo",
      workQueue: [toWorkItem(redoPhotoId, "secondary")],
    };
  }

  if (appendSecondary) {
    return {
      batchMode: "append-secondary",
      workQueue: photoIds
        .filter((id) => !renderedSet.has(id))
        .map((id) => toWorkItem(id, "secondary")),
    };
  }

  const isInitialMultiMaster = multiView && !redoPhotoId && rendersCount === 0;
  if (isInitialMultiMaster) {
    return {
      batchMode: "master-only",
      workQueue: [toWorkItem(masterPhotoId, "master")],
    };
  }

  return {
    batchMode: "full",
    workQueue: photoIds.map((id, i) =>
      toWorkItem(id, multiView && i > 0 ? "secondary" : "master"),
    ),
  };
}
