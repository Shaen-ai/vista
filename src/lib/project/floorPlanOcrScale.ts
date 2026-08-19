import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { parseAssistantJsonObject } from "@/lib/creativeDirectorJson";
import { polygonArea } from "./floorPlanGeometry";
import type { FloorPlanAnalysis } from "./types";

export type OcrPlanLabel = {
  text: string;
  /** meters when parseable */
  valueMeters: number | null;
  /** area m² when parseable */
  valueAreaM2: number | null;
  kind: "dimension" | "area" | "other";
};

const FT_IN_RE = /(\d+)\s*['′]\s*-?\s*(\d+(?:\.\d+)?)?\s*["″]?/i;
const SF_RE = /(\d+(?:\.\d+)?)\s*SF\b/i;
const M2_RE = /(\d+(?:\.\d+)?)\s*(?:m²|m2|մ²)/i;

export function parseArchitecturalLabel(text: string): Pick<OcrPlanLabel, "valueMeters" | "valueAreaM2" | "kind"> {
  const t = text.trim();
  const sf = SF_RE.exec(t);
  if (sf) {
    const sqft = Number(sf[1]);
    return { valueMeters: null, valueAreaM2: Number.isFinite(sqft) ? sqft * 0.092903 : null, kind: "area" };
  }
  const m2 = M2_RE.exec(t);
  if (m2) {
    const v = Number(m2[1]);
    return { valueMeters: null, valueAreaM2: Number.isFinite(v) ? v : null, kind: "area" };
  }
  const ft = FT_IN_RE.exec(t);
  if (ft) {
    const feet = Number(ft[1]);
    const inches = ft[2] != null && ft[2] !== "" ? Number(ft[2]) : 0;
    if (Number.isFinite(feet) && Number.isFinite(inches)) {
      return {
        valueMeters: feet * 0.3048 + inches * 0.0254,
        valueAreaM2: null,
        kind: "dimension",
      };
    }
  }
  return { valueMeters: null, valueAreaM2: null, kind: "other" };
}

export function buildOcrHintBlock(labels: OcrPlanLabel[]): string {
  const useful = labels.filter((l) => l.valueMeters != null || l.valueAreaM2 != null);
  if (useful.length === 0) return "";
  const lines = useful.slice(0, 40).map((l) => {
    if (l.valueAreaM2 != null) return `"${l.text}" → ${l.valueAreaM2.toFixed(2)} m²`;
    if (l.valueMeters != null) return `"${l.text}" → ${l.valueMeters.toFixed(2)} m`;
    return l.text;
  });
  return `

PRINTED LABELS (OCR — prefer these for estimatedArea and dimensions):
${lines.join("\n")}`;
}

/** Build scale hints from the main vision JSON `printedLabels` field (no extra API call). */
export function ocrLabelsFromParsedRaw(raw: unknown): OcrPlanLabel[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const arr = (raw as { printedLabels?: unknown }).printedLabels;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((text) => {
      const parsed = parseArchitecturalLabel(text);
      return { text: text.trim(), ...parsed };
    });
}

/**
 * Lightweight vision OCR pass (legacy — not used on the hot analyze path).
 */
export async function extractFloorPlanOcrLabels(
  imageBase64: string,
  imageMimeType: string,
): Promise<OcrPlanLabel[]> {
  const key = getOpenAiApiKey();
  if (!key) return [];

  const model = process.env.FLOOR_PLAN_OCR_MODEL?.trim() || "gpt-4o-mini";
  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";

  const res = await openAiFetch(
    apiUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `List every printed dimension or area label on this floor plan (feet-inches, SF, m², Armenian մ²). Return JSON: {"labels":["19'-0\"","110 SF","14.7 m²",...]} only.`,
              },
              {
                type: "image_url",
                image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: "low" },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 2000,
        temperature: 0,
      }),
    },
    { vision: true },
  );

  if (!res.ok) return [];
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return [];
  const parsed = parseAssistantJsonObject(text);
  const labelsRaw = parsed && typeof parsed === "object" && Array.isArray((parsed as { labels?: unknown }).labels)
    ? (parsed as { labels: unknown[] }).labels
    : [];
  const out: OcrPlanLabel[] = [];
  for (const item of labelsRaw) {
    if (typeof item !== "string") continue;
    const parsedLabel = parseArchitecturalLabel(item);
    out.push({ text: item, ...parsedLabel });
  }
  return out;
}

/**
 * Rescale anchored analysis when OCR area labels imply a better total area.
 */
export function applyOcrScaleToAnalysis(
  analysis: FloorPlanAnalysis,
  labels: OcrPlanLabel[],
  userAreaM2?: number,
): { analysis: FloorPlanAnalysis; ocrScaleConfidence: number } {
  if (userAreaM2 && userAreaM2 > 0) {
    return { analysis, ocrScaleConfidence: 0 };
  }

  const areaLabels = labels.map((l) => l.valueAreaM2).filter((v): v is number => v != null && v > 0);
  const ocrTotal = areaLabels.reduce((s, v) => s + v, 0);
  if (ocrTotal <= 0 || !analysis.imageFrame) {
    return { analysis, ocrScaleConfidence: 0 };
  }

  const footprintM2 = analysis.rooms.reduce(
    (s, r) => s + (r.polygon && r.polygon.length >= 3 ? polygonArea(r.polygon) / 1_000_000 : 0),
    0,
  );
  if (footprintM2 <= 0) return { analysis, ocrScaleConfidence: 0 };

  const modelTotal = analysis.totalArea > 0 ? analysis.totalArea : footprintM2;
  const target = ocrTotal > modelTotal * 0.5 ? ocrTotal : modelTotal;
  const ratio = Math.sqrt(target / footprintM2);
  if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 0.03) {
    return { analysis, ocrScaleConfidence: 0.5 };
  }

  const scaleMm = ratio;
  const rooms = analysis.rooms.map((room) => {
    const poly = (room.polygon ?? []).map(([x, y]) => [x * scaleMm, y * scaleMm] as [number, number]);
    return {
      ...room,
      polygon: poly,
      estimatedArea: Math.round((polygonArea(poly) / 1_000_000) * 10) / 10,
      dimensions: {
        ...room.dimensions,
        width: Math.round(room.dimensions.width * ratio * 10) / 10,
        depth: Math.round(room.dimensions.depth * ratio * 10) / 10,
      },
    };
  });

  const confidence = areaLabels.length >= 2 ? 0.85 : 0.65;
  return {
    analysis: {
      ...analysis,
      rooms,
      totalArea: Math.round(target * 10) / 10,
      imageFrame: analysis.imageFrame
        ? {
            width: analysis.imageFrame.width * scaleMm,
            height: analysis.imageFrame.height * scaleMm,
          }
        : undefined,
    },
    ocrScaleConfidence: confidence,
  };
}
