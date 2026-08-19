import { NextRequest } from "next/server";
import { detectFloorPlanWithRoboflow } from "@/lib/project/roboflowFloorPlanDetect";
import {
  buildNormalizedOverlay,
  CUBICASA5K_SAMPLE_FIXTURE,
} from "@/lib/project/floorPlanDetections";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const useMock = process.env.ROBOFLOW_USE_MOCK === "1";
  if (!useMock && !process.env.ROBOFLOW_API_KEY?.trim()) {
    return Response.json(
      { error: "Roboflow is not configured (ROBOFLOW_API_KEY missing)." },
      { status: 503 },
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || !file.type.startsWith("image/")) {
    return Response.json({ error: "Image file is required." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (useMock) {
      const meta = await import("sharp").then((m) => m.default(buffer).metadata());
      const fullW = meta.width ?? CUBICASA5K_SAMPLE_FIXTURE.image.width;
      const fullH = meta.height ?? CUBICASA5K_SAMPLE_FIXTURE.image.height;
      const mock = {
        image: { width: fullW, height: fullH },
        predictions: CUBICASA5K_SAMPLE_FIXTURE.predictions,
      };
      return Response.json({
        ...mock,
        normalized: buildNormalizedOverlay(mock),
      });
    }

    const result = await detectFloorPlanWithRoboflow(buffer, file.type || "image/jpeg");
    if (!result) {
      return Response.json({ error: "Roboflow returned no detections." }, { status: 502 });
    }

    return Response.json({
      ...result,
      normalized: buildNormalizedOverlay(result),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Roboflow detect failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
