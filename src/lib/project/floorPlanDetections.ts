/**
 * Roboflow CubiCasa-style floor plan detections (wall / window / door).
 * Coordinates: center x/y in inference-image pixels.
 */

import fixturePayload from "./fixtures/cubicasa5k-sample.detections.json";

export type FloorPlanDetectionClass = "wall" | "window" | "door";

export type FloorPlanDetection = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: FloorPlanDetectionClass;
  class_id?: number;
  detection_id?: string;
};

export type NormalizedFloorPlanDetection = {
  class: FloorPlanDetectionClass;
  confidence: number;
  detection_id?: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type RoboflowDetectPayload = {
  image: { width: number; height: number };
  predictions: FloorPlanDetection[];
};

const DETECTION_CLASSES = new Set<FloorPlanDetectionClass>(["wall", "window", "door"]);

export function isFloorPlanDetectionClass(value: string): value is FloorPlanDetectionClass {
  return DETECTION_CLASSES.has(value as FloorPlanDetectionClass);
}

export function parseRoboflowDetectPayload(raw: unknown): RoboflowDetectPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const imageRaw = o.image;
  if (!imageRaw || typeof imageRaw !== "object") return null;
  const imageObj = imageRaw as Record<string, unknown>;
  const width = Number(imageObj.width);
  const height = Number(imageObj.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (!Array.isArray(o.predictions)) return null;

  const predictions: FloorPlanDetection[] = [];
  for (const item of o.predictions) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const cls = p.class;
    if (typeof cls !== "string" || !isFloorPlanDetectionClass(cls)) continue;
    const x = Number(p.x);
    const y = Number(p.y);
    const w = Number(p.width);
    const h = Number(p.height);
    const confidence = Number(p.confidence);
    if (![x, y, w, h, confidence].every(Number.isFinite)) continue;
    predictions.push({
      x,
      y,
      width: w,
      height: h,
      confidence,
      class: cls,
      class_id: typeof p.class_id === "number" ? p.class_id : undefined,
      detection_id: typeof p.detection_id === "string" ? p.detection_id : undefined,
    });
  }

  return { image: { width, height }, predictions };
}

/** Alias for Roboflow API / workflow plan naming. */
export const parseRoboflowDetectResponse = parseRoboflowDetectPayload;

export function normalizeFloorPlanDetections(
  predictions: FloorPlanDetection[],
  imageWidth: number,
  imageHeight: number,
): NormalizedFloorPlanDetection[] {
  return predictions.map((p) => {
    const left = p.x - p.width / 2;
    const top = p.y - p.height / 2;
    return {
      class: p.class,
      confidence: p.confidence,
      detection_id: p.detection_id,
      left: left / imageWidth,
      top: top / imageHeight,
      width: p.width / imageWidth,
      height: p.height / imageHeight,
    };
  });
}

export function buildNormalizedOverlay(payload: RoboflowDetectPayload): NormalizedFloorPlanDetection[] {
  return normalizeFloorPlanDetections(
    payload.predictions,
    payload.image.width,
    payload.image.height,
  );
}

/** Bundled Roboflow sample (31 boxes, image 914×1720 until API metadata is provided). */
export const CUBICASA5K_SAMPLE_FIXTURE: RoboflowDetectPayload =
  parseRoboflowDetectPayload(fixturePayload) ?? {
    image: { width: 914, height: 1720 },
    predictions: [],
  };

export const CUBICASA5K_SAMPLE_FIXTURE_IMAGE_PATH = "/fixtures/cubicasa5k-sample.jpg";

/** Matched inference image + 31-box JSON (914×1720). Use dev “Load sample plan” on /project/new. */
export async function fetchCubicasaSamplePlanFile(): Promise<File> {
  const res = await fetch(CUBICASA5K_SAMPLE_FIXTURE_IMAGE_PATH);
  if (!res.ok) throw new Error("CubiCasa fixture image missing");
  const blob = await res.blob();
  return new File([blob], "cubicasa5k-sample.jpg", { type: blob.type || "image/jpeg" });
}

export const CUBICASA5K_SAMPLE_NORMALIZED = buildNormalizedOverlay(CUBICASA5K_SAMPLE_FIXTURE);
