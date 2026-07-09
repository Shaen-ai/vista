"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { CheckCheck, Eraser, Paintbrush, PencilLine, Trash2 } from "lucide-react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";

const BRUSH_SIZE = 6;
/** Screen-space diameter for the object-removal paint brush (structural lines stay thin). */
const REMOVAL_BRUSH_SIZE = 36;
const HIT_THRESHOLD_PX = 14;
const REMOVAL_BRUSH_COLOR = "#ff00ff";
const REMOVAL_DISPLAY_ALPHA = 0.55;

export type StructuralBrushMode = "floorWall" | "wallCeiling" | "column" | "corner";

type CanvasTool = "drawLine" | "removeLine" | "markRemove";

const BRUSH_MODES: StructuralBrushMode[] = ["floorWall", "wallCeiling", "column", "corner"];

const MODE_COLORS: Record<StructuralBrushMode, string> = {
  floorWall: "#ff0000",
  wallCeiling: "#00bfff",
  column: "#00ff66",
  corner: "#ffaa00",
};

const MODE_LABEL_KEYS: Record<StructuralBrushMode, string> = {
  floorWall: "components.structuralModeFloorWallLabel",
  wallCeiling: "components.structuralModeWallCeilingLabel",
  column: "components.structuralModeColumnLabel",
  corner: "components.structuralModeCornerLabel",
};

const MODE_HINT_KEYS: Record<StructuralBrushMode, string> = {
  floorWall: "components.structuralModeFloorWall",
  wallCeiling: "components.structuralModeWallCeiling",
  column: "components.structuralModeColumn",
  corner: "components.structuralModeCorner",
};

type Point = { x: number; y: number };

interface StructuralLine {
  id: string;
  mode: StructuralBrushMode;
  from: Point;
  to: Point;
}

export interface StructuralLineExport {
  /** Black background + white strokes — ControlNet input. */
  strokeMapBase64: string;
  strokeMapMimeType: string;
  /** Photo with colored strokes — optional preview / composite fallback. */
  compositeBase64: string;
  compositeMimeType: string;
  /** White strokes on black — regions to clear before redesign. */
  removalMaskBase64?: string;
  removalMaskMimeType?: string;
  hasStructuralLines?: boolean;
  hasRemovalMask?: boolean;
}

export interface StructuralBoundaryCanvasProps {
  imageSrc: string;
  onExport: (result: StructuralLineExport) => void;
  onSkip?: () => void;
  onFinish?: () => void;
  /** Fires once the photo is loaded and canvas dimensions match natural size. */
  onImageReady?: () => void;
  className?: string;
  /**
   * "full" — line drawing + object removal (Quick Room / kontext path).
   * "removeOnly" — object-removal painting only; line tools hidden because the
   * Full Project edit-pipeline never consumes structural line maps.
   */
  variant?: "full" | "removeOnly";
}

function snapshotCanvas(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.split(",")[1] || null;
}

function distToSegment(px: number, py: number, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - from.x, py - from.y);
  let t = ((px - from.x) * dx + (py - from.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = from.x + t * dx;
  const cy = from.y + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function findLineAtPoint(lines: StructuralLine[], point: Point, threshold: number): string | null {
  let bestId: string | null = null;
  let bestDist = threshold;
  for (const line of lines) {
    const d = distToSegment(point.x, point.y, line.from, line.to);
    if (d < bestDist) {
      bestDist = d;
      bestId = line.id;
    }
  }
  return bestId;
}

function removalCanvasHasStrokes(canvas: HTMLCanvasElement | null): boolean {
  if (!canvas) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 20 || (data[i + 1] ?? 0) > 20 || (data[i + 2] ?? 0) > 20) {
      return true;
    }
  }
  return false;
}

