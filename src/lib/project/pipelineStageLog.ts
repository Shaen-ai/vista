import { pipelineLog } from "@/lib/pipelineLog";

export type PipelineStageName = "erase" | "master" | "secondary" | "validate";

export interface PipelineStageLogInput {
  projectId: string;
  roomId: string;
  photoId?: string;
  stage: PipelineStageName;
  ok: boolean;
  ms: number;
  endpoint?: string;
  retry?: number;
  errorCode?: string;
  extra?: Record<string, unknown>;
}

/** One structured line per pipeline stage boundary — greppable via `[7·pipeline-stage]`. */
export function logPipelineStage(input: PipelineStageLogInput): void {
  const { stage, ok, extra, ...rest } = input;
  pipelineLog(
    "PIPELINE_STAGE",
    ok ? `${stage} ok` : `${stage} failed`,
    { stage, ...rest, ...extra },
    ok ? "info" : "warn",
  );
}

export interface RoomPipelineSummaryInput {
  projectId: string;
  roomId: string;
  roomName: string;
  viewsRendered: number;
  viewsTarget: number;
  validationsFailed: number;
  retries: number;
  totalMs: number;
  estimatedUsd?: number;
}

export function logRoomPipelineSummary(input: RoomPipelineSummaryInput): void {
  pipelineLog("PIPELINE_STAGE", "room complete", {
    ...input,
    ok: input.viewsRendered > 0,
  });
}
