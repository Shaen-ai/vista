"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { track } from "@/lib/analytics";
import { isIosMobile, isStandaloneMode } from "@/lib/pwaPlatform";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PwaInstallContextValue = {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isStandalone: boolean;
  isIosMobile: boolean;
  promptInstall: () => Promise<void>;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

export function usePwaInstall(): PwaInstallContextValue {
  const value = useContext(PwaInstallContext);
  if (!value) {
    throw new Error("usePwaInstall must be used within PwaInstallProvider");
  }
  return value;
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [iosMobile, setIosMobile] = useState(false);

  const refreshStandalone = useCallback(() => {
    setIsStandalone(isStandaloneMode());
  }, []);

  useEffect(() => {
    refreshStandalone();
    setIosMobile(isIosMobile());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      refreshStandalone();
      track("pwa_installed", { source: "appinstalled" });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshStandalone();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", refreshStandalone);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", refreshStandalone);
    };
  }, [refreshStandalone]);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.debug("[pwa] install prompt outcome:", outcome);
    track("pwa_install_prompt", { outcome });
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const value = useMemo(
    () => ({
      deferredPrompt,
      isStandalone,
      isIosMobile: iosMobile,
      promptInstall,
    }),
    [deferredPrompt, isStandalone, iosMobile, promptInstall],
  );

  return <PwaInstallContext.Provider value={value}>{children}</PwaInstallContext.Provider>;
}
