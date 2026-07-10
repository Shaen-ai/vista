export type QuickRoomPlacementMode = "redesign" | "placeOnly";

export function parseQuickRoomPlacementMode(
  raw: FormDataEntryValue | null | undefined,
): QuickRoomPlacementMode {
  const value = String(raw ?? "").trim();
  return value === "placeOnly" ? "placeOnly" : "redesign";
}
