"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { NormalizedFloorPlanDetection } from "@/lib/project/floorPlanDetections";

/** Roboflow Universe–style class colors. */
const CLASS_STYLE: Record<
  NormalizedFloorPlanDetection["class"],
  { stroke: string; fill: string; label: string }
> = {
  wall: { stroke: "#7c3aed", fill: "rgba(124,58,237,0.35)", label: "wall" },
  window: { stroke: "#84cc16", fill: "rgba(132,204,22,0.4)", label: "window" },
  door: { stroke: "#f43f5e", fill: "rgba(244,63,94,0.4)", label: "door" },
};

type Props = {
  imageSrc: string;
  imageAlt: string;
  detections: NormalizedFloorPlanDetection[];
  showOverlay: boolean;
  showLabels?: boolean;
  isLoading?: boolean;
  errorMessage?: string | null;
  className?: string;
  onImageAspect?: (aspect: number) => void;
};

export default function FloorPlanImageWithDetections({
  imageSrc,
  imageAlt,
  detections,
  showOverlay,
  showLabels = true,
  isLoading = false,
  errorMessage = null,
  className = "",
  onImageAspect,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    if (w > 0 && h > 0) setBox({ width: w, height: h });
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (nw > 0 && nh > 0) onImageAspect?.(nw / nh);
  }, [onImageAspect]);

  useLayoutEffect(() => {
    measure();
    const img = imgRef.current;
    if (!img) return;

    const ro = new ResizeObserver(() => measure());
    ro.observe(img);

    return () => ro.disconnect();
  }, [measure, imageSrc, showOverlay]);

  return (
    <div ref={wrapRef} className="relative inline-block max-w-full">
      <img
        ref={imgRef}
        src={imageSrc}
        alt={imageAlt}
        className={`block h-auto max-w-full ${className}`}
        onLoad={measure}
      />
      {isLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 rounded-lg">
          <span className="px-3 py-1.5 rounded-lg bg-black/70 text-white text-xs font-medium">
            Detecting walls, doors, windows…
          </span>
        </div>
      )}
      {!isLoading && errorMessage && showOverlay && (
        <div className="absolute bottom-2 right-2 z-30 max-w-[min(100%,16rem)] px-2 py-1 rounded-lg bg-red-950/85 text-red-50 text-[10px] leading-snug">
          {errorMessage}
        </div>
      )}
      {showOverlay && box && detections.length > 0 && (
        <svg
          className="pointer-events-none absolute left-0 top-0 z-20"
          width={box.width}
          height={box.height}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden
        >
          {detections.map((d, i) => {
            const style = CLASS_STYLE[d.class] ?? CLASS_STYLE.wall;
            const pct = Math.round(d.confidence * 100);
            return (
              <g key={d.detection_id ?? i}>
                <rect
                  x={d.left}
                  y={d.top}
                  width={d.width}
                  height={d.height}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={0.0025}
                />
                {showLabels && (
                  <text
                    x={d.left + d.width / 2}
                    y={d.top + d.height / 2}
                    fill="#ffffff"
                    fontSize={0.018}
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    stroke="#000000"
                    strokeWidth={0.0008}
                    paintOrder="stroke"
                  >
                    {pct}%
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
