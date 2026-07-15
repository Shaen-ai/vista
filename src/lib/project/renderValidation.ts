import "server-only";

import { getOpenAiApiKey } from "@/lib/serverAiKeys";
import { openAiFetch } from "@/lib/openAiFetch";
import { withRetry } from "@/lib/aiRetry";
import { pipelineLog, pipelineTimed } from "@/lib/pipelineLog";
import { logPipelineStage } from "@/lib/project/pipelineStageLog";
import { validateOpenings } from "@/lib/validateOpenings";
import { buildOpeningValidationContext } from "@/lib/openingValidationContext";
import { mergePlacementIntoValidation, validatePlacement } from "@/lib/placementBoxes";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";
import type { DetectedRoom } from "@/lib/project/types";
import type { ViewpointFraming } from "@/lib/project/viewpointFraming";
import { framingVisibleOpenings } from "@/lib/project/viewpointFraming";
import {
  formatHeroMasterAnalysis,
  type HeroMasterAnalysis,
} from "./heroPlacementMap";
import {
  getValidateModel,
  prepareValidationImages,
} from "@/lib/validationImageHelpers";
import {
  isValidationTimeoutError,
  VALIDATION_MAX_RETRIES,
  validationAbortSignal,
} from "@/lib/validationAiHelpers";

export type ValidationCheck = "judge" | "openings" | "placement";

export interface RenderValidationInput {
  mode: "master" | "secondary";
  originalBase64: string;
  originalMime: string;
  renderedBase64: string;
  renderedMime: string;
  windowBoxes?: OpeningBox[];
  doorBoxes?: OpeningBox[];
  detectedRoom?: DetectedRoom | null;
  framing?: ViewpointFraming | null;
  hadRemovalMask?: boolean;
  heroBase64?: string;
  heroMime?: string;
  projectId?: string;
  roomId?: string;
  photoId?: string;
  label?: string;
  /** Furniture labels for deterministic placement validation. */
  furnitureLabels?: string[];
  /** When set, run only these checks (used on validation retries). */
  onlyChecks?: ValidationCheck[];
  /** Master judge: also extract furniture placement + decor lock for secondary views. */
  extractHeroAnalysis?: boolean;
  heroFraming?: ViewpointFraming | null;
  expectedFurnitureList?: string[];
}

export interface RenderValidationResult {
  pass: boolean;
  reason: string;
  correctiveFeedback?: string;
  failureTypes: string[];
  failedChecks?: ValidationCheck[];
  heroAnalysis?: HeroMasterAnalysis;
}

export function isRenderValidationEnabled(): boolean {
  const raw = (process.env.VISTA_RENDER_VALIDATE ?? "").trim();
  if (raw === "0") return false;
  if (raw === "1") return true;
  return !!getOpenAiApiKey();
}

function shouldRunCheck(check: ValidationCheck, onlyChecks?: ValidationCheck[]): boolean {
  if (!onlyChecks?.length) return true;
  return onlyChecks.includes(check);
}

function compassWallLabel(wall: string | null | undefined, fallback: string): string {
  return wall ? `${wall.toUpperCase()} wall` : fallback;
}

