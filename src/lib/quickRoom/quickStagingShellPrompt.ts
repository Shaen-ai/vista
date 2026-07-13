/** Short shell prompt — structure lock only; no products or style images. */
export function buildQuickStagingShellPrompt(designStyleLabel: string): string {
  const style = designStyleLabel.trim() || "neutral";
  return (
    `Keep walls, doors, windows, ceiling, floor, and camera exactly as in the photo. ` +
    `Apply ${style} wall, floor, and ceiling finishes. ` +
    `Empty room. No furniture. No decor. Photorealistic.`
  );
}
