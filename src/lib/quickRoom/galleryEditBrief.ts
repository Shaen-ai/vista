import type { DesignBrief } from "@/lib/interiorDesignPrompts";

/** Minimal brief carried through gallery-edit sessions (no Claude redesign). */
export function stubGalleryEditBrief(prior?: Partial<DesignBrief> | null): DesignBrief {
  return {
    subject: prior?.subject ?? "",
    arrangement: prior?.arrangement ?? "",
    context: prior?.context ?? "",
    composition: prior?.composition ?? "",
    style: prior?.style ?? "",
    fullPrompt: prior?.fullPrompt ?? "",
    roomType: prior?.roomType ?? "",
    cameraAngle: prior?.cameraAngle ?? "",
    designIntent: prior?.designIntent ?? "",
    requiredSlots: prior?.requiredSlots ?? [],
    constraints: prior?.constraints ?? {},
    selectedCatalogIds: prior?.selectedCatalogIds ?? [],
    productIntents: prior?.productIntents ?? [],
    productDescriptions: prior?.productDescriptions ?? [],
    doorDesign: prior?.doorDesign,
  };
}

export function parsePriorDesignBriefFromForm(
  raw: FormDataEntryValue | null,
): Partial<DesignBrief> | null {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as Partial<DesignBrief>;
  } catch {
    return null;
  }
}
