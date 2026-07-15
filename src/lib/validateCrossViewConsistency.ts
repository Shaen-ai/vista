import "server-only";

import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { withRetry } from "@/lib/aiRetry";
import { pipelineLog } from "@/lib/pipelineLog";
import { getValidateModel, optimizeBase64ForValidation } from "@/lib/validationImageHelpers";
import {
  crossViewRetryScore,
  parseCrossViewValidationJson,
  skippedCrossViewResult,
  type CrossViewConsistencyResult,
} from "@/lib/crossViewValidationParse";

export type { CrossViewConsistencyResult } from "@/lib/crossViewValidationParse";
export {
  SECONDARY_LAYOUT_LOCK,
  SECONDARY_LAYOUT_LOCK_COMPACT,
  appendSecondaryLayoutLock,
} from "@/lib/secondaryLayoutLock";

/** Opt-out default — on when OPENAI_API_KEY is set unless VISTA_FAL_VALIDATE_CROSS_VIEW=0. */
export function isCrossViewValidationEnabled(): boolean {
  if ((process.env.VISTA_FAL_VALIDATE_CROSS_VIEW || "").trim() === "0") return false;
  return !!getOpenAiApiKey();
}

export async function validateCrossViewConsistency(opts: {
  heroBase64: string;
  heroMime: string;
  secondaryBase64: string;
  secondaryMime: string;
  furnitureLabels: string[];
  label?: string;
}): Promise<CrossViewConsistencyResult> {
  const openAiKey = getOpenAiApiKey();
  if (!isCrossViewValidationEnabled() || !openAiKey || opts.furnitureLabels.length === 0) {
    return skippedCrossViewResult("validation skipped");
  }

  const list = opts.furnitureLabels.map((item, i) => `${i + 1}. ${item}`).join("\n");
  const [heroImage, secondaryImage] = await Promise.all([
    optimizeBase64ForValidation(opts.heroBase64, opts.heroMime),
    optimizeBase64ForValidation(opts.secondaryBase64, opts.secondaryMime),
  ]);

  const content = [
    {
      type: "text",
      text:
        "You compare two interior design renders of the SAME room from different camera angles.\n\n" +
        "FIRST image: approved hero/master design (primary camera).\n" +
        "SECOND image: secondary viewpoint render from a different camera.\n\n" +
        `EXPECTED FURNITURE:\n${list}\n\n` +
        "For each major listed piece visible in BOTH images, check:\n" +
        "(a) Same product identity — shape, proportions, color, style (not a substitute).\n" +
        "(b) Same wall placement relative to fixed landmarks (window, door) — piece must stay on the same compass wall, not teleported or mirrored.\n\n" +
        "Fail if wardrobe, bed, desk, chair, or other major piece is on a different wall, is a clearly different product, or is missing from the secondary when visible in hero.\n" +
        'Respond JSON only: {"match": boolean, "mismatches": string[], "correctiveFeedback": string}. ' +
        "match is true only when placement AND product identity agree for all major listed pieces. " +
        "correctiveFeedback must be prompt-ready English (e.g. 'Move the wardrobe to the wall left of the window as in the reference; use the same cream desk chair, not a dark office chair.').",
    },
    {
      type: "image_url",
      image_url: {
        url: `data:${heroImage.mime};base64,${heroImage.base64}`,
        detail: "high",
      },
    },
    {
      type: "image_url",
      image_url: {
        url: `data:${secondaryImage.mime};base64,${secondaryImage.base64}`,
        detail: "high",
      },
    },
  ];

  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = getValidateModel();

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
            max_completion_tokens: 1500,
          }),
        },
        { vision: true },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Cross-view validation failed (${res.status}): ${body.slice(0, 300)}`);
      }
      return res.json();
    }, "Cross-view consistency validation");

    const text = response?.choices?.[0]?.message?.content;
    const parsed = typeof text === "string" ? JSON.parse(text) : {};
    const result = parseCrossViewValidationJson(parsed, opts.furnitureLabels);

    pipelineLog("VALIDATE", "cross-view consistency", {
      label: opts.label,
      match: result.match,
      mismatches: result.mismatches.slice(0, 8),
      correctivePreview: result.correctiveFeedback.slice(0, 200),
    });

    return result;
  } catch (err) {
    pipelineLog(
      "VALIDATE",
      "cross-view consistency error",
      { label: opts.label, message: err instanceof Error ? err.message.slice(0, 200) : String(err) },
      "warn",
    );
    return skippedCrossViewResult("validation unavailable");
  }
}

export async function acceptSecondaryWithCrossViewRetry<T extends { base64: string; mimeType: string }>(opts: {
  image: T;
  heroBase64: string;
  heroMime: string;
  furnitureLabels: string[];
  retryRender: (correctiveFeedback: string) => Promise<T | null>;
  label?: string;
}): Promise<{ image: T; crossView: CrossViewConsistencyResult }> {
  const initial = await validateCrossViewConsistency({
    heroBase64: opts.heroBase64,
    heroMime: opts.heroMime,
    secondaryBase64: opts.image.base64,
    secondaryMime: opts.image.mimeType,
    furnitureLabels: opts.furnitureLabels,
    label: opts.label,
  });

  if (initial.skipped || initial.match || !initial.correctiveFeedback.trim()) {
    return { image: opts.image, crossView: initial };
  }

  const retried = await opts.retryRender(initial.correctiveFeedback);
  if (!retried) {
    return { image: opts.image, crossView: initial };
  }

  const recheck = await validateCrossViewConsistency({
    heroBase64: opts.heroBase64,
    heroMime: opts.heroMime,
    secondaryBase64: retried.base64,
    secondaryMime: retried.mimeType,
    furnitureLabels: opts.furnitureLabels,
    label: opts.label ? `${opts.label}-retry` : "cross-view-retry",
  });

  const initialScore = crossViewRetryScore(initial);
  const retryScore = crossViewRetryScore(recheck);

  if (recheck.match || (retryScore > initialScore && !recheck.skipped)) {
    pipelineLog("VALIDATE", "cross-view retry accepted", {
      label: opts.label,
      initialMismatches: initial.mismatches.length,
      retryMismatches: recheck.mismatches.length,
    });
    return { image: retried, crossView: recheck };
  }

  pipelineLog(
    "VALIDATE",
    "cross-view retry rejected — keeping original",
    {
      label: opts.label,
      initialMismatches: initial.mismatches.length,
      retryMismatches: recheck.mismatches.length,
    },
    "warn",
  );
  return { image: opts.image, crossView: initial };
}
