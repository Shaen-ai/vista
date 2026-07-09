"use client";

import { useEffect } from "react";
import { useConsumerDesignStore } from "@/app/store";
import { getPublicApiUrl } from "@/lib/publicEnv";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { hasPersistedVistaLocale } from "@/i18n/vistaLocale";

type DetectCountryResponse = {
  data?: {
    country_code?: string;
  };
};

export function CountryBootstrap() {
  const setSelectedCountry = useConsumerDesignStore((s) => s.setSelectedCountry);
  const setCountryDetected = useConsumerDesignStore((s) => s.setCountryDetected);
  const { setLocale } = useTranslation();

  useEffect(() => {
    let cancelled = false;

    const apiBase = getPublicApiUrl().replace(/\/$/, "");

    fetch(`${apiBase}/marketplace/detect-country`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("detect-country failed");
        const json = (await res.json()) as DetectCountryResponse;
        const code = json.data?.country_code?.trim().toUpperCase();
        if (!code || !/^[A-Z]{2}$/.test(code)) throw new Error("invalid country code");
        if (cancelled) return;
        setSelectedCountry(code);
        setCountryDetected(true);
        // Default language by country until the visitor picks one explicitly.
        if (!hasPersistedVistaLocale()) {
          setLocale(code === "AM" ? "hy" : "en");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setCountryDetected(false);
      });

    return () => {
      cancelled = true;
    };
  }, [setSelectedCountry, setCountryDetected, setLocale]);

  return null;
}
