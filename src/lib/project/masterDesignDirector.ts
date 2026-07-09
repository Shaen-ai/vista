/**
 * Phase 2 — Master Design Concept.
 *
 * The single most important prompt in the pipeline: it takes the
 * floor-plan analysis + user preferences and produces a unified,
 * room-by-room design concept that ensures visual consistency across
 * the entire home (shared color palette, material palette, NCS codes).
 */

import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "@/lib/aiRetry";
import {
  collectAnthropicTextBlocks,
  parseDesignBriefJsonFromAssistantText,
} from "@/lib/creativeDirectorJson";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import type {
  FloorPlanAnalysis,
  MasterDesignConcept,
  RoomDesignBrief,
  RoomType,
  UserPreferences,
  UtilityEntryPoint,
  NcsColor,
  MaterialPalette,
} from "./types";
import { getStylePresetOrDefault, type StylePreset } from "./stylePresets";
import { edgeDimsText } from "./roomFloorPlanContext";
import { buildConceptUtilityConstraints } from "./utilityConstraints";
import { isArmeniaLocalScrapedExclusive } from "@/lib/scrapedAllowlist";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";

function buildAnalysisJsonBlock(analysis: FloorPlanAnalysis): string {
  const clean = {
    totalArea: analysis.totalArea,
    ceilingHeight: analysis.ceilingHeight,
    overallShape: analysis.overallShape,
    notes: analysis.notes,
    rooms: analysis.rooms.map((r) => {
      const poly = r.polygon;
      const hasShape = !!poly && poly.length >= 3;
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        estimatedArea: r.estimatedArea,
        dimensions: r.dimensions,
        // Real boundary so non-rectangular rooms are designed against their true
        // shape (not just the bounding box) — corner-labeled to match what Gemini
        // and the schematic show. `edges` uses the same A-B-C-D wall lengths.
        shape: hasShape ? `${poly!.length}-corner polygon` : "rectangular",
        corners: hasShape ? poly!.length : 4,
        polygon: hasShape ? poly!.map(([x, y]) => [Math.round(x), Math.round(y)]) : undefined,
        edges: hasShape ? edgeDimsText(poly!) : undefined,
        windows: r.windows,
        doors: r.doors,
        features: r.features,
      };
    }),
    utilityPoints: analysis.utilityPoints,
  };
  return JSON.stringify(clean, null, 2);
}

function angleCountForRoom(type: RoomType, _area: number): number {
  // Tiny rooms get 2 views (opposite viewpoints); every other room gets 3
  // distinct views. We never render the same shot twice, so counts are capped
  // here to keep the gallery/PDF tight.
  if (
    type === "bathroom" ||
    type === "toilet" ||
    type === "laundry" ||
    type === "balcony"
  ) {
    return 2;
  }
  return 3;
}

