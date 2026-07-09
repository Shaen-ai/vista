import "server-only";

import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { withRetry } from "@/lib/aiRetry";
import { pipelineLog } from "@/lib/pipelineLog";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import {
  isValidationTimeoutError,
  VALIDATION_MAX_RETRIES,
  validationAbortSignal,
} from "@/lib/validationAiHelpers";
import {
  evaluatePlacementRules,
  type PlacementFurnitureBox,
  type PlacementFurnitureCategory,
  type PlacementRuleResult,
} from "@/lib/placementRules";

export type { PlacementFurnitureBox, PlacementRuleResult, PlacementViolation } from "@/lib/placementRules";
export {
  evaluatePlacementRules,
  countViolations,
  mergePlacementIntoValidation,
} from "@/lib/placementRules";

const VALID_CATEGORIES = new Set<PlacementFurnitureCategory>([
  "wardrobe",
  "bed",
  "sofa",
  "table",
  "desk",
  "chair",
  "mirror",
  "rug",
  "lighting",
  "decor",
  "other",
]);

/** Opt-out default — on when OPENAI_API_KEY is set unless VISTA_PLACEMENT_VALIDATE=0. */
export function isPlacementValidationEnabled(): boolean {
  if ((process.env.VISTA_PLACEMENT_VALIDATE || "").trim() === "0") return false;
  return !!getOpenAiApiKey();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function parseBox(raw: unknown): OpeningBox | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const w = Number(o.w);
  const h = Number(o.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (w <= 0 || h <= 0) return null;
  return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
}

function parseCategory(raw: unknown): PlacementFurnitureCategory {
  if (typeof raw === "string" && VALID_CATEGORIES.has(raw as PlacementFurnitureCategory)) {
    return raw as PlacementFurnitureCategory;
  }
  return "other";
}

export async function detectPlacementBoxes(opts: {
  renderedBase64: string;
  renderedMime: string;
  furnitureLabels: string[];
  label?: string;
}): Promise<PlacementFurnitureBox[]> {
  const openAiKey = getOpenAiApiKey();
  if (!openAiKey || opts.furnitureLabels.length === 0) return [];

  const list = opts.furnitureLabels.map((item, i) => `${i + 1}. ${item}`).join("\n");
  const content = [
    {
      type: "text",
      text:
        "You are analyzing an interior design render. For each listed furniture piece that is clearly visible, return a tight normalized bounding box.\n\n" +
        `EXPECTED FURNITURE:\n${list}\n\n` +
        "Coordinates use top-left origin, normalized 0–1 (x,y = top-left corner; w,h = width/height).\n" +
        "category must be one of: wardrobe, bed, sofa, table, desk, chair, mirror, rug, lighting, decor, other.\n" +
        "floorContact is true when the piece visibly rests on the floor (false for wall-mounted art, ceiling lights, or clearly floating items).\n" +
        'Respond JSON only: {"items":[{"label":string,"box":{"x":number,"y":number,"w":number,"h":number},"floorContact":boolean,"category":string}]}. ' +
        "Include only listed pieces that are clearly visible. Omit missing pieces.",
    },
    {
      type: "image_url",
      image_url: {
        url: `data:${opts.renderedMime};base64,${opts.renderedBase64}`,
        detail: "high",
      },
    },
  ];

  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = process.env.FLOOR_PLAN_ANALYSIS_MODEL || "gpt-5.5";

  try {
    const response = await withRetry(async () => {
      const res = await openAiFetch(
        apiUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content }],
            response_format: { type: "json_object" },
            max_completion_tokens: 2000,
          }),
          signal: validationAbortSignal(),
        },
        { vision: true },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Placement box detection failed (${res.status}): ${body.slice(0, 300)}`);
      }
      return res.json();
    }, opts.label ? `Placement boxes (${opts.label})` : "Placement boxes", VALIDATION_MAX_RETRIES);

    const text = response?.choices?.[0]?.message?.content;
    const finishReason = response?.choices?.[0]?.finish_reason;
    if (typeof text !== "string" || !text.trim()) {
      pipelineLog(
        "VALIDATE",
        "placement box detection empty content",
        { label: opts.label, finishReason: finishReason ?? "unknown" },
        "warn",
      );
      return [];
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      pipelineLog(
        "VALIDATE",
        "placement box detection JSON parse failed",
        {
          label: opts.label,
          finishReason: finishReason ?? "unknown",
          contentPreview: text.slice(0, 120),
          message: parseErr instanceof Error ? parseErr.message : String(parseErr),
        },
        "warn",
      );
      return [];
    }
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    const items: PlacementFurnitureBox[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") continue;
      const label = typeof raw.label === "string" ? raw.label.trim() : "";
      const box = parseBox(raw.box);
      if (!label || !box) continue;
      items.push({
        label,
        box,
        floorContact: raw.floorContact !== false,
        category: parseCategory(raw.category),
      });
    }

    pipelineLog("VALIDATE", "placement boxes detected", {
      label: opts.label,
      expected: opts.furnitureLabels.length,
      detected: items.length,
      items: items.slice(0, 8).map((i) => ({ label: i.label, category: i.category, floorContact: i.floorContact })),
    });
    return items;
  } catch (err) {
    if (isValidationTimeoutError(err)) {
      pipelineLog(
        "VALIDATE",
        "placement box detection timed out — skipping",
        { label: opts.label, deadlineMs: 90_000 },
        "warn",
      );
      return [];
    }
    pipelineLog(
      "VALIDATE",
      "placement box detection error",
      { label: opts.label, message: err instanceof Error ? err.message.slice(0, 200) : String(err) },
      "warn",
    );
    return [];
  }
}

export async function validatePlacement(opts: {
  renderedBase64: string;
  renderedMime: string;
  doorBoxes?: OpeningBox[];
  windowBoxes?: OpeningBox[];
  furnitureLabels: string[];
  label?: string;
}): Promise<PlacementRuleResult & { items: PlacementFurnitureBox[]; skipped: boolean }> {
  if (!isPlacementValidationEnabled()) {
    return {
      pass: true,
      violations: [],
      correctiveFeedback: "",
      items: [],
      skipped: true,
    };
  }

  const items = await detectPlacementBoxes({
    renderedBase64: opts.renderedBase64,
    renderedMime: opts.renderedMime,
    furnitureLabels: opts.furnitureLabels,
    label: opts.label,
  });

  if (items.length === 0) {
    pipelineLog("VALIDATE", "placement validation skipped — no boxes detected", { label: opts.label }, "warn");
    return {
      pass: true,
      violations: [],
      correctiveFeedback: "",
      items: [],
      skipped: true,
    };
  }

  const result = evaluatePlacementRules({
    items,
    doorBoxes: opts.doorBoxes,
    windowBoxes: opts.windowBoxes,
  });

  pipelineLog(
    "VALIDATE",
    "placement validation",
    {
      label: opts.label,
      pass: result.pass,
      violationCount: result.violations.length,
      violations: result.violations.slice(0, 6).map((v) => ({ type: v.type, label: v.label })),
      reason: result.correctiveFeedback.slice(0, 200),
    },
    result.pass ? "info" : "warn",
  );

  return { ...result, items, skipped: false };
}

/** Build human-readable furniture labels for placement checks. */
export function buildFurnitureLabels(opts: {
  furnitureList?: string[];
  catalogNames?: string[];
  requiredSlots?: Array<{ subtype?: string; family?: string; placement?: string; quantity?: number }>;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const label = raw.trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(label);
  };

  for (const item of opts.furnitureList ?? []) add(item);
  for (const name of opts.catalogNames ?? []) add(name);
  for (const slot of opts.requiredSlots ?? []) {
    const subtype = typeof slot.subtype === "string" ? slot.subtype.trim() : "";
    const family = typeof slot.family === "string" ? slot.family.trim() : "";
    const placement = typeof slot.placement === "string" ? slot.placement.trim() : "";
    const qty = typeof slot.quantity === "number" && slot.quantity > 1 ? slot.quantity : 1;
    const base = subtype || family;
    if (!base || base === "flooring" || base === "walls" || base === "window_treatments") continue;
    for (let i = 0; i < qty; i++) {
      add(placement ? `${base} (${placement})` : base);
    }
  }

  return out.slice(0, 16);
}

export async function acceptRenderWithPlacementRetry<T extends { base64: string; mimeType: string }>(opts: {
  image: T;
  retryRender: (correctiveFeedback: string) => Promise<T | null>;
  doorBoxes?: OpeningBox[];
  windowBoxes?: OpeningBox[];
  furnitureLabels: string[];
  label?: string;
}): Promise<{ image: T; placement: PlacementRuleResult & { items: PlacementFurnitureBox[]; skipped: boolean } }> {
  const initial = await validatePlacement({
    renderedBase64: opts.image.base64,
    renderedMime: opts.image.mimeType,
    doorBoxes: opts.doorBoxes,
    windowBoxes: opts.windowBoxes,
    furnitureLabels: opts.furnitureLabels,
    label: opts.label,
  });

  if (initial.pass || initial.skipped || !initial.correctiveFeedback.trim()) {
    return { image: opts.image, placement: initial };
  }

  const retried = await opts.retryRender(initial.correctiveFeedback);
  if (!retried) {
    return { image: opts.image, placement: initial };
  }

  const recheck = await validatePlacement({
    renderedBase64: retried.base64,
    renderedMime: retried.mimeType,
    doorBoxes: opts.doorBoxes,
    windowBoxes: opts.windowBoxes,
    furnitureLabels: opts.furnitureLabels,
    label: opts.label ? `${opts.label}-retry` : "retry",
  });

  const initialCount = initial.violations.length;
  const retryCount = recheck.violations.length;

  if (recheck.pass || (retryCount < initialCount && !recheck.skipped)) {
    pipelineLog("VALIDATE", "placement retry accepted", {
      label: opts.label,
      initialViolations: initialCount,
      retryViolations: retryCount,
    });
    return { image: retried, placement: recheck };
  }

  pipelineLog("VALIDATE", "placement retry rejected — keeping original", {
    label: opts.label,
    initialViolations: initialCount,
    retryViolations: retryCount,
  }, "warn");
  return { image: opts.image, placement: initial };
}
