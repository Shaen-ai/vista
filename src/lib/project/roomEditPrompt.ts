/**
 * Phase 6 — Room Edit / Redesign.
 *
 * When a user wants to change something about a room's design,
 * Claude interprets their natural-language feedback and updates
 * the room brief accordingly, keeping the master palette as a
 * guardrail for visual consistency.
 */

import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "@/lib/aiRetry";
import { getAnthropicApiKey } from "@/lib/serverAiKeys";
import { logClaudeRequest, logClaudeResponse } from "@/lib/logClaudeRequest";
import type { MasterDesignConcept, RoomDesignBrief, RoomType } from "./types";

function buildRoomEditPrompt(
  feedback: string,
  currentBrief: RoomDesignBrief,
  concept: MasterDesignConcept,
  crossRoomContext?: string,
): string {
  return `You are a senior interior designer revising a room design based on client feedback. You must update the room's design brief while maintaining overall project consistency.

${crossRoomContext ? `${crossRoomContext}\n\n` : ""}MASTER PROJECT PALETTE (must stay generally consistent — you can adjust shades but not completely change the temperature or style):
- Style: ${concept.overallStyle}
- Primary: ${concept.colorPalette.primary.name} (${concept.colorPalette.primary.ncs})
- Secondary: ${concept.colorPalette.secondary.name} (${concept.colorPalette.secondary.ncs})
- Accent: ${concept.colorPalette.accent.name} (${concept.colorPalette.accent.ncs})
- Wood: ${concept.materialPalette.woodType}
- Metal: ${concept.materialPalette.metalFinish}
- Stone: ${concept.materialPalette.stoneType}

CURRENT ROOM BRIEF:
- Room: ${currentBrief.roomName} (${currentBrief.roomType})
- Wall color: ${currentBrief.wallColor.ncs} (${currentBrief.wallColor.hex})
${currentBrief.furnitureColor ? `- Furniture color: ${currentBrief.furnitureColor.ncs} (${currentBrief.furnitureColor.hex})` : ""}
- Floor: ${currentBrief.floorMaterial}
- Ceiling: ${currentBrief.ceilingDesign}
- Lighting: ${currentBrief.lightingConcept}
- Furniture: ${currentBrief.furnitureList.join("; ")}
- Design elements: ${currentBrief.keyDesignElements.join("; ")}
- Render angles: ${currentBrief.renderAngles.join("; ")}

CLIENT FEEDBACK: "${feedback}"

RULES:
1. Apply the client's requested changes precisely
2. Keep everything else from the current brief that the client didn't ask to change
3. Wall colors must still use valid NCS codes (format: NCS-S-XXXX-X)
4. Maintain harmony with the master palette — if client asks for a different wall color, pick one that still works with the project's overall scheme
5. Keep the same number of render angles unless the client specifically asks for different views
6. Be specific with materials and furniture descriptions

Respond ONLY with valid JSON — the complete updated room brief:
{
  "roomId": "${currentBrief.roomId}",
  "roomName": "${currentBrief.roomName}",
  "roomType": "${currentBrief.roomType}",
  "wallColor": { "hex": "#XXXXXX", "ncs": "NCS-S-XXXX-X" },
  "furnitureColor": { "hex": "#XXXXXX", "ncs": "NCS-S-XXXX-X" },
  "floorMaterial": "string",
  "ceilingDesign": "string",
  "lightingConcept": "string",
  "furnitureList": ["string"],
  "keyDesignElements": ["string"],
  "renderAngles": ["string (keep same angles unless client asked to change views)"],
  "specialNotes": "string (mention what was changed from the previous version)"
}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStr(v: unknown, d: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : d;
}

function parseUpdatedBrief(raw: unknown, fallback: RoomDesignBrief): RoomDesignBrief {
  const o = isRecord(raw) ? raw : {};
  const wc = isRecord(o.wallColor) ? o.wallColor : {};
  const fc = isRecord(o.furnitureColor) ? o.furnitureColor : null;

  return {
    roomId: asStr(o.roomId, fallback.roomId),
    roomName: asStr(o.roomName, fallback.roomName),
    roomType: asStr(o.roomType, fallback.roomType) as RoomType,
    wallColor: {
      hex: asStr(wc.hex, fallback.wallColor.hex),
      ncs: asStr(wc.ncs, fallback.wallColor.ncs),
    },
    furnitureColor: fc
      ? {
          hex: asStr(fc.hex, fallback.furnitureColor?.hex ?? fallback.wallColor.hex),
          ncs: asStr(fc.ncs, fallback.furnitureColor?.ncs ?? fallback.wallColor.ncs),
        }
      : fallback.furnitureColor,
    floorMaterial: asStr(o.floorMaterial, fallback.floorMaterial),
    ceilingDesign: asStr(o.ceilingDesign, fallback.ceilingDesign),
    lightingConcept: asStr(o.lightingConcept, fallback.lightingConcept),
    furnitureList: Array.isArray(o.furnitureList)
      ? o.furnitureList.filter((x): x is string => typeof x === "string")
      : fallback.furnitureList,
    keyDesignElements: Array.isArray(o.keyDesignElements)
      ? o.keyDesignElements.filter((x): x is string => typeof x === "string")
      : fallback.keyDesignElements,
    renderAngles: Array.isArray(o.renderAngles)
      ? o.renderAngles.filter((x): x is string => typeof x === "string")
      : fallback.renderAngles,
    specialNotes: asStr(o.specialNotes, ""),
  };
}

/**
 * Interpret user feedback and return an updated room brief.
 */
export async function interpretRoomEdit(
  feedback: string,
  currentBrief: RoomDesignBrief,
  concept: MasterDesignConcept,
  crossRoomContext?: string,
): Promise<RoomDesignBrief> {
  const anthropicKey = getAnthropicApiKey();
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey: anthropicKey });
  const prompt = buildRoomEditPrompt(feedback, currentBrief, concept, crossRoomContext);

  logClaudeRequest({
    label: "room-edit-interpretation",
    model: "claude-opus-4-8",
    maxTokens: 2048,
    messages: [{ type: "text", text: prompt }],
    context: { feedback },
  });

  const response = await withRetry(
    () =>
      client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    "Room edit interpretation",
  );

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Room edit interpretation returned no text response");
  }

  let rawText = textBlock.text;
  const codeBlock = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock) rawText = codeBlock[1];
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

  const updated = parseUpdatedBrief(parsed, currentBrief);
  logClaudeResponse({
    label: "room-edit-interpretation",
    response,
    rawText: textBlock.text,
    parsed: updated,
  });
  return updated;
}
