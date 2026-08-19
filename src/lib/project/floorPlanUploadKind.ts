import sharp from "sharp";
import { detectDualPlanPanelInsets } from "./floorPlanPanelRegions";

export type FloorPlanUploadKind =
  | "clean_architectural"
  | "dense_permit_sheet"
  | "furnished_marketing";

/**
 * Heuristic upload classifier for hybrid analyze routing (no extra model call).
 */
export async function classifyFloorPlanUploadKind(
  imageBase64: string,
): Promise<FloorPlanUploadKind> {
  const panels = await detectDualPlanPanelInsets(imageBase64);
  if (panels && panels.length === 2) {
    return "dense_permit_sheet";
  }

  try {
    const buf = Buffer.from(imageBase64, "base64");
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    if (!width || !height || channels < 3) return "clean_architectural";

    let colorPx = 0;
    let samples = 0;
    const step = Math.max(1, Math.floor((width * height) / 8000));
    for (let i = 0; i < width * height; i += step) {
      const o = i * channels;
      const r = data[o]!;
      const g = data[o + 1]!;
      const b = data[o + 2]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min > 28 && max > 40 && min < 230) colorPx += 1;
      samples += 1;
    }
    const colorRatio = samples > 0 ? colorPx / samples : 0;
    if (colorRatio > 0.12) return "furnished_marketing";
  } catch {
    /* keep default */
  }

  return "clean_architectural";
}

export function uploadKindPromptHint(kind: FloorPlanUploadKind): string {
  switch (kind) {
    case "dense_permit_sheet":
      return `
SHEET TYPE: Dense permit / construction sheet. Ignore legend, keynotes, schedules, title block, and engineer stamps. If two unit plans appear side-by-side, assign floorLevel 1 (right) and 2 (left) and do NOT merge footprints.`;
    case "furnished_marketing":
      return `
SHEET TYPE: Furnished marketing / colored layout. Ignore furniture icons, sofas, beds, and decorative fills when tracing walls. Prefer printed room area labels (m², SF) for estimatedArea.`;
    default:
      return "";
  }
}