export default function StructuralBoundaryCanvas({
  imageSrc,
  onExport,
  onSkip,
  onFinish,
  onImageReady,
  className,
  variant = "full",
}: StructuralBoundaryCanvasProps) {
  const { t } = useTranslation();
  const removeOnly = variant === "removeOnly";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const removalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [brushMode, setBrushMode] = useState<StructuralBrushMode>("floorWall");
  const [canvasTool, setCanvasTool] = useState<CanvasTool>(removeOnly ? "markRemove" : "drawLine");
  const [markRemoveErasing, setMarkRemoveErasing] = useState(false);
  const [lines, setLines] = useState<StructuralLine[]>([]);
  const [pendingStart, setPendingStart] = useState<Point | null>(null);
  const [previewEnd, setPreviewEnd] = useState<Point | null>(null);
  const [hasRemovalStrokes, setHasRemovalStrokes] = useState(false);
  const [isMarkDrawing, setIsMarkDrawing] = useState(false);
  const [removalCursor, setRemovalCursor] = useState<Point | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const linesRef = useRef(lines);
  const pendingStartRef = useRef(pendingStart);
  const previewEndRef = useRef(previewEnd);
  const brushModeRef = useRef(brushMode);
  const markLastPoint = useRef<Point | null>(null);

  useEffect(() => { linesRef.current = lines; }, [lines]);
  useEffect(() => { pendingStartRef.current = pendingStart; }, [pendingStart]);
  useEffect(() => { previewEndRef.current = previewEnd; }, [previewEnd]);
  useEffect(() => { brushModeRef.current = brushMode; }, [brushMode]);
  useEffect(() => {
    if (canvasTool !== "markRemove") setRemovalCursor(null);
  }, [canvasTool]);

  const strokeWidth = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return BRUSH_SIZE;
    return BRUSH_SIZE * (canvas.width / (containerRef.current?.clientWidth || canvas.width));
  }, []);

  const removalStrokeWidth = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return REMOVAL_BRUSH_SIZE;
    return REMOVAL_BRUSH_SIZE * (canvas.width / (containerRef.current?.clientWidth || canvas.width));
  }, []);

  const drawLineSegment = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      from: Point,
      to: Point,
      color: string,
      width: number,
      dashed = false,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (dashed) ctx.setLineDash([width * 2, width * 1.5]);
      else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
    },
    [],
  );

  const redrawCanvases = useCallback(
    (
      lineList: StructuralLine[],
      pending: Point | null,
      preview: Point | null,
      previewMode: StructuralBrushMode,
    ) => {
      const canvas = canvasRef.current;
      const strokeCanvas = strokeCanvasRef.current;
      const removalCanvas = removalCanvasRef.current;
      const img = imageRef.current;
      if (!canvas || !strokeCanvas || !img) return;

      const w = strokeWidth();
      const ctx = canvas.getContext("2d");
      const sctx = strokeCanvas.getContext("2d");
      if (!ctx || !sctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      sctx.fillStyle = "#000000";
      sctx.fillRect(0, 0, strokeCanvas.width, strokeCanvas.height);

      for (const line of lineList) {
        drawLineSegment(ctx, line.from, line.to, MODE_COLORS[line.mode], w);
        drawLineSegment(sctx, line.from, line.to, "#ffffff", w);
      }

      if (pending && preview) {
        drawLineSegment(ctx, pending, preview, MODE_COLORS[previewMode], w, true);
      }

      if (pending) {
        const r = w * 0.75;
        ctx.fillStyle = MODE_COLORS[previewMode];
        ctx.beginPath();
        ctx.arc(pending.x, pending.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (removalCanvas) {
        ctx.save();
        ctx.globalAlpha = REMOVAL_DISPLAY_ALPHA;
        ctx.drawImage(removalCanvas, 0, 0);
        ctx.restore();
      }
    },
    [drawLineSegment, strokeWidth],
  );

  useEffect(() => {
    redrawCanvases(lines, pendingStart, previewEnd, brushMode);
  }, [lines, pendingStart, previewEnd, brushMode, redrawCanvases, hasRemovalStrokes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const strokeCanvas = document.createElement("canvas");
      strokeCanvas.width = img.naturalWidth;
      strokeCanvas.height = img.naturalHeight;
      strokeCanvasRef.current = strokeCanvas;

      const removalCanvas = document.createElement("canvas");
      removalCanvas.width = img.naturalWidth;
      removalCanvas.height = img.naturalHeight;
      const rctx = removalCanvas.getContext("2d");
      if (rctx) {
        rctx.fillStyle = "#000000";
        rctx.fillRect(0, 0, removalCanvas.width, removalCanvas.height);
      }
      removalCanvasRef.current = removalCanvas;

      redrawCanvases(linesRef.current, pendingStartRef.current, previewEndRef.current, brushModeRef.current);
      onImageReady?.();
    };
    img.src = imageSrc;
  }, [imageSrc, redrawCanvases, onImageReady]);

  const getCanvasPoint = useCallback(
    (e: React.MouseEvent | React.TouchEvent): Point | null => {
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

  const paintRemovalStroke = useCallback(
    (from: Point, to: Point, erasing: boolean) => {
      const removalCanvas = removalCanvasRef.current;
      if (!removalCanvas) return;
      const rctx = removalCanvas.getContext("2d");
      if (!rctx) return;
      const w = removalStrokeWidth();
      rctx.lineCap = "round";
      rctx.lineJoin = "round";
      rctx.lineWidth = w;
      if (erasing) {
        rctx.globalCompositeOperation = "destination-out";
        rctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        rctx.globalCompositeOperation = "source-over";
        rctx.strokeStyle = "#ffffff";
      }
      rctx.beginPath();
      rctx.moveTo(from.x, from.y);
      rctx.lineTo(to.x, to.y);
      rctx.stroke();
      rctx.globalCompositeOperation = "source-over";
      setHasRemovalStrokes(removalCanvasHasStrokes(removalCanvas));
      redrawCanvases(linesRef.current, pendingStartRef.current, previewEndRef.current, brushModeRef.current);
    },
    [removalStrokeWidth, redrawCanvases],
  );

  const updateRemovalCursor = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const container = containerRef.current;
      if (!container || canvasTool !== "markRemove") {
        setRemovalCursor(null);
        return;
      }
      const rect = container.getBoundingClientRect();
      let clientX: number, clientY: number;
      if ("touches" in e) {
        const touch = e.touches[0];
        if (!touch) {
          setRemovalCursor(null);
          return;
        }
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      setRemovalCursor({
        x: clientX - rect.left,
        y: clientY - rect.top,
      });
    },
    [canvasTool],
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (canvasTool === "markRemove") {
        updateRemovalCursor(e);
      }
      if (canvasTool === "markRemove" && isMarkDrawing) {
        e.preventDefault();
        const point = getCanvasPoint(e);
        if (!point || !markLastPoint.current) return;
        paintRemovalStroke(markLastPoint.current, point, markRemoveErasing);
        markLastPoint.current = point;
        return;
      }
      if (canvasTool !== "drawLine" || !pendingStart) return;
      e.preventDefault();
      const point = getCanvasPoint(e);
      if (point) setPreviewEnd(point);
    },
    [canvasTool, isMarkDrawing, markRemoveErasing, pendingStart, getCanvasPoint, paintRemovalStroke, updateRemovalCursor],
  );

  const handleCanvasPointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const point = getCanvasPoint(e);
      if (!point) return;

      if (canvasTool === "markRemove") {
        setIsMarkDrawing(true);
        markLastPoint.current = point;
        paintRemovalStroke(point, point, markRemoveErasing);
        return;
      }

      const w = strokeWidth();
      const threshold = Math.max(HIT_THRESHOLD_PX, w * 2);

      if (canvasTool === "removeLine") {
        const hitId = findLineAtPoint(lines, point, threshold);
        if (hitId) {
          setLines((prev) => prev.filter((l) => l.id !== hitId));
          setPendingStart(null);
          setPreviewEnd(null);
        }
        return;
      }

      if (!pendingStart) {
        setPendingStart(point);
        setPreviewEnd(point);
        return;
      }

      const dx = point.x - pendingStart.x;
      const dy = point.y - pendingStart.y;
      if (Math.hypot(dx, dy) < w) {
        setPendingStart(null);
        setPreviewEnd(null);
        return;
      }

      setLines((prev) => [
        ...prev,
        {
          id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          mode: brushMode,
          from: pendingStart,
          to: point,
        },
      ]);
      setPendingStart(null);
      setPreviewEnd(null);
    },
    [canvasTool, lines, pendingStart, brushMode, markRemoveErasing, getCanvasPoint, strokeWidth, paintRemovalStroke],
  );

  const handleCanvasPointerUp = useCallback(() => {
    setIsMarkDrawing(false);
    markLastPoint.current = null;
  }, []);

  const handleCanvasPointerLeave = useCallback(() => {
    handleCanvasPointerUp();
    setRemovalCursor(null);
  }, [handleCanvasPointerUp]);

  const handleClearAll = useCallback(() => {
    setLines([]);
    setPendingStart(null);
    setPreviewEnd(null);
    const removalCanvas = removalCanvasRef.current;
    if (removalCanvas) {
      const rctx = removalCanvas.getContext("2d");
      if (rctx) {
        rctx.fillStyle = "#000000";
        rctx.fillRect(0, 0, removalCanvas.width, removalCanvas.height);
      }
    }
    setHasRemovalStrokes(false);
    redrawCanvases([], null, null, brushModeRef.current);
  }, [redrawCanvases]);

  const handleDone = useCallback(() => {
    const compositeBase64 = snapshotCanvas(canvasRef.current);
    const strokeMapBase64 = snapshotCanvas(strokeCanvasRef.current);
    const removalMaskBase64 = hasRemovalStrokes
      ? snapshotCanvas(removalCanvasRef.current)
      : undefined;
    if (compositeBase64 && strokeMapBase64) {
      onExport({
        strokeMapBase64,
        strokeMapMimeType: "image/png",
        compositeBase64,
        compositeMimeType: "image/png",
        hasStructuralLines: lines.length > 0,
        hasRemovalMask: hasRemovalStrokes,
        ...(removalMaskBase64
          ? { removalMaskBase64, removalMaskMimeType: "image/png" }
          : {}),
      });
    }
    onFinish?.();
  }, [onExport, onFinish, hasRemovalStrokes]);

  const activeHint =
    canvasTool === "removeLine"
      ? t("components.structuralLineClickRemove")
      : canvasTool === "markRemove"
        ? markRemoveErasing
          ? t("components.structuralMarkRemoveEraseHint")
          : t("components.structuralMarkRemoveHint")
        : pendingStart
          ? t("components.structuralLineClickEnd")
          : t(MODE_HINT_KEYS[brushMode]);

  const hasContent = lines.length > 0 || hasRemovalStrokes;

  return (
    <div className={className ?? ""}>
      {!removeOnly && (
        <p className="text-xs text-[var(--muted-foreground)] mb-2 leading-snug">
          {t("components.structuralBoundaryHint")}
        </p>
      )}

      {!removeOnly && (
      <div className="flex flex-wrap gap-1.5 mb-2">
        <button
          type="button"
          onClick={() => {
            setCanvasTool("drawLine");
            setPendingStart(null);
            setPreviewEnd(null);
            setIsMarkDrawing(false);
          }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer transition-colors ${
            canvasTool === "drawLine"
              ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
              : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/40"
          }`}
        >
          <PencilLine size={12} />
          {t("components.structuralLineToolDraw")}
        </button>
        <button
          type="button"
          onClick={() => {
            setCanvasTool("removeLine");
            setPendingStart(null);
            setPreviewEnd(null);
            setIsMarkDrawing(false);
          }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer transition-colors ${
            canvasTool === "removeLine"
              ? "border-red-500 bg-red-500/10 text-red-600"
              : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-red-400/50"
          }`}
        >
          <Eraser size={12} />
          {t("components.structuralLineToolErase")}
        </button>
        <button
          type="button"
          onClick={() => {
            setCanvasTool("markRemove");
            setPendingStart(null);
            setPreviewEnd(null);
            setMarkRemoveErasing(false);
          }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer transition-colors ${
            canvasTool === "markRemove"
              ? "border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-700"
              : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-fuchsia-400/50"
          }`}
        >
          <Paintbrush size={12} />
          {t("components.structuralLineToolMarkRemove")}
        </button>
      </div>
      )}

      {canvasTool === "drawLine" && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {BRUSH_MODES.map((mode) => {
            const active = brushMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setBrushMode(mode);
                  setPendingStart(null);
                  setPreviewEnd(null);
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer transition-colors ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/40"
                }`}
                style={active ? { borderColor: MODE_COLORS[mode] } : undefined}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                  style={{ backgroundColor: MODE_COLORS[mode] }}
                />
                {t(MODE_LABEL_KEYS[mode])}
              </button>
            );
          })}
        </div>
      )}

      {canvasTool === "markRemove" && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button
            type="button"
            onClick={() => setMarkRemoveErasing(false)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer transition-colors ${
              !markRemoveErasing
                ? "border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-700"
                : "border-[var(--border)] text-[var(--muted-foreground)]"
            }`}
          >
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
              style={{ backgroundColor: REMOVAL_BRUSH_COLOR }}
            />
            {t("components.structuralLineToolMarkRemove")}
          </button>
          <button
            type="button"
            onClick={() => setMarkRemoveErasing(true)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border cursor-pointer transition-colors ${
              markRemoveErasing
                ? "border-red-500 bg-red-500/10 text-red-600"
                : "border-[var(--border)] text-[var(--muted-foreground)]"
            }`}
          >
            <Eraser size={12} />
            {t("components.structuralMarkRemoveErase")}
          </button>
        </div>
      )}

      <p className="text-[11px] text-[var(--muted-foreground)] mb-2 leading-snug">{activeHint}</p>

      <div
        ref={containerRef}
        className="relative rounded-xl overflow-hidden border-2 border-dashed border-[var(--primary)]/50"
      >
        <canvas
          ref={canvasRef}
          className={`w-full h-auto block touch-none ${
            canvasTool === "removeLine"
              ? "cursor-pointer"
              : canvasTool === "markRemove"
                ? "cursor-none"
                : "cursor-crosshair"
          }`}
          onMouseMove={handlePointerMove}
          onMouseDown={handleCanvasPointerDown}
          onMouseUp={handleCanvasPointerUp}
          onMouseLeave={handleCanvasPointerLeave}
          onTouchMove={handlePointerMove}
          onTouchStart={handleCanvasPointerDown}
          onTouchEnd={handleCanvasPointerUp}
        />
        {canvasTool === "markRemove" && removalCursor && (
          <div
            className="absolute pointer-events-none rounded-full border-2"
            style={{
              left: removalCursor.x,
              top: removalCursor.y,
              width: REMOVAL_BRUSH_SIZE,
              height: REMOVAL_BRUSH_SIZE,
              transform: "translate(-50%, -50%)",
              borderColor: markRemoveErasing ? "#ef4444" : REMOVAL_BRUSH_COLOR,
              backgroundColor: markRemoveErasing
                ? "rgba(239, 68, 68, 0.15)"
                : "rgba(255, 0, 255, 0.15)",
            }}
          />
        )}
        <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-white bg-black/50 px-2 py-0.5 rounded-full pointer-events-none select-none whitespace-nowrap max-w-[95%] text-center">
          {canvasTool === "removeLine"
            ? t("components.structuralLineClickRemove")
            : canvasTool === "markRemove"
              ? t("components.structuralMarkRemovePaint")
              : t("components.structuralLineClickStart")}
        </p>
      </div>

      {(lines.length > 0 || hasRemovalStrokes) && (
        <p className="text-[10px] text-[var(--muted-foreground)] mt-1.5">
          {lines.length > 0 && t("components.structuralLineCount", { count: lines.length })}
          {lines.length > 0 && hasRemovalStrokes && " · "}
          {hasRemovalStrokes && t("components.structuralRemovalMarkCount")}
        </p>
      )}

      <div className="flex gap-2 mt-2">
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="px-3 py-2 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
          >
            {t(removeOnly ? "components.removeItemsSkip" : "components.skipStructuralLines")}
          </button>
        )}
        <button
          type="button"
          onClick={handleClearAll}
          disabled={!hasContent}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--muted)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)]/50 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          <Trash2 size={14} />
          {t("components.clearAllDrawing")}
        </button>
        <button
          type="button"
          onClick={handleDone}
          disabled={!hasContent}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-[var(--primary)] text-white hover:brightness-110 transition-all cursor-pointer disabled:opacity-40"
        >
          <CheckCheck size={14} />
          {t("common.done")}
        </button>
      </div>
    </div>
  );
}
