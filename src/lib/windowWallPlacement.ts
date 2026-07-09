/** Camera-relative wall labels parsed from room-analysis window_positions strings. */

export type CameraWall = "back" | "left" | "right" | "front" | "unknown";

type KnownCameraWall = Exclude<CameraWall, "unknown">;

const WALL_ORDER: KnownCameraWall[] = ["back", "left", "right", "front"];

const WALL_LABELS: Record<Exclude<CameraWall, "unknown">, string> = {
  back: "BACK/FAR WALL",
  left: "LEFT WALL",
  right: "RIGHT WALL",
  front: "FRONT WALL",
};

/** Compass → camera-relative wall mapping (supplied when the camera is known). */
export type CompassWallMap = Partial<Record<"north" | "south" | "east" | "west", KnownCameraWall>>;

/**
 * First comma-separated segment names the wall (see WINDOW_OPENING_INSTRUCTIONS).
 * `compassMap` lets a caller resolve compass-named walls ("south wall") to a
 * camera-relative wall when the viewpoint is known — without it, compass-only
 * labels stay "unknown" (we never guess a camera side from a bare compass word).
 */
export function parseWindowWallLabel(position: string, compassMap?: CompassWallMap): CameraWall {
  const trimmed = position.trim();
  if (!trimmed) return "unknown";

  const firstSegment = trimmed.split(",")[0]?.trim().toLowerCase() ?? trimmed.toLowerCase();

  if (/\bleft\s+recess\s+wall\b/.test(firstSegment)) return "left";
  if (/\bright\s+recess\s+wall\b/.test(firstSegment)) return "right";
  // "left wall", "left-hand wall", "wall on the left", "wall to the left"
  if (/\bleft[-\s]hand\s+wall\b|\bleft\s+wall\b|\bwall\s+(?:on|to)\s+the\s+left\b/.test(firstSegment))
    return "left";
  if (/\bright[-\s]hand\s+wall\b|\bright\s+wall\b|\bwall\s+(?:on|to)\s+the\s+right\b/.test(firstSegment))
    return "right";
  // "back wall", "far wall", "rear wall", "facing wall"
  if (/\b(?:back|far|rear|facing)\s+wall\b/.test(firstSegment)) return "back";
  if (/\bfront\s+wall\b/.test(firstSegment)) return "front";

  // Armenian / Russian fallbacks when the wall name is not in the first segment
  const lower = trimmed.toLowerCase();
  if (/\b(?:ձախ\s+պատ|левая\s+стена)\b/.test(lower)) return "left";
  if (/\b(?:աջ\s+պատ|правая\s+стена)\b/.test(lower)) return "right";
  if (/\b(?:հետև(?:ի)?\s+պատ|задн(?:яя)?\s+стена)\b/.test(lower)) return "back";

  // Compass-named wall ("south wall left") — only resolvable with a camera map.
  if (compassMap) {
    const compass = firstSegment.match(/\b(north|south|east|west)\b/)?.[1] as
      | keyof CompassWallMap
      | undefined;
    if (compass && compassMap[compass]) return compassMap[compass]!;
  }

  return "unknown";
}

export function groupWindowPositionsByWall(
  positions: string[],
): Map<Exclude<CameraWall, "unknown">, string[]> {
  const groups = new Map<Exclude<CameraWall, "unknown">, string[]>();
  for (const wall of WALL_ORDER) {
    groups.set(wall, []);
  }
  for (const pos of positions) {
    const wall = parseWindowWallLabel(pos);
    if (wall === "unknown") continue;
    groups.get(wall)!.push(pos);
  }
  return groups;
}

function formatWallOpeningsList(positions: string[]): string {
  return positions.map((p, i) => `(${i + 1}) ${p}`).join("; ");
}

export function buildCurtainPolicyLines(positions: string[], windowCount: number): string[] {
  if (windowCount <= 0) {
    return [
      "CURTAIN POLICY: This room has 0 window openings — omit all window treatments entirely. No curtain fabric, rods, tracks, sheers, blinds, or drapery panels anywhere in the output.",
    ];
  }

  const lines: string[] = [
    "CURTAIN POLICY (overrides decorative brief wording):",
    "- The reference photo is authoritative: curtains/drapes/sheers/blinds/rods may appear ONLY where glazed glass and daylight are visible in the input image.",
    "- Each treatment must be anchored to that opening's frame/header — never freestanding on plain wall, never spanning a wall with no glazing.",
    "- HARD RULE: A solid wall (no window behind it) must NEVER have curtains, drapes, sheers, or fabric panels hanging on it. Fabric on a wall without a window opening is ALWAYS wrong.",
    "- If per-wall rules below conflict with what you see in the photo, follow the photo.",
  ];

  const groups = groupWindowPositionsByWall(positions);
  const hasKnownWall = WALL_ORDER.some((wall) => (groups.get(wall)?.length ?? 0) > 0);

  if (!hasKnownWall) {
    lines.push(`Dress exactly ${windowCount} opening(s) visible in the reference photo — nowhere else.`);
    return lines;
  }

  for (const wall of WALL_ORDER) {
    const onWall = groups.get(wall) ?? [];
    const label = WALL_LABELS[wall];
    if (onWall.length === 0) {
      const suffix = wall === "front" ? " (if visible in frame)" : "";
      lines.push(`  ${label}: 0 openings → no curtain fabric, rods, or drapery on this wall${suffix}.`);
    } else {
      lines.push(
        `  ${label}: ${onWall.length} opening(s) → curtains at these openings only, anchored to each window frame/header; no fabric on adjacent solid wall surface. ${formatWallOpeningsList(onWall)}`,
      );
    }
  }

  return lines;
}

