import type { PlanContentInset } from "./floorPlanContentCrop";
import type { FloorPlanAnalysis } from "./types";
import { analysisHasMultipleFloors } from "./floorPlanFloors";
import { roomsOnFloor } from "./floorPlanFloorView";

export type StoredPlanPanelInset = PlanContentInset & { floorLevel: 1 | 2 };

/** Crop a data-URL floor plan to a normalized inset (browser canvas). */
export function cropFloorPlanImageToInsetClient(
  dataUrl: string,
  inset: PlanContentInset,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sx = inset.left * img.naturalWidth;
      const sy = inset.top * img.naturalHeight;
      const sw = Math.max(1, inset.width * img.naturalWidth);
      const sh = Math.max(1, inset.height * img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not available"));
        return;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("Failed to load floor plan image"));
    img.src = dataUrl;
  });
}

export function panelInsetForFloor(
  panels: StoredPlanPanelInset[] | null | undefined,
  floor: 1 | 2,
): PlanContentInset | null {
  if (!panels?.length) return null;
  const match = panels.find((p) => p.floorLevel === floor);
  if (!match) return null;
  return { left: match.left, top: match.top, width: match.width, height: match.height };
}

/** When Roboflow did not return panels, approximate crop boxes from room geometry. */
export function derivePanelInsetsFromAnalysis(analysis: FloorPlanAnalysis): StoredPlanPanelInset[] | null {
  const frame = analysis.imageFrame;
  if (!frame?.width || !frame.height) return null;
  if (!analysisHasMultipleFloors(analysis.rooms)) return null;

  const fw = frame.width;
  const fh = frame.height;
  const out: StoredPlanPanelInset[] = [];

  for (const floor of [1, 2] as const) {
    const floorRooms = roomsOnFloor(analysis.rooms, floor);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of floorRooms) {
      for (const [x, y] of r.polygon ?? []) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (!Number.isFinite(minX)) continue;
    const pad = Math.max(fw * 0.03, fh * 0.03, 300);
    const leftPx = Math.max(0, minX - pad);
    const topPx = Math.max(0, minY - pad);
    const rightPx = Math.min(fw, maxX + pad);
    const bottomPx = Math.min(fh, maxY + pad);
    out.push({
      floorLevel: floor,
      left: leftPx / fw,
      top: topPx / fh,
      width: (rightPx - leftPx) / fw,
      height: (bottomPx - topPx) / fh,
    });
  }
  return out.length === 2 ? out : null;
}
