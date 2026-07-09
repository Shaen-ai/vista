import type {
  DetectedRoom,
  PhotoViewpoint,
  ProjectState,
  RoomRenderPlan,
} from "./types";
import { buildFinishLockFromPlan, deriveFurnitureLayoutLockFallback } from "./stagingConceptParse";
import { buildFinishLockSnippet } from "./stagingConceptParse";
import {
  areViewpointsRoughlyOpposite,
  buildViewpointTransferDirective,
  framingVisibleOpenings,
  resolveViewpointFraming,
  type ViewpointFraming,
} from "./viewpointFraming";
import { getRoomPhotos } from "./types";

export interface SecondaryRenderViewpointContext {
  photoId?: string;
  heroViewpoint?: PhotoViewpoint;
  secondaryViewpoint?: PhotoViewpoint;
  detectedRoom?: DetectedRoom;
  /** Per-piece wall/adjacency map observed in the master render (see heroPlacementMap.ts). */
  heroPlacementMap?: string;
  /** Decor identity lock (rug, pillows, wall art, etc.) observed in the master render. */
  heroDecorLock?: string;
  /**
   * False when the render call sends ONLY the secondary photo (no hero render
   * as second image) — the hero-copy escalation path. The prompt then must not
   * reference a "SECOND image"; the master design is carried by text only.
   */
  heroImageAttached?: boolean;
}

export const MASTER_STYLE_REF_IMAGE_ROLES = [
  "IMAGE ROLES: The FIRST image is the real photo of this room — it is the ONLY authority for geometry: walls, ceiling, floor, door and window openings, camera angle, and composition. The SECOND image is the user's style inspiration photo — copy its color palette, materials, furniture character, decor density, textures, and lighting mood.",
  "Do NOT copy the second image's room shape, layout, openings, or camera — geometry comes exclusively from the first image.",
].join(" ");

const SECONDARY_IMAGE_ROLES = [
  "IMAGE ROLES: The FIRST image is the real photo of this room from THIS camera angle — it is the ONLY authority for geometry: walls, ceiling, floor, door and window openings, camera angle, and composition. The SECOND image is the approved master design of the SAME physical room from a DIFFERENT camera angle — use it ONLY as a reference for furniture identity, finishes, materials, and palette.",
  "Decorative items — rug, cushions, wall art, curtains, plants — must be the identical items from the master design, not similar alternatives.",
  "Do NOT reproduce walls, openings, or composition from the second image. Openings and walls not visible in the first image must NOT appear in the output.",
].join(" ");

const SECONDARY_TEXT_ONLY_ROLES = [
  "IMAGE ROLES: Only ONE image is provided — the real photo of this room from THIS camera angle. It is the ONLY authority for geometry: walls, ceiling, floor, door and window openings, camera angle, and composition; keep all of them exactly as photographed.",
  "Recreate the approved master design described in the text below inside this exact geometry: the same furniture pieces, finishes, materials, and palette.",
  "Decorative items — rug, cushions, wall art, curtains, plants — must be the identical items from the master design, not similar alternatives.",
].join(" ");

const PRESERVE_PREFIX =
  "PRESERVE: Keep the exact room geometry — all walls, ceiling height, floor plane, doors, windows, columns, and structural posts unchanged. Do not add, remove, move, or resize any architectural openings or structural elements. Keep the camera angle and perspective identical. Keep the ceiling a single flat plane exactly as in the photo; do not add soffits, bulkheads, tray or cove steps, coffered panels, or beams. Keep all walls flat; do not add paneling, niches, recesses, or built-in light channels.";

const DOOR_FINISH_SENTENCE =
  "DOORS: Render every door-sized opening and doorway visible in the photo as a finished door — a closed door leaf with frame and casing, in a finish matching the design palette and trim — never a bare, empty, or gray recess. Fitting a door leaf inside an existing opening is required and is NOT a geometry change; do not alter any opening's position or size. Keep wide archways and open passages open — only door-sized openings receive a door leaf.";

