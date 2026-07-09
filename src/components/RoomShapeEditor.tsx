"use client";

import { useMemo } from "react";
import type { RoomPolygonEdge } from "@/lib/roomGeometryTypes";
import {
  cornerLabel,
  cornersFromPolygonEdges,
  getShapeTemplate,
  type Point2,
} from "@/lib/roomShapePolygon";

type RoomShapeEditorProps = {
  roomShape: string;
  edges: RoomPolygonEdge[];
  ceilingHeight: number;
  onEdgesChange: (edges: RoomPolygonEdge[]) => void;
  onCeilingChange: (height: number) => void;
  lowConfidence?: boolean;
  lowConfidenceLabel?: string;
  edgeLabel?: (label: string) => string;
  ceilingLabel?: string;
};

function projectCornersToSvg(corners: Point2[], pad: number, size: number): Point2[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const w = Math.max(maxX - minX, 0.1);
  const h = Math.max(maxY - minY, 0.1);
  const inner = size - pad * 2;
  const scale = Math.min(inner / w, inner / h);
  const ox = pad + (inner - w * scale) / 2 - minX * scale;
  const oy = pad + (inner - h * scale) / 2 + maxY * scale;

  return corners.map(([x, y]) => [x * scale + ox, oy - y * scale]);
}

export default function RoomShapeEditor({
  roomShape,
  edges,
  ceilingHeight,
  onEdgesChange,
  onCeilingChange,
  lowConfidence,
  lowConfidenceLabel,
  edgeLabel: edgeLabelFn,
  ceilingLabel = "Ceiling (m)",
}: RoomShapeEditorProps) {
  const template = getShapeTemplate(roomShape);

  const corners = useMemo(() => {
    if (!template) return [] as Point2[];
    return cornersFromPolygonEdges(template, edges);
  }, [template, edges]);

  const svgCorners = useMemo(
    () => (corners.length > 1 ? projectCornersToSvg(corners, 16, 200) : []),
    [corners],
  );

  const svgPoints = useMemo(
    () => svgCorners.map(([x, y]) => `${x},${y}`).join(" "),
    [svgCorners],
  );

  if (!template) return null;

  const uniqueCorners = svgCorners.slice(0, -1);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3">
        <svg
          viewBox="0 0 200 200"
          className="w-full max-w-[280px] mx-auto aspect-square"
          aria-label="Room floor plan preview"
        >
          {svgPoints ? (
            <polygon
              points={svgPoints}
              fill="rgba(59,130,246,0.12)"
              stroke="rgb(59,130,246)"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ) : null}
          {uniqueCorners.map(([sx, sy], i) => {
            return (
              <g key={`corner-${i}`}>
                <circle cx={sx} cy={sy} r={5} fill="white" stroke="rgb(37,99,235)" strokeWidth={1.5} />
                <text
                  x={sx}
                  y={sy - 10}
                  textAnchor="middle"
                  fill="rgb(37,99,235)"
                  fontSize={11}
                  fontWeight={700}
                >
                  {cornerLabel(i)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {edges.map((edge, i) => (
          <label key={edge.label} className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--muted-foreground)]">
                {edgeLabelFn ? edgeLabelFn(edge.label) : `${edge.label} (m)`}
              </span>
              {lowConfidence && i === 0 ? (
                <span className="text-amber-500/90 text-[10px] shrink-0">{lowConfidenceLabel}</span>
              ) : null}
            </span>
            <input
              type="number"
              step={0.1}
              min={0.1}
              value={edge.length_m}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                const val = Number.isFinite(v) ? Math.max(0.1, v) : 0.1;
                const next = edges.map((ed, j) =>
                  j === i ? { ...ed, length_m: val } : ed,
                );
                onEdgesChange(next);
              }}
              className="rounded-lg px-3 py-2 text-sm bg-[var(--card)] border border-[var(--border)]"
            />
          </label>
        ))}
      </div>

      <label className="flex flex-col gap-1 max-w-[12rem]">
        <span className="text-xs font-medium text-[var(--muted-foreground)]">{ceilingLabel}</span>
        <input
          type="number"
          step={0.1}
          min={0}
          value={ceilingHeight}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onCeilingChange(Number.isFinite(v) ? v : 0);
          }}
          className="rounded-lg px-3 py-2 text-sm bg-[var(--card)] border border-[var(--border)]"
        />
      </label>
    </div>
  );
}