/** Hard lock for walls with zero openings — prevents flux from inventing glazing/doorways. */
export function buildSolidWallOpeningLockLines(
  windowPositions: string[],
  doorPositions: string[],
  wallLengthsM?: WallLengthsM,
): string[] {
  const winGroups = groupWindowPositionsByWall(windowPositions);
  const doorGroups = groupWindowPositionsByWall(doorPositions);
  const lines: string[] = ["SOLID WALL LOCK — do NOT invent openings on these walls:"];
  for (const wall of ["back", "left", "right"] as const) {
    const count = (winGroups.get(wall)?.length ?? 0) + (doorGroups.get(wall)?.length ?? 0);
    if (count > 0) continue;
    const len = wallLengthsM?.[wall];
    const lenStr = len ? ` (${len}m wide)` : "";
    lines.push(
      `  ${WALL_LABELS[wall]}${lenStr}: 0 openings — keep floor-to-ceiling solid; no windows, doors, archways, mirror-glazing, or niche passages.`,
    );
  }
  return lines.length > 1 ? lines : [];
}

/** Measured length (meters) per camera-relative wall, from the viewpoint framing. */
export type WallLengthsM = Partial<Record<"back" | "left" | "right", number>>;

/**
 * Annotate a wall label with its measured length + narrow/long classification, so
 * Gemini renders the faced wall at its true width (a window on the SHORT wall must
 * not drift onto a LONG wall). Returns the bare label when no length is known.
 */
function labelWithLength(
  wall: KnownCameraWall,
  label: string,
  wallLengthsM?: WallLengthsM,
): string {
  if (!wallLengthsM || wall === "front") return label;
  const lenM = wallLengthsM[wall as "back" | "left" | "right"];
  if (typeof lenM !== "number" || lenM <= 0) return label;
  const lens = Object.values(wallLengthsM).filter((l): l is number => typeof l === "number" && l > 0);
  const longest = lens.length ? Math.max(...lens) : lenM;
  const shortest = lens.length ? Math.min(...lens) : lenM;
  const elongated = shortest > 0 && longest / shortest >= 1.35;
  const kind = elongated
    ? lenM <= shortest * 1.1
      ? ", SHORT/narrow wall"
      : lenM >= longest * 0.9
        ? ", LONG wall"
        : ""
    : "";
  return `${label} (${lenM} m${kind})`;
}

/** Per-wall placement lock lines for Gemini — avoids false back-wall matches on "back-left corner". */
export function buildWallPlacementLockLines(positions: string[], wallLengthsM?: WallLengthsM): string[] {
  if (positions.length === 0) return [];

  const groups = groupWindowPositionsByWall(positions);
  const hasKnownWall = WALL_ORDER.some((wall) => (groups.get(wall)?.length ?? 0) > 0);
  if (!hasKnownWall) return [];

  const lines: string[] = [
    "WALL PLACEMENT LOCK — windows stay on these walls only (match reference photo):",
  ];

  for (const wall of WALL_ORDER) {
    const onWall = groups.get(wall) ?? [];
    const label = labelWithLength(wall, WALL_LABELS[wall], wallLengthsM);
    if (onWall.length === 0) {
      lines.push(`  ${label}: Solid, unbroken wall — continuous flat surface from corner to corner, plain paint/plaster finish only. Zero openings, zero glass, zero glazing on this wall.`);
    } else {
      lines.push(
        `  ${label}: ${onWall.length} opening(s) — ${formatWallOpeningsList(onWall)}`,
      );
      if (wall === "back") {
        lines.push(
          `  ${label} finish note: decorative slats/panels/paint must frame these bays; each must remain visible glazed glass in the output.`,
        );
      }
    }
  }

  const sideWallCount =
    (groups.get("left")?.length ?? 0) + (groups.get("right")?.length ?? 0);
  const backCount = groups.get("back")?.length ?? 0;
  if (sideWallCount > 0 && backCount === 0) {
    lines.push("Side-wall windows remain on their original side walls. The back/far wall is a continuous solid surface with no glazing.");
  }

  const hasRecessWindows = positions.some((p) =>
    /\b(?:left\s+recess|recess\s+wall|alcove)\b/i.test(p),
  );
  if (hasRecessWindows) {
    lines.push(
      "LEFT RECESS: windows sit on the recessed alcove wall BEHIND the foreground pier. The recess depth and stepped geometry remain intact. The back wall remains a continuous solid surface.",
    );
  }

  return lines;
}

/**
 * Per-wall placement lock lines for DOORS / passages — mirrors the window lock so
 * Gemini keeps doors on their original walls and treats door-free walls as solid
 * (no door leaf, no archway, no clear passage). Doors drift far more than windows
 * because they previously got only a raw position list with no solidity rule.
 */
export function buildDoorWallPlacementLockLines(positions: string[]): string[] {
  if (positions.length === 0) return [];

  const groups = groupWindowPositionsByWall(positions);
  const hasKnownWall = WALL_ORDER.some((wall) => (groups.get(wall)?.length ?? 0) > 0);
  if (!hasKnownWall) return [];

  const lines: string[] = [
    "DOOR PLACEMENT LOCK — doors/passages stay on these walls only (match reference photo):",
  ];

  for (const wall of WALL_ORDER) {
    const onWall = groups.get(wall) ?? [];
    const label = WALL_LABELS[wall];
    if (onWall.length === 0) {
      lines.push(
        `  ${label}: No door or passage on this wall — keep it a continuous solid surface; do NOT add, move, or cut a doorway/archway/opening here.`,
      );
    } else {
      lines.push(
        `  ${label}: ${onWall.length} door/passage opening(s) — ${formatWallOpeningsList(onWall)}. Keep each on this wall at this position.`,
      );
    }
  }

  return lines;
}