const NO_DOORS_SENTENCE =
  "DOORS: The walls visible in this photo contain NO doors. Do NOT add any door, door leaf, door frame, or doorway anywhere — keep every wall a solid wall exactly as in the photo.";

const NO_INVENTED_DOORS_SENTENCE =
  "Never add a door or doorway that is not present in the original photo.";

/**
 * Door prompt block keyed on the photo's analyzed door count. `undefined`
 * means the photo was never opening-analyzed — we can't assert zero, so the
 * finish sentence stays but inventing doors is still forbidden.
 */
function doorDirective(doorCount: number | undefined): string {
  if (doorCount === 0) return NO_DOORS_SENTENCE;
  if (doorCount === undefined) {
    return `${DOOR_FINISH_SENTENCE} ${NO_INVENTED_DOORS_SENTENCE}`;
  }
  return `${DOOR_FINISH_SENTENCE} There are exactly ${doorCount} door opening(s) in this photo; do not add a door anywhere else.`;
}

/**
 * Fallback opening counts from floor-plan viewpoint framing, for photos that
 * were never opening-analyzed. Geometry only ever *adds* certainty about doors
 * it knows about — a plan can miss a door, so zero visible doors returns
 * undefined (generic directive) instead of asserting "NO doors".
 */
export function framingFallbackOpeningCounts(
  framing: ViewpointFraming | null | undefined,
): { windows: number; doors: number } | undefined {
  if (!framing) return undefined;
  const visible = framingVisibleOpenings(framing);
  if (visible.doorCount <= 0) return undefined;
  return { windows: visible.windowCount, doors: visible.doorCount };
}

/** Explicit door/window counts for geometry retry anchors on secondary views. */
export function buildGeometryAnchorSentence(
  openingBoxCounts?: { windows: number; doors: number },
): string {
  if (!openingBoxCounts) return "";
  const { windows, doors } = openingBoxCounts;
  return `GEOMETRY ANCHOR: This photo contains exactly ${windows} window(s) and ${doors} door opening(s). Do not add, remove, or relocate any opening. Keep the camera angle and wall layout exactly as photographed.`;
}

function openingPreserveSentence(
  windowCount: number,
  doorCount: number,
): string {
  if (windowCount === 0 && doorCount === 0) return "";
  const parts: string[] = [];
  if (windowCount > 0) parts.push(`${windowCount} window(s) in their exact positions`);
  if (doorCount > 0)
    parts.push(
      `${doorCount} door opening(s) in their exact positions, each fitted with a finished closed door (leaf, frame, and casing)`,
    );
  return `Protect ${parts.join(" and ")}.`;
}

/**
 * The full geometry-lock scaffold (PRESERVE prefix + opening protection +
 * door directive) for callers outside the project pipeline (Quick Room).
 * Undefined counts mean the photo was never opening-analyzed.
 */
export function buildPreserveScaffold(
  openingBoxCounts?: { windows: number; doors: number },
): string {
  const openingBit = openingBoxCounts
    ? openingPreserveSentence(openingBoxCounts.windows, openingBoxCounts.doors)
    : "";
  return [PRESERVE_PREFIX, openingBit, doorDirective(openingBoxCounts?.doors)]
    .filter(Boolean)
    .join(" ");
}

