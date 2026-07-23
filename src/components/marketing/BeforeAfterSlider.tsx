"use client";

import { useCallback, useRef, useState, type PointerEvent } from "react";

type Props = {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
  beforeLabel?: string;
  afterLabel?: string;
};

export function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  beforeLabel = "Before",
  afterLabel = "After",
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(52);
  const dragging = useRef(false);

  const setFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(98, Math.max(2, next)));
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setFromClientX(e.clientX);
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  return (
    <div
      ref={trackRef}
      className="relative aspect-[3/2] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-2xl bg-[var(--muted)]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label="Before and after comparison — drag to reveal"
    >
      <img
        src={afterSrc}
        alt={afterAlt}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />

      <img
        src={beforeSrc}
        alt={beforeAlt}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />

      <div
        className="absolute inset-y-0 z-10 w-0.5 bg-[var(--primary)]"
        style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
      >
        <div className="absolute top-1/2 left-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg">
          <span className="text-sm font-semibold" aria-hidden>
            ⟷
          </span>
        </div>
      </div>

      <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold tracking-wide text-white uppercase">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute top-3 right-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-semibold tracking-wide text-white uppercase">
        {afterLabel}
      </span>
    </div>
  );
}
