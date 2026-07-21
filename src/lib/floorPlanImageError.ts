/** SSE / client code when floor plan is not an image MIME type. */
export const FLOOR_PLAN_IMAGE_REQUIRED_CODE = "floor_plan_image_required";

export class FloorPlanImageRequiredError extends Error {
  readonly code = FLOOR_PLAN_IMAGE_REQUIRED_CODE;

  constructor(message: string = "Floor plan must be an image file (JPG, PNG, or WEBP).") {
    super(message);
    this.name = "FloorPlanImageRequiredError";
  }
}

export function isFloorPlanImageRequiredCode(code: unknown): boolean {
  return code === FLOOR_PLAN_IMAGE_REQUIRED_CODE;
}

export function isFloorPlanImageRequiredError(err: unknown): err is FloorPlanImageRequiredError {
  return err instanceof FloorPlanImageRequiredError;
}

export function isFloorPlanImageMime(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.trim().toLowerCase().startsWith("image/");
}
