import "server-only";

import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { withRetry } from "@/lib/aiRetry";
import { pipelineLog } from "@/lib/pipelineLog";
import type { ViewpointFraming } from "@/lib/project/viewpointFraming";

export function isHeroPlacementMapEnabled(): boolean {
  const raw = (process.env.VISTA_HERO_PLACEMENT_MAP ?? "").trim();
  if (raw === "0") return false;
  if (raw === "1") return true;
  return !!getOpenAiApiKey();
}

const PLACEMENT_MAP_RULES =
  "Every listed piece keeps this exact wall and these exact neighbors in this view. Pieces adjacent in the master remain adjacent here. Never swap two pieces' positions.";

const DECOR_LOCK_RULES =
  "Every listed decor item is the exact same physical object in this view — render only the subset visible from this camera; never substitute a different rug, different pillows, or different wall art.";

function compassLabel(wall: string | null | undefined, fallback: string): string {
  return wall ? `${wall.toUpperCase()} wall` : fallback;
}

export interface HeroMasterAnalysis {
  placementMap: string | null;
  decorLock: string | null;
}

function formatPlacementMap(placements: string[]): string {
  return [
    "FURNITURE PLACEMENT MAP (observed in the approved master design — mandatory):",
    ...placements.map((p) => `- ${p.trim()}`),
    PLACEMENT_MAP_RULES,
  ].join("\n");
}

function formatDecorLock(decor: string[]): string {
  return [
    "DECOR IDENTITY LOCK (observed in the approved master — mandatory):",
    ...decor.map((d) => `- ${d.trim()}`),
    DECOR_LOCK_RULES,
  ].join("\n");
}

/**
 * Describe the approved master (hero) render with one vision call, producing a
 * per-piece wall/adjacency map and decor identity lock for secondary-view prompts.
 * Non-blocking: returns null fields when disabled or on any failure.
 */
export async function describeHeroFurniturePlacement(input: {
  heroBase64: string;
  heroMime: string;
  furnitureList?: string[];
  heroFraming?: ViewpointFraming | null;
  projectId?: string;
  roomId?: string;
}): Promise<HeroMasterAnalysis> {
  const empty: HeroMasterAnalysis = { placementMap: null, decorLock: null };
  if (!isHeroPlacementMapEnabled()) return empty;
  const openAiKey = getOpenAiApiKey();
  if (!openAiKey) return empty;

  const start = Date.now();
  const ahead = compassLabel(input.heroFraming?.aheadWall, "wall ahead of the camera");
  const left = compassLabel(input.heroFraming?.leftWall, "wall on the camera's left");
  const right = compassLabel(input.heroFraming?.rightWall, "wall on the camera's right");
  const expectedPieces = (input.furnitureList ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .join(", ");

  const promptText =
    "This is the approved master render of a room interior. Respond JSON only with two arrays:\n\n" +
    '1. "placements": List EVERY visible furniture piece and its physical position. ' +
    "For each piece state: (1) which wall it stands against or is nearest to — use these labels: " +
    `wall ahead of camera = ${ahead}, wall on camera's left = ${left}, wall on camera's right = ${right}; ` +
    "(2) its immediate neighbors — what is directly to its left and right (another named piece, a door opening, a window, or a room corner). " +
    (expectedPieces ? `Planned pieces to look for: ${expectedPieces}. ` : "") +
    "One short line per piece, concrete and spatial, no styling commentary, e.g. " +
    "'wardrobe: NORTH wall at the right corner, rattan bench immediately to its left'.\n\n" +
    '2. "decor": List EVERY visible decorative item with enough detail to reproduce the exact same item in another camera angle. Include: ' +
    "rug (shape, base color, pattern/motif), cushions/pillows (count and colors per furniture piece), " +
    "wall art (count, subjects, frame colors, which wall), curtains/blinds, plants, lamps, bedding. " +
    "One short line per item, e.g. " +
    "'round light-blue rug with a single large white star in the center', " +
    "'bunk bed lower bunk: three pillows — medium blue, burnt orange, dark navy', " +
    "'left wall: two framed superhero posters — Captain America and Iron Man'. " +
    "If no decor is visible, return an empty array.\n\n" +
    'Respond JSON only: {"placements": string[], "decor": string[]}.';

  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.FLOOR_PLAN_ANALYSIS_MODEL || "gpt-5.5";

  try {
    const response = await withRetry(async () => {
      const res = await openAiFetch(
        apiUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: promptText },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${input.heroMime || "image/png"};base64,${input.heroBase64}`,
                      detail: "high",
                    },
                  },
                ],
              },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 2000,
          }),
        },
        { vision: true },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Hero placement map failed (${res.status}): ${body.slice(0, 300)}`);
      }
      return res.json();
    }, "hero placement map");

    const text = response?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      pipelineLog("FAL_PIPELINE", "hero placement map empty content", { roomId: input.roomId }, "warn");
      return empty;
    }
    const parsed = JSON.parse(text) as { placements?: unknown; decor?: unknown };
    const placements = Array.isArray(parsed?.placements)
      ? parsed.placements.filter((p): p is string => typeof p === "string" && !!p.trim())
      : [];
    const decor = Array.isArray(parsed?.decor)
      ? parsed.decor.filter((d): d is string => typeof d === "string" && !!d.trim())
      : [];

    const placementMap = placements.length > 0 ? formatPlacementMap(placements) : null;
    const decorLock = decor.length > 0 ? formatDecorLock(decor) : null;

    if (!placementMap && !decorLock) {
      pipelineLog("FAL_PIPELINE", "hero placement map no placements or decor", { roomId: input.roomId }, "warn");
      return empty;
    }

    pipelineLog("FAL_PIPELINE", "hero placement map built", {
      roomId: input.roomId,
      projectId: input.projectId,
      ms: Date.now() - start,
      pieces: placements.length,
      decorItems: decor.length,
      preview: placements.slice(0, 3).join(" | ").slice(0, 240),
      decorPreview: decor.slice(0, 2).join(" | ").slice(0, 240),
    });

    return { placementMap, decorLock };
  } catch (err) {
    pipelineLog(
      "FAL_PIPELINE",
      "hero placement map error",
      {
        roomId: input.roomId,
        message: err instanceof Error ? err.message.slice(0, 200) : String(err),
      },
      "warn",
    );
    return empty;
  }
}
