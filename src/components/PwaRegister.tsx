"use client";

import { useEffect } from "react";

function shouldRegisterServiceWorker(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith("tunzone.com");
}

export function PwaRegister() {
  useEffect(() => {
    if (!shouldRegisterServiceWorker()) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.debug("[pwa] service worker registration failed", error);
    });
  }, []);

  return null;
}
