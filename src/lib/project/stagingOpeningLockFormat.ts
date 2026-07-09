export function formatOpeningLockParts(
  count: number,
  positions: string[],
  kind: "door" | "window",
): string {
  if (count <= 0) return "";
  const noun = count === 1 ? kind : `${kind}s`;
  const posText =
    positions.length > 0
      ? ` on ${positions.map((p) => (/\bwall\b/i.test(p) ? p : `${p} wall`)).join(", ")}`
      : "";
  return `${count} ${noun}${posText}`;
}
