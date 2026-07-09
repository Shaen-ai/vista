"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import { getOrCreateDeviceId } from "@/lib/vistaTokens";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!POSTHOG_KEY || posthog.__loaded) return;
    const deviceId = getOrCreateDeviceId();
    posthog.init(POSTHOG_KEY, {
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      defaults: "2025-05-24",
      capture_pageview: "history_change",
      person_profiles: "identified_only",
      session_recording: { maskAllInputs: true },
      // Applies only when no .tunzone.com posthog cookie exists yet; visitors
      // arriving from the landing page keep their cross-subdomain id.
      ...(deviceId ? { bootstrap: { distinctID: deviceId } } : {}),
    });
    posthog.register({ app: "vista", ...(deviceId ? { vista_device_id: deviceId } : {}) });
  }, []);

  if (!POSTHOG_KEY) return <>{children}</>;
  return <PHProvider client={posthog}>{children}</PHProvider>;
}
