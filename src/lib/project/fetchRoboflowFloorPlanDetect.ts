import type { NormalizedFloorPlanDetection, RoboflowDetectPayload } from "./floorPlanDetections";

export type RoboflowDetectApiResponse = RoboflowDetectPayload & {
  normalized: NormalizedFloorPlanDetection[];
  panels?: Array<{ floorLevel: 1 | 2; inset: { left: number; top: number; width: number; height: number } }>;
};

export async function fetchRoboflowFloorPlanDetect(
  file: File,
): Promise<RoboflowDetectApiResponse> {
  const form = new FormData();
  form.append("file", file, file.name || "floorplan.jpg");

  const res = await fetch("/api/project/roboflow-detect", {
    method: "POST",
    body: form,
  });

  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof json === "object" &&
      json !== null &&
      typeof (json as { error?: string }).error === "string"
        ? (json as { error: string }).error
        : `Detection failed (${res.status})`;
    throw new Error(msg);
  }

  return json as RoboflowDetectApiResponse;
}
