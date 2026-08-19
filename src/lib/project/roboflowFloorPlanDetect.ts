import sharp from "sharp";
import {
  cropImageBase64ToInset,
  type PlanContentInset,
} from "./floorPlanContentCrop";
import { detectDualPlanPanelInsets } from "./floorPlanPanelRegions";
import {
  parseRoboflowDetectPayload,
  type FloorPlanDetection,
  type RoboflowDetectPayload,
} from "./floorPlanDetections";

export type RoboflowFloorPlanDetectResult = RoboflowDetectPayload & {
  panels?: Array<{ floorLevel: 1 | 2; inset: PlanContentInset }>;
};

function remapPredictionToFullImage(
  p: FloorPlanDetection,
  inset: PlanContentInset,
  cropRoboflowW: number,
  cropRoboflowH: number,
  fullW: number,
  fullH: number,
): FloorPlanDetection {
  const panelW = inset.width * fullW;
  const panelH = inset.height * fullH;
  const offsetX = inset.left * fullW;
  const offsetY = inset.top * fullH;
  const sx = panelW / cropRoboflowW;
  const sy = panelH / cropRoboflowH;
  return {
    ...p,
    x: offsetX + p.x * sx,
    y: offsetY + p.y * sy,
    width: p.width * sx,
    height: p.height * sy,
  };
}

function roboflowModelVersionFromEnv(): string {
  return process.env.ROBOFLOW_MODEL_VERSION?.trim() || "6";
}

function isNumericRoboflowVersion(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/** Serverless API path: exactly `{project}/{version}` (no workspace prefix). */
export function resolveRoboflowServerlessModelPath(
  modelEnv?: string,
  versionEnv?: string,
): string {
  const model = modelEnv?.trim() || "floorplan-recognition/cubicasa5k-2-qpmsa";
  const parts = model.split("/").filter(Boolean);
  const version = versionEnv?.trim() || "6";

  if (parts.length === 0) {
    return `cubicasa5k-2-qpmsa/${version}`;
  }
  if (parts.length === 1) {
    return `${parts[0]}/${version}`;
  }

  const last = parts[parts.length - 1]!;
  const secondLast = parts[parts.length - 2]!;

  if (isNumericRoboflowVersion(last)) {
    return `${secondLast}/${last}`;
  }

  return `${last}/${version}`;
}

function roboflowModelPath(): string {
  return resolveRoboflowServerlessModelPath(
    process.env.ROBOFLOW_MODEL,
    process.env.ROBOFLOW_MODEL_VERSION,
  );
}

function roboflowDetectTimeoutMs(): number {
  const raw = process.env.ROBOFLOW_DETECT_TIMEOUT_MS?.trim() ?? "20000";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 20_000;
}

export function remapRoboflowPayloadToFullImage(
  payload: RoboflowDetectPayload,
  inset: PlanContentInset,
  fullW: number,
  fullH: number,
): RoboflowDetectPayload {
  const cropW = payload.image.width;
  const cropH = payload.image.height;
  return {
    image: { width: fullW, height: fullH },
    predictions: payload.predictions.map((p) =>
      remapPredictionToFullImage(p, inset, cropW, cropH, fullW, fullH),
    ),
  };
}

export async function callRoboflowDetectOnBuffer(
  imageBuffer: Buffer,
  _mimeType: string,
): Promise<RoboflowDetectPayload | null> {
  const apiKey = process.env.ROBOFLOW_API_KEY?.trim();
  if (!apiKey) return null;

  const base =
    process.env.ROBOFLOW_API_BASE?.trim()?.replace(/\/$/, "") ||
    "https://serverless.roboflow.com";
  const modelPath = roboflowModelPath();
  const url = `${base}/${modelPath}?api_key=${encodeURIComponent(apiKey)}&confidence=0.25`;

  const timeoutMs = roboflowDetectTimeoutMs();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: imageBuffer.toString("base64"),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`Roboflow detect timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Roboflow detect failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const raw: unknown = await res.json();
  const parsed = parseRoboflowDetectPayload(raw);
  if (parsed) return parsed;

  // Serverless v2 may nest image metadata under a single object or array entry.
  if (typeof raw === "object" && raw !== null && Array.isArray((raw as { image?: unknown }).image)) {
    const images = (raw as { image: Array<{ width?: number; height?: number }> }).image;
    const first = images[0];
    const w = Number(first?.width);
    const h = Number(first?.height);
    const preds = (raw as { predictions?: unknown }).predictions;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      const nested = parseRoboflowDetectPayload({ image: { width: w, height: h }, predictions: preds });
      if (nested) return nested;
    }
  }

  // Some responses nest under predictions only — infer image size from buffer
  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h || typeof raw !== "object" || raw === null) return null;
  const preds = (raw as { predictions?: unknown }).predictions;
  return parseRoboflowDetectPayload({ image: { width: w, height: h }, predictions: preds });
}

async function detectOnInset(
  fullBase64: string,
  inset: PlanContentInset,
  fullW: number,
  fullH: number,
): Promise<FloorPlanDetection[]> {
  const cropped = await cropImageBase64ToInset(fullBase64, inset);
  const buf = Buffer.from(cropped.base64, "base64");
  const payload = await callRoboflowDetectOnBuffer(buf, cropped.mimeType);
  if (!payload) return [];
  return payload.predictions.map((p) =>
    remapPredictionToFullImage(
      p,
      inset,
      payload.image.width,
      payload.image.height,
      fullW,
      fullH,
    ),
  );
}

export async function detectFloorPlanWithRoboflow(
  imageBuffer: Buffer,
  mimeType: string,
  prefetched?: RoboflowFloorPlanDetectResult | RoboflowDetectPayload | null,
): Promise<RoboflowFloorPlanDetectResult | null> {
  if (
    prefetched &&
    Array.isArray(prefetched.predictions) &&
    prefetched.image?.width &&
    prefetched.image?.height
  ) {
    const p = prefetched as RoboflowFloorPlanDetectResult;
    return {
      image: prefetched.image,
      predictions: prefetched.predictions,
      ...(p.panels ? { panels: p.panels } : {}),
    };
  }

  if (!process.env.ROBOFLOW_API_KEY?.trim()) return null;

  const base64 = imageBuffer.toString("base64");
  const meta = await sharp(imageBuffer).metadata();
  const fullW = meta.width ?? 0;
  const fullH = meta.height ?? 0;
  if (!fullW || !fullH) return null;

  const panels = await detectDualPlanPanelInsets(base64);
  if (panels && panels.length === 2) {
    const merged: FloorPlanDetection[] = [];
    for (const panel of panels) {
      const part = await detectOnInset(base64, panel, fullW, fullH);
      merged.push(...part);
    }
    return {
      image: { width: fullW, height: fullH },
      predictions: merged,
      panels: panels.map((p) => ({
        floorLevel: p.floorLevel,
        inset: { left: p.left, top: p.top, width: p.width, height: p.height },
      })),
    };
  }

  const payload = await callRoboflowDetectOnBuffer(imageBuffer, mimeType);
  if (!payload) return null;
  return {
    image: { width: fullW, height: fullH },
    predictions:
      payload.image.width === fullW && payload.image.height === fullH
        ? payload.predictions
        : payload.predictions.map((p) =>
            remapPredictionToFullImage(
              p,
              { left: 0, top: 0, width: 1, height: 1 },
              payload.image.width,
              payload.image.height,
              fullW,
              fullH,
            ),
          ),
  };
}
