import { useConsumerDesignStore } from "@/app/store";
import { loadAndHydrateProject } from "@/lib/projectHydration";
import { markJustHydratedFromHub } from "@/lib/projectHydrationSkip";

export function prepareOpenSavedProject(): void {
  const store = useConsumerDesignStore.getState();
  store.setGeneratedImage(null, null);
  store.setDesignBrief(null);
  store.setProductLinks([]);
  store.setError(null);
}

export async function openSavedProject(
  projectId: string,
  mode: "quick_room" | "project",
): Promise<boolean> {
  prepareOpenSavedProject();
  if (mode === "project") {
    useConsumerDesignStore.getState().resetProject();
    useConsumerDesignStore.setState({ currentProjectDbId: null });
  } else {
    useConsumerDesignStore.getState().setCurrentProjectDbId(null);
  }

  const ok = await loadAndHydrateProject(projectId);
  if (ok && mode === "project") {
    markJustHydratedFromHub();
  }
  return ok;
}

export function workspacePathForMode(mode: "quick_room" | "project"): string {
  return mode === "quick_room" ? "/quick/new" : "/project/new";
}
