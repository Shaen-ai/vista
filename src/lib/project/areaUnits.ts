export type AreaUnit = "m2" | "ft2";
export type LengthUnit = "m" | "ft";

export const SQFT_TO_M2 = 0.092903;
const M_TO_FT = 1 / 0.3048;

export function lengthUnitFromAreaUnit(unit: AreaUnit): LengthUnit {
  return unit === "ft2" ? "ft" : "m";
}

export function m2ToDisplayArea(m2: number | undefined, unit: AreaUnit): string {
  if (m2 == null || !Number.isFinite(m2) || m2 <= 0) return "";
  if (unit === "ft2") return String(Math.round(m2 / SQFT_TO_M2));
  return String(m2);
}

export function displayAreaToM2(value: number, unit: AreaUnit): number {
  if (unit === "ft2") return Math.round(value * SQFT_TO_M2);
  return value;
}

export function metresToDisplayLength(m: number, lengthUnit: LengthUnit): number {
  if (lengthUnit === "ft") return Math.round(m * M_TO_FT * 100) / 100;
  return Math.round(m * 100) / 100;
}

export function displayLengthToMetres(value: number, lengthUnit: LengthUnit): number {
  if (lengthUnit === "ft") return value / M_TO_FT;
  return value;
}

export function formatEstimatedAreaLabel(areaM2: number, unit: AreaUnit): string {
  if (unit === "ft2") {
    const ft2 = Math.round(areaM2 / SQFT_TO_M2);
    return `~${ft2} ft²`;
  }
  return `~${areaM2} m²`;
}
