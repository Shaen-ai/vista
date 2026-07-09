import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { DetectedRoom } from "@/lib/project/types";
import type {
  ViewpointFraming,
  VisibleOpeningExpectation,
} from "@/lib/project/viewpointFraming";
import { compassToCameraWallMap } from "@/lib/project/viewpointFraming";
import type { CompassWallMap } from "@/lib/windowWallPlacement";

const CAMERA_WALL_LABEL: Record<"back" | "left" | "right" | "front", string> = {
  back: "far/back wall",
  left: "left wall",
  right: "right wall",
  front: "front/near wall",
};

/** Describe along-wall offset from normalized plan parameter t (0 = wall start, 1 = end). */
export function alongWallOffsetPhrase(t: number): string {
  if (t < 0.4) return "left-of-center along the wall";
  if (t > 0.55) return "right-of-center along the wall (NOT centered)";
  return "near center along the wall";
}

function compassFromPosition(position: string): string | undefined {
  const m = position.toLowerCase().match(/\b(north|south|east|west)\b/);
  return m?.[1];
}

function cameraWallLabel(
  position: string,
  compassMap: CompassWallMap | undefined,
): string {
  const compass = compassFromPosition(position);
  if (compass && compassMap?.[compass as keyof CompassWallMap]) {
    return CAMERA_WALL_LABEL[compassMap[compass as keyof CompassWallMap]!];
  }
  return position;
}

function formatPlanWindowLines(
  windows: DetectedRoom["windows"],
  compassMap: CompassWallMap | undefined,
): string[] {
  return windows.map((w, i) => {
    const wall = cameraWallLabel(w.position, compassMap);
    const tPart =
      typeof w.t === "number"
        ? `, ${alongWallOffsetPhrase(w.t)} (plan t=${w.t.toFixed(2)})`
        : "";
    const size = `${w.width}m × ${w.height}m`;
    return `Window ${i + 1}: ${wall}${tPart}, ${size}`;
  });
}

/**
 * Build authoritative opening metadata for the vision validation gate.
 * Floor plan edge placement (t along wall) + viewpoint geometry beat raw photo guesses
 * about "centered" vs "side wall".
 */
export function buildOpeningValidationContext(opts: {
  visibleOpenings?: VisibleOpeningExpectation | null;
  lockAnalysis?: RoomAnalysis | null;
  detectedRoom?: DetectedRoom | null;
  framing?: ViewpointFraming | null;
}): string | undefined {
  const lines: string[] = [];
  const compassMap = opts.framing ? compassToCameraWallMap(opts.framing) : undefined;

  if (opts.framing?.note?.trim()) {
    lines.push(`Camera/view: ${opts.framing.note.trim()}`);
  }
  if (opts.framing?.openingsSummary?.trim()) {
    lines.push(`Geometry-visible openings: ${opts.framing.openingsSummary.trim()}`);
  }

  const planWindows = opts.detectedRoom?.windows ?? [];
  if (planWindows.length > 0) {
    lines.push("Floor plan windows (authoritative wall + along-wall position):");
    for (const line of formatPlanWindowLines(planWindows, compassMap)) {
      lines.push(`  - ${line}`);
    }
  }

  if (opts.visibleOpenings?.windowCount) {
    lines.push(
      `This photo should show ${opts.visibleOpenings.windowCount} window(s): ${opts.visibleOpenings.windowPositions.join("; ")}`,
    );
  }
  if (opts.visibleOpenings?.doorCount) {
    lines.push(
      `This photo should show ${opts.visibleOpenings.doorCount} door(s): ${opts.visibleOpenings.doorPositions.join("; ")}`,
    );
  }

  const lockedWindows = opts.lockAnalysis?.window_positions ?? [];
  if (lockedWindows.length > 0) {
    lines.push(`Generation lock window positions: ${lockedWindows.join("; ")}`);
  }
  const lockedDoors = opts.lockAnalysis?.door_positions ?? [];
  if (lockedDoors.length > 0) {
    lines.push(`Generation lock door positions: ${lockedDoors.join("; ")}`);
  }

  const cameraAngle = opts.lockAnalysis?.camera_angle?.trim();
  if (cameraAngle && cameraAngle !== "unknown") {
    lines.push(`Camera angle metadata: ${cameraAngle}`);
  }

  const planDoorCount = opts.lockAnalysis?.plan_door_count ?? 0;
  if (planDoorCount > 0) {
    const planDoors = opts.lockAnalysis?.plan_door_positions ?? [];
    lines.push(
      `Room has ${planDoorCount} door(s) on the floor plan (may be behind camera): ${planDoors.join("; ")}`,
    );
  }

  if (lines.length === 0) return undefined;

  lines.push(
    "When judging wall placement: a window on the far/back wall offset to the right is CORRECT even if it sits near the right edge of the photo — do NOT confuse that with a right-side-wall window. Trust the floor plan t values and geometry summary above over visual guesses about 'centered'.",
  );

  return lines.join("\n");
}
