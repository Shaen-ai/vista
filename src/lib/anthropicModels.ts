import "server-only";

/** Creative design brief — quality-critical; defaults to Opus. */
export const ANTHROPIC_BRIEF_MODEL =
  process.env.ANTHROPIC_BRIEF_MODEL?.trim() || "claude-opus-4-8";

/** Structured JSON / vision extraction tasks — faster and cheaper than Opus. */
export const ANTHROPIC_EXTRACT_MODEL =
  process.env.ANTHROPIC_EXTRACT_MODEL?.trim() || "claude-sonnet-4-6";

/** Room geometry extraction; legacy ANTHROPIC_ROOM_GEOMETRY_MODEL still wins. */
export function resolveGeometryModel(override?: string): string {
  return (
    override?.trim() ||
    process.env.ANTHROPIC_ROOM_GEOMETRY_MODEL?.trim() ||
    ANTHROPIC_EXTRACT_MODEL
  );
}
