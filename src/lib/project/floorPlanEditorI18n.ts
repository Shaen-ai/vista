type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

export function fpT(t: TranslateFn, key: string, vars?: Record<string, string | number>): string {
  return t(`project.floorPlanEditor.${key}`, vars);
}

const OPENING_DIR_KEYS: Record<string, string> = {
  north: "openingDirNorth",
  south: "openingDirSouth",
  east: "openingDirEast",
  west: "openingDirWest",
};

const OPENING_PLACE_KEYS: Record<string, string> = {
  "near corner": "openingPlacementNearCorner",
  center: "openingPlacementCenter",
  "off-center": "openingPlacementOffCenter",
};

/** Translate AI/editor position strings like "east wall off-center". */
export function translateOpeningPosition(position: string, t: TranslateFn): string {
  const trimmed = position.trim();
  const match = trimmed.match(/^(north|south|east|west)\s+wall\s+(near corner|center|off-center)$/i);
  if (!match) return trimmed;
  const dirKey = OPENING_DIR_KEYS[match[1]!.toLowerCase()];
  const placeKey = OPENING_PLACE_KEYS[match[2]!.toLowerCase()];
  if (!dirKey || !placeKey) return trimmed;
  return fpT(t, "openingPositionFormat", {
    direction: fpT(t, dirKey),
    placement: fpT(t, placeKey),
  });
}

export function formatOpeningWallTitle(
  kind: "window" | "door",
  edge: string,
  t: TranslateFn,
): string {
  return fpT(t, kind === "window" ? "windowOnWall" : "doorOnWall", { edge });
}

export function formatDoorConnectionSubtitle(
  position: string,
  connectsTo: string | undefined,
  roomName: string | undefined,
  t: TranslateFn,
): string {
  const pos = translateOpeningPosition(position, t);
  if (!connectsTo || connectsTo === "exterior") {
    return `${pos} ${fpT(t, "connectsExterior")}`;
  }
  return `${pos} ${fpT(t, "connectsToRoom", { room: roomName ?? connectsTo })}`;
}

export function formatEdgeLengthLabel(edge: string, t: TranslateFn): string {
  return fpT(t, "edgeLengthMetres", { edge });
}

export function formatFootprint(
  width: number,
  depth: number,
  area: number,
  t: TranslateFn,
): string {
  return fpT(t, "footprintFormat", { width, depth, area });
}
