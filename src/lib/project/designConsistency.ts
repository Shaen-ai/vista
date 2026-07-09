/**
 * Cross-room design consistency — builds prompt blocks from master concept
 * and approved room summaries so subsequent rooms match the same pattern.
 */

import type {
  ApprovedDesignSummary,
  MasterDesignConcept,
  RoomMaterialSpec,
  RoomDesignBrief,
  RoomResult,
} from "./types";

export function buildApprovedDesignSummary(
  room: RoomResult,
  concept: MasterDesignConcept,
): ApprovedDesignSummary {
  const materialParts: string[] = [];
  if (room.materials?.floorMaterial?.type) {
    materialParts.push(`Floor: ${room.materials.floorMaterial.type}`);
  }
  if (room.materials?.tileMaterial?.type) {
    materialParts.push(`Tile: ${room.materials.tileMaterial.type}`);
  }
  for (const kf of room.materials?.keyFurniture ?? []) {
    materialParts.push(`${kf.category}: ${kf.name}`);
  }

  const renderDesc =
    room.renders.length > 0
      ? room.renders.map((r) => r.angleDescription).join("; ")
      : room.brief.renderAngles.join("; ");

  return {
    roomName: room.brief.roomName,
    roomType: room.brief.roomType,
    style: concept.overallStyle,
    wallColorHex: room.brief.wallColor.hex,
    wallColorNcs: room.brief.wallColor.ncs,
    floorMaterial: room.brief.floorMaterial,
    furnitureList: room.brief.furnitureList,
    keyDesignElements: room.brief.keyDesignElements,
    lightingConcept: room.brief.lightingConcept,
    materialChoices: materialParts.join(". ") || room.brief.floorMaterial,
    renderDescription: renderDesc,
  };
}

export function buildCrossRoomConsistencyBlock(
  concept: MasterDesignConcept,
  approvedSummaries: Record<string, ApprovedDesignSummary>,
): string {
  const approved = Object.values(approvedSummaries);
  if (approved.length === 0) {
    return `PROJECT-WIDE DESIGN PATTERN (MANDATORY — apply to this room):
- Overall style: ${concept.overallStyle}
- Primary color: ${concept.colorPalette.primary.name} (${concept.colorPalette.primary.hex}, ${concept.colorPalette.primary.ncs})
- Secondary: ${concept.colorPalette.secondary.name} (${concept.colorPalette.secondary.hex}, ${concept.colorPalette.secondary.ncs})
- Accent: ${concept.colorPalette.accent.name} (${concept.colorPalette.accent.hex}, ${concept.colorPalette.accent.ncs})
- Neutral: ${concept.colorPalette.neutral.name} (${concept.colorPalette.neutral.hex}, ${concept.colorPalette.neutral.ncs})
- Wood: ${concept.materialPalette.woodType}
- Metal: ${concept.materialPalette.metalFinish}
- Stone: ${concept.materialPalette.stoneType}
- Textile: ${concept.materialPalette.textilePrimary}

Use the SAME design pattern, color temperature, wood tone, and metal finish across the entire home.`;
  }

  const roomSummaries = approved
    .map(
      (s) =>
        `- ${s.roomName} (${s.roomType}): walls ${s.wallColorNcs} (${s.wallColorHex}), floor "${s.floorMaterial}", ` +
        `furniture: ${s.furnitureList.slice(0, 4).join("; ") || "as specified"}, ` +
        `lighting: ${s.lightingConcept}. Materials: ${s.materialChoices}`,
    )
    .join("\n");

  return `PROJECT-WIDE DESIGN CONSISTENCY (MANDATORY):
This is one cohesive home design. Match the approved rooms below.

MASTER PALETTE:
- Style: ${concept.overallStyle}
- Primary: ${concept.colorPalette.primary.name} (${concept.colorPalette.primary.hex}, ${concept.colorPalette.primary.ncs})
- Secondary: ${concept.colorPalette.secondary.name} (${concept.colorPalette.secondary.hex}, ${concept.colorPalette.secondary.ncs})
- Accent: ${concept.colorPalette.accent.name} (${concept.colorPalette.accent.hex}, ${concept.colorPalette.accent.ncs})
- Neutral: ${concept.colorPalette.neutral.name} (${concept.colorPalette.neutral.hex}, ${concept.colorPalette.neutral.ncs})
- Wood: ${concept.materialPalette.woodType} | Metal: ${concept.materialPalette.metalFinish}
- Stone: ${concept.materialPalette.stoneType} | Textile: ${concept.materialPalette.textilePrimary}

ALREADY APPROVED ROOMS (match these choices):
${roomSummaries}

RULES:
- Use the same wood tone, metal finish, and color temperature as approved rooms
- Wall and floor colors must harmonize with the master palette and approved rooms
- Transitions between rooms should feel natural — one unified design studio project
- Do NOT introduce conflicting styles or clashing palettes`;
}

export function materialSummaryFromSpec(spec: RoomMaterialSpec | null): string {
  if (!spec) return "";
  const parts: string[] = [];
  if (spec.floorMaterial?.type) parts.push(`Floor: ${spec.floorMaterial.type}`);
  if (spec.tileMaterial?.type) parts.push(`Tile: ${spec.tileMaterial.type}`);
  for (const kf of spec.keyFurniture) {
    parts.push(`${kf.category}: ${kf.name}`);
  }
  return parts.join(". ");
}
