export interface SupportedCountry {
  code: string;
  name: string;
  flag: string | null;
  currency: string | null;
  modes: string[];
}

/**
 * Mirrors backend `config/marketplaces.php` so the Vista UI lists every
 * supported country when /api/marketplace/countries is unavailable (e.g. local dev).
 */
export const SUPPORTED_COUNTRIES_FALLBACK: SupportedCountry[] = [
  {
    code: "AM",
    name: "Armenia",
    flag: "🇦🇲",
    currency: "AMD",
    modes: ["local", "regional", "global"],
  },
];
