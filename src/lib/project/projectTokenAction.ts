import type { TokenAction } from "@/lib/vistaTokens";

/** Map project generate-room `action` (+ options) to a Laravel token action, or null if free. */
export function resolveProjectTokenAction(
  action: string,
  opts?: { redo?: boolean },
): TokenAction | null {
  switch (action) {
    case "generate":
      return "generate";
    case "regenerate":
      return "regenerate";
    case "edit":
      return "edit";
    case "next-viewpoint":
      return opts?.redo ? "regenerate" : "generate";
    case "sync-gallery":
      return "edit";
    default:
      return null;
  }
}