function buildHeroExtractionInstructions(input: RenderValidationInput): string {
  if (!input.extractHeroAnalysis || input.mode !== "master") return "";
  const ahead = compassWallLabel(input.heroFraming?.aheadWall, "wall ahead of the camera");
  const left = compassWallLabel(input.heroFraming?.leftWall, "wall on the camera's left");
  const right = compassWallLabel(input.heroFraming?.rightWall, "wall on the camera's right");
  const expectedPieces = (input.expectedFurnitureList ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .join(", ");
  return (
    ' Also include "placements": string[] listing every visible furniture piece in the SECOND (render) image with wall position ' +
    `(labels: ahead=${ahead}, left=${left}, right=${right}) and immediate neighbors; and "decor": string[] listing every visible decor item with enough detail to reproduce in another camera angle.` +
    (expectedPieces ? ` Planned pieces: ${expectedPieces}.` : "") +
    " Use empty arrays when none visible."
  );
}

async function runRenderJudgeValidation(
  input: RenderValidationInput,
  images: Awaited<ReturnType<typeof prepareValidationImages>>,
): Promise<RenderValidationResult | null> {
  const openAiKey = getOpenAiApiKey();
  if (!openAiKey) return null;

  const modeInstructions =
    input.mode === "master"
      ? [
          "Judge whether the SECOND image is a valid interior redesign of the FIRST.",
          input.hadRemovalMask
            ? "The user marked furniture/objects for removal — they must NOT appear in the render."
            : "",
          "Room walls, ceiling plane, and floor plane must match the original geometry.",
          "Ceiling must remain a single flat plane — no new soffits, tray steps, coves, bulkheads, coffered panels, or beams.",
          "Walls must remain flat — no new paneling, niches, recesses, or built-in light channels.",
          "Interior design (furniture, surface finishes, decor) should be present and coherent.",
          "Every door and doorway in the SECOND image must exist in the FIRST image at the same wall position. A door present in the render but absent in the original photo is a failure (added_opening); correctiveFeedback must name which wall the invented door is on and instruct removing it and restoring a solid wall.",
          "A door opening that exists in the FIRST image but is rendered as a bare, empty, or gray recess without a visible door leaf and frame is a failure (door_unfinished); correctiveFeedback must say to render a finished closed door in that opening.",
        ].filter(Boolean).join(" ")
      : [
          "FIRST image: original photo from a secondary camera angle of the room.",
          "SECOND image: redesigned render from that angle.",
          "THIRD image (if present): approved master design from the primary angle.",
          "The render must match the FIRST image's camera angle and wall/opening layout exactly — same walls, same windows, same door openings, same columns and structural posts, same perspective.",
          "If the render's camera angle and composition match the THIRD image (master design) instead of the FIRST image — i.e. it is essentially the master design re-rendered rather than a redesign of the FIRST image's photo — fail with failureType hero_copy; correctiveFeedback must say to discard the THIRD image's camera and composition entirely and re-render from the FIRST image's exact camera angle.",
          "Door openings, windows, and columns must appear on the SAME screen side as in the FIRST image. A horizontally mirrored room layout (door or column flipped to the opposite side) is a geometry_drift failure.",
          "Any window, door, or wall that is visible only in the THIRD image (master design) but not in the FIRST image appearing in the render is a failure (added_opening / geometry_drift).",
          "Furniture, flooring, ceiling, and wall finishes must match the master design in consistent positions.",
          "Do not move the sofa or major pieces to different walls between views.",
          "The rug (shape, color, pattern), cushions, wall art (count and subjects), and curtains must be the same items as in the THIRD image (master). If any decorative item is a different design, fail with failureType decor_inconsistent and in correctiveFeedback name each drifted item and describe the correct one from the master.",
          "If any furniture piece sits on a different wall or has different neighbors than in the THIRD image (master), fail with failureType furniture_inconsistent, and in correctiveFeedback NAME each misplaced piece and state exactly where it must go — which wall and which piece it must be adjacent to (e.g. 'Move the wardrobe back to the wall on the right of the bench; keep the bench immediately left of the wardrobe.').",
          "A door opening rendered as a bare, empty, or gray recess without a visible door leaf and frame is a failure (door_unfinished); correctiveFeedback must say to render a finished closed door in that opening.",
        ].join(" ");

  const heroFields = input.extractHeroAnalysis && input.mode === "master" ? ', "placements": string[], "decor": string[]' : "";
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        `${modeInstructions}${buildHeroExtractionInstructions(input)} ` +
        `Respond JSON only: {"pass": boolean, "reason": string, "failureTypes": string[], "correctiveFeedback": string${heroFields}}. ` +
        "failureTypes may include: geometry_drift, removal_failed, no_design, furniture_inconsistent, decor_inconsistent, added_opening, ceiling_remodeled, wall_remodeled, door_unfinished, hero_copy, blocked_door, object_overlap, wall_clip, floating_object.",
    },
    {
      type: "image_url",
      image_url: {
        url: `data:${images.original.mime};base64,${images.original.base64}`,
        detail: "high",
      },
    },
    {
      type: "image_url",
      image_url: {
        url: `data:${images.rendered.mime};base64,${images.rendered.base64}`,
        detail: "high",
      },
    },
  ];

  if (input.mode === "secondary" && images.hero) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${images.hero.mime};base64,${images.hero.base64}`,
        detail: "high",
      },
    });
  }

  const apiUrl = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
  const model = getValidateModel();
  const judgeLabel = input.label ? `render judge (${input.label})` : `render judge (${input.mode})`;

  const response = await withRetry(
    async () => {
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
            messages: [{ role: "user", content }],
            response_format: { type: "json_object" },
            max_completion_tokens: 4000,
          }),
          signal: validationAbortSignal(),
        },
        { vision: true },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Render validation failed (${res.status}): ${body.slice(0, 300)}`);
      }
      return res.json();
    },
    judgeLabel,
    VALIDATION_MAX_RETRIES,
  );

  const text = response?.choices?.[0]?.message?.content;
  const finishReason = response?.choices?.[0]?.finish_reason;
  if (typeof text !== "string" || !text.trim()) {
    pipelineLog(
      "VALIDATE",
      "render validation empty content",
      {
        mode: input.mode,
        finishReason: finishReason ?? "unknown",
        photoId: input.photoId,
      },
      "warn",
    );
    return { pass: true, reason: "validation empty response", failureTypes: [] };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch (parseErr) {
    pipelineLog(
      "VALIDATE",
      "render validation JSON parse failed",
      {
        mode: input.mode,
        finishReason: finishReason ?? "unknown",
        contentPreview: text.slice(0, 120),
        message: parseErr instanceof Error ? parseErr.message : String(parseErr),
      },
      "warn",
    );
    return { pass: true, reason: "validation parse failed", failureTypes: [] };
  }

  const pass = parsed?.pass === true;
  const reason = typeof parsed?.reason === "string" ? parsed.reason : "";
  const failureTypes = Array.isArray(parsed?.failureTypes)
    ? parsed.failureTypes.filter((x: unknown) => typeof x === "string")
    : [];
  const correctiveFeedback =
    typeof parsed?.correctiveFeedback === "string" ? parsed.correctiveFeedback : undefined;

  let heroAnalysis: HeroMasterAnalysis | undefined;
  if (input.extractHeroAnalysis && input.mode === "master" && pass) {
    const placements = Array.isArray(parsed?.placements)
      ? parsed.placements.filter((p): p is string => typeof p === "string" && !!p.trim())
      : [];
    const decor = Array.isArray(parsed?.decor)
      ? parsed.decor.filter((d): d is string => typeof d === "string" && !!d.trim())
      : [];
    if (placements.length > 0 || decor.length > 0) {
      heroAnalysis = formatHeroMasterAnalysis(placements, decor);
    }
  }

  return { pass, reason, correctiveFeedback, failureTypes, heroAnalysis };
}