function buildMasterConceptPrompt(
  analysis: FloorPlanAnalysis,
  prefs: UserPreferences,
  style: StylePreset,
  utilityEntryPoints: UtilityEntryPoint[],
): string {
  const roomList = buildAnalysisJsonBlock(analysis);
  const utilityBlock = buildConceptUtilityConstraints(analysis.rooms, utilityEntryPoints);
  const roomCount = analysis.rooms.length;
  const angleGuidance = analysis.rooms
    .map((r) => `  "${r.id}": ${angleCountForRoom(r.type, r.estimatedArea)} angles`)
    .join("\n");
  const concisenessNote =
    roomCount >= 6
      ? `\nCONCISENESS (required): This home has ${roomCount} rooms. Keep furnitureList to 3–5 items per room, keyDesignElements to 2–3 items, and render angle descriptions to one short sentence each. The entire JSON must fit in one response.\n`
      : "";

  const scrapedExclusiveBlock = isArmeniaLocalScrapedExclusive(
    prefs.countryCode ?? "",
    prefs.searchMode ?? "",
  )
    ? `

SCRAPED-INVENTORY PROJECT MODE (Armenia · Local Shop — REQUIRED)
- Finished renders may ONLY show specific products/SKUs that exist in our scraped marketplace database. Phantom brands or undocumented model names must never appear in imagery.
- Write furnitureList, floorMaterial descriptions, tiling, fixed lighting fixtures, appliances, HVAC splits, parquet, rugs with visible SKU-like presence, etc. as NEUTRAL, SEARCHABLE intents: plain product types + materials + approximate sizes + colors (e.g. "modular sectional sofa roughly 260×180cm, light oatmeal woven fabric"; "wall cassette AC indoor unit beside window").
- Omit brand names, retailer names, and model codes — those cannot be resolver-mapped to scraped rows.
- Categories with no scraped match at render time are left unfurnished or shown only as generic finishes (paint/plaster/base trim) rather than phantom products.
`
    : "";

  return `You are a senior interior designer creating a COMPLETE home design concept. You must design ALL rooms as ONE cohesive project — the entire home should feel unified, like a luxury design studio project.

PROJECT BRIEF:
- Apartment/house: ${analysis.totalArea}m², ${analysis.overallShape} layout, ceiling height ${analysis.ceilingHeight}m
- Style: "${style.label}" — ${style.description}
- Style keywords: ${style.keywords}
- Family: ${prefs.familyMembers} members
- Budget tier: ${prefs.budgetTier}
- User wishes: "${prefs.wishes || "No specific wishes"}"

FLOOR PLAN ANALYSIS (authoritative structured data — every room with exact dimensions, window/door positions and sizes, connectivity):
${roomList}
${utilityBlock}
STYLE REFERENCE (use as starting point, adapt as needed):
- Suggested palette: primary ${style.defaultPalette.primary.name} (${style.defaultPalette.primary.ncs}), secondary ${style.defaultPalette.secondary.name} (${style.defaultPalette.secondary.ncs}), accent ${style.defaultPalette.accent.name} (${style.defaultPalette.accent.ncs}), neutral ${style.defaultPalette.neutral.name} (${style.defaultPalette.neutral.ncs})
- Wood: ${style.defaultMaterials.woodType}, Metal: ${style.defaultMaterials.metalFinish}
- Stone: ${style.defaultMaterials.stoneType}, Textile: ${style.defaultMaterials.textilePrimary}
- Ceiling approach: ${style.ceilingStyle}
- Lighting approach: ${style.lightingStyle}

CRITICAL RULES:
1. NCS COLOR CODES: Every wall color AND furniture color MUST have a valid NCS code in the format "NCS-S-XXXX-Y" (e.g. NCS-S-1505-Y50R, NCS-S-0300-N). Use real NCS codes that interior designers actually use. furnitureColor describes the dominant built-in or freestanding furniture finish in the room (cabinetry, wardrobes, kitchen fronts, etc.).
2. VISUAL CONSISTENCY: All rooms share the same wood type, metal finish, and general color temperature. The home should flow naturally from one room to the next.
3. ROOM-APPROPRIATE CHOICES: Bathrooms get water-resistant materials (porcelain tile, marble). Kitchens get durable countertops and backsplashes. Bedrooms get soft, warm materials.
4. RENDER ANGLES: For each room, describe specific camera viewpoints that are CLEARLY DIFFERENT from one another — never two versions of the same shot. The viewpoints MUST be complementary so together they reveal the whole room:
   - Angle 1: from the entry/doorway looking into the room toward its main focal wall.
   - Angle 2: from the OPPOSITE side of the room (camera roughly 180° around, standing near the focal wall) looking back toward the entry. This is the reverse of angle 1, not the same view.
   - Angle 3 (only when the room has 3 angles): an elevated or corner three-quarter view that captures a different part of the room than angles 1 and 2.
   Each viewpoint must cover a different portion of the room.
5. STRUCTURAL FEATURES STAY VISIBLE: Any structural column, pier, post, or exposed
   beam/soffit present in the floor plan or photos MUST be treated as a visible,
   intentional architectural feature — design WITH it (e.g. as a finished accent). NEVER
   conceal it, box it inside a wardrobe/cabinet, clad it to disappear into the wall, or hide
   it behind furniture. Do not write specialNotes/keyDesignElements that hide structural
   columns.${scrapedExclusiveBlock}${concisenessNote}

Number of render angles per room:
${angleGuidance}

Each render angle description should be specific AND state the camera position and facing direction: "Eye-level view from the doorway on the south wall looking north toward the window wall, capturing the sofa and TV wall" — NOT vague like "angle 1".

Respond ONLY with valid JSON:
{
  "projectName": "string (creative project name)",
  "overallStyle": "string (one-sentence style description)",
  "colorPalette": {
    "primary": { "hex": "#XXXXXX", "ncs": "NCS-S-XXXX-X", "name": "string" },
    "secondary": { "hex": "#XXXXXX", "ncs": "NCS-S-XXXX-X", "name": "string" },
    "accent": { "hex": "#XXXXXX", "ncs": "NCS-S-XXXX-X", "name": "string" },
    "neutral": { "hex": "#XXXXXX", "ncs": "NCS-S-XXXX-X", "name": "string" }
  },
  "materialPalette": {
    "woodType": "string",
    "metalFinish": "string",
    "stoneType": "string",
    "textilePrimary": "string"
  },
  "rooms": [
    {
      "roomId": "string (must match the room ids from the detected rooms list above)",
      "roomName": "string",
      "roomType": "string",
      "wallColor": { "hex": "#XXXXXX", "ncs": "NCS-S-XXXX-X" },
      "furnitureColor": { "hex": "#XXXXXX", "ncs": "NCS-S-XXXX-X" },
      "floorMaterial": "string (specific: e.g. 'Chevron pattern light oak engineered wood' or 'Large-format 60×120cm grey marble-look porcelain tile')",
      "ceilingDesign": "string — a DELIBERATE, SYMMETRIC ceiling: finish + fixture LAYOUT with alignment and counts. e.g. 'Flat gypsum tray ceiling; one continuous warm-white LED cove parallel to all walls; symmetric 2x3 grid of flush recessed downlights aligned to the walls'. NEVER write vague 'recessed lighting' or 'ceiling lights' with no layout",
      "lightingConcept": "string — list EVERY fixture WITH placement + symmetry: e.g. 'Symmetric downlight grid (warm 2700K) aligned to the walls, concealed perimeter LED cove, one pendant centered over the bed, matching sconces flanking the headboard'. Fixtures must read as professionally planned, never scattered",
      "furnitureList": ["string (specific furniture pieces with materials, e.g. 'L-shaped bouclé sofa in cream, ~2.8m × 1.8m')"],
      "keyDesignElements": ["string (accent wall, mirror, artwork, plants, etc.)"],
      "renderAngles": ["string (specific camera angle descriptions for image generation)"],
      "specialNotes": "string (any room-specific design decisions)"
    }
  ]
}

Ensure EVERY room from the detected rooms list has an entry. The furnitureList should be realistic for the room size and function. Include specific dimensions for major furniture pieces.`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown, d: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : d;
}

