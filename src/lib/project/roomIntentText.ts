import type { DetectedRoom, RoomDesignBrief, RoomRenderPlan } from "./types";
import { describePolygonEdgesForPrompt } from "@/lib/pipelineLog";

/** Full room intent for Gemini — includes door/window sections when visible. */
export function buildRoomIntentText(
  brief: RoomDesignBrief,
  detectedRoom: DetectedRoom | undefined,
  visible?: { windowCount: number; doorCount: number },
): string {
  const dims = detectedRoom?.dimensions;
  const sections: string[] = [];

  const showWindows = visible ? visible.windowCount > 0 : true;
  const showDoors = visible ? visible.doorCount > 0 : true;

  sections.push(`ROOM: ${brief.roomName} (${brief.roomType})`);

  if (dims) {
    sections.push(`DIMENSIONS: ${dims.width}m wide × ${dims.depth}m deep, ${dims.height}m ceiling height`);
  }

  if (showWindows && detectedRoom?.windows?.length) {
    const wins = detectedRoom.windows
      .map((w, i) => `  ${i + 1}. ${w.position} — ${w.width}m × ${w.height}m`)
      .join("\n");
    sections.push(`WINDOWS (${detectedRoom.windows.length}):\n${wins}`);
  }

  if (showDoors && detectedRoom?.doors?.length) {
    const doors = detectedRoom.doors
      .map((d, i) => `  ${i + 1}. ${d.position}, ${d.width}m wide → ${d.connectsTo}`)
      .join("\n");
    sections.push(`DOORS (${detectedRoom.doors.length}):\n${doors}`);
  }

  appendDesignSections(sections, brief);
  return sections.join("\n\n");
}

/** FAL Stage 2 overlay — surfaces + furniture only; openings locked via Stage 1 image. */
export function buildFalRoomIntentText(
  brief: RoomDesignBrief,
  detectedRoom: DetectedRoom | undefined,
  plan?: RoomRenderPlan,
): string {
  const merged: RoomDesignBrief = {
    ...brief,
    ceilingDesign: brief.ceilingDesign || plan?.ceilingDesign || "",
    lightingConcept: brief.lightingConcept || plan?.lightingConcept || "",
    floorMaterial: brief.floorMaterial || plan?.floorMaterial || "",
  };

  const sections: string[] = [];
  sections.push(`ROOM: ${merged.roomName} (${merged.roomType})`);

  const polygon = detectedRoom?.polygon;
  if (polygon && polygon.length > 4) {
    const edgeSummary = describePolygonEdgesForPrompt(polygon);
    const height = detectedRoom?.dimensions?.height;
    sections.push(
      `ROOM SHAPE: ${polygon.length} corners — edges: ${edgeSummary}${height ? `, ${height}m ceiling height` : ""}.`,
    );
  } else if (detectedRoom?.dimensions) {
    const { width, depth, height } = detectedRoom.dimensions;
    sections.push(`DIMENSIONS: ${width}m wide × ${depth}m deep, ${height}m ceiling height`);
  }

  appendDesignSections(sections, merged, plan, { omitFurniture: true });
  return sections.join("\n\n");
}

function appendDesignSections(
  sections: string[],
  brief: RoomDesignBrief,
  plan?: RoomRenderPlan,
  opts?: { omitFurniture?: boolean },
): void {
  if (brief.ceilingDesign) {
    sections.push(`CEILING DESIGN (follow exactly):\n  ${brief.ceilingDesign}`);
  }

  const lighting = brief.lightingConcept || plan?.lightingConcept;
  if (lighting) {
    sections.push(`LIGHTING PLAN (follow exactly — count, placement, symmetry):\n  ${lighting}`);
  }

  const floor = brief.floorMaterial || plan?.floorMaterial;
  if (floor) {
    sections.push(`FLOORING:\n  ${floor}`);
  }

  if (!opts?.omitFurniture) {
    const furniture = mergeFurnitureLists(brief.furnitureList, plan?.furnitureList);
    if (furniture.length) {
      const items = furniture.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
      sections.push(`FURNITURE (${furniture.length} pieces):\n${items}`);
    }
  }

  if (plan?.materials?.length) {
    sections.push(`MATERIALS:\n  ${plan.materials.join("; ")}`);
  }

  if (plan?.mood) {
    sections.push(`MOOD: ${plan.mood}`);
  }

  if (brief.keyDesignElements.length) {
    const elems = brief.keyDesignElements.map((e, i) => `  ${i + 1}. ${e}`).join("\n");
    sections.push(`KEY DESIGN ELEMENTS:\n${elems}`);
  }

  if (brief.specialNotes) {
    sections.push(`DESIGNER NOTES: ${brief.specialNotes}`);
  }
}

function mergeFurnitureLists(briefList: string[], planList?: string[]): string[] {
  if (briefList.length) return briefList;
  return planList?.length ? planList : [];
}
