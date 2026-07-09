import posthog from "posthog-js";
import { getOrCreateDeviceId } from "./vistaTokens";

function enabled(): boolean {
  return typeof window !== "undefined" && posthog.__loaded;
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (enabled()) posthog.capture(event, props);
}

export function identifyUser(id: string, props?: Record<string, unknown>): void {
  if (enabled()) posthog.identify(id, props);
}

export function resetAnalytics(): void {
  if (!enabled()) return;
  posthog.reset();
  // reset() clears super properties — restore the ones the provider registers.
  const deviceId = getOrCreateDeviceId();
  posthog.register({ app: "vista", ...(deviceId ? { vista_device_id: deviceId } : {}) });
}
