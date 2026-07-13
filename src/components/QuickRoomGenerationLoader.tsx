"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

export type QuickRoomLoaderPhase = "idle" | "analysing" | "designing" | "generating";

const STEPS: QuickRoomLoaderPhase[] = ["analysing", "designing", "generating"];

const PARTICLE_COUNT = 6;

function stepIndex(phase: QuickRoomLoaderPhase): number {
  const idx = STEPS.indexOf(phase);
  return idx >= 0 ? idx : 0;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function QuickRoomGenerationLoader({ phase }: { phase: QuickRoomLoaderPhase }) {
  const { t } = useTranslation();
  const reducedMotion = usePrefersReducedMotion();
  const activePhase = phase === "idle" ? "analysing" : phase;
  const activeIdx = stepIndex(activePhase);

  const stepLabels = useMemo(
    () => [
      t("page.loaderImagining"),
      t("page.loaderPlacing"),
      t("page.loaderRendering"),
    ],
    [t],
  );

  const tips = useMemo(
    () => [
      t("page.loaderTip1"),
      t("page.loaderTip2"),
      t("page.loaderTip3"),
    ],
    [t],
  );

  const [tipIdx, setTipIdx] = useState(0);
  const [tipFading, setTipFading] = useState(false);

  useEffect(() => {
    if (reducedMotion || tips.length <= 1) return;

    const interval = window.setInterval(() => {
      setTipFading(true);
      window.setTimeout(() => {
        setTipIdx((i) => (i + 1) % tips.length);
        setTipFading(false);
      }, 280);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [reducedMotion, tips.length]);

  const headline = stepLabels[activeIdx] ?? t("page.generatingDesign");
  const activeTip = tips[tipIdx] ?? t("page.loaderSubtext");

  return (
    <div
      className="cd-gen-loader"
      data-phase={activePhase}
      role="status"
      aria-live="polite"
    >
      <div className="cd-gen-loader-atmosphere" aria-hidden />

      <div className="cd-gen-loader-particles" aria-hidden>
        {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
          <span
            key={i}
            className="cd-gen-loader-particle"
            style={{ animationDelay: `${i * 0.55}s` }}
          />
        ))}
      </div>

      <div className="cd-gen-loader-room" aria-hidden>
        <div className="cd-gen-loader-room-floor" />
        <div className="cd-gen-loader-room-wall cd-gen-loader-room-wall--left" />
        <div className="cd-gen-loader-room-wall cd-gen-loader-room-wall--right" />
        <div className="cd-gen-loader-room-window" />
        <div className="cd-gen-loader-light-sweep" />
        <div className="cd-gen-loader-shimmer" />
        <div className="cd-gen-loader-furniture">
          <div className="cd-gen-loader-sofa" />
          <div className="cd-gen-loader-table" />
          <div className="cd-gen-loader-plant" />
          <div className="cd-gen-loader-lamp" />
        </div>
      </div>

      <div className="cd-gen-loader-copy">
        <p key={activeIdx} className="cd-gen-loader-headline">
          {headline}
        </p>
        <p
          className={`cd-gen-loader-sub${tipFading ? " cd-gen-loader-sub--fade" : ""}`}
        >
          {activeTip}
        </p>
      </div>

      <ol className="cd-gen-loader-steps">
        {stepLabels.map((label, i) => {
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
          return (
            <li
              key={label}
              className={`cd-gen-loader-step cd-gen-loader-step--${state}`}
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <span className="cd-gen-loader-step-dot" aria-hidden />
              <span className="cd-gen-loader-step-label">{label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
