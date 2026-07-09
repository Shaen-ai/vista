import sharp from "sharp";
import { renderApartmentStaging, renderFluxCannyImg2Img } from "@/lib/falRoomRenderer";
import { uploadPublicImage } from "@/lib/falStorage";
import { pipelineLog } from "@/lib/pipelineLog";
import { normalizeStructuralLineMap } from "@/lib/extractUserStructuralLines";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import type { RoomPhotoWithViewpoint } from "./types";
import {
  resolveStagingLayerRenderer,
  type StagingLayerRenderer,
  type StagingLayerKind,
} from "./stagingLayerRouter";

export type { StagingLayerRenderer, StagingLayerKind } from "./stagingLayerRouter";
export { resolveStagingLayerRenderer } from "./stagingLayerRouter";

export interface RenderStagingLayerInput {
  layer: StagingLayerKind;
  photo: RoomPhotoWithViewpoint;
  imageBase64: string;
  imageMime: string;
  prompt: string;
  seed?: number;
  sessionId: string;
  roomLabel: string;
  photoId: string;
  /** Lower strength for shell pass on flux path. */
  denoise?: number;
}

export async function renderStagingLayer(
  input: RenderStagingLayerInput,
): Promise<{ base64: string; mimeType: string; seed?: number; renderer: StagingLayerRenderer }> {
  const renderer = resolveStagingLayerRenderer(input.photo, input.layer);
  const label = `project-${input.roomLabel}-${input.layer}-${input.photoId}`;

  pipelineLog("FAL_PIPELINE", "staging layer render", {
    layer: input.layer,
    renderer,
    photoId: input.photoId,
    promptChars: input.prompt.length,
    promptPreview: input.prompt.slice(0, 120),
  });

  if (renderer === "apartment-staging") {
    const buf = Buffer.from(input.imageBase64, "base64");
    const meta = await sharp(buf).metadata();
    const imageUrl = await uploadPublicImage(buf, input.imageMime || "image/jpeg", {
      sessionId: input.sessionId,
      type: "original",
      label: `staging-${input.layer}-${input.photoId}`,
    });
    const rendered = await renderApartmentStaging({
      imageUrl,
      prompt: input.prompt,
      seed: input.seed,
      sessionId: input.sessionId,
      label,
      photoId: input.photoId,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    });
    const img = rendered.images[0];
    if (!img) throw new Error(`Staging layer ${input.layer} returned no image`);
    return { ...img, seed: rendered.seed, renderer };
  }

  const windowBoxes = input.photo.openingAnalysis?.window_boxes as OpeningBox[] | undefined;
  const doorBoxes = input.photo.openingAnalysis?.door_boxes as OpeningBox[] | undefined;

  let controlImageBase64: string | undefined;
  let controlImageMime: string | undefined;
  const lineMap = input.photo.structuralLineMap;
  if (lineMap?.base64) {
    const normalized = await normalizeStructuralLineMap({
      lineMapBase64: lineMap.base64,
      originalPhotoBase64: input.imageBase64,
      strokeOnly: lineMap.strokeOnly,
    });
    controlImageBase64 = normalized.base64;
    controlImageMime = normalized.mimeType;
  }

  const layerDenoise =
    input.denoise ??
    (input.layer === "shell"
      ? Number(process.env.VISTA_FAL_SHELL_DENOISE) || 0.55
      : Number(process.env.VISTA_FAL_FURNISH_DENOISE) || 0.65);

  const rendered = await renderFluxCannyImg2Img({
    photoBase64: input.imageBase64,
    photoMime: input.imageMime || "image/jpeg",
    prompt: input.prompt,
    controlImageBase64,
    controlImageMime,
    windowBoxes,
    doorBoxes,
    useAutoCanny: !controlImageBase64,
    seed: input.seed,
    sessionId: input.sessionId,
    label,
    angleRole: "master",
    denoise: layerDenoise,
  });

  const img = rendered.images[0];
  if (!img) throw new Error(`Flux staging layer ${input.layer} returned no image`);
  return { ...img, seed: rendered.seed, renderer };
}