function parseNcsColor(v: unknown, fallback: NcsColor): NcsColor {
  if (!isRecord(v)) return fallback;
  return {
    hex: asStr(v.hex, fallback.hex),
    ncs: asStr(v.ncs, fallback.ncs),
    name: asStr(v.name, fallback.name),
  };
}

function parseMaterialPalette(v: unknown, fallback: MaterialPalette): MaterialPalette {
  if (!isRecord(v)) return fallback;
  return {
    woodType: asStr(v.woodType, fallback.woodType),
    metalFinish: asStr(v.metalFinish, fallback.metalFinish),
    stoneType: asStr(v.stoneType, fallback.stoneType),
    textilePrimary: asStr(v.textilePrimary, fallback.textilePrimary),
  };
}

function parseColorPair(v: unknown, fallback: { hex: string; ncs: string }): { hex: string; ncs: string } {
  if (!isRecord(v)) return fallback;
  return { hex: asStr(v.hex, fallback.hex), ncs: asStr(v.ncs, fallback.ncs) };
}

function parseRoomBrief(v: unknown): RoomDesignBrief | null {
  if (!isRecord(v)) return null;
  const wc = isRecord(v.wallColor) ? v.wallColor : {};
  const fc = isRecord(v.furnitureColor) ? v.furnitureColor : null;
  const wallColor = { hex: asStr(wc.hex, "#E0DDD8"), ncs: asStr(wc.ncs, "NCS-S-1002-Y") };
  return {
    roomId: asStr(v.roomId, ""),
    roomName: asStr(v.roomName, ""),
    roomType: asStr(v.roomType, "other") as RoomType,
    wallColor,
    furnitureColor: fc ? parseColorPair(fc, wallColor) : undefined,
    floorMaterial: asStr(v.floorMaterial, ""),
    ceilingDesign: asStr(v.ceilingDesign, ""),
    lightingConcept: asStr(v.lightingConcept, ""),
    furnitureList: Array.isArray(v.furnitureList)
      ? v.furnitureList.filter((x): x is string => typeof x === "string")
      : [],
    keyDesignElements: Array.isArray(v.keyDesignElements)
      ? v.keyDesignElements.filter((x): x is string => typeof x === "string")
      : [],
    renderAngles: Array.isArray(v.renderAngles)
      ? v.renderAngles.filter((x): x is string => typeof x === "string")
      : [],
    specialNotes: asStr(v.specialNotes, ""),
  };
}

