export type PhasedFinalView = { id: string; base64: string; mimeType: string };

type ViewpointTrack = {
  phase1Versions: Array<{ image?: { base64: string; mimeType: string } }>;
  phase1SelectedIndex: number;
  phase2Versions: Array<{ image?: { base64: string; mimeType: string } }>;
  phase2SelectedIndex: number;
  phase3Versions: Array<{ image?: { base64: string; mimeType: string } }>;
  phase3SelectedIndex: number;
};

function trackHasCompletedPipeline(track: ViewpointTrack, compactFlow: boolean): boolean {
  if (compactFlow) return track.phase2Versions.length > 0;
  return track.phase3Versions.length > 0;
}

function getTerminalTrackImage(track: ViewpointTrack) {
  const terminal =
    track.phase3Versions[track.phase3SelectedIndex] ??
    track.phase2Versions[track.phase2SelectedIndex] ??
    track.phase1Versions[track.phase1SelectedIndex];
  return terminal?.image ?? null;
}

export function buildPhasedFinalViews({
  primary,
  extraPhotos,
  tracks,
  compactFlow,
}: {
  primary: { base64: string; mimeType: string };
  extraPhotos: Array<{ id: string }>;
  tracks: Record<string, ViewpointTrack>;
  compactFlow: boolean;
}): PhasedFinalView[] {
  if (extraPhotos.length === 0 || Object.keys(tracks).length === 0) {
    return [];
  }

  const primaryView: PhasedFinalView = {
    id: `view-primary-${Date.now()}`,
    base64: primary.base64,
    mimeType: primary.mimeType || "image/png",
  };

  const extraViews = extraPhotos
    .map((photo, i) => {
      const track = tracks[photo.id];
      if (!track || !trackHasCompletedPipeline(track, compactFlow)) return null;
      const image = getTerminalTrackImage(track);
      if (!image?.base64 || image.base64 === primary.base64) return null;
      return {
        id: `view-extra-${Date.now()}-${i}`,
        base64: image.base64,
        mimeType: image.mimeType || "image/png",
      };
    })
    .filter((v): v is PhasedFinalView => v !== null);

  const allViews = [primaryView, ...extraViews];
  return allViews.length > 1 ? allViews : [];
}

export function shouldShowPhasedGallery(
  phasedFinalViews: PhasedFinalView[],
  extraPhotoCount: number,
): boolean {
  return extraPhotoCount > 0 && phasedFinalViews.length > 1;
}