export function buildMasterRenderInstruction(
  plan: RoomRenderPlan,
  photoId: string,
  cameraNote?: string | null,
  editFeedback?: string,
  openingBoxCounts?: { windows: number; doors: number },
  hasStyleReference?: boolean,
): string {
  const perPhoto = plan.photoPrompts?.find((p) => p.photoId === photoId);
  const doorSentence = doorDirective(openingBoxCounts?.doors);
  const styleRefRoles = hasStyleReference ? `${MASTER_STYLE_REF_IMAGE_ROLES} ` : "";
  if (perPhoto?.renderInstruction?.trim()) {
    const edit = editFeedback?.trim();
    const designBlock = edit
      ? `${perPhoto.renderInstruction.trim()} Adjustments: ${edit}`
      : perPhoto.renderInstruction.trim();
    return `${styleRefRoles}${designBlock} ${doorSentence}`;
  }

  const finishLock = buildFinishLockFromPlan(plan);
  const finishSnippet = buildFinishLockSnippet(finishLock);
  const layoutLock =
    plan.furnitureLayoutLock?.trim() || deriveFurnitureLayoutLockFallback(plan);
  const camera = cameraNote?.trim() || perPhoto?.cameraNote?.trim();
  const openingBit = openingBoxCounts
    ? openingPreserveSentence(openingBoxCounts.windows, openingBoxCounts.doors)
    : "";

  const changeParts = [
    `CHANGE: Stage this room as a photorealistic interior design.`,
    `Finishes: ${finishSnippet}.`,
    layoutLock ? `Furniture layout: ${layoutLock}` : "",
    // 2000 (not 1200): deterministic-fallback concepts put the household-scope
    // sleeping directive at ~1200-1400 chars — a shorter slice cuts it off and
    // the render model reads apartment-wide wishes as per-room instructions.
    plan.designConcept ? `Design direction: ${plan.designConcept.slice(0, 2000)}` : "",
    camera ? `Camera view: ${camera}.` : "",
    editFeedback?.trim() ? `User adjustments: ${editFeedback.trim()}` : "",
  ].filter(Boolean);

  return [hasStyleReference ? MASTER_STYLE_REF_IMAGE_ROLES : "", PRESERVE_PREFIX, openingBit, doorSentence, ...changeParts]
    .filter(Boolean)
    .join(" ");
}

/**
 * The placement map is written from the MASTER camera's point of view (its
 * "left"/"right" phrases are hero-screen-relative). For a roughly opposite
 * secondary camera those sides invert — without this note the map contradicts
 * the OPPOSITE-CAMERA directive and pulls the model back to the hero
 * composition.
 */
const OPPOSITE_CAMERA_MAP_NOTE =
  "NOTE: The map above describes positions as seen from the MASTER camera. THIS camera faces the opposite direction (~180° turned): every 'left' in the map appears on YOUR RIGHT and every 'right' appears on YOUR LEFT. Compass walls (NORTH/SOUTH/EAST/WEST) are fixed and authoritative — keep each piece on its compass wall.";

function appendPlacementMap(
  prompt: string,
  ctx?: SecondaryRenderViewpointContext,
): string {
  const map = ctx?.heroPlacementMap?.trim();
  const decor = ctx?.heroDecorLock?.trim();
  if (!map && !decor) return prompt;

  const opposite =
    ctx?.heroViewpoint &&
    ctx?.secondaryViewpoint &&
    areViewpointsRoughlyOpposite(ctx.heroViewpoint.angleDeg, ctx.secondaryViewpoint.angleDeg);

  let out = prompt;
  if (map) {
    out = opposite ? `${out}\n${map}\n${OPPOSITE_CAMERA_MAP_NOTE}` : `${out}\n${map}`;
  }
  if (decor) {
    out = `${out}\n${decor}`;
  }
  return out;
}

function appendViewpointTransferDirective(
  prompt: string,
  ctx?: SecondaryRenderViewpointContext,
): string {
  if (!ctx?.heroViewpoint || !ctx?.secondaryViewpoint) {
    return appendPlacementMap(prompt, ctx);
  }

  const heroFraming = ctx.detectedRoom
    ? resolveViewpointFraming(ctx.heroViewpoint, ctx.detectedRoom)
    : null;
  const editTargetFraming = ctx.detectedRoom
    ? resolveViewpointFraming(ctx.secondaryViewpoint, ctx.detectedRoom)
    : null;

  const heroAttached = ctx.heroImageAttached !== false;
  const transferDirective = buildViewpointTransferDirective({
    referenceAngleDeg: ctx.heroViewpoint.angleDeg,
    editTargetAngleDeg: ctx.secondaryViewpoint.angleDeg,
    referenceFacing: heroFraming?.facing,
    editTargetFacing: editTargetFraming?.facing,
    heroFraming,
    editTargetFraming,
    labels: heroAttached
      ? {
          photoLabel: "FIRST image (the real photo)",
          referenceLabel: "SECOND image (the master design)",
        }
      : {
          photoLabel: "provided photo",
          referenceLabel: "master design (described in text)",
        },
  });

  return appendPlacementMap(`${prompt} ${transferDirective}`.trim(), ctx);
}

