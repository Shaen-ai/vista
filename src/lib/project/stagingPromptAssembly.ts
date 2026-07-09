import {
  STAGING_PROMPT_MAX_CHARS,
  buildFinishLockFromPlan,
  clampStagingPrompt,
  deriveFurnitureLayoutLockFallback,
} from "./stagingConceptParse";
import type { RoomFinishLock, RoomRenderPlan } from "./types";
import type { StagingLayerRenderer, StagingLayerKind } from "./stagingLayerRouter";

/** Claude director + legacy single-pass staging prompts. */
export { STAGING_PROMPT_MAX_CHARS };

/** Layered shell/furnish passes — full layout/finish text must fit. */
export const LAYERED_STAGING_PROMPT_MAX_CHARS = 400;

const LAYERED_GEOMETRY_PREFIX =
  "Keep all walls, doors, windows, ceiling from input photo unchanged.";

export interface AssembleStagingPromptInput {
  openingLock?: string;
  body: string;
  editFeedback?: string;
  maxChars?: number;
  /** When false, openingLock is ignored (flux path — mask protects openings). */
  includeOpeningLock?: boolean;
}

/**
 * Reserve opening-lock text first; truncate body (and edit) to fit the budget.
 * Prevents "Keep all walls, doors, windows…" from being dropped when body is 220 chars.
 */
export function assembleStagingPrompt(input: AssembleStagingPromptInput): string {
  const maxChars = input.maxChars ?? STAGING_PROMPT_MAX_CHARS;
  const includeOpening = input.includeOpeningLock !== false;
  const opening = includeOpening ? (input.openingLock?.replace(/\s+/g, " ").trim() ?? "") : "";
  const edit = input.editFeedback?.replace(/\s+/g, " ").trim() ?? "";
  const body = input.body.replace(/\s+/g, " ").trim();

  const prefixParts = [opening, edit].filter(Boolean);
  const prefix = prefixParts.join(" ");
  const sep = prefix && body ? " " : "";
  const combined = `${prefix}${sep}${body}`.trim();

  if (combined.length <= maxChars) return combined;

  const reserved = prefix.length + (prefix && body ? 1 : 0);
  const bodyBudget = Math.max(0, maxChars - reserved);
  let trimmedBody = body;
  if (bodyBudget <= 0) {
    trimmedBody = "";
  } else if (body.length > bodyBudget) {
    trimmedBody =
      bodyBudget <= 1
        ? body.slice(0, bodyBudget)
        : body.slice(0, bodyBudget - 1).trimEnd() + "…";
  }

  const out = [opening, edit, trimmedBody].filter(Boolean).join(" ").trim();
  return out.length <= maxChars ? out : clampStagingPrompt(out);
}

export interface AssembleLayeredStagingPromptInput {
  layer: StagingLayerKind;
  renderer: StagingLayerRenderer;
  /** Long per-photo lock from director — unused on flux path. */
  openingLock?: string;
  body: string;
  editFeedback?: string;
}

/**
 * Layered passes: flux uses opening-freeze mask only (no long opening-lock text).
 * Apartment-staging gets compact geometry prefix only.
 */
export function assembleLayeredStagingPrompt(input: AssembleLayeredStagingPromptInput): string {
  const openingLock =
    input.renderer === "apartment-staging" ? LAYERED_GEOMETRY_PREFIX : undefined;

  let body = input.body.replace(/\s+/g, " ").trim();
  if (input.renderer === "flux-opening-freeze" && input.layer === "furnish") {
    const hint = "Keep door opening visible.";
    if (!body.toLowerCase().includes("door opening")) {
      body = `${body} ${hint}`.trim();
    }
  }

  return assembleStagingPrompt({
    openingLock,
    body,
    editFeedback: input.editFeedback,
    maxChars: LAYERED_STAGING_PROMPT_MAX_CHARS,
    includeOpeningLock: input.renderer === "apartment-staging",
  });
}

function buildCompactFinishLine(finishLock: RoomFinishLock): string {
  return [finishLock.wallColor, finishLock.floorMaterial, finishLock.ceilingDesign]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
}

/** Layer 2 — finishes only, no furniture. */
export function buildShellStagingPrompt(plan: RoomRenderPlan): string {
  const finishLock = buildFinishLockFromPlan(plan);
  const finishLine = buildCompactFinishLine(finishLock);
  const lighting = finishLock.lightingConcept?.trim();
  const lightingBit = lighting ? ` ${lighting}.` : "";
  return `${finishLine}.${lightingBit} Empty room. No furniture. Photorealistic.`.replace(/\s+/g, " ").trim();
}

/** Layer 3 — furniture placement only (layout lock + camera subset). */
export function buildFurnitureStagingPrompt(
  plan: RoomRenderPlan,
  photoId: string,
  cameraNote?: string | null,
): string {
  const layoutLock =
    plan.furnitureLayoutLock?.trim() || deriveFurnitureLayoutLockFallback(plan);
  const perPhoto = plan.photoPrompts?.find((p) => p.photoId === photoId);
  const camera = cameraNote?.trim() || perPhoto?.cameraNote?.trim();
  const visibleSubset = camera ? `Visible: ${camera.slice(0, 120)}.` : "";
  const lockPart = layoutLock ? `${layoutLock}.` : "";
  return `${lockPart} ${visibleSubset} Freestanding furniture only.`
    .replace(/\s+/g, " ")
    .trim();
}
