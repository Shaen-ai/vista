import "server-only";

import { renderEditStaging } from "@/lib/falEditRenderer";
import { pipelineLog } from "@/lib/pipelineLog";
import { buildQuickRoomGalleryEditPrompt } from "./quickRoomGalleryEditPrompt";
import {
  QUICK_ROOM_FAL_BANANA_ENDPOINT,
  logQuickRoomFalStep,
} from "./quickFalStepLog";

export interface QuickRoomGalleryEditProgressEvent {
  message: string;
  progress: number;
}

export interface QuickRoomGalleryEditInput {
  sessionId: string;
  approvedRenderBase64: string;
  approvedRenderMime: string;
  editFeedback: string;
  hasEditAnnotation?: boolean;
  annotationBase64?: string | null;
  annotationMime?: string | null;
  onProgress?: (ev: QuickRoomGalleryEditProgressEvent) => void | Promise<void>;
}

export async function runQuickRoomGalleryEditPipeline(
  input: QuickRoomGalleryEditInput,
): Promise<{ base64: string; mimeType: string }> {
  const projectId = `quick-${input.sessionId}`;
  const roomId = "quick";
  const photoId = "gallery-edit";

  let prompt = buildQuickRoomGalleryEditPrompt(input.editFeedback, input.hasEditAnnotation);

  const imageBase64List = [input.approvedRenderBase64];
  const imageMimeList = [input.approvedRenderMime || "image/jpeg"];
  const imageRoles = ["0: approved render — preserve everything except the user change"];

  if (input.hasEditAnnotation && input.annotationBase64?.trim()) {
    imageBase64List.push(input.annotationBase64);
    imageMimeList.push(input.annotationMime || "image/png");
    imageRoles.push("1: user marked areas (red strokes) — edit only these regions");
  }

  const editResolution = (process.env.VISTA_EDIT_RESOLUTION || "2K").trim().toUpperCase();

  logQuickRoomFalStep({
    step: "banana",
    sessionId: input.sessionId,
    endpoint: QUICK_ROOM_FAL_BANANA_ENDPOINT,
    prompt,
    falParams: {
      resolution: editResolution === "1K" || editResolution === "2K" ? editResolution : "4K",
      aspect_ratio: "auto (from approved render)",
      num_images: 1,
      output_format: "png",
      mode: "gallery-edit",
    },
    imageIndexRoles: imageRoles,
    extra: {
      projectId,
      hasEditAnnotation: !!input.hasEditAnnotation,
      editFeedbackPreview: input.editFeedback.slice(0, 120),
    },
  });

  pipelineLog("FAL_RENDER", "quick room gallery edit — direct nano-banana", {
    projectId,
    imageCount: imageBase64List.length,
    promptChars: prompt.length,
    hasAnnotation: !!input.hasEditAnnotation,
  });

  await input.onProgress?.({ message: "Applying your edit…", progress: 0.35 });

  const rendered = await renderEditStaging({
    imageBase64List,
    imageMimeList,
    prompt,
    projectId,
    roomId,
    photoId,
    stage: "master",
    sessionId: input.sessionId,
    label: "quick-room-gallery-edit",
  });

  pipelineLog("FAL_RENDER", "quick room gallery edit complete", {
    projectId,
    durationMs: Date.now(),
  });

  return rendered;
}