export function buildSecondaryRenderInstruction(
  plan: RoomRenderPlan,
  cameraNote?: string | null,
  editFeedback?: string,
  openingBoxCounts?: { windows: number; doors: number },
  viewpointCtx?: SecondaryRenderViewpointContext,
): string {
  const perPhoto = viewpointCtx?.photoId
    ? plan.photoPrompts?.find((p) => p.photoId === viewpointCtx.photoId)
    : undefined;
  const doorSentence = doorDirective(openingBoxCounts?.doors);
  const imageRoles =
    viewpointCtx?.heroImageAttached === false ? SECONDARY_TEXT_ONLY_ROLES : SECONDARY_IMAGE_ROLES;

  if (perPhoto?.renderInstruction?.trim()) {
    const edit = editFeedback?.trim();
    const designBlock = edit
      ? `${perPhoto.renderInstruction.trim()} Adjustments: ${edit}`
      : perPhoto.renderInstruction.trim();
    const wrapped = [imageRoles, designBlock, doorSentence]
      .filter(Boolean)
      .join(" ");
    return appendViewpointTransferDirective(wrapped, viewpointCtx);
  }

  const finishLock = buildFinishLockFromPlan(plan);
  const finishSnippet = buildFinishLockSnippet(finishLock);
  const layoutLock =
    plan.furnitureLayoutLock?.trim() || deriveFurnitureLayoutLockFallback(plan);
  const camera = cameraNote?.trim();
  const openingBit = openingBoxCounts
    ? openingPreserveSentence(openingBoxCounts.windows, openingBoxCounts.doors)
    : "";

  const parts = [
    PRESERVE_PREFIX,
    openingBit,
    doorSentence,
    imageRoles,
    "CHANGE: Apply the exact same flooring, ceiling, wall finishes, and furniture pieces as the master design, placed where the master's layout puts them relative to THIS camera's geometry.",
    `Finishes: ${finishSnippet}.`,
    layoutLock ? `Furniture layout lock: ${layoutLock}` : "",
    camera ? `This camera shows: ${camera}.` : "",
    "Only show furniture visible from this viewpoint; do not invent new pieces or move existing ones.",
    editFeedback?.trim() ? `User adjustments: ${editFeedback.trim()}` : "",
  ].filter(Boolean);

  return appendViewpointTransferDirective(parts.join(" "), viewpointCtx);
}

export function resolvePhotoRenderInstruction(
  state: ProjectState,
  roomId: string,
  photoId: string,
  editFeedback?: string,
  hasStyleReference?: boolean,
): string | undefined {
  const plan = state.roomRenderPlans?.[roomId];
  if (!plan) return undefined;

  const detected = state.analysis?.rooms.find((r) => r.id === roomId);
  const photo = getRoomPhotos(state, roomId).find((p) => p.id === photoId);
  const framing =
    photo?.viewpoint && detected ? resolveViewpointFraming(photo.viewpoint, detected) : null;
  const cameraNote = framing?.note ?? photo?.label;

  // No opening analysis → fall back to floor-plan framing (doors the confirmed
  // plan puts inside this camera's FOV), else undefined counts so the door
  // directive can't wrongly assert "zero doors" for an unanalyzed photo.
  const openingBoxCounts = photo?.openingAnalysis
    ? {
        windows: photo.openingAnalysis.window_boxes?.length ?? 0,
        doors: photo.openingAnalysis.door_boxes?.length ?? 0,
      }
    : framingFallbackOpeningCounts(framing);

  return buildMasterRenderInstruction(
    plan,
    photoId,
    cameraNote,
    editFeedback,
    openingBoxCounts,
    hasStyleReference,
  );
}