export async function validateProjectRender(
  input: RenderValidationInput,
): Promise<RenderValidationResult> {
  const start = Date.now();
  const fail = (reason: string, failureTypes: string[], correctiveFeedback?: string): RenderValidationResult => ({
    pass: false,
    reason,
    failureTypes,
    correctiveFeedback,
  });

  if (!isRenderValidationEnabled()) {
    return { pass: true, reason: "validation skipped", failureTypes: [] };
  }

  const validationImages = await prepareValidationImages({
    originalBase64: input.originalBase64,
    originalMime: input.originalMime,
    renderedBase64: input.renderedBase64,
    renderedMime: input.renderedMime,
    heroBase64: input.heroBase64,
    heroMime: input.heroMime,
  });

  const openingContext = buildOpeningValidationContext({
    visibleOpenings: input.framing ? framingVisibleOpenings(input.framing) : null,
    detectedRoom: input.detectedRoom ?? null,
    framing: input.framing ?? null,
  });

  const hasOpeningBoxes =
    (input.windowBoxes?.length ?? 0) > 0 || (input.doorBoxes?.length ?? 0) > 0;
  const furnitureLabels = (input.furnitureLabels ?? []).filter((x) => x.trim());
  const openAiKey = getOpenAiApiKey();
  const runOpenings = hasOpeningBoxes && shouldRunCheck("openings", input.onlyChecks);
  const runPlacement =
    furnitureLabels.length > 0 && shouldRunCheck("placement", input.onlyChecks);
  const runJudge = shouldRunCheck("judge", input.onlyChecks);

  const openingPromise = runOpenings
    ? validateOpenings({
        originalBase64: validationImages.original.base64,
        originalMime: validationImages.original.mime,
        renderedBase64: validationImages.rendered.base64,
        renderedMime: validationImages.rendered.mime,
        windowBoxes: input.windowBoxes,
        doorBoxes: input.doorBoxes,
        openingContext,
        label: input.label ?? input.mode,
      })
    : Promise.resolve(null);

  const placementPromise = runPlacement
    ? validatePlacement({
        renderedBase64: validationImages.rendered.base64,
        renderedMime: validationImages.rendered.mime,
        doorBoxes: input.doorBoxes,
        windowBoxes: input.windowBoxes,
        furnitureLabels,
        label: input.label ? `${input.label}-placement` : `${input.mode}-placement`,
      })
    : Promise.resolve(null);

  const judgePromise =
    openAiKey && runJudge
      ? pipelineTimed(
          "VALIDATE",
          input.label ? `render judge (${input.label})` : `render judge (${input.mode})`,
          () => runRenderJudgeValidation(input, validationImages),
          {
            meta: {
              mode: input.mode,
              photoId: input.photoId,
              projectId: input.projectId,
              roomId: input.roomId,
            },
          },
        ).catch((err) => {
        if (isValidationTimeoutError(err)) {
          pipelineLog(
            "VALIDATE",
            "render judge timed out — skipping",
            {
              mode: input.mode,
              photoId: input.photoId,
              deadlineMs: 90_000,
            },
            "warn",
          );
          return { pass: true, reason: "validation timed out", failureTypes: [] } as RenderValidationResult;
        }
        pipelineLog(
          "VALIDATE",
          "render validation error",
          {
            mode: input.mode,
            message: err instanceof Error ? err.message.slice(0, 200) : String(err),
          },
          "warn",
        );
        return { pass: true, reason: "validation unavailable", failureTypes: [] } as RenderValidationResult;
      })
    : Promise.resolve(null);

  let openingCheck: Awaited<ReturnType<typeof validateOpenings>> | null = null;
  let placementResult: Awaited<ReturnType<typeof validatePlacement>> | null = null;
  let judgeResult: RenderValidationResult | null = null;

  try {
    [openingCheck, placementResult, judgeResult] = await Promise.all([
      openingPromise,
      placementPromise,
      judgePromise,
    ]);
  } catch (err) {
    if (isValidationTimeoutError(err)) {
      pipelineLog(
        "VALIDATE",
        "render validation timed out — skipping",
        { mode: input.mode, photoId: input.photoId, deadlineMs: 90_000 },
        "warn",
      );
      return { pass: true, reason: "validation timed out", failureTypes: [] };
    }
    pipelineLog(
      "VALIDATE",
      "render validation error",
      {
        mode: input.mode,
        message: err instanceof Error ? err.message.slice(0, 200) : String(err),
      },
      "warn",
    );
    return { pass: true, reason: "validation unavailable", failureTypes: [] };
  }

  if (openingCheck && !openingCheck.match) {
    const corrective = `Fix structural drift: ${openingCheck.reason}. Do not add, remove, or move doors or windows.`;
    logPipelineStage({
      projectId: input.projectId ?? "unknown",
      roomId: input.roomId ?? "unknown",
      photoId: input.photoId,
      stage: "validate",
      ok: false,
      ms: Date.now() - start,
      errorCode: openingCheck.failureType,
      extra: { mode: input.mode, reason: openingCheck.reason.slice(0, 200) },
    });
    return { ...fail(openingCheck.reason, [openingCheck.failureType], corrective), failedChecks: ["openings"] };
  }

  if (!openAiKey) {
    if (placementResult && !placementResult.skipped && !placementResult.pass) {
      return {
        ...fail(
          placementResult.violations.map((v) => v.detail).join(" "),
          placementResult.violations.map((v) => v.type),
          placementResult.correctiveFeedback,
        ),
        failedChecks: ["placement"],
      };
    }
    return { pass: true, reason: "extended validation skipped (no key)", failureTypes: [] };
  }

  if (!judgeResult) {
    if (placementResult && !placementResult.skipped && !placementResult.pass) {
      return {
        ...fail(
          placementResult.violations.map((v) => v.detail).join(" "),
          placementResult.violations.map((v) => v.type),
          placementResult.correctiveFeedback,
        ),
        failedChecks: ["placement"],
      };
    }
    return { pass: true, reason: "extended validation skipped (no key)", failureTypes: [] };
  }

  let result: RenderValidationResult = judgeResult;

  if (placementResult && !placementResult.skipped) {
    result = mergePlacementIntoValidation(result, placementResult);
  }

  if (!result.pass) {
    const failedChecks: ValidationCheck[] = [];
    if (!judgeResult.pass) failedChecks.push("judge");
    if (placementResult && !placementResult.skipped && !placementResult.pass) {
      failedChecks.push("placement");
    }
    result = { ...result, failedChecks: failedChecks.length > 0 ? failedChecks : ["judge"] };
  }

  logPipelineStage({
    projectId: input.projectId ?? "unknown",
    roomId: input.roomId ?? "unknown",
    photoId: input.photoId,
    stage: "validate",
    ok: result.pass,
    ms: Date.now() - start,
    extra: { mode: input.mode, reason: result.reason.slice(0, 200), failureTypes: result.failureTypes },
  });

  pipelineLog(
    "VALIDATE",
    `render validation ${input.mode}`,
    {
      pass: result.pass,
      reason: result.reason.slice(0, 200),
      failureTypes: result.failureTypes,
      photoId: input.photoId,
    },
    result.pass ? "info" : "warn",
  );

  return result;
}