function normalizeConcept(raw: unknown, style: StylePreset): MasterDesignConcept {
  const o = isRecord(raw) ? raw : {};
  const cp = isRecord(o.colorPalette) ? o.colorPalette : {};

  return {
    projectName: asStr(o.projectName, "Design Project"),
    overallStyle: asStr(o.overallStyle, style.label),
    colorPalette: {
      primary: parseNcsColor(cp.primary, style.defaultPalette.primary),
      secondary: parseNcsColor(cp.secondary, style.defaultPalette.secondary),
      accent: parseNcsColor(cp.accent, style.defaultPalette.accent),
      neutral: parseNcsColor(cp.neutral, style.defaultPalette.neutral),
    },
    materialPalette: parseMaterialPalette(o.materialPalette, style.defaultMaterials),
    rooms: (Array.isArray(o.rooms) ? o.rooms : [])
      .map(parseRoomBrief)
      .filter((r): r is RoomDesignBrief => r !== null && r.roomId !== ""),
  };
}

export async function createMasterDesignConcept(
  analysis: FloorPlanAnalysis,
  preferences: UserPreferences,
  utilityEntryPoints: UtilityEntryPoint[] = [],
): Promise<MasterDesignConcept> {
  const anthropicKey = getAnthropicApiKey();
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const style = getStylePresetOrDefault(preferences.style);
  const prompt = buildMasterConceptPrompt(analysis, preferences, style, utilityEntryPoints);

  const client = new Anthropic({ apiKey: anthropicKey });

  logClaudeRequest({
    label: "master-design-concept",
    model: "claude-opus-4-8",
    maxTokens: 16384,
    messages: [{ type: "text", text: prompt }],
    context: { rooms: analysis.rooms?.length, style: style.id },
  });

  const response = await withRetry(
    () =>
      client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 16384,
        messages: [{ role: "user", content: prompt }],
      }),
    "Master design concept",
  );

  if (response.stop_reason === "max_tokens") {
    console.warn(
      "[Master design concept] Response hit max_tokens; truncated JSON repair will be attempted.",
    );
  }

  const assistantPlainText = collectAnthropicTextBlocks(response.content);
  if (!assistantPlainText) {
    throw new Error("Master design concept returned no text response");
  }

  const parsed = parseDesignBriefJsonFromAssistantText(assistantPlainText);

  const concept = normalizeConcept(parsed, style);

  logClaudeResponse({
    label: "master-design-concept",
    response,
    rawText: assistantPlainText,
    parsed: concept,
  });

  // Ensure every detected room has a brief — fill gaps with defaults
  for (const detectedRoom of analysis.rooms) {
    if (!concept.rooms.find((r) => r.roomId === detectedRoom.id)) {
      concept.rooms.push({
        roomId: detectedRoom.id,
        roomName: detectedRoom.name,
        roomType: detectedRoom.type,
        wallColor: { hex: style.defaultPalette.primary.hex, ncs: style.defaultPalette.primary.ncs },
        floorMaterial: `${style.defaultMaterials.woodType} engineered wood`,
        ceilingDesign: style.ceilingStyle,
        lightingConcept: style.lightingStyle,
        furnitureList: [],
        keyDesignElements: [],
        renderAngles: [
          "Wide-angle view from the main entrance showing full room layout",
          "Eye-level detail shot of the primary focal area and materials",
          "Close-up detail of textures, lighting, and decor accents",
        ],
        specialNotes: "Auto-generated brief — room was not covered by Claude's response.",
      });
    }
  }

  return concept;
}
