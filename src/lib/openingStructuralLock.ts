import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { RoomGeometry } from "@/lib/roomGeometryTypes";
import {
  buildWallPlacementLockLines,
  buildCurtainPolicyLines,
  buildDoorWallPlacementLockLines,
  buildSolidWallOpeningLockLines,
} from "@/lib/windowWallPlacement";
import {
  buildStructuralGeometryLock,
  buildNoColumnHallucinationDirective,
} from "@/lib/structuralGeometryLock";
import { DOOR_CLEARANCE_DIRECTIVE } from "@/lib/doorRenderPrompt";

function buildWindowSillDirective(boxes: RoomAnalysis["window_boxes"]): string[] {
  const lines: string[] = [
    "WINDOW VERTICAL PLACEMENT & SIZE (reference photo is authoritative — overrides any width/height wording above): preserve each window's sill height, head height, and width EXACTLY as seen in the reference photo. A window is a punched opening in the wall — NEVER render it floor-to-ceiling or full-height glazing unless the photo clearly shows that.",
  ];
  if (!boxes?.length) return lines;
  const maxBottom = Math.max(...boxes.map((b) => b.y + b.h));
  const minTop = Math.min(...boxes.map((b) => b.y));
  if (maxBottom < 0.9) {
    lines.push(
      `Sill sits clearly ABOVE the floor: the glazing's lower edge is around ${Math.round(maxBottom * 100)}% down the photo, with solid wall/sill below it — do NOT drop the window to the floor.`,
    );
  }
  if (minTop > 0.08) {
    lines.push(
      `Head stops below the ceiling: the glazing's top edge is around ${Math.round(minTop * 100)}% down the photo — keep solid wall above it.`,
    );
  }
  return lines;
}

