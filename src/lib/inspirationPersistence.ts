import type { InspirationProduct, StyleInspirationImage } from "@/app/store";
import { useConsumerDesignStore } from "@/app/store";

export type LaravelInspirationImage = {
  url: string;
  label: string;
  mime: string;
};

export type OrchestratorInspirationUpload = {
  base64: string;
  mimeType: string;
  label: string;
};

export function inspirationProductsToPatchPayload(
  products: InspirationProduct[],
): Array<{ base64: string; mime: string; label: string }> {
  return products
    .filter((p) => p.base64 && p.mimeType)
    .map((p) => ({
      base64: p.base64!,
      mime: p.mimeType!,
      label: p.label ?? "",
    }));
}

export function styleInspirationsToPatchPayload(
  images: StyleInspirationImage[],
): Array<{ base64: string; mime: string; label: string }> {
  return images.map((img) => ({
    base64: img.base64,
    mime: img.mimeType,
    label: "",
  }));
}

export async function fetchUrlAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type || "image/jpeg";
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return { base64: btoa(binary), mimeType };
  } catch {
    return null;
  }
}

export function applyInspirationProductsToStore(
  orchestrator?: OrchestratorInspirationUpload[],
  laravel?: LaravelInspirationImage[],
  local?: InspirationProduct[],
): boolean {
  const store = useConsumerDesignStore.getState();

  if (orchestrator?.length) {
    store.clearInspirationProducts();
    for (const u of orchestrator) {
      store.addInspirationProduct({
        base64: u.base64,
        mimeType: u.mimeType,
        url: null,
        label: u.label ?? "",
        thumbnailUrl: null,
      });
    }
    return true;
  }

  if (laravel?.length) {
    store.clearInspirationProducts();
    for (const img of laravel) {
      store.addInspirationProduct({
        base64: null,
        mimeType: img.mime,
        url: img.url,
        label: img.label ?? "",
        thumbnailUrl: img.url,
      });
    }
    return true;
  }

  if (local?.length) {
    store.clearInspirationProducts();
    for (const p of local) {
      store.addInspirationProduct({
        base64: p.base64,
        mimeType: p.mimeType,
        url: p.url,
        label: p.label,
        thumbnailUrl: p.thumbnailUrl,
      });
    }
    return true;
  }

  return false;
}

export async function hydrateInspirationProductsFromLaravel(
  images: LaravelInspirationImage[],
): Promise<void> {
  const store = useConsumerDesignStore.getState();
  store.clearInspirationProducts();
  for (const img of images) {
    const fetched = await fetchUrlAsBase64(img.url);
    if (fetched) {
      store.addInspirationProduct({
        base64: fetched.base64,
        mimeType: fetched.mimeType,
        url: img.url,
        label: img.label ?? "",
        thumbnailUrl: img.url,
      });
    }
  }
}

export async function hydrateStyleInspirationsFromLaravel(
  images: LaravelInspirationImage[],
): Promise<void> {
  const store = useConsumerDesignStore.getState();
  store.clearStyleInspirations();
  for (const img of images) {
    const fetched = await fetchUrlAsBase64(img.url);
    if (fetched) {
      store.addStyleInspiration({ base64: fetched.base64, mimeType: fetched.mimeType });
    }
  }
}

export function applyStyleInspirationsToStore(local?: StyleInspirationImage[]): boolean {
  if (!local?.length) return false;
  const store = useConsumerDesignStore.getState();
  store.clearStyleInspirations();
  for (const img of local) {
    store.addStyleInspiration({ base64: img.base64, mimeType: img.mimeType });
  }
  return true;
}

export async function fetchLaravelInspirationImages(
  projectDbId: string,
): Promise<LaravelInspirationImage[]> {
  try {
    const { authJsonHeaders } = await import("@/lib/authApi");
    const res = await fetch(`/api/vista/projects/${projectDbId}`, {
      headers: authJsonHeaders(),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const raw = json.data?.inspiration_images;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item: unknown) => item && typeof item === "object" && typeof (item as { url?: string }).url === "string")
      .map((item: { url: string; label?: string; mime?: string }) => ({
        url: item.url,
        label: typeof item.label === "string" ? item.label : "",
        mime: typeof item.mime === "string" ? item.mime : "image/jpeg",
      }));
  } catch {
    return [];
  }
}
