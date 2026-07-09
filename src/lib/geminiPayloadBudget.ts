import "server-only";

import type { CollageSheet } from "@/lib/productReferenceCollage";

export const GEMINI_TOTAL_PAYLOAD_BUDGET_BYTES = 6_000_000;
export const GEMINI_COLLAGE_SHEET_MAX_BYTES = 250_000;

export interface BudgetSelectionResult {
  includedSheets: CollageSheet[];
  droppedSheets: CollageSheet[];
  totalBytes: number;
}

export function applyGeminiCollageBudget(
  sheets: CollageSheet[],
  roomByteLength: number,
  budget = GEMINI_TOTAL_PAYLOAD_BUDGET_BYTES,
): BudgetSelectionResult {
  const sorted = [...sheets].sort((a, b) => a.priority - b.priority);

  let total = roomByteLength;
  const includedSheets: CollageSheet[] = [];
  const droppedSheets: CollageSheet[] = [];

  for (const sheet of sorted) {
    if (total + sheet.byteLength <= budget) {
      includedSheets.push(sheet);
      total += sheet.byteLength;
    } else {
      droppedSheets.push(sheet);
    }
  }

  includedSheets.sort((a, b) => a.priority - b.priority);

  return { includedSheets, droppedSheets, totalBytes: total };
}
