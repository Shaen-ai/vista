"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { CheckCheck, Trash2 } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

const BRUSH_COLOR = "#ff0000";
const BRUSH_SIZE = 6;

export interface DrawingCanvasProps {
  imageSrc: string;
  onAnnotatedImage: (base64: string, mimeType: string) => void;
  onFinish?: () => void;
  className?: string;
}

function snapshotCanvas(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];
  return base64 || null;
}

export default function DrawingCanvas({
  imageSrc,
  onAnnotatedImage,
  onFinish,
  className,
}: DrawingCanvasProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const onAnnotatedImageRef = useRef(onAnnotatedImage);
  useEffect(() => { onAnnotatedImageRef.current = onAnnotatedImage; }, [onAnnotatedImage]);
  const hasStrokesRef = useRef(hasStrokes);
  useEffect(() => { hasStrokesRef.current = hasStrokes; }, [hasStrokes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    return () => {
      if (hasStrokesRef.current) {
        const base64 = snapshotCanvas(canvasEl);
        if (base64) onAnnotatedImageRef.current(base64, "image/png");
      }
    };
  }, []);

  const getCanvasPoint = useCallback(
    (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();

      let clientX: number, clientY: number;
      if ("touches" in e) {
        const touch = e.touches[0] || e.changedTouches[0];
        if (!touch) return null;
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  const startDraw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const point = getCanvasPoint(e);
      if (!point) return;
      setIsDrawing(true);
      lastPoint.current = point;
    },
    [getCanvasPoint],
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (!isDrawing) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx || !canvas) return;
      const point = getCanvasPoint(e);
      if (!point || !lastPoint.current) return;

      ctx.strokeStyle = BRUSH_COLOR;
      ctx.lineWidth = BRUSH_SIZE * (canvas.width / (containerRef.current?.clientWidth || canvas.width));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();

      lastPoint.current = point;
      setHasStrokes(true);
    },
    [isDrawing, getCanvasPoint],
  );

  const endDraw = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPoint.current = null;
  }, [isDrawing]);

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    setHasStrokes(false);
  }, []);

  const handleDone = useCallback(() => {
    const base64 = snapshotCanvas(canvasRef.current);
    if (base64) {
      onAnnotatedImage(base64, "image/png");
    }
    onFinish?.();
  }, [onAnnotatedImage, onFinish]);

  return (
    <div className={className ?? ""}>
      <div
        ref={containerRef}
        className="relative rounded-xl overflow-hidden border-2 border-dashed border-[var(--primary)]/50"
      >
        <canvas
          ref={canvasRef}
          className="w-full h-auto block cursor-crosshair touch-none"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-white bg-black/50 px-2 py-0.5 rounded-full pointer-events-none select-none whitespace-nowrap">
          {t("components.drawOnImage")}
        </p>
      </div>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={handleClear}
          disabled={!hasStrokes}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--muted)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/50 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          <Trash2 size={14} />
          {t("components.clearDrawing")}
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--primary)] text-white hover:brightness-110 transition-all cursor-pointer"
        >
          <CheckCheck size={14} />
          {t("common.done")}
        </button>
      </div>
    </div>
  );
}
