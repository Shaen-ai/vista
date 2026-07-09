export const OBJECT_REMOVAL_DIRECTIVE =
  "OBJECT REMOVAL (mandatory): The REMOVAL MASK marks existing furniture, objects, or debris that MUST be cleared. Remove them completely — show empty floor or wall behind. Do not copy, preserve, or redesign around marked items.";

export const FAL_OBJECT_REMOVAL_TAIL = OBJECT_REMOVAL_DIRECTIVE;

export const REMOVAL_MASK_GEMINI_INTRO =
  "REMOVAL MASK — WHITE regions = clear existing objects completely before furnishing. Do not preserve furniture or debris inside white areas.";

export function buildObjectRemovalDirective(hasRemovalMask: boolean): string {
  return hasRemovalMask ? OBJECT_REMOVAL_DIRECTIVE : "";
}
