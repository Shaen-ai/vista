"use client";

import { useMemo, useRef } from "react";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import type { FloorPlanAnalysis, RoomResult, UtilityEntryPoint, UtilityPointType, PlanColumn } from "@/lib/project/types";
import { ROOM_TYPES, type RoomType } from "@/lib/project/types";
import { computeBounds, flipY, pointInPolygon, polygonCentroid } from "@/lib/project/floorPlanGeometry";
import { cornerLabel } from "@/lib/roomShapePolygon";
import { UTILITY_ICONS } from "@/lib/project/utilityIcons";
import { RoomOpenings } from "./OpeningGlyphs";

export interface ViewpointMarker {
  photoId: string;
  x: number;
  y: number;
  angleDeg: number;
}

export interface FloorPlanHubProps {
  analysis: FloorPlanAnalysis;
  floorPlanImageSrc: string;
  rooms: RoomResult[];
  selectedRoomId: string | null;
  suggestedNextRoomId: string | null;
  onRoomSelect: (roomId: string) => void;
  onNextRoom?: () => void;
  mode: "review" | "design";
  /** Brief highlight when selection changes (e.g. Next room). */
  selectionFlashRoomId?: string | null;
  utilityPoints?: UtilityEntryPoint[];
  activePlacementType?: UtilityPointType | null;
  onPlaceUtility?: (type: UtilityPointType, x: number, y: number) => void;
  onRemoveUtility?: (id: string) => void;
  /** Camera viewpoints to draw (position + facing arrow). */
  viewpointMarkers?: ViewpointMarker[];
  /** When set, a click on the plan places/moves this photo's viewpoint. */
  activeViewpointPhotoId?: string | null;
  onPlaceViewpoint?: (x: number, y: number) => void;
  /** Move a structural column marker (mm coordinates). */
  onMoveColumn?: (id: string, x: number, y: number) => void;
  /** Remove a structural column marker. */
  onRemoveColumn?: (id: string) => void;
}

function roomStatusColor(
  roomId: string,
  rooms: RoomResult[],
  selectedRoomId: string | null,
): { fill: string; stroke: string } {
  if (selectedRoomId === roomId) {
    return { fill: "rgba(59, 130, 246, 0.45)", stroke: "rgb(59, 130, 246)" };
  }
  const room = rooms.find((r) => r.roomId === roomId);
  if (room?.status === "approved") {
    return { fill: "rgba(34, 197, 94, 0.4)", stroke: "rgb(34, 197, 94)" };
  }
  if (room && room.renders.length > 0) {
    return { fill: "rgba(249, 115, 22, 0.4)", stroke: "rgb(249, 115, 22)" };
  }
  if (room?.status === "generating" || room?.status === "editing") {
    return { fill: "rgba(168, 85, 247, 0.35)", stroke: "rgb(168, 85, 247)" };
  }
  if (room?.generationError) {
    return { fill: "rgba(239, 68, 68, 0.35)", stroke: "rgb(239, 68, 68)" };
  }
  return { fill: "rgba(148, 163, 184, 0.25)", stroke: "rgb(148, 163, 184)" };
}

export function roomHubStatusLabel(
  roomId: string,
  rooms: RoomResult[],
  t: (key: string, params?: Record<string, string>) => string,
): string {
  const room = rooms.find((r) => r.roomId === roomId);
  if (!room) return t("project.roomStatusNotStarted");
  if (room.status === "approved") return t("project.roomStatusApproved");
  if (room.status === "generating") return t("project.roomStatusGenerating");
  if (room.generationError && room.renders.length === 0) return t("project.roomStatusFailed");
  const targetCount = room.viewpointTargetCount ?? 0;
  if (
    targetCount > 1 &&
    room.renders.length > 0 &&
    room.renders.length < targetCount
  ) {
    return t("project.roomStatusPartialViews", {
      remaining: String(targetCount - room.renders.length),
    });
  }
  if (room.renders.length > 0 || room.status === "review") return t("project.roomStatusReview");
  return t("project.roomStatusNotStarted");
}

