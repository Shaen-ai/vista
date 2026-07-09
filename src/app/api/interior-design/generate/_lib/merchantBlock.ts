/**
 * Order the catalog ids that get a merchant-text reference: collage-included ids
 * first (so the text lines up with the visual sheets), then pinned ids, de-duped
 * while preserving first-seen order. Pure — identical logic was inlined in both
 * the `render` and `full` phases of the generate route.
 */
export function orderMerchantBlockIds(
  collageIncludedIds: string[],
  pinnedMpKeysList: string[],
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };
  for (const id of collageIncludedIds) push(id);
  for (const id of pinnedMpKeysList) push(id);
  return ordered;
}
