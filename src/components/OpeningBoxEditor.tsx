"use client";

import { useCallback, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";

/**
 * Manual correction layer for auto-detected window/door boxes. The boxes drive the
 * fal freeze mask (`buildFreezeMask`) and the Gemini opening guide (`annotateOpenings`),
 * so fixing a mis-detected opening here directly fixes the render's structural lock.
 *
 * Boxes are normalized (0–1, top-left origin) — the same shape the rest of the
 * pipeline consumes. Drag a box to move it, drag its bottom-right handle to resize,
 * use ✕ to delete, and the Add buttons to place a new opening.
 */

const WINDOW_COLOR = "#ff2d2d";
const DOOR_COLOR = "#1e7bff";
const MIN_SIZE = 0.03;

type DragState =
  | { kind: "move"; type: "window" | "door"; index: number; offsetX: number; offsetY: number }
  | { kind: "resize"; type: "window" | "door"; index: number }
  | null;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export interface OpeningBoxEditorProps {
  imageBase64: string;
  imageMimeType: string;
  windowBoxes: OpeningBox[];
  doorBoxes: OpeningBox[];
  onChange: (next: { window_boxes: OpeningBox[]; door_boxes: OpeningBox[] }) => void;
  windowLabel?: string;
  doorLabel?: string;
}

export default function OpeningBoxEditor({
  imageBase64,
  imageMimeType,
  windowBoxes,
  doorBoxes,
  onChange,
  windowLabel = "Window",
  doorLabel = "Door",
}: OpeningBoxEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>(null);

  const emit = useCallback(
    (windows: OpeningBox[], doors: OpeningBox[]) => {
      onChange({ window_boxes: windows, door_boxes: doors });
    },
    [onChange],
  );

  const pointerToNorm = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return;
      const { x, y } = pointerToNorm(e.clientX, e.clientY);
      const list = drag.type === "window" ? [...windowBoxes] : [...doorBoxes];
      const b = list[drag.index];
      if (!b) return;
      if (drag.kind === "move") {
        list[drag.index] = {
          ...b,
          x: clamp01(x - drag.offsetX),
          y: clamp01(y - drag.offsetY),
        };
      } else {
        list[drag.index] = {
          ...b,
          w: Math.max(MIN_SIZE, clamp01(x) - b.x),
          h: Math.max(MIN_SIZE, clamp01(y) - b.y),
        };
      }
      if (drag.type === "window") emit(list, doorBoxes);
      else emit(windowBoxes, list);
    },
    [drag, pointerToNorm, windowBoxes, doorBoxes, emit],
  );

  const endDrag = useCallback(() => setDrag(null), []);

  const addBox = useCallback(
    (type: "window" | "door") => {
      const fresh: OpeningBox = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
      if (type === "window") emit([...windowBoxes, fresh], doorBoxes);
      else emit(windowBoxes, [...doorBoxes, fresh]);
    },
    [windowBoxes, doorBoxes, emit],
  );

  const removeBox = useCallback(
    (type: "window" | "door", index: number) => {
      if (type === "window") emit(windowBoxes.filter((_, i) => i !== index), doorBoxes);
      else emit(windowBoxes, doorBoxes.filter((_, i) => i !== index));
    },
    [windowBoxes, doorBoxes, emit],
  );

  const renderBoxes = (boxes: OpeningBox[], type: "window" | "door") => {
    const color = type === "window" ? WINDOW_COLOR : DOOR_COLOR;
    const prefix = type === "window" ? "W" : "D";
    return boxes.map((b, i) => (
      <div
        key={`${type}-${i}`}
        className="absolute"
        style={{
          left: `${b.x * 100}%`,
          top: `${b.y * 100}%`,
          width: `${b.w * 100}%`,
          height: `${b.h * 100}%`,
          border: `2px solid ${color}`,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
          touchAction: "none",
          cursor: drag ? "grabbing" : "grab",
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const { x, y } = pointerToNorm(e.clientX, e.clientY);
          setDrag({ kind: "move", type, index: i, offsetX: x - b.x, offsetY: y - b.y });
        }}
      >
        <span
          className="absolute -top-0.5 left-0 px-1 text-[10px] font-bold text-white leading-tight"
          style={{ background: color }}
        >
          {prefix}
          {i + 1}
        </span>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removeBox(type, i);
          }}
          className="absolute -top-2 -right-2 rounded-full bg-white text-black w-4 h-4 flex items-center justify-center shadow"
          aria-label="Delete opening"
        >
          <X size={10} />
        </button>
        {/* bottom-right resize handle */}
        <div
          className="absolute -bottom-1.5 -right-1.5 w-3 h-3 rounded-sm"
          style={{ background: color, cursor: "nwse-resize", touchAction: "none" }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            setDrag({ kind: "resize", type, index: i });
          }}
        />
      </div>
    ));
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl border border-[var(--border)] select-none"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:${imageMimeType};base64,${imageBase64}`}
          alt=""
          className="w-full block pointer-events-none"
          draggable={false}
        />
        {renderBoxes(windowBoxes, "window")}
        {renderBoxes(doorBoxes, "door")}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => addBox("window")}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs border border-[var(--border)] bg-[var(--card)]"
        >
          <Plus size={12} style={{ color: WINDOW_COLOR }} /> {windowLabel}
        </button>
        <button
          type="button"
          onClick={() => addBox("door")}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs border border-[var(--border)] bg-[var(--card)]"
        >
          <Plus size={12} style={{ color: DOOR_COLOR }} /> {doorLabel}
        </button>
      </div>
    </div>
  );
}
