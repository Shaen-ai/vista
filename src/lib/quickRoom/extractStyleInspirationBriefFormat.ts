export interface StyleInspirationExtract {
  palette?: string;
  materials?: string;
  lightingMood?: string;
  furnitureCharacter?: string;
  decorDensity?: string;
  styleSummary?: string;
}

/** Turn Claude JSON into a compact FAL prompt fragment (~200–400 chars). */
export function formatStyleInspirationProse(extract: StyleInspirationExtract): string {
  if (extract.styleSummary?.trim()) {
    return `STYLE FROM INSPIRATION: ${extract.styleSummary.trim().slice(0, 380)}`;
  }

  const parts = [
    extract.palette?.trim(),
    extract.materials?.trim(),
    extract.lightingMood?.trim(),
    extract.furnitureCharacter?.trim(),
    extract.decorDensity?.trim(),
  ].filter(Boolean);

  if (parts.length === 0) return "";
  return `STYLE FROM INSPIRATION: ${parts.join(", ").slice(0, 380)}`;
}

export function parseStyleInspirationExtractFromText(text: string): StyleInspirationExtract | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as StyleInspirationExtract;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}
