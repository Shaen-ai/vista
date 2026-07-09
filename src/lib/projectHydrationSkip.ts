/** One-shot flag: skip useProjectSessionRestore when openSavedProject just hydrated the store. */
let justHydratedFromHub = false;

export function markJustHydratedFromHub(): void {
  justHydratedFromHub = true;
}

export function consumeJustHydratedFromHub(): boolean {
  if (!justHydratedFromHub) return false;
  justHydratedFromHub = false;
  return true;
}