/** Hard lock on window/door counts — prefers room analysis when it counts more openings than geometry JSON. */
export function buildOpeningStructuralLock(
  roomAnalysis: RoomAnalysis | null | undefined,
  roomGeometry: RoomGeometry | null | undefined,
): string {
  const analysisWindows = roomAnalysis?.window_count ?? 0;
  const analysisDoors = roomAnalysis?.door_count ?? 0;
  const geometryWindows = roomGeometry?.windows?.length ?? 0;
  const geometryDoors = roomGeometry?.doors?.length ?? 0;
  const windowCount = Math.max(analysisWindows, geometryWindows);
  const doorCount = Math.max(analysisDoors, geometryDoors);

  if (windowCount <= 0 && doorCount <= 0) return "";

  const lines: string[] = [
    "══════════════════════════════════════════════════════════════",
    "OPENING COUNT LOCK — OVERRIDES ALL CONTRADICTORY DESIGN WORDING",
    "══════════════════════════════════════════════════════════════",
  ];

  const dims = roomAnalysis?.estimated_dimensions;
  const cornerCount = roomAnalysis?.polygon_corner_count ?? 0;
  const isIrregularShape =
    roomAnalysis?.room_shape === "irregular" || cornerCount > 4;

  if (dims && dims.width > 0 && dims.depth > 0) {
    const long = Math.max(dims.width, dims.depth);
    const short = Math.min(dims.width, dims.depth);
    const ratio = long / short;
    if (isIrregularShape) {
      const n = cornerCount > 4 ? cornerCount : "multi";
      lines.push(
        `ROOM SHAPE: irregular ${n}-corner shell — preserve every wall jog and notch exactly; do NOT simplify to a rectangle. ` +
          `Bounding span ~${dims.width}m × ${dims.depth}m (not a simple rectangular footprint).`,
      );
    } else if (ratio >= 1.35) {
      lines.push(
        `ROOM PROPORTIONS: This room is ${dims.width}m × ${dims.depth}m — clearly elongated (~${ratio.toFixed(1)}:1), NOT square. The render MUST keep this narrow rectangular footprint and aspect ratio; do NOT widen, square off, or enlarge the room.`,
      );
    }
  } else if (isIrregularShape) {
    const n = cornerCount > 4 ? cornerCount : "multi";
    lines.push(
      `ROOM SHAPE: irregular ${n}-corner shell — preserve every wall jog and notch exactly; do NOT simplify to a rectangle.`,
    );
  }

  if (windowCount > 0) {
    const windowConfidence =
      roomAnalysis?.confidence?.window_count ?? roomGeometry?.confidence ?? "medium";
    const windowLockVerb =
      windowConfidence === "high"
        ? `EXACTLY ${windowCount}`
        : `at least ${windowCount}`;
    lines.push(
      `WINDOWS: The output image MUST show ${windowLockVerb} distinct window opening(s) — the same count visible in the input photo. Never ${windowCount - 1} or fewer. Never merge multiple windows into one.`,
    );
    const cameraAngle = roomAnalysis?.camera_angle?.trim();
    if (cameraAngle && cameraAngle !== "unknown") {
      lines.push(`Internal camera metadata (never render as visible text): ${cameraAngle}`);
    }
    if (analysisWindows > geometryWindows && geometryWindows > 0) {
      lines.push(
        `(Room analysis: ${analysisWindows} windows; geometry scan: ${geometryWindows} — preserve ALL ${analysisWindows} from the photo.)`,
      );
    }
    const positions =
      roomAnalysis?.window_positions?.length && analysisWindows > 0
        ? roomAnalysis.window_positions.slice(0, windowCount)
        : roomGeometry?.windows?.map(
            (w, i) =>
              `Window ${i + 1}: wall ${w.wall_id}, ~${w.approx_offset_from_left_m}m from wall start, ${w.width_m}m wide`,
          ) ?? [];
    if (positions.length > 0) {
      lines.push("Keep each opening at:");
      for (let i = 0; i < Math.min(windowCount, positions.length); i++) {
        lines.push(`  ${i + 1}. ${positions[i]}`);
      }
      lines.push(...buildWallPlacementLockLines(positions.slice(0, windowCount), roomAnalysis?.wall_lengths_m));
      lines.push(...buildCurtainPolicyLines(positions.slice(0, windowCount), windowCount));
      const doorPositionsForSolidLock =
        roomAnalysis?.door_positions?.length
          ? roomAnalysis.door_positions
          : (roomAnalysis?.plan_door_positions ?? []);
      lines.push(
        ...buildSolidWallOpeningLockLines(
          positions.slice(0, windowCount),
          doorPositionsForSolidLock,
          roomAnalysis?.wall_lengths_m,
        ),
      );
    } else {
      lines.push(...buildCurtainPolicyLines([], windowCount));
    }
    lines.push(...buildWindowSillDirective(roomAnalysis?.window_boxes));
    lines.push(
      "WALL FINISHES vs WINDOWS: Apply paint, wallpaper, slats, and panels ONLY around openings — each glazed bay remains visible glass with outdoor light shining through.",
      "Every window stays fully visible and unobstructed. Curtains/blinds may dress openings but the glazed openings and outdoor light/view remain.",
    );
  }

  if (windowCount === 0) {
    lines.push(
      "WINDOWS: This viewpoint shows NO window — the output MUST NOT contain any window, glazing, glass pane, or exterior view on ANY wall. Every wall in frame is a solid surface.",
    );
    lines.push(...buildCurtainPolicyLines([], 0));
  }

  const geometryLock = buildStructuralGeometryLock(roomAnalysis);
  if (geometryLock) {
    lines.push(geometryLock);
  }

  const noColumnDirective = buildNoColumnHallucinationDirective(roomAnalysis);
  if (noColumnDirective) {
    lines.push(noColumnDirective);
  }

  if (doorCount > 0) {
    const doorConfidence =
      roomAnalysis?.confidence?.door_count ?? roomGeometry?.confidence ?? "medium";
    const doorLockVerb =
      doorConfidence === "high"
        ? `EXACTLY ${doorCount}`
        : `at least ${doorCount}`;
    lines.push(
      `DOORS / PASSAGES: Keep ${doorLockVerb} door or clear passage opening(s). Do not wall up archways or wide openings between rooms.`,
    );
    const doorPositions =
      roomAnalysis?.door_positions?.length && analysisDoors > 0
        ? roomAnalysis.door_positions.slice(0, doorCount)
        : roomGeometry?.doors?.map(
            (d, i) =>
              `Door ${i + 1}: wall ${d.wall_id}, ~${d.approx_offset_from_left_m}m from wall start, ${d.width_m}m wide`,
          ) ?? [];
    if (doorPositions.length > 0) {
      lines.push("Positions:");
      doorPositions.slice(0, doorCount).forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
      lines.push(...buildDoorWallPlacementLockLines(doorPositions.slice(0, doorCount)));
    }
  }

  const planDoorInventory = roomAnalysis?.plan_door_count ?? 0;
  if (doorCount === 0) {
    if (planDoorInventory > 0) {
      lines.push(
        `DOORS / PASSAGES: This viewpoint shows NO door in frame. The floor plan has ${planDoorInventory} door(s) behind the camera or outside this view — every wall visible in this photo must stay solid; do NOT add any doorway, archway, or passage on the left, right, or far walls.`,
      );
      if (roomAnalysis?.plan_door_positions?.length) {
        lines.push("Plan door inventory (NOT visible in this photo — do not render):");
        roomAnalysis.plan_door_positions.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
        lines.push(...buildDoorWallPlacementLockLines(roomAnalysis.plan_door_positions));
      }
      if (windowCount > 0) {
        lines.push(
          ...buildSolidWallOpeningLockLines(
            roomAnalysis?.window_positions?.slice(0, windowCount) ?? [],
            roomAnalysis?.plan_door_positions ?? [],
            roomAnalysis?.wall_lengths_m,
          ),
        );
      }
    } else {
      lines.push(
        "DOORS / PASSAGES: This viewpoint shows NO door — the output MUST NOT contain any door, doorway, archway, or open passage on ANY wall. Every wall in frame is solid floor-to-ceiling.",
      );
    }
  }

  lines.push(
    "The floor plan shows the room's COMPLETE opening inventory; from THIS camera position only the opening(s) named in this lock are visible — do NOT add any window or door that appears on the plan but is behind or outside this view.",
    DOOR_CLEARANCE_DIRECTIVE,
  );

  return lines.join("\n");
}