function columnHalfSizeMm(col: PlanColumn): number {
  return Math.max(col.width, col.depth) * 500;
}

function utilityShortLabel(type: UtilityPointType): string {
  switch (type) {
    case "water_inlet":
      return "Water";
    case "water_drain_stack":
      return "Drain";
    case "electrical_panel":
      return "Electric";
    case "gas_inlet":
      return "Gas";
    default:
      return "Utility";
  }
}

function utilityMarkerStyle(type: UtilityPointType): { fill: string; stroke: string } {
  switch (type) {
    case "water_inlet":
      return { fill: "rgb(59, 130, 246)", stroke: "rgb(29, 78, 216)" };
    case "water_drain_stack":
      return { fill: "rgb(14, 165, 233)", stroke: "rgb(3, 105, 161)" };
    case "electrical_panel":
      return { fill: "rgb(234, 179, 8)", stroke: "rgb(161, 98, 7)" };
    case "gas_inlet":
      return { fill: "rgb(239, 68, 68)", stroke: "rgb(185, 28, 28)" };
    default:
      return { fill: "rgb(100, 116, 139)", stroke: "rgb(71, 85, 105)" };
  }
}

export default function FloorPlanHub({
  analysis,
  floorPlanImageSrc,
  rooms,
  selectedRoomId,
  suggestedNextRoomId,
  onRoomSelect,
  onNextRoom,
  mode,
  selectionFlashRoomId = null,
  utilityPoints = [],
  activePlacementType = null,
  onPlaceUtility,
  onRemoveUtility,
  viewpointMarkers = [],
  activeViewpointPhotoId = null,
  onPlaceViewpoint,
  onMoveColumn,
  onRemoveColumn,
}: FloorPlanHubProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const utilityPointsList = utilityPoints;
  const columns = analysis.columns ?? [];
  // When the analyzer anchored the rooms to the uploaded plan it recorded the
  // image frame (mm). Use it as the viewBox so the overlay lines up with the
  // image; otherwise fall back to the rooms' bounding box.
  const imageFrame = analysis.imageFrame;
  const bounds = useMemo(
    () =>
      imageFrame
        ? { minX: 0, minY: 0, maxX: imageFrame.width, maxY: imageFrame.height }
        : computeBounds(analysis, utilityPointsList),
    [analysis, utilityPointsList, imageFrame],
  );
  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;
  const planWidth = bounds.maxX - bounds.minX;
  // Utility markers must read clearly on the floor-plan image (mm-scale viewBox).
  const markerRadius = Math.max(planWidth * 0.032, 280);
  const labelFontSize = Math.max(planWidth * 0.02, 160);

  const viewpointPlacing = Boolean(activeViewpointPhotoId && onPlaceViewpoint);

  const handleSvgClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const svgPt = pt.matrixTransform(ctm.inverse());
    const x = svgPt.x;
    const y = bounds.maxY - svgPt.y + bounds.minY;

    if (viewpointPlacing && onPlaceViewpoint) {
      // A click on a *different* room navigates there instead of moving the
      // active viewpoint — otherwise the user is trapped on the current room.
      const clickedRoom = analysis.rooms.find((r) =>
        pointInPolygon([x, y], r.polygon ?? []),
      );
      if (clickedRoom && clickedRoom.id !== selectedRoomId) {
        onRoomSelect(clickedRoom.id);
        return;
      }
      onPlaceViewpoint(x, y);
      return;
    }
    if (activePlacementType && onPlaceUtility) {
      onPlaceUtility(activePlacementType, x, y);
    }
  };

  const placementActive = Boolean((activePlacementType && onPlaceUtility) || viewpointPlacing);

  return (
    <div className="flex flex-col gap-3 w-full">
      <div
        className={`relative w-full rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--muted)] ${
          imageFrame ? "" : "aspect-[4/3]"
        }`}
        style={imageFrame ? { aspectRatio: `${imageFrame.width} / ${imageFrame.height}` } : undefined}
      >
        <img
          src={floorPlanImageSrc}
          alt="Floor plan"
          className="absolute inset-0 w-full h-full object-contain opacity-90 pointer-events-none"
        />
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className={`absolute inset-0 w-full h-full ${placementActive ? "cursor-crosshair" : ""}`}
          preserveAspectRatio="xMidYMid meet"
          onClick={placementActive ? handleSvgClick : undefined}
        >
          {analysis.wallSegments.map((w, i) => (
            <line
              key={`wall-${i}`}
              x1={w.x1}
              y1={flipY(w.y1, bounds)}
              x2={w.x2}
              y2={flipY(w.y2, bounds)}
              stroke="rgba(0,0,0,0.35)"
              strokeWidth={Math.max(w.thickness, 80)}
              strokeLinecap="square"
            />
          ))}

          {analysis.rooms.map((room) => {
            const polygon = room.polygon;
            if (!polygon || polygon.length < 3) return null;

            const flipped = polygon
              .map(([x, y]) => `${x},${flipY(y, bounds)}`)
              .join(" ");
            const [cx, cy] = polygonCentroid(polygon);
            const labelY = flipY(cy, bounds);
            const colors = roomStatusColor(room.id, rooms, selectedRoomId);
            const isSuggested = suggestedNextRoomId === room.id && mode === "design";

            return (
              <g key={room.id}>
                <polygon
                  points={flipped}
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth={isSuggested ? 120 : 60}
                  strokeDasharray={isSuggested ? "200 100" : undefined}
                  className={
                    placementActive
                      ? "pointer-events-none"
                      : "cursor-pointer transition-all hover:opacity-90"
                  }
                  onClick={
                    placementActive
                      ? undefined
                      : (e) => {
                          e.stopPropagation();
                          onRoomSelect(room.id);
                        }
                  }
                />
                <text
                  x={cx}
                  y={labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize={Math.max((bounds.maxX - bounds.minX) * 0.018, 180)}
                  fontWeight="600"
                  style={{ pointerEvents: "none", textShadow: "0 0 4px rgba(0,0,0,0.8)" }}
                >
                  {room.name}
                </text>
                {/* Corner letters (A, B, C…) on the active room so the user can map
                    each editable wall (A-B, B-C…) to a corner on the plan. */}
                {room.id === selectedRoomId &&
                  polygon.map((v, i) => {
                    // Offset INWARD (toward the room centre) so corner letters sit
                    // inside the room — letters on edge corners would otherwise fall
                    // outside the plan and get clipped by the white canvas.
                    const dx = cx - v[0];
                    const dy = cy - v[1];
                    const d = Math.hypot(dx, dy) || 1;
                    const off = Math.max((bounds.maxX - bounds.minX) * 0.02, 200);
                    const cornerFontSize = Math.max((bounds.maxX - bounds.minX) * 0.018, 180) * 1.6;
                    return (
                      <text
                        key={`corner-${i}`}
                        x={v[0] + (dx / d) * off}
                        y={flipY(v[1] + (dy / d) * off, bounds)}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#facc15"
                        fontSize={cornerFontSize}
                        fontWeight="800"
                        stroke="#000000"
                        strokeWidth={cornerFontSize * 0.12}
                        style={{ pointerEvents: "none", paintOrder: "stroke" }}
                      >
                        {cornerLabel(i)}
                      </text>
                    );
                  })}
              </g>
            );
          })}

          {analysis.rooms.map((room) => (
            <RoomOpenings key={`op-${room.id}`} room={room} bounds={bounds} planWidth={planWidth} />
          ))}

          {utilityPointsList.map((point) => {
            const style = utilityMarkerStyle(point.type);
            const displayY = flipY(point.y, bounds);
            const deleteRadius = markerRadius * 0.55;

            const mapLabel =
              point.label?.trim() || utilityShortLabel(point.type);

            return (
              <g key={point.id}>
                <circle
                  cx={point.x}
                  cy={displayY}
                  r={markerRadius * 1.15}
                  fill="white"
                  stroke="none"
                  style={{ pointerEvents: "none" }}
                />
                <circle
                  cx={point.x}
                  cy={displayY}
                  r={markerRadius}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={markerRadius * 0.14}
                  style={{ pointerEvents: placementActive ? "none" : "auto" }}
                />
                {(() => {
                  const Icon = UTILITY_ICONS[point.type];
                  if (!Icon) return null;
                  const iconSize = markerRadius * 1.4;
                  return (
                    <Icon
                      x={point.x - iconSize / 2}
                      y={displayY - iconSize / 2}
                      width={iconSize}
                      height={iconSize}
                      color="white"
                      strokeWidth={2.25}
                      style={{ pointerEvents: "none" }}
                    />
                  );
                })()}
                {mode === "review" && (
                  <text
                    x={point.x}
                    y={displayY + markerRadius * 1.55}
                    textAnchor="middle"
                    dominantBaseline="hanging"
                    fill={style.stroke}
                    fontSize={labelFontSize}
                    fontWeight="700"
                    style={{
                      pointerEvents: "none",
                      paintOrder: "stroke",
                      stroke: "white",
                      strokeWidth: labelFontSize * 0.22,
                    }}
                  >
                    {mapLabel.length > 28 ? `${mapLabel.slice(0, 26)}…` : mapLabel}
                  </text>
                )}
                {onRemoveUtility && !placementActive && (
                  <g
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveUtility(point.id);
                    }}
                  >
                    <circle
                      cx={point.x + markerRadius * 0.85}
                      cy={displayY - markerRadius * 0.85}
                      r={deleteRadius}
                      fill="rgba(0,0,0,0.75)"
                      stroke="white"
                      strokeWidth={markerRadius * 0.08}
                    />
                    <text
                      x={point.x + markerRadius * 0.85}
                      y={displayY - markerRadius * 0.85}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="white"
                      fontSize={deleteRadius * 1.4}
                      fontWeight="700"
                      style={{ pointerEvents: "none" }}
                    >
                      ×
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {columns.map((col) => {
            const displayY = flipY(col.y, bounds);
            const half = columnHalfSizeMm(col);
            const isCircle = col.shape === "circular";
            const deleteRadius = markerRadius * 0.55;
            return (
              <g key={col.id}>
                {isCircle ? (
                  <circle
                    cx={col.x}
                    cy={displayY}
                    r={half}
                    fill="rgba(100, 116, 139, 0.55)"
                    stroke="rgb(71, 85, 105)"
                    strokeWidth={markerRadius * 0.12}
                    className={onMoveColumn && !placementActive ? "cursor-move" : undefined}
                    onPointerDown={
                      onMoveColumn && !placementActive
                        ? (e) => {
                            e.stopPropagation();
                            (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId);
                            const svg = svgRef.current;
                            if (!svg) return;
                            const rect = svg.getBoundingClientRect();
                            const vb = bounds;
                            const scaleX = (vb.maxX - vb.minX) / rect.width;
                            const scaleY = (vb.maxY - vb.minY) / rect.height;
                            const startMm: [number, number] = [
                              vb.minX + (e.clientX - rect.left) * scaleX,
                              vb.maxY - (e.clientY - rect.top) * scaleY,
                            ];
                            const move = (ev: PointerEvent) => {
                              const x = vb.minX + (ev.clientX - rect.left) * scaleX;
                              const y = vb.maxY - (ev.clientY - rect.top) * scaleY;
                              onMoveColumn(col.id, x, y);
                            };
                            const up = () => {
                              window.removeEventListener("pointermove", move);
                              window.removeEventListener("pointerup", up);
                            };
                            window.addEventListener("pointermove", move);
                            window.addEventListener("pointerup", up);
                            void startMm;
                          }
                        : undefined
                    }
                  />
                ) : (
                  <rect
                    x={col.x - half}
                    y={displayY - half}
                    width={half * 2}
                    height={half * 2}
                    fill="rgba(100, 116, 139, 0.55)"
                    stroke="rgb(71, 85, 105)"
                    strokeWidth={markerRadius * 0.12}
                    className={onMoveColumn && !placementActive ? "cursor-move" : undefined}
                    onPointerDown={
                      onMoveColumn && !placementActive
                        ? (e) => {
                            e.stopPropagation();
                            (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId);
                            const svg = svgRef.current;
                            if (!svg) return;
                            const rect = svg.getBoundingClientRect();
                            const vb = bounds;
                            const scaleX = (vb.maxX - vb.minX) / rect.width;
                            const scaleY = (vb.maxY - vb.minY) / rect.height;
                            const move = (ev: PointerEvent) => {
                              const x = vb.minX + (ev.clientX - rect.left) * scaleX;
                              const y = vb.maxY - (ev.clientY - rect.top) * scaleY;
                              onMoveColumn(col.id, x, y);
                            };
                            const up = () => {
                              window.removeEventListener("pointermove", move);
                              window.removeEventListener("pointerup", up);
                            };
                            window.addEventListener("pointermove", move);
                            window.addEventListener("pointerup", up);
                          }
                        : undefined
                    }
                  />
                )}
                {onRemoveColumn && !placementActive && (
                  <g
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveColumn(col.id);
                    }}
                  >
                    <circle
                      cx={col.x + half * 0.7}
                      cy={displayY - half * 0.7}
                      r={deleteRadius}
                      fill="rgba(0,0,0,0.75)"
                      stroke="white"
                      strokeWidth={markerRadius * 0.08}
                    />
                    <text
                      x={col.x + half * 0.7}
                      y={displayY - half * 0.7}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="white"
                      fontSize={deleteRadius * 1.4}
                      fontWeight="700"
                      style={{ pointerEvents: "none" }}
                    >
                      ×
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {viewpointMarkers.map((vp) => {
            const cy = flipY(vp.y, bounds);
            const len = markerRadius * 2.4;
            const rad = (vp.angleDeg * Math.PI) / 180;
            // Y-up angle → SVG (Y-down) arrow endpoint.
            const ex = vp.x + len * Math.cos(rad);
            const ey = cy - len * Math.sin(rad);
            const active = vp.photoId === activeViewpointPhotoId;
            const color = active ? "rgb(168, 85, 247)" : "rgb(99, 102, 241)";
            return (
              <g key={`vp-${vp.photoId}`} style={{ pointerEvents: "none" }}>
                <line
                  x1={vp.x}
                  y1={cy}
                  x2={ex}
                  y2={ey}
                  stroke={color}
                  strokeWidth={markerRadius * 0.32}
                  strokeLinecap="round"
                />
                <circle cx={ex} cy={ey} r={markerRadius * 0.45} fill={color} />
                <circle
                  cx={vp.x}
                  cy={cy}
                  r={markerRadius * 0.85}
                  fill="white"
                  stroke={color}
                  strokeWidth={markerRadius * 0.22}
                />
                <circle cx={vp.x} cy={cy} r={markerRadius * 0.4} fill={color} />
              </g>
            );
          })}
        </svg>
      </div>

      {mode === "design" && onNextRoom && (
        <button
          type="button"
          onClick={onNextRoom}
          disabled={!suggestedNextRoomId}
          title={!suggestedNextRoomId ? t("project.nextRoomNoTarget") : undefined}
          className="self-center px-5 py-2.5 rounded-xl bg-[var(--primary)] text-white text-sm font-semibold hover:brightness-110 transition-all cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:brightness-100"
        >
          {t("project.nextRoom")} →
        </button>
      )}

      <div className="flex flex-wrap gap-3 text-[10px] text-[var(--muted-foreground)] justify-center">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-slate-400/40 border border-slate-400" /> Pending
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-blue-500/40 border border-blue-500" /> Selected
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-orange-500/40 border border-orange-500" /> Draft
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-green-500/40 border border-green-500" /> Approved
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-purple-500/40 border border-purple-500" /> Generating
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-500/40 border border-red-500" /> Failed
        </span>
      </div>
    </div>
  );
}

export { ROOM_TYPES, type RoomType };
