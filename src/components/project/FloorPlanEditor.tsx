"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, Maximize2, Scan, Hand, Trash2, Magnet, CornerUpLeft, PenTool, Check, X, AppWindow, DoorOpen, Undo2, Redo2, GripVertical } from "lucide-react";
import type { DetectedRoom, FloorPlanAnalysis, PlanColumn, RoomType } from "@/lib/project/types";
import { ROOM_TYPES } from "@/lib/project/types";
import {
  computeBounds,
  type Bounds,
  flipY,
  polygonCentroid,
  polygonArea,
  translatePolygon,
  moveEdge,
  dimensionsFromPolygon,
  edgeLengthMm,
  resizePolygonExtent,
  isRectanglePolygon,
  screenToMm,
  snapPointToGeometry,
  orthogonalVertexDrag,
  orthogonalEdgePush,
  isRectilinearPolygon,
  isCollinearVertex,
  wallPerpendicularDelta,
  dropCollinearVertices,
  axisAlignedRect,
  snapAndCloseGaps,
  pointAlongEdge,
  nearestEdgeToPoint,
  describeOpening,
  inferConnectsTo,
  openingEndpoints,
  isValidEdgeIndex,
  repairOpeningAnchors,
  sanitizePolygon,
  type Point,
} from "@/lib/project/floorPlanGeometry";
import { cornerLabel } from "@/lib/roomShapePolygon";
import { RoomOpenings } from "./OpeningGlyphs";
import DoorSwingPicker from "./DoorSwingPicker";
import { useTranslation } from "@/i18n/VistaLocaleProvider";
import {
  fpT,
  translateOpeningPosition,
  formatOpeningWallTitle,
  formatDoorConnectionSubtitle,
  formatEdgeLengthLabel,
  formatFootprint,
} from "@/lib/project/floorPlanEditorI18n";

const MIN_SCALE = 0.1; // how far the room view can zoom out (toward / past the whole plan)
const MAX_SCALE = 8; // how far in
const clampNum = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Manual zoom/pan over the auto-fit base view: scale (1 = base fit) + pan centre (mm). */
type ViewTransform = { scale: number; cx: number; cy: number };

/** Screen-space midpoint of the first two active pinch pointers. */
function pinchMidpoint(pts: { x: number; y: number }[]) {
  return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
}

/**
 * World (Y-up mm) point under a screen point, read straight from the SVG's live
 * `viewBox` — the source of truth for what is currently painted. Using this instead of
 * React-state bounds avoids a stale-closure feedback loop (anchor from one frame, scale
 * from another) that makes the plan jitter while zooming. Aspect of the viewBox always
 * matches the container, so the mapping is a direct proportion (no letterboxing).
 */
function worldAtClient(svg: SVGSVGElement, clientX: number, clientY: number): Point | null {
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const vb = svg.viewBox.baseVal;
  if (!vb.width || !vb.height) return null;
  const svgX = vb.x + ((clientX - rect.left) / rect.width) * vb.width;
  const svgY = vb.y + ((clientY - rect.top) / rect.height) * vb.height;
  // Invert flipY(y) = (maxY) - y + (minY), with minY = vb.y, maxY = vb.y + vb.height.
  return [svgX, vb.y + vb.height - svgY + vb.y];
}

const GRID_MM = 10; // 1 cm snapping grid — fine enough to align corners precisely
const VERTEX_SNAP_MM = 350; // snap a dragged corner onto a neighbour corner within 35 cm
const EDGE_SNAP_MM = 250; // snap a dragged corner onto a neighbour's wall line within 25 cm
const MERGE_MM = 250; // cluster radius for "snap & close gaps"

interface FloorPlanEditorProps {
  analysis: FloorPlanAnalysis;
  floorPlanImageSrc: string;
  selectedRoomId: string | null;
  onRoomSelect: (roomId: string | null) => void;
  /** Emits the full edited room set; the parent persists it (walls derived on confirm). */
  onRoomsChange: (rooms: DetectedRoom[]) => void;
  /** Restore the original analyzer output. */
  onReset?: () => void;
  roomTypeLabel?: (type: RoomType) => string;
  /**
   * Fixed drawing-canvas extent (mm). When set, the viewBox is stable (it does not
   * auto-fit to the rooms) and the canvas takes this aspect ratio — so manually drawn
   * rooms keep a realistic size and overlay the uploaded plan image 1:1.
   */
  canvasExtentMm?: { width: number; height: number };
  /**
   * When set, the editor zooms to this room and dims the rest (context only,
   * non-interactive). Drives the guided room-by-room confirmation flow.
   */
  focusRoomId?: string | null;
  /** Touch-first sizing: larger handles, no scroll-hijack while dragging. */
  isMobile?: boolean;
  /** Persist edited structural columns (when omitted, columns are read-only). */
  onColumnsChange?: (columns: PlanColumn[]) => void;
}

type OpeningKind = "window" | "door";

// `baseline` is the rooms snapshot at pointerdown — recorded as one undo step when
// the drag ends (per-frame changes during the drag are skipped).
type DragState =
  | { kind: "vertex"; roomId: string; vertexIndex: number; baseline: DetectedRoom[] }
  | { kind: "room"; roomId: string; startMm: Point; startPoly: Point[]; baseline: DetectedRoom[] }
  | { kind: "edge"; roomId: string; edgeIndex: number; startMm: Point; startPoly: Point[]; baseline: DetectedRoom[] }
  | { kind: "opening"; roomId: string; openingKind: OpeningKind; index: number; baseline: DetectedRoom[] };

interface OpeningRef {
  roomId: string;
  kind: OpeningKind;
  index: number;
}

const DEFAULT_WINDOW_W = 1.2; // metres
const DEFAULT_DOOR_W = 0.8; // metres
const WINDOW_FILL = "rgb(14, 165, 233)";
const DOOR_FILL = "rgb(217, 119, 6)";

function openingEdgeLengthMm(
  polygon: Point[] | undefined,
  edgeIndex: number | undefined,
): number | undefined {
  if (polygon === undefined || edgeIndex === undefined || !isValidEdgeIndex(polygon, edgeIndex)) {
    return undefined;
  }
  return edgeLengthMm(polygon, edgeIndex);
}

function columnHalfSizeMm(col: PlanColumn): number {
  return Math.max(col.width, col.depth) * 500;
}

/** Project a point onto a specific polygon edge and return the clamped 0..1 fraction. */
function edgeFraction(poly: Point[], edgeIndex: number, p: Point): number {
  const n = poly.length;
  const a = poly[edgeIndex % n];
  const b = poly[(edgeIndex + 1) % n];
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 <= 0) return 0;
  return Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
}

/** True when vertex `i` is on a curved section (angle between adjacent edges < 15 deg). */
function isCurveVertex(poly: Point[], i: number): boolean {
  const n = poly.length;
  if (n <= 4) return false;
  const prev = poly[(i - 1 + n) % n];
  const cur = poly[i];
  const next = poly[(i + 1) % n];
  const ax = cur[0] - prev[0], ay = cur[1] - prev[1];
  const bx = next[0] - cur[0], by = next[1] - cur[1];
  const dot = ax * bx + ay * by;
  const cross = ax * by - ay * bx;
  return Math.abs(Math.atan2(cross, dot) * (180 / Math.PI)) < 15;
}

/** Snap a translation delta to the grid so dragged rooms/walls keep clean coordinates. */
function snapDelta(dx: number, dy: number, gridMm: number): [number, number] {
  if (gridMm <= 0) return [dx, dy];
  return [Math.round(dx / gridMm) * gridMm, Math.round(dy / gridMm) * gridMm];
}

function defaultRoomPolygon(bounds: { minX: number; minY: number; maxX: number; maxY: number }): Point[] {
  // A 3m × 3m room dropped near the plan centre, capped so it never dominates a small canvas.
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const half = Math.min(1500, (bounds.maxX - bounds.minX) * 0.12);
  return [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ];
}

export default function FloorPlanEditor({
  analysis,
  floorPlanImageSrc,
  selectedRoomId,
  onRoomSelect,
  onRoomsChange,
  onReset,
  roomTypeLabel,
  canvasExtentMm,
  focusRoomId,
  isMobile = false,
  onColumnsChange,
}: FloorPlanEditorProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  // Active pointers (for two-finger pinch) + the in-progress pinch / pan gestures.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDist: number; startScale: number; anchor: Point } | null>(null);
  const panRef = useRef<{ startView: ViewTransform; startClientX: number; startClientY: number; moved: boolean } | null>(null);
  // Frozen bounds captured at drag start — prevents the viewBox↔polygon feedback loop
  // that causes wall oscillation in focus mode (same class of bug as the zoom jitter
  // fixed by worldAtClient, but for edit drags).
  const dragBoundsRef = useRef<Bounds | null>(null);
  const rooms = useMemo(() => analysis.rooms.map(repairOpeningAnchors), [analysis.rooms]);
  const columns = analysis.columns ?? [];
  // Prefer an explicit drawing canvas, then the image frame the auto-detect
  // analyzer recorded (so the overlay sits on the uploaded plan 1:1), and only
  // fall back to the rooms' bounding box for legacy analyses without a frame.
  const extentMm = canvasExtentMm ?? analysis.imageFrame ?? null;
  const fullBounds = useMemo(
    () =>
      extentMm
        ? { minX: 0, minY: 0, maxX: extentMm.width, maxY: extentMm.height }
        : computeBounds(analysis),
    [analysis, extentMm],
  );
  // When confirming one room at a time, zoom the canvas to that room (its bbox
  // padded by ~14%) so it fills the screen — essential on phones. The plan image
  // is rendered inside the SVG in this mode so it zooms in lockstep (see below).
  const focusRoom = useMemo(
    () =>
      focusRoomId
        ? rooms.find((r) => r.id === focusRoomId && (r.polygon?.length ?? 0) >= 3) ?? null
        : null,
    [focusRoomId, rooms],
  );
  // The auto-fit base view always frames the whole plan, even when one room is focused, so the
  // canvas never starts zoomed into a small room — that heavy zoom (combined with whole-plan pan
  // clamping) made dragging feel chaotic. The focused room stays highlighted and editable; users
  // can still zoom into it manually via the controls. Manual zoom/pan (`view`) layers on top of
  // this — see `bounds` below.
  const baseBounds = fullBounds;

  // Manual zoom/pan applied over the base fit. `null` = the auto-fit base view.
  const [view, setView] = useState<ViewTransform | null>(null);
  // Hand tool: when on, dragging anywhere on the plan moves the whole plan (instead of
  // selecting/editing rooms & openings). Lets the user drag the plan around when zoomed in.
  const [panMode, setPanMode] = useState(false);
  // Reset the manual view when the focused room changes (re-fit to the new room).
  // Adjusting state during render is React's recommended alternative to a reset effect.
  const [lastFocusRoomId, setLastFocusRoomId] = useState(focusRoomId);
  if (focusRoomId !== lastFocusRoomId) {
    setLastFocusRoomId(focusRoomId);
    setView(null);
  }

  // Effective bounds = base bounds scaled around the pan centre. Same aspect ratio as
  // `baseBounds` (width & height divide by the same `scale`), so the container box never
  // reflows while zooming and `preserveAspectRatio="xMidYMid meet"` stays exact.
  const bounds = useMemo(() => {
    if (!view) return baseBounds;
    const baseW = baseBounds.maxX - baseBounds.minX;
    const baseH = baseBounds.maxY - baseBounds.minY;
    const w = baseW / view.scale;
    const h = baseH / view.scale;
    return { minX: view.cx - w / 2, minY: view.cy - h / 2, maxX: view.cx + w / 2, maxY: view.cy + h / 2 };
  }, [view, baseBounds]);

  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;
  const planWidth = bounds.maxX - bounds.minX;
  // Touch handles need a larger minimum so they stay thumb-sized on a small canvas.
  const handleScale = isMobile ? 1.7 : 1;
  const vertexRadius = Math.max(planWidth * 0.012, 120) * handleScale;
  const labelSize = Math.max(planWidth * 0.018, 180);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  // Advanced unlocks free-form editing; default (off) keeps every room rectilinear.
  const [advanced, setAdvanced] = useState(false);
  // null = not drawing; "rect" = click-drag a rectangle (simple); "free" = trace corners (advanced).
  const [drawMode, setDrawMode] = useState<null | "rect" | "free">(null);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [rectAnchor, setRectAnchor] = useState<Point | null>(null);
  const [cursorMm, setCursorMm] = useState<Point | null>(null);
  const [openingMode, setOpeningMode] = useState<OpeningKind | null>(null);
  const [openingPlaceHint, setOpeningPlaceHint] = useState<string | null>(null);
  const openingPointerRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const lastOpeningPlaceAtRef = useRef(0);
  const [selectedOpening, setSelectedOpening] = useState<OpeningRef | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const popupDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const sidebarPanelRef = useRef<HTMLDivElement>(null);

  // Anchor the popup to the sidebar panel (not the viewport) when an opening is selected.
  useLayoutEffect(() => {
    if (!selectedOpening) {
      setPopupPos(null);
      return;
    }
    const el = sidebarPanelRef.current;
    if (el) {
      const { left, top } = el.getBoundingClientRect();
      setPopupPos({ x: left, y: top + 8 });
    } else {
      setPopupPos({ x: 16, y: 80 });
    }
  }, [selectedOpening]);

  // Drag-to-move handlers for the floating opening editor popup.
  const onPopupDragStart = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-opening-popup-close]")) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const el = (e.currentTarget as HTMLElement).closest("[data-opening-popup]") as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    popupDragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top };
  }, []);

  const onPopupDragMove = useCallback((e: React.PointerEvent) => {
    const d = popupDragRef.current;
    if (!d) return;
    setPopupPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) });
  }, []);

  const onPopupDragEnd = useCallback(() => {
    popupDragRef.current = null;
  }, []);

  const closeOpeningPopup = useCallback(() => {
    popupDragRef.current = null;
    setPopupPos(null);
    setSelectedOpening(null);
  }, []);

  // --- Undo / redo history (controlled component) ---
  // The rooms live in the parent; we keep snapshots so Ctrl+Z / Ctrl+Shift+Z work.
  // Snapshots are recorded inside edit handlers (never during render) — one entry per
  // discrete edit and one per drag gesture (the pre-drag baseline pushed on release).
  const [history, setHistory] = useState<{ past: DetectedRoom[][]; future: DetectedRoom[][] }>({
    past: [],
    future: [],
  });

  // Push a pre-edit snapshot; clears the redo stack. Called from handlers only.
  const recordSnapshot = useCallback((snapshot: DetectedRoom[]) => {
    setHistory((h) => ({ past: [...h.past, snapshot], future: [] }));
  }, []);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const undo = useCallback(() => {
    if (history.past.length === 0) return;
    const prev = history.past[history.past.length - 1];
    setHistory({ past: history.past.slice(0, -1), future: [...history.future, rooms] });
    setSelectedVertex(null);
    setSelectedOpening(null);
    onRoomsChange(prev);
  }, [history, rooms, onRoomsChange]);

  const redo = useCallback(() => {
    if (history.future.length === 0) return;
    const next = history.future[history.future.length - 1];
    setHistory({ past: [...history.past, rooms], future: history.future.slice(0, -1) });
    setSelectedVertex(null);
    setSelectedOpening(null);
    onRoomsChange(next);
  }, [history, rooms, onRoomsChange]);

  // Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z or Ctrl+Y redo. Ignored while tracing or typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (drawMode) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode, undo, redo]);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;

  /** Replace one room's windows or doors via an updater on the chosen array. */
  const mutateOpenings = useCallback(
    (
      roomId: string,
      kind: OpeningKind,
      updater: (list: DetectedRoom["windows"] | DetectedRoom["doors"]) => void,
    ) => {
      if (!drag) recordSnapshot(rooms); // drag edits are coalesced via the gesture baseline
      const next = rooms.map((r) => {
        if (r.id !== roomId) return r;
        if (kind === "window") {
          const windows = [...r.windows];
          updater(windows);
          return { ...r, windows };
        }
        const doors = [...r.doors];
        updater(doors);
        return { ...r, doors };
      });
      onRoomsChange(next);
    },
    [rooms, onRoomsChange, drag, recordSnapshot],
  );

  const nearestOpeningTarget = useCallback(
    (candidateRooms: DetectedRoom[], mm: Point) => {
      let target: { room: DetectedRoom; edgeIndex: number; t: number; dist: number } | null = null;
      for (const r of candidateRooms) {
        const poly = r.polygon;
        if (!poly || poly.length < 3) continue;
        const near = nearestEdgeToPoint(poly, mm);
        if (!target || near.distMm < target.dist) {
          target = { room: r, edgeIndex: near.edgeIndex, t: near.t, dist: near.distMm };
        }
      }
      return target;
    },
    [],
  );

  /** Drop a new window/door on the wall nearest to `mm`, across all rooms. */
  const placeOpening = useCallback(
    (kind: OpeningKind, mm: Point) => {
      // Guided per-room mode: only that room. Otherwise prefer the selected room when
      // the click is near its wall, then fall back to the globally nearest wall so a tap
      // anywhere still lands an opening on the closest wall (matches the room-drag model).
      const selected = selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) ?? null : null;
      // Treat a tap as "on" the selected room when within a generous slice of the visible
      // plan (the trace canvas can be >20 m wide, so a fixed mm gate is far too tight).
      const nearThresholdMm = Math.max(2500, (bounds.maxX - bounds.minX) * 0.2);
      let target = focusRoom
        ? nearestOpeningTarget([focusRoom], mm)
        : selected
          ? nearestOpeningTarget([selected], mm)
          : null;
      if (!focusRoom && (!target || target.dist > nearThresholdMm)) {
        // Either no room was selected, or the tap is closer to a different room's wall.
        const global = nearestOpeningTarget(rooms, mm);
        if (global && (!target || global.dist < target.dist)) target = global;
      }
      if (!target) {
        setOpeningPlaceHint(fpT(t, "placeOpeningHintNoRoom"));
        return;
      }
      setOpeningPlaceHint(null);
      const { room, edgeIndex, t: edgeT } = target;
      const poly = room.polygon!;
      const position = describeOpening(poly, edgeIndex, edgeT);
      // User-created openings are confirmed by definition (authoritative count).
      if (kind === "window") {
        const opening = { position, width: DEFAULT_WINDOW_W, height: 1.5, edgeIndex, t: edgeT, confirmed: true };
        mutateOpenings(room.id, "window", (list) => (list as DetectedRoom["windows"]).push(opening));
        setSelectedOpening({ roomId: room.id, kind: "window", index: room.windows.length });
      } else {
        const connectsTo = inferConnectsTo(rooms, room, edgeIndex, edgeT);
        const opening = { position, width: DEFAULT_DOOR_W, connectsTo, edgeIndex, t: edgeT, confirmed: true };
        mutateOpenings(room.id, "door", (list) => (list as DetectedRoom["doors"]).push(opening));
        setSelectedOpening({ roomId: room.id, kind: "door", index: room.doors.length });
      }
      onRoomSelect(room.id);
    },
    [rooms, focusRoom, selectedRoomId, bounds, nearestOpeningTarget, mutateOpenings, onRoomSelect, t],
  );

  const placeOpeningAtClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!openingMode || !svgRef.current) return;
      const now = Date.now();
      if (now - lastOpeningPlaceAtRef.current < 250) return;
      lastOpeningPlaceAtRef.current = now;
      const mm = screenToMm(svgRef.current, clientX, clientY, bounds);
      if (mm) placeOpening(openingMode, mm);
    },
    [openingMode, bounds, placeOpening],
  );

  /** Slide an existing opening to a new fraction along its wall (keeps it on the same edge). */
  const setOpeningT = useCallback(
    (ref: OpeningRef, t: number) => {
      const room = rooms.find((r) => r.id === ref.roomId);
      const poly = room?.polygon;
      if (!poly) return;
      mutateOpenings(ref.roomId, ref.kind, (list) => {
        const o = list[ref.index];
        if (!o || o.edgeIndex === undefined) return;
        o.t = t;
        o.confirmed = true;
        o.position = describeOpening(poly, o.edgeIndex, t);
        if (ref.kind === "door") {
          (o as DetectedRoom["doors"][number]).connectsTo = inferConnectsTo(rooms, room!, o.edgeIndex, t);
        }
      });
    },
    [rooms, mutateOpenings],
  );

  const setOpeningWidth = useCallback(
    (ref: OpeningRef, metres: number) => {
      if (!Number.isFinite(metres) || metres <= 0) return;
      mutateOpenings(ref.roomId, ref.kind, (list) => {
        const o = list[ref.index];
        if (o) {
          o.width = metres;
          o.confirmed = true;
        }
      });
    },
    [mutateOpenings],
  );

  const setOpeningHeight = useCallback(
    (ref: OpeningRef, metres: number) => {
      if (!Number.isFinite(metres) || metres <= 0) return;
      mutateOpenings(ref.roomId, ref.kind, (list) => {
        const o = list[ref.index];
        if (o) {
          (o as Record<string, unknown>).height = metres;
          o.confirmed = true;
        }
      });
    },
    [mutateOpenings],
  );

  const setDoorHinge = useCallback(
    (ref: OpeningRef, hinge: "left" | "right") => {
      mutateOpenings(ref.roomId, "door", (list) => {
        const o = list[ref.index] as DetectedRoom["doors"][number] | undefined;
        if (o) {
          o.hinge = hinge;
          o.confirmed = true;
        }
      });
    },
    [mutateOpenings],
  );

  const setDoorSwing = useCallback(
    (ref: OpeningRef, swing: "in" | "out") => {
      mutateOpenings(ref.roomId, "door", (list) => {
        const o = list[ref.index] as DetectedRoom["doors"][number] | undefined;
        if (o) {
          o.swing = swing;
          o.confirmed = true;
        }
      });
    },
    [mutateOpenings],
  );

  const removeOpening = useCallback(
    (ref: OpeningRef) => {
      mutateOpenings(ref.roomId, ref.kind, (list) => list.splice(ref.index, 1));
      setSelectedOpening(null);
    },
    [mutateOpenings],
  );

  /** Re-anchor a room's openings after its polygon topology changed (vertex add/remove). */
  const reanchorOpenings = useCallback((room: DetectedRoom, oldPoly: Point[], newPoly: Point[]) => {
    const remap = <T extends { edgeIndex?: number; t?: number; position: string }>(o: T): T => {
      if (o.edgeIndex === undefined || oldPoly.length < 2 || newPoly.length < 2) return o;
      const world = pointAlongEdge(oldPoly, o.edgeIndex, o.t ?? 0.5);
      const near = nearestEdgeToPoint(newPoly, world);
      return { ...o, edgeIndex: near.edgeIndex, t: near.t, position: describeOpening(newPoly, near.edgeIndex, near.t) };
    };
    return {
      windows: room.windows.map(remap),
      doors: room.doors.map((d) => {
        const m = remap(d);
        return { ...m, connectsTo: m.edgeIndex !== undefined ? inferConnectsTo(rooms, room, m.edgeIndex, m.t ?? 0.5) : d.connectsTo };
      }),
    };
  }, [rooms]);

  // All vertices except the one being dragged — used as snap targets.
  const snapTargets = useCallback(
    (excludeRoomId: string, excludeIndex: number): Point[] => {
      const pts: Point[] = [];
      for (const r of rooms) {
        (r.polygon ?? []).forEach((p, i) => {
          if (r.id === excludeRoomId && i === excludeIndex) return;
          pts.push(p);
        });
      }
      return pts;
    },
    [rooms],
  );

  // Every wall segment of OTHER rooms — snap targets so a dragged corner lands on
  // a neighbour's wall line (making the two rooms share that wall exactly).
  const edgeTargets = useCallback(
    (excludeRoomId: string): [Point, Point][] => {
      const edges: [Point, Point][] = [];
      for (const r of rooms) {
        if (r.id === excludeRoomId) continue;
        const poly = r.polygon ?? [];
        for (let i = 0; i < poly.length; i++) {
          edges.push([poly[i], poly[(i + 1) % poly.length]]);
        }
      }
      return edges;
    },
    [rooms],
  );

  const updateRoom = useCallback(
    (roomId: string, polygon: Point[]) => {
      if (!drag) recordSnapshot(rooms); // drag edits are coalesced via the gesture baseline
      const next = rooms.map((r) =>
        r.id === roomId
          ? {
              ...r,
              polygon,
              dimensions: dimensionsFromPolygon(polygon, r.dimensions.height),
              estimatedArea: Math.round(((polygonArea(polygon) / 1_000_000) * 10)) / 10,
            }
          : r,
      );
      onRoomsChange(next);
    },
    [rooms, onRoomsChange, drag, recordSnapshot],
  );

  // Replace a room's polygon AND re-anchor its openings (use when the corner count may
  // change, e.g. orthogonal wall pushes that insert jogs). Records no undo snapshot — the
  // caller owns coalescing (drag gestures record their baseline on release).
  const setRoomPolygonReanchored = useCallback(
    (room: DetectedRoom, newPoly: Point[]) => {
      const { windows, doors } = reanchorOpenings(room, room.polygon ?? [], newPoly);
      onRoomsChange(
        rooms.map((r) =>
          r.id === room.id
            ? {
                ...r,
                polygon: newPoly,
                dimensions: dimensionsFromPolygon(newPoly, r.dimensions.height),
                estimatedArea: Math.round((polygonArea(newPoly) / 1_000_000) * 10) / 10,
                windows,
                doors,
              }
            : r,
        ),
      );
    },
    [rooms, reanchorOpenings, onRoomsChange],
  );

  // Begin a pan gesture, capturing the view + pointer baseline.
  const startPan = useCallback(
    (clientX: number, clientY: number) => {
      panRef.current = {
        startView: view ?? {
          scale: 1,
          cx: (baseBounds.minX + baseBounds.maxX) / 2,
          cy: (baseBounds.minY + baseBounds.maxY) / 2,
        },
        startClientX: clientX,
        startClientY: clientY,
        moved: false,
      };
    },
    [view, baseBounds],
  );

  // Apply an in-progress pan: shift the view centre by the pointer's mm delta.
  const doPan = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!panRef.current || !svg) return;
      const rect = svg.getBoundingClientRect();
      const { startView } = panRef.current;
      const w = (baseBounds.maxX - baseBounds.minX) / startView.scale;
      const h = (baseBounds.maxY - baseBounds.minY) / startView.scale;
      const dxMm = ((clientX - panRef.current.startClientX) * w) / rect.width;
      const dyMm = ((clientY - panRef.current.startClientY) * h) / rect.height;
      if (Math.hypot(clientX - panRef.current.startClientX, clientY - panRef.current.startClientY) > 4) {
        panRef.current.moved = true;
      }
      setView({
        scale: startView.scale,
        cx: clampNum(startView.cx - dxMm, fullBounds.minX, fullBounds.maxX),
        cy: clampNum(startView.cy + dyMm, fullBounds.minY, fullBounds.maxY),
      });
    },
    [baseBounds, fullBounds],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;

      // One-finger / mouse drag on empty canvas pans the view (pinch is handled in
      // the container capture handlers; element drags stopPropagation before here).
      if (panRef.current && !pinchRef.current) {
        doPan(e.clientX, e.clientY);
        return;
      }

      const activeBounds = dragBoundsRef.current ?? bounds;
      const mm = screenToMm(svgRef.current, e.clientX, e.clientY, activeBounds);
      if (!mm) return;

      // In draw mode the SVG just tracks the cursor for the rubber-band preview.
      if (drawMode) {
        setCursorMm(mm);
        return;
      }
      if (!drag) return;

      if (drag.kind === "vertex") {
        const room = rooms.find((r) => r.id === drag.roomId);
        if (!room?.polygon) return;
        // 1 cm grid, no magnet. Simple mode keeps the room rectilinear (neighbours slide
        // so every wall stays axis-aligned); advanced moves just the one corner. Rooms
        // that aren't rectilinear (angled/diagonal walls) always move just the one corner
        // too — the orthogonal slide would flatten their angled walls into a rectangle.
        const target: Point = [
          Math.round(mm[0] / GRID_MM) * GRID_MM,
          Math.round(mm[1] / GRID_MM) * GRID_MM,
        ];
        // A freshly inserted corner sits collinear on a straight wall; dragging it must move
        // only that corner (freeform) so the user can pull a real corner out — otherwise the
        // rectilinear slide moves the whole wall and the corner gets reabsorbed on release.
        const freeform =
          advanced ||
          !isRectilinearPolygon(room.polygon) ||
          isCollinearVertex(room.polygon, drag.vertexIndex);
        const poly = freeform
          ? room.polygon.map<Point>((p, i) => (i === drag.vertexIndex ? target : p))
          : orthogonalVertexDrag(room.polygon, drag.vertexIndex, target);
        updateRoom(drag.roomId, poly);
        return;
      }

      if (drag.kind === "opening") {
        const room = rooms.find((r) => r.id === drag.roomId);
        const poly = room?.polygon;
        if (!poly) return;
        const list = drag.openingKind === "window" ? room!.windows : room!.doors;
        const o = list[drag.index];
        if (!o || o.edgeIndex === undefined) return;
        setOpeningT({ roomId: drag.roomId, kind: drag.openingKind, index: drag.index }, edgeFraction(poly, o.edgeIndex, mm));
        return;
      }

      const [dx, dy] = snapDelta(mm[0] - drag.startMm[0], mm[1] - drag.startMm[1], GRID_MM);
      if (drag.kind === "room") {
        updateRoom(drag.roomId, translatePolygon(drag.startPoly, dx, dy));
        return;
      }
      // Edge drag. Advanced = free wall translate; simple = perpendicular push that keeps
      // the room rectilinear (auto-jogs where a flanking wall is collinear → builds L/T).
      // Non-rectilinear rooms (angled walls) also translate freely — the orthogonal push
      // assumes axis-aligned walls and would flatten them.
      if (advanced || !isRectilinearPolygon(drag.startPoly)) {
        updateRoom(drag.roomId, moveEdge(drag.startPoly, drag.edgeIndex, dx, dy));
        return;
      }
      const room = rooms.find((r) => r.id === drag.roomId);
      if (!room?.polygon) return;
      const [pdx, pdy] = wallPerpendicularDelta(drag.startPoly, drag.edgeIndex, dx, dy);
      const pushed = orthogonalEdgePush(drag.startPoly, drag.edgeIndex, pdx, pdy);
      setRoomPolygonReanchored(room, pushed);
    },
    [drag, drawMode, advanced, bounds, doPan, rooms, updateRoom, setRoomPolygonReanchored, setOpeningT],
  );

  const endDrag = useCallback(() => {
    // Commit the whole drag as a single undo step: the baseline captured on
    // pointerdown is recorded once here (per-frame changes were skipped above).
    if (drag && rooms !== drag.baseline) {
      recordSnapshot(drag.baseline);
      // Simple mode: drop any 180° corners the gesture flattened (e.g. a wall pushed
      // back flush) so the saved polygon stays clean.
      if (!advanced) {
        const room = rooms.find((r) => r.id === drag.roomId);
        if (room?.polygon) {
          const tidied = dropCollinearVertices(room.polygon);
          if (tidied.length !== room.polygon.length) setRoomPolygonReanchored(room, tidied);
        }
      }
    }
    setDrag(null);
    dragBoundsRef.current = null;
  }, [drag, rooms, advanced, recordSnapshot, setRoomPolygonReanchored]);

  // --- Zoom / pan ------------------------------------------------------------
  // Set the view to `newScale` while keeping `anchor` (mm) pinned under the screen
  // point (clientX, clientY). Used by buttons (anchor = centre), wheel & pinch.
  const setViewAnchored = useCallback(
    (newScale: number, anchor: Point, clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const s = clampNum(newScale, MIN_SCALE, MAX_SCALE);
      const w = (baseBounds.maxX - baseBounds.minX) / s;
      const h = (baseBounds.maxY - baseBounds.minY) / s;
      // Solve for the centre so `anchor` lands under (clientX, clientY) at scale s.
      const cx = anchor[0] + w / 2 - ((clientX - rect.left) * w) / rect.width;
      const cy = anchor[1] - h / 2 + ((clientY - rect.top) * h) / rect.height;
      setView({
        scale: s,
        cx: clampNum(cx, fullBounds.minX, fullBounds.maxX),
        cy: clampNum(cy, fullBounds.minY, fullBounds.maxY),
      });
    },
    [baseBounds, fullBounds],
  );

  // Current zoom scale as painted (DOM truth), so it compounds correctly across rapid
  // events without depending on possibly-stale React state.
  const domScale = useCallback(
    (svg: SVGSVGElement) => (baseBounds.maxX - baseBounds.minX) / (svg.viewBox.baseVal.width || (baseBounds.maxX - baseBounds.minX)),
    [baseBounds],
  );

  // +/- buttons: zoom a fixed step around the canvas centre.
  const zoomByStep = useCallback(
    (factor: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const cxClient = rect.left + rect.width / 2;
      const cyClient = rect.top + rect.height / 2;
      const anchor = worldAtClient(svg, cxClient, cyClient);
      if (!anchor) return;
      setViewAnchored(domScale(svg) * factor, anchor, cxClient, cyClient);
    },
    [domScale, setViewAnchored],
  );

  // "Whole plan": frame the entire floor plan inside the (room-aspect) viewport.
  const fitWholePlan = useCallback(() => {
    const baseW = baseBounds.maxX - baseBounds.minX;
    const baseH = baseBounds.maxY - baseBounds.minY;
    const fw = fullBounds.maxX - fullBounds.minX || 1;
    const fh = fullBounds.maxY - fullBounds.minY || 1;
    setView({
      scale: Math.min(baseW / fw, baseH / fh),
      cx: (fullBounds.minX + fullBounds.maxX) / 2,
      cy: (fullBounds.minY + fullBounds.maxY) / 2,
    });
  }, [baseBounds, fullBounds]);

  // Non-passive wheel listener (so preventDefault works): zoom toward the cursor.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!focusRoom) return; // only the per-room view zooms (bg image lives in the SVG there)
      e.preventDefault();
      const anchor = worldAtClient(svg, e.clientX, e.clientY);
      if (!anchor) return;
      const factor = Math.exp(-e.deltaY * 0.0035);
      setViewAnchored(domScale(svg) * factor, anchor, e.clientX, e.clientY);
    };
    // Subscribe once per focus view (not per zoom step) so the handler never goes stale
    // mid-gesture — that staleness was the source of the zoom jitter.
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [focusRoom, domScale, setViewAnchored]);

  // Two-finger pinch — tracked in the capture phase on the container so it wins over
  // child element drags. A second finger cancels any in-progress single-pointer drag.
  const onContainerPointerDownCapture = useCallback(
    (e: React.PointerEvent) => {
      if (!focusRoom) return; // manual zoom/pan only in the per-room focus view
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2 && svgRef.current) {
        const svg = svgRef.current;
        setDrag(null); // a pinch supersedes any element/room drag that just started
        panRef.current = null;
        const pts = [...pointersRef.current.values()];
        const mid = pinchMidpoint(pts);
        const anchor = worldAtClient(svg, mid.x, mid.y);
        if (anchor) {
          pinchRef.current = {
            startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
            startScale: domScale(svg),
            anchor,
          };
        }
      }
    },
    [focusRoom, domScale],
  );
  const onContainerPointerMoveCapture = useCallback(
    (e: React.PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pinch = pinchRef.current;
      if (!pinch || pointersRef.current.size < 2) return;
      const pts = [...pointersRef.current.values()].slice(0, 2);
      const mid = pinchMidpoint(pts);
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      setViewAnchored((dist / pinch.startDist) * pinch.startScale, pinch.anchor, mid.x, mid.y);
    },
    [setViewAnchored],
  );
  const onContainerPointerUpCapture = useCallback((e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
  }, []);

  const createRoomFromPolygon = useCallback(
    (poly: Point[]) => {
      recordSnapshot(rooms);
      const id = `room-${Date.now().toString(36)}`;
      const newRoom: DetectedRoom = {
        id,
        name: `Room ${rooms.length + 1}`,
        type: "other",
        estimatedArea: Math.round((polygonArea(poly) / 1_000_000) * 10) / 10,
        dimensions: dimensionsFromPolygon(poly, analysis.ceilingHeight || 2.7),
        windows: [],
        doors: [],
        features: [],
        polygon: poly,
      };
      onRoomsChange([...rooms, newRoom]);
      onRoomSelect(id);
      setSelectedVertex(null);
    },
    [rooms, analysis.ceilingHeight, onRoomsChange, onRoomSelect, recordSnapshot],
  );

  const addRoom = useCallback(() => {
    createRoomFromPolygon(defaultRoomPolygon(bounds));
  }, [bounds, createRoomFromPolygon]);

  // --- Draw-room tools (rectangle drag in simple mode, corner trace in advanced) ---
  const cancelDraft = useCallback(() => {
    setDraftPoints([]);
    setRectAnchor(null);
    setCursorMm(null);
    setDrawMode(null);
  }, []);

  const commitDraft = useCallback(() => {
    if (draftPoints.length >= 3) createRoomFromPolygon(draftPoints);
    cancelDraft();
  }, [draftPoints, createRoomFromPolygon, cancelDraft]);

  const gridSnap = useCallback(
    (p: Point): Point => [Math.round(p[0] / GRID_MM) * GRID_MM, Math.round(p[1] / GRID_MM) * GRID_MM],
    [],
  );

  // Rectangle tool: pointer-down anchors a corner, pointer-up (handled in endDrag) commits.
  const startRect = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (drawMode !== "rect" || !svgRef.current) return;
      const mm = screenToMm(svgRef.current, e.clientX, e.clientY, bounds);
      if (!mm) return;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      const a = gridSnap(mm);
      setRectAnchor(a);
      setCursorMm(a);
    },
    [drawMode, bounds, gridSnap],
  );

  const finishRect = useCallback(() => {
    if (drawMode !== "rect") return;
    if (rectAnchor && cursorMm) {
      const b = gridSnap(cursorMm);
      // Require a meaningfully sized rectangle (≥ 10 cm each side) before creating it.
      if (Math.abs(b[0] - rectAnchor[0]) >= 100 && Math.abs(b[1] - rectAnchor[1]) >= 100) {
        createRoomFromPolygon(axisAlignedRect(rectAnchor, b));
      }
    }
    cancelDraft();
  }, [drawMode, rectAnchor, cursorMm, gridSnap, createRoomFromPolygon, cancelDraft]);

  // SVG pointer-down on empty canvas: start a rectangle (draw mode) or pan the view.
  // Child rooms/openings stopPropagation, so this only fires on true background.
  const handleSvgPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (drawMode === "rect") {
        startRect(e);
        return;
      }
      if (openingMode) {
        openingPointerRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
        return;
      }
      if (drawMode || !focusRoom || pointersRef.current.size >= 2) return;
      const svg = svgRef.current;
      if (!svg) return;
      svg.setPointerCapture?.(e.pointerId);
      startPan(e.clientX, e.clientY);
    },
    [drawMode, openingMode, startRect, focusRoom, startPan],
  );

  // SVG pointer-up: commit a rectangle, finish a pan (a tap deselects), place an opening, or end a drag.
  const handleSvgPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (openingMode && openingPointerRef.current?.pointerId === e.pointerId) {
        const start = openingPointerRef.current;
        openingPointerRef.current = null;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 14) {
          placeOpeningAtClient(e.clientX, e.clientY);
        }
        return;
      }
      if (drawMode === "rect") {
        finishRect();
        return;
      }
      if (panRef.current) {
        const wasTap = !panRef.current.moved;
        panRef.current = null;
        if (wasTap) {
          setSelectedOpening(null);
          setSelectedVertex(null);
        }
        return;
      }
      endDrag();
    },
    [drawMode, finishRect, endDrag, openingMode, placeOpeningAtClient],
  );

  const handleSvgPointerLeave = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (openingPointerRef.current?.pointerId === e.pointerId) {
        openingPointerRef.current = null;
      }
      panRef.current = null;
      endDrag();
    },
    [endDrag],
  );

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (openingMode) {
        placeOpeningAtClient(e.clientX, e.clientY);
        return;
      }
      if (drawMode !== "free" || !svgRef.current) return;
      const mm = screenToMm(svgRef.current, e.clientX, e.clientY, bounds);
      if (!mm) return;
      // Close the polygon when clicking back near the first point.
      if (draftPoints.length >= 3) {
        const first = draftPoints[0];
        if (Math.hypot(first[0] - mm[0], first[1] - mm[1]) <= VERTEX_SNAP_MM) {
          commitDraft();
          return;
        }
      }
      const snapped = snapPointToGeometry(
        mm,
        snapTargets("", -1),
        edgeTargets(""),
        GRID_MM,
        VERTEX_SNAP_MM,
        EDGE_SNAP_MM,
      );
      setDraftPoints((pts) => [...pts, snapped]);
    },
    [openingMode, placeOpeningAtClient, drawMode, bounds, draftPoints, snapTargets, edgeTargets, commitDraft],
  );

  useEffect(() => {
    if (!openingMode) setOpeningPlaceHint(null);
  }, [openingMode]);

  // Esc cancels an in-progress trace; Enter finishes it.
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDraft();
      else if (e.key === "Enter") commitDraft();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode, cancelDraft, commitDraft]);

  const deleteRoom = useCallback(() => {
    if (!selectedRoomId) return;
    recordSnapshot(rooms);
    onRoomsChange(rooms.filter((r) => r.id !== selectedRoomId));
    onRoomSelect(null);
    setSelectedVertex(null);
  }, [selectedRoomId, rooms, onRoomsChange, onRoomSelect, recordSnapshot]);

  // Update a room's polygon AND re-anchor its openings (use when corners are
  // added/removed so edge indices stay valid and openings keep their wall).
  const updateRoomTopology = useCallback(
    (room: DetectedRoom, newPoly: Point[]) => {
      recordSnapshot(rooms);
      const { windows, doors } = reanchorOpenings(room, room.polygon ?? [], newPoly);
      const next = rooms.map((r) =>
        r.id === room.id
          ? {
              ...r,
              polygon: newPoly,
              dimensions: dimensionsFromPolygon(newPoly, r.dimensions.height),
              estimatedArea: Math.round((polygonArea(newPoly) / 1_000_000) * 10) / 10,
              windows,
              doors,
            }
          : r,
      );
      onRoomsChange(next);
    },
    [rooms, reanchorOpenings, onRoomsChange, recordSnapshot],
  );

  const insertVertex = useCallback(
    (roomId: string, edgeIndex: number) => {
      const room = rooms.find((r) => r.id === roomId);
      if (!room?.polygon) return;
      const a = room.polygon[edgeIndex];
      const b = room.polygon[(edgeIndex + 1) % room.polygon.length];
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const poly = [...room.polygon];
      poly.splice(edgeIndex + 1, 0, mid);
      updateRoomTopology(room, poly);
      setSelectedVertex(edgeIndex + 1);
    },
    [rooms, updateRoomTopology],
  );

  const deleteVertex = useCallback(() => {
    if (!selectedRoom?.polygon || selectedVertex === null) return;
    if (selectedRoom.polygon.length <= 3) return; // keep a valid polygon
    const poly = selectedRoom.polygon.filter((_, i) => i !== selectedVertex);
    updateRoomTopology(selectedRoom, poly);
    setSelectedVertex(null);
  }, [selectedRoom, selectedVertex, updateRoomTopology]);

  // Delete / Backspace removes the selected corner (if a corner is picked and the
  // polygon stays valid) otherwise the selected room. Ignored while tracing or typing.
  // In per-room focus mode, only opening removal is allowed (no room/vertex deletion).
  useEffect(() => {
    if (drawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return; // don't hijack delete while editing a field
      }
      if (selectedOpening) {
        e.preventDefault();
        removeOpening(selectedOpening);
      } else if (focusRoom) {
        return; // guided mode: don't delete rooms or vertices
      } else if (selectedVertex !== null && (selectedRoom?.polygon?.length ?? 0) > 3) {
        e.preventDefault();
        deleteVertex();
      } else if (selectedRoomId) {
        e.preventDefault();
        deleteRoom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode, selectedOpening, removeOpening, selectedVertex, selectedRoom, selectedRoomId, deleteVertex, deleteRoom, focusRoom]);

  const snapAll = useCallback(() => {
    recordSnapshot(rooms);
    const polys = rooms.map((r) => r.polygon ?? []);
    const snapped = snapAndCloseGaps(polys, GRID_MM, MERGE_MM);
    const next = rooms.map((r, i) =>
      r.polygon
        ? {
            ...r,
            polygon: snapped[i],
            dimensions: dimensionsFromPolygon(snapped[i], r.dimensions.height),
          }
        : r,
    );
    onRoomsChange(next);
  }, [rooms, onRoomsChange, recordSnapshot]);

  // Type an exact wall length (metres). The traced outline must NOT be skewed — only its
  // size changes:
  //  • A clean rectangle scales along just this wall's axis, so it stays a rectangle and
  //    only this dimension (and its parallel wall) updates — the perpendicular size is kept.
  //  • Any other traced shape scales uniformly about its centre, so the exact shape (every
  //    angle/proportion) is preserved while this wall reaches the typed length. This treats
  //    the trace as an arbitrarily-scaled sketch that one measured wall calibrates.
  const resizeEdge = useCallback(
    (edgeIndex: number, metres: number) => {
      const poly = selectedRoom?.polygon;
      if (!poly || poly.length < 3 || !Number.isFinite(metres) || metres <= 0) return;
      if (!isValidEdgeIndex(poly, edgeIndex)) return;
      const targetMm = metres * 1000;
      const currentMm = edgeLengthMm(poly, edgeIndex);
      if (currentMm <= 0) return;

      if (isRectanglePolygon(poly)) {
        const a = poly[edgeIndex];
        const b = poly[(edgeIndex + 1) % poly.length];
        const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? "x" : "y";
        updateRoom(selectedRoom!.id, resizePolygonExtent(poly, axis, targetMm));
        return;
      }

      const factor = targetMm / currentMm;
      if (!Number.isFinite(factor) || factor <= 0) return;
      const [cx, cy] = polygonCentroid(poly);
      const scaled = poly.map<Point>(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
      updateRoom(selectedRoom!.id, scaled);
    },
    [selectedRoom, updateRoom],
  );

  const updateSelectedMeta = useCallback(
    (patch: Partial<Pick<DetectedRoom, "name" | "type">> & { height?: number }) => {
      if (!selectedRoom) return;
      recordSnapshot(rooms);
      const next = rooms.map((r) =>
        r.id === selectedRoom.id
          ? {
              ...r,
              name: patch.name ?? r.name,
              type: patch.type ?? r.type,
              dimensions:
                patch.height !== undefined
                  ? { ...r.dimensions, height: patch.height }
                  : r.dimensions,
            }
          : r,
      );
      onRoomsChange(next);
    },
    [selectedRoom, rooms, onRoomsChange, recordSnapshot],
  );

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex flex-wrap gap-2">
        {drawMode === "rect" ? (
          <>
            <ToolbarButton onClick={cancelDraft} icon={<X size={16} />} label={fpT(t, "cancel")} />
            <span className="self-center text-[11px] text-[var(--muted-foreground)]">
              {fpT(t, "drawRectHint")}
            </span>
          </>
        ) : drawMode === "free" ? (
          <>
            <ToolbarButton
              onClick={commitDraft}
              icon={<Check size={16} />}
              label={fpT(t, "finishRoom")}
              disabled={draftPoints.length < 3}
            />
            <ToolbarButton onClick={cancelDraft} icon={<X size={16} />} label={fpT(t, "cancel")} />
            <span className="self-center text-[11px] text-[var(--muted-foreground)]">
              {fpT(t, "drawFreeHint")}
            </span>
          </>
        ) : openingMode ? (
          <>
            <ToolbarButton
              onClick={() => setOpeningMode(null)}
              icon={<Check size={16} />}
              label={fpT(t, "donePlacing")}
            />
            <span className="self-center text-[11px] text-[var(--muted-foreground)]">
              {fpT(t, "placeOpeningHint", {
                kind: fpT(t, openingMode === "window" ? "placeOpeningKindWindow" : "placeOpeningKindDoor"),
              })}
              {openingPlaceHint ? (
                <span className="block text-amber-600 mt-0.5">{openingPlaceHint}</span>
              ) : null}
            </span>
          </>
        ) : focusRoom ? (
          // Per-room confirmation: windows & doors are the focus; structural
          // room tools (draw / add / delete room) are intentionally hidden.
          <>
            <ToolbarButton
              onClick={() => {
                setSelectedOpening(null);
                setOpeningMode("window");
              }}
              icon={<AppWindow size={18} />}
              label={fpT(t, "addWindow")}
              large
            />
            <ToolbarButton
              onClick={() => {
                setSelectedOpening(null);
                setOpeningMode("door");
              }}
              icon={<DoorOpen size={18} />}
              label={fpT(t, "addDoor")}
              large
            />
            <div className="ml-auto flex items-center gap-2">
              <ToolbarButton onClick={undo} icon={<Undo2 size={16} />} label={fpT(t, "undo")} disabled={!canUndo} iconOnly={isMobile} />
              <ToolbarButton onClick={redo} icon={<Redo2 size={16} />} label={fpT(t, "redo")} disabled={!canRedo} iconOnly={isMobile} />
            </div>
          </>
        ) : (
          <>
            <ToolbarButton onClick={undo} icon={<Undo2 size={16} />} label={fpT(t, "undo")} disabled={!canUndo} />
            <ToolbarButton onClick={redo} icon={<Redo2 size={16} />} label={fpT(t, "redo")} disabled={!canRedo} />
            <ToolbarButton
              onClick={() => {
                setDraftPoints([]);
                setRectAnchor(null);
                setCursorMm(null);
                setDrawMode(advanced ? "free" : "rect");
              }}
              icon={<PenTool size={16} />}
              label={fpT(t, "drawRoom")}
            />
            <ToolbarButton onClick={addRoom} icon={<Plus size={16} />} label={fpT(t, "addRoom")} />
            <ToolbarButton
              onClick={() => {
                setSelectedOpening(null);
                setOpeningPlaceHint(null);
                setOpeningMode("window");
              }}
              icon={<AppWindow size={16} />}
              label={fpT(t, "addWindow")}
            />
            <ToolbarButton
              onClick={() => {
                setSelectedOpening(null);
                setOpeningPlaceHint(null);
                setOpeningMode("door");
              }}
              icon={<DoorOpen size={16} />}
              label={fpT(t, "addDoor")}
            />
            <ToolbarButton
              onClick={deleteRoom}
              icon={<Trash2 size={16} />}
              label={fpT(t, "deleteRoom")}
              disabled={!selectedRoomId}
            />
            {advanced && (
              <ToolbarButton
                onClick={deleteVertex}
                icon={<Trash2 size={16} />}
                label={fpT(t, "deleteCorner")}
                disabled={selectedVertex === null || (selectedRoom?.polygon?.length ?? 0) <= 3}
              />
            )}
            <ToolbarButton onClick={snapAll} icon={<Magnet size={16} />} label={fpT(t, "snapCloseGaps")} />
            {onReset && (
              <ToolbarButton onClick={onReset} icon={<CornerUpLeft size={16} />} label={fpT(t, "resetToDetected")} />
            )}
            <label className="self-center ml-auto flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={advanced}
                onChange={(e) => setAdvanced(e.target.checked)}
                className="accent-[rgb(37,99,235)]"
              />
              {fpT(t, "advancedOptions")}
            </label>
          </>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-start">
        <div className="flex-1 min-w-0">
      <div
        className={`relative w-full ${focusRoom || extentMm ? "" : "aspect-[4/3]"}`}
        style={
          focusRoom
            ? { aspectRatio: `${baseBounds.maxX - baseBounds.minX} / ${baseBounds.maxY - baseBounds.minY}` }
            : extentMm
              ? { aspectRatio: `${extentMm.width} / ${extentMm.height}` }
              : undefined
        }
        onPointerDownCapture={onContainerPointerDownCapture}
        onPointerMoveCapture={onContainerPointerMoveCapture}
        onPointerUpCapture={onContainerPointerUpCapture}
        onPointerCancelCapture={onContainerPointerUpCapture}
      >
        {/* The plan itself is clipped (rounded card); the zoom controls & the floating
            opening editor below live in the un-clipped outer box so they never crop. */}
        <div className="absolute inset-0 rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--muted)]">
        {/* When focusing one room we zoom the SVG viewBox, so the plan image must
            live inside the SVG to zoom with it. Otherwise keep it as a plain bg img. */}
        {!focusRoom && (
          <img
            src={floorPlanImageSrc}
            alt="Floor plan"
            className="absolute inset-0 w-full h-full object-contain opacity-60 pointer-events-none"
          />
        )}
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className={`absolute inset-0 w-full h-full ${drag ? "cursor-grabbing" : ""} ${
            drawMode || openingMode ? "cursor-crosshair" : ""
          }`}
          style={{ touchAction: "none" }}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handleSvgPointerUp}
          onPointerLeave={handleSvgPointerLeave}
          onClick={handleSvgClick}
        >
          {focusRoom && (
            <image
              href={floorPlanImageSrc}
              x={fullBounds.minX}
              y={flipY(fullBounds.maxY, bounds)}
              width={fullBounds.maxX - fullBounds.minX}
              height={fullBounds.maxY - fullBounds.minY}
              preserveAspectRatio="xMidYMid meet"
              opacity={0.6}
              style={{ pointerEvents: "none" }}
            />
          )}
          {rooms.map((room) => {
            const poly = room.polygon;
            if (!poly || poly.length < 3) return null;
            const isDimmed = !!focusRoom && room.id !== focusRoom.id;
            const isSelected = room.id === selectedRoomId && !isDimmed;
            const pts = poly.map(([x, y]) => `${x},${flipY(y, bounds)}`).join(" ");
            const [cx, cy] = polygonCentroid(poly);
            return (
              <g
                key={room.id}
                style={{
                  pointerEvents: drawMode || openingMode ? "none" : "auto",
                  opacity: isDimmed ? 0.3 : 1,
                }}
              >
                <polygon
                  points={pts}
                  fill={isSelected ? "rgba(59,130,246,0.28)" : "rgba(148,163,184,0.22)"}
                  stroke={isSelected ? "rgb(59,130,246)" : "rgb(100,116,139)"}
                  strokeWidth={isSelected ? 90 : 50}
                  className={isDimmed ? "cursor-pointer" : "cursor-move"}
                  onPointerDown={(e) => {
                    if (drawMode || !svgRef.current) return;
                    e.stopPropagation();
                    if (isDimmed) {
                      onRoomSelect(room.id);
                      return;
                    }
                    (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId);
                    onRoomSelect(room.id);
                    setSelectedVertex(null);
                    const mm = screenToMm(svgRef.current, e.clientX, e.clientY, bounds);
                    if (mm) {
                      dragBoundsRef.current = bounds;
                      setDrag({ kind: "room", roomId: room.id, startMm: mm, startPoly: poly, baseline: rooms });
                    }
                  }}
                />
                <text
                  x={cx}
                  y={flipY(cy, bounds)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize={labelSize}
                  fontWeight="600"
                  style={{ pointerEvents: "none", textShadow: "0 0 4px rgba(0,0,0,0.8)" }}
                >
                  {room.name}
                </text>

                {/* Wall (edge) drag handles + "+" insert handles on the selected room. */}
                {isSelected &&
                  poly.map((a, i) => {
                    const b = poly[(i + 1) % poly.length];
                    const mx = (a[0] + b[0]) / 2;
                    const my = (a[1] + b[1]) / 2;
                    return (
                      <g key={`edge-${i}`}>
                        {/* Thick invisible line: drag the whole wall (both corners). */}
                        <line
                          x1={a[0]}
                          y1={flipY(a[1], bounds)}
                          x2={b[0]}
                          y2={flipY(b[1], bounds)}
                          stroke="transparent"
                          strokeWidth={vertexRadius * 1.3}
                          strokeLinecap="round"
                          className="cursor-move"
                          onPointerDown={(e) => {
                            if (!svgRef.current) return;
                            e.stopPropagation();
                            (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId);
                            setSelectedVertex(null);
                            const mm = screenToMm(svgRef.current, e.clientX, e.clientY, bounds);
                            if (mm) {
                              dragBoundsRef.current = bounds;
                              setDrag({ kind: "edge", roomId: room.id, edgeIndex: i, startMm: mm, startPoly: poly, baseline: rooms });
                            }
                          }}
                        />
                        {/* Small "+" to insert a corner at the edge midpoint. */}
                        <g
                          className="cursor-copy"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            insertVertex(room.id, i);
                          }}
                        >
                          <circle
                            cx={mx}
                            cy={flipY(my, bounds)}
                            r={vertexRadius * 0.55}
                            fill="white"
                            stroke="rgb(59,130,246)"
                            strokeWidth={vertexRadius * 0.16}
                          />
                          <text
                            x={mx}
                            y={flipY(my, bounds)}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fill="rgb(59,130,246)"
                            fontSize={vertexRadius * 0.9}
                            fontWeight="700"
                            style={{ pointerEvents: "none" }}
                          >
                            +
                          </text>
                        </g>
                      </g>
                    );
                  })}

                {isSelected &&
                  poly.map((v, i) => (
                    <circle
                      key={`vtx-${i}`}
                      cx={v[0]}
                      cy={flipY(v[1], bounds)}
                      r={vertexRadius}
                      fill={selectedVertex === i ? "rgb(37,99,235)" : "white"}
                      stroke="rgb(37,99,235)"
                      strokeWidth={vertexRadius * 0.25}
                      className="cursor-grab"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        (e.target as SVGElement).setPointerCapture?.(e.pointerId);
                        setSelectedVertex(i);
                        dragBoundsRef.current = bounds;
                        setDrag({ kind: "vertex", roomId: room.id, vertexIndex: i, baseline: rooms });
                      }}
                    />
                  ))}

                {/* Corner letters (A, B, C…) — on all rooms (dimmer when not selected). */}
                {poly.map((v, i) => {
                  if (!isSelected && isCurveVertex(poly, i)) return null;
                  const dx = v[0] - cx;
                  const dy = v[1] - cy;
                  const d = Math.hypot(dx, dy) || 1;
                  const off = vertexRadius * (isSelected ? 2 : 1.6);
                  return (
                    <text
                      key={`lbl-${i}`}
                      x={v[0] + (dx / d) * off}
                      y={flipY(v[1] + (dy / d) * off, bounds)}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={isSelected ? "rgb(37,99,235)" : "rgba(100,116,139,0.8)"}
                      fontSize={labelSize * (isSelected ? 0.9 : 0.7)}
                      fontWeight={isSelected ? "700" : "600"}
                      style={{ pointerEvents: "none", textShadow: "0 0 4px rgba(0,0,0,0.7)" }}
                    >
                      {cornerLabel(i)}
                    </text>
                  );
                })}

                {/* Edge length labels at midpoints. */}
                {isSelected &&
                  poly.map((a, i) => {
                    if (isCurveVertex(poly, i) && isCurveVertex(poly, (i + 1) % poly.length)) return null;
                    const b = poly[(i + 1) % poly.length];
                    const mx = (a[0] + b[0]) / 2;
                    const my = (a[1] + b[1]) / 2;
                    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                    const lenM = (len / 1000).toFixed(2);
                    const ex = b[0] - a[0];
                    const ey = b[1] - a[1];
                    const perpX = -ey / (len || 1);
                    const perpY = ex / (len || 1);
                    const nudge = labelSize * 0.9;
                    return (
                      <text
                        key={`elen-${i}`}
                        x={mx + perpX * nudge}
                        y={flipY(my + perpY * nudge, bounds)}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="rgba(37,99,235,0.85)"
                        fontSize={labelSize * 0.6}
                        fontWeight="500"
                        style={{ pointerEvents: "none", textShadow: "0 0 3px rgba(0,0,0,0.7)" }}
                      >
                        {lenM}m
                      </text>
                    );
                  })}
              </g>
            );
          })}

          {/* While placing openings, thick wall hit targets sit above the room fill (which
              has pointer-events: none) so taps land reliably on mobile and desktop. */}
          {openingMode &&
            !drawMode &&
            rooms.map((room) => {
              if (focusRoom && room.id !== focusRoom.id) return null;
              if (!focusRoom && selectedRoomId && room.id !== selectedRoomId) return null;
              const poly = room.polygon;
              if (!poly || poly.length < 3) return null;
              return (
                <g key={`opening-hit-${room.id}`}>
                  {poly.map((a, i) => {
                    const b = poly[(i + 1) % poly.length];
                    return (
                      <line
                        key={`opening-hit-${room.id}-${i}`}
                        x1={a[0]}
                        y1={flipY(a[1], bounds)}
                        x2={b[0]}
                        y2={flipY(b[1], bounds)}
                        stroke="transparent"
                        strokeWidth={Math.max(vertexRadius * 2.2, 280)}
                        strokeLinecap="round"
                        className="cursor-crosshair"
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerUp={(e) => {
                          e.stopPropagation();
                          placeOpeningAtClient(e.clientX, e.clientY);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          placeOpeningAtClient(e.clientX, e.clientY);
                        }}
                      />
                    );
                  })}
                </g>
              );
            })}

          {/* Openings (windows/doors): read-only glyphs + interactive overlay. */}
          {rooms.map((room) => {
            const isDimmed = !!focusRoom && room.id !== focusRoom.id;
            return (
              <g key={`op-${room.id}`} style={isDimmed ? { opacity: 0.3 } : undefined}>
                <RoomOpenings room={room} bounds={bounds} planWidth={planWidth} />
              </g>
            );
          })}
          {columns.map((col) => {
            const displayY = flipY(col.y, bounds);
            const half = columnHalfSizeMm(col);
            const isCircle = col.shape === "circular";
            const editable = Boolean(onColumnsChange);
            return (
              <g key={`col-${col.id}`}>
                {isCircle ? (
                  <circle
                    cx={col.x}
                    cy={displayY}
                    r={half}
                    fill="rgba(100, 116, 139, 0.55)"
                    stroke="rgb(71, 85, 105)"
                    strokeWidth={vertexRadius * 0.08}
                    className={editable ? "cursor-move" : undefined}
                    onPointerDown={
                      editable
                        ? (e) => {
                            e.stopPropagation();
                            (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId);
                            dragBoundsRef.current = bounds;
                            const svg = svgRef.current;
                            if (!svg || !onColumnsChange) return;
                            const move = (ev: PointerEvent) => {
                              const mm = screenToMm(svg, ev.clientX, ev.clientY, dragBoundsRef.current ?? bounds);
                              if (!mm) return;
                              onColumnsChange(
                                columns.map((c) =>
                                  c.id === col.id ? { ...c, x: mm[0], y: mm[1] } : c,
                                ),
                              );
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
                ) : (
                  <rect
                    x={col.x - half}
                    y={displayY - half}
                    width={half * 2}
                    height={half * 2}
                    fill="rgba(100, 116, 139, 0.55)"
                    stroke="rgb(71, 85, 105)"
                    strokeWidth={vertexRadius * 0.08}
                    className={editable ? "cursor-move" : undefined}
                    onPointerDown={
                      editable
                        ? (e) => {
                            e.stopPropagation();
                            (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId);
                            dragBoundsRef.current = bounds;
                            const svg = svgRef.current;
                            if (!svg || !onColumnsChange) return;
                            const move = (ev: PointerEvent) => {
                              const mm = screenToMm(svg, ev.clientX, ev.clientY, dragBoundsRef.current ?? bounds);
                              if (!mm) return;
                              onColumnsChange(
                                columns.map((c) =>
                                  c.id === col.id ? { ...c, x: mm[0], y: mm[1] } : c,
                                ),
                              );
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
                {editable && (
                  <g
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onColumnsChange?.(columns.filter((c) => c.id !== col.id));
                    }}
                  >
                    <circle
                      cx={col.x + half * 0.7}
                      cy={displayY - half * 0.7}
                      r={vertexRadius * 0.55}
                      fill="rgba(0,0,0,0.75)"
                      stroke="white"
                      strokeWidth={vertexRadius * 0.06}
                    />
                    <text
                      x={col.x + half * 0.7}
                      y={displayY - half * 0.7}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="white"
                      fontSize={vertexRadius * 0.9}
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

          {!drawMode &&
            !openingMode &&
            rooms.flatMap((room) => {
              if (focusRoom && room.id !== focusRoom.id) return [];
              const poly = room.polygon;
              if (!poly || poly.length < 3) return [];
              const handles: React.ReactNode[] = [];
              const render = (kind: OpeningKind) => {
                const list = kind === "window" ? room.windows : room.doors;
                list.forEach((o, index) => {
                  if (o.edgeIndex === undefined) return;
                  const [a, b] = openingEndpoints(poly, o.edgeIndex, o.t ?? 0.5, (o.width || (kind === "window" ? DEFAULT_WINDOW_W : DEFAULT_DOOR_W)) * 1000);
                  const isSel =
                    selectedOpening?.roomId === room.id &&
                    selectedOpening.kind === kind &&
                    selectedOpening.index === index;
                  const color = kind === "window" ? WINDOW_FILL : DOOR_FILL;
                  handles.push(
                    <g key={`${room.id}-${kind}-${index}`}>
                      {/* Wide transparent hit line: select + drag along the wall. */}
                      <line
                        x1={a[0]}
                        y1={flipY(a[1], bounds)}
                        x2={b[0]}
                        y2={flipY(b[1], bounds)}
                        stroke="transparent"
                        strokeWidth={vertexRadius * 1.6}
                        strokeLinecap="round"
                        className="cursor-move"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId);
                          onRoomSelect(room.id);
                          setSelectedVertex(null);
                          setSelectedOpening({ roomId: room.id, kind, index });
                          dragBoundsRef.current = bounds;
                          setDrag({ kind: "opening", roomId: room.id, openingKind: kind, index, baseline: rooms });
                        }}
                      />
                      {isSel && (
                        <>
                          <line
                            x1={a[0]}
                            y1={flipY(a[1], bounds)}
                            x2={b[0]}
                            y2={flipY(b[1], bounds)}
                            stroke={color}
                            strokeWidth={vertexRadius * 0.4}
                            strokeLinecap="round"
                            strokeDasharray={`${vertexRadius} ${vertexRadius * 0.8}`}
                            style={{ pointerEvents: "none" }}
                          />
                          <g
                            className="cursor-pointer"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeOpening({ roomId: room.id, kind, index });
                            }}
                          >
                            <circle
                              cx={b[0]}
                              cy={flipY(b[1], bounds)}
                              r={vertexRadius * 0.7}
                              fill="rgba(0,0,0,0.75)"
                              stroke="white"
                              strokeWidth={vertexRadius * 0.12}
                            />
                            <text
                              x={b[0]}
                              y={flipY(b[1], bounds)}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fill="white"
                              fontSize={vertexRadius}
                              fontWeight="700"
                              style={{ pointerEvents: "none" }}
                            >
                              ×
                            </text>
                          </g>
                        </>
                      )}
                    </g>,
                  );
                });
              };
              render("window");
              render("door");
              return handles;
            })}

          {/* In-progress rectangle (simple draw mode). */}
          {drawMode === "rect" && rectAnchor && cursorMm && (
            <polygon
              points={axisAlignedRect(rectAnchor, cursorMm)
                .map(([x, y]) => `${x},${flipY(y, bounds)}`)
                .join(" ")}
              fill="rgba(59,130,246,0.12)"
              stroke="rgb(59,130,246)"
              strokeWidth={70}
              strokeDasharray="160 120"
              style={{ pointerEvents: "none" }}
            />
          )}

          {/* In-progress traced room (advanced draw mode). */}
          {drawMode === "free" && draftPoints.length > 0 && (
            <g style={{ pointerEvents: "none" }}>
              <polyline
                points={[...draftPoints, ...(cursorMm ? [cursorMm] : [])]
                  .map(([x, y]) => `${x},${flipY(y, bounds)}`)
                  .join(" ")}
                fill="rgba(59,130,246,0.12)"
                stroke="rgb(59,130,246)"
                strokeWidth={70}
                strokeDasharray="160 120"
              />
              {draftPoints.map(([x, y], i) => (
                <circle
                  key={`draft-${i}`}
                  cx={x}
                  cy={flipY(y, bounds)}
                  r={i === 0 ? vertexRadius * 1.1 : vertexRadius * 0.8}
                  fill={i === 0 ? "rgb(37,99,235)" : "white"}
                  stroke="rgb(37,99,235)"
                  strokeWidth={vertexRadius * 0.25}
                />
              ))}
            </g>
          )}
        </svg>
        </div>

        {/* Zoom controls — overlaid on the plan so the user can zoom out to see the
            whole floor plan while reviewing one room, then zoom back in. Per-room view
            only (in the overview the whole plan is already visible). */}
        {focusRoom && (
          <div className="absolute right-2 top-2 z-20 flex flex-col gap-1.5">
            <ZoomButton onClick={() => zoomByStep(2)} label={fpT(t, "zoomIn")}>
              <Plus size={16} />
            </ZoomButton>
            <ZoomButton onClick={() => zoomByStep(0.5)} label={fpT(t, "zoomOut")}>
              <Minus size={16} />
            </ZoomButton>
            <ZoomButton
              onClick={() => setPanMode((p) => !p)}
              label={panMode ? fpT(t, "panModeActive") : fpT(t, "panMode")}
              active={panMode}
            >
              <Hand size={16} />
            </ZoomButton>
            <ZoomButton onClick={fitWholePlan} label={fpT(t, "showWholePlan")}>
              <Maximize2 size={16} />
            </ZoomButton>
            <ZoomButton onClick={() => setView(null)} label={fpT(t, "fitRoom")} disabled={view === null}>
              <Scan size={16} />
            </ZoomButton>
          </div>
        )}

        {/* Hand tool: a transparent surface over the plan so dragging anywhere pans the
            whole plan (room/opening editing is suppressed while it's active). */}
        {focusRoom && panMode && (
          <div
            className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={(e) => {
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              startPan(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => doPan(e.clientX, e.clientY)}
            onPointerUp={() => {
              panRef.current = null;
            }}
            onPointerCancel={() => {
              panRef.current = null;
            }}
          />
        )}

      </div>

      </div>

        {/* Floating draggable opening editor popup — positioned over the right panel. */}
        {selectedOpening && popupPos &&
          (() => {
            const room = rooms.find((r) => r.id === selectedOpening.roomId);
            const list = room
              ? selectedOpening.kind === "window"
                ? room.windows
                : room.doors
              : undefined;
            const o = list?.[selectedOpening.index];
            if (!room || !o || o.edgeIndex === undefined) return null;
            const polyLen = room.polygon?.length ?? 1;
            const isDoor = selectedOpening.kind === "door";
            const door = o as DetectedRoom["doors"][number];
            return (
              <div
                data-opening-popup
                className="fixed z-50 w-[340px] max-w-[90vw] rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl"
                style={{ left: popupPos.x, top: popupPos.y }}
              >
                <div
                  className="mb-1 flex items-center justify-between cursor-move select-none touch-none"
                  onPointerDown={onPopupDragStart}
                  onPointerMove={onPopupDragMove}
                  onPointerUp={onPopupDragEnd}
                  onPointerCancel={onPopupDragEnd}
                >
                  <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    <GripVertical size={12} className="opacity-50" />
                    {fpT(t, "editOpening", {
                      kind: fpT(t, isDoor ? "door" : "window"),
                    })}
                  </span>
                  <button
                    type="button"
                    data-opening-popup-close
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeOpeningPopup();
                    }}
                    aria-label={fpT(t, "close")}
                    className="p-1 rounded-md hover:bg-[var(--muted)] text-[var(--muted-foreground)] cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
                <OpeningRow
                  icon={
                    isDoor ? (
                      <DoorOpen size={14} className="text-amber-600" />
                    ) : (
                      <AppWindow size={14} className="text-sky-500" />
                    )
                  }
                  title={formatOpeningWallTitle(
                    isDoor ? "door" : "window",
                    `${cornerLabel(o.edgeIndex)}-${cornerLabel((o.edgeIndex + 1) % polyLen)}`,
                    t,
                  )}
                  subtitle={
                    isDoor
                      ? formatDoorConnectionSubtitle(
                          o.position,
                          door.connectsTo,
                          rooms.find((r) => r.id === door.connectsTo)?.name,
                          t,
                        )
                      : translateOpeningPosition(o.position, t)
                  }
                  width={o.width}
                  onWidth={(m) => setOpeningWidth(selectedOpening, m)}
                  height={isDoor ? door.height ?? 2.1 : (o as DetectedRoom["windows"][number]).height}
                  onHeight={(m) => setOpeningHeight(selectedOpening, m)}
                  positionT={o.t}
                  edgeLengthMm={openingEdgeLengthMm(room.polygon, o.edgeIndex)}
                  onPositionT={(t) => setOpeningT(selectedOpening, t)}
                  door={
                    isDoor
                      ? {
                          hinge: door.hinge ?? "left",
                          swing: door.swing ?? "in",
                          onHinge: (h) => setDoorHinge(selectedOpening, h),
                          onSwing: (s) => setDoorSwing(selectedOpening, s),
                        }
                      : undefined
                  }
                  onRemove={() => removeOpening(selectedOpening)}
                />
              </div>
            );
          })()}

        <div
          ref={sidebarPanelRef}
          className="w-full lg:w-[420px] lg:shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1"
        >
      {selectedRoom ? (
        <div className="flex flex-col gap-3 p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-[var(--muted-foreground)]">{fpT(t, "name")}</span>
              <input
                value={selectedRoom.name}
                onChange={(e) => updateSelectedMeta({ name: e.target.value })}
                className="px-2 py-1.5 rounded-lg bg-[var(--muted)] border border-[var(--border)] text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-[var(--muted-foreground)]">{fpT(t, "type")}</span>
              <select
                value={selectedRoom.type}
                onChange={(e) => updateSelectedMeta({ type: e.target.value as RoomType })}
                className="px-2 py-1.5 rounded-lg bg-[var(--muted)] border border-[var(--border)] text-sm cursor-pointer"
              >
                {ROOM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {roomTypeLabel ? roomTypeLabel(t) : t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/* Every room edits by labelled side (A–B, B–C…) so the corner letters
              on the plan match the inputs — including plain rectangles. */}
          <div className="flex flex-col gap-3">
            {(() => {
              const roomPoly = sanitizePolygon(selectedRoom.polygon ?? []);
              if (roomPoly.length < 3) return null;
              return (
            <div className="grid grid-cols-3 gap-3">
              {roomPoly.map((_, i) => (
                <DimensionInput
                  key={`edge-${i}`}
                  label={formatEdgeLengthLabel(
                    `${cornerLabel(i)}–${cornerLabel((i + 1) % roomPoly.length)}`,
                    t,
                  )}
                  value={Math.round((edgeLengthMm(roomPoly, i) / 1000) * 100) / 100}
                  onCommit={(m) => resizeEdge(i, m)}
                />
              ))}
            </div>
              );
            })()}
            <div className="grid grid-cols-3 gap-3">
              <HeightInput value={selectedRoom.dimensions.height} onChange={(h) => updateSelectedMeta({ height: h })} />
              <div className="col-span-2 flex flex-col gap-1">
                <span className="text-[10px] uppercase text-[var(--muted-foreground)]">{fpT(t, "footprint")}</span>
                <div className="px-2 py-1.5 rounded-lg bg-[var(--muted)]/50 border border-[var(--border)] text-sm text-[var(--muted-foreground)]">
                  {formatFootprint(
                    selectedRoom.dimensions.width,
                    selectedRoom.dimensions.depth,
                    selectedRoom.estimatedArea,
                    t,
                  )}
                </div>
              </div>
            </div>
          </div>

          {selectedRoom &&
            selectedRoom.doors.filter((d) => d.edgeIndex !== undefined).length === 0 &&
            !openingMode && (
              <div className="flex flex-col gap-2 pt-1 border-t border-[var(--border)]">
                <p className="text-[11px] text-amber-600">
                  {fpT(t, "needsDoor")}
                </p>
                <ToolbarButton
                  onClick={() => {
                    setSelectedOpening(null);
                    setOpeningPlaceHint(null);
                    setOpeningMode("door");
                  }}
                  icon={<DoorOpen size={18} />}
                  label={fpT(t, "addDoorToRoom")}
                  large
                />
              </div>
            )}

          {/* Openings on this room — windows & doors placed on the walls. */}
          {(selectedRoom.windows.some((w) => w.edgeIndex !== undefined) ||
            selectedRoom.doors.some((d) => d.edgeIndex !== undefined)) && (
            <div className="flex flex-col gap-2 pt-1 border-t border-[var(--border)]">
              <span className="text-[10px] uppercase text-[var(--muted-foreground)]">{fpT(t, "openings")}</span>
              {selectedRoom.windows.map((w, i) =>
                w.edgeIndex === undefined ||
                !selectedRoom.polygon ||
                !isValidEdgeIndex(selectedRoom.polygon, w.edgeIndex) ? null : (
                  <OpeningRow
                    key={`w-${i}`}
                    icon={<AppWindow size={14} className="text-sky-500" />}
                    title={formatOpeningWallTitle(
                      "window",
                      `${cornerLabel(w.edgeIndex)}-${cornerLabel((w.edgeIndex + 1) % (selectedRoom.polygon?.length ?? 1))}`,
                      t,
                    )}
                    subtitle={translateOpeningPosition(w.position, t)}
                    width={w.width}
                    onWidth={(m) => setOpeningWidth({ roomId: selectedRoom.id, kind: "window", index: i }, m)}
                    height={w.height}
                    onHeight={(m) => setOpeningHeight({ roomId: selectedRoom.id, kind: "window", index: i }, m)}
                    positionT={w.t}
                    edgeLengthMm={openingEdgeLengthMm(selectedRoom.polygon, w.edgeIndex)}
                    onPositionT={(t) => setOpeningT({ roomId: selectedRoom.id, kind: "window", index: i }, t)}
                    onRemove={() => removeOpening({ roomId: selectedRoom.id, kind: "window", index: i })}
                  />
                ),
              )}
              {selectedRoom.doors.map((d, i) =>
                d.edgeIndex === undefined ||
                !selectedRoom.polygon ||
                !isValidEdgeIndex(selectedRoom.polygon, d.edgeIndex) ? null : (
                  <OpeningRow
                    key={`d-${i}`}
                    icon={<DoorOpen size={14} className="text-amber-600" />}
                    title={formatOpeningWallTitle(
                      "door",
                      `${cornerLabel(d.edgeIndex)}-${cornerLabel((d.edgeIndex + 1) % (selectedRoom.polygon?.length ?? 1))}`,
                      t,
                    )}
                    subtitle={formatDoorConnectionSubtitle(
                      d.position,
                      d.connectsTo,
                      rooms.find((r) => r.id === d.connectsTo)?.name,
                      t,
                    )}
                    width={d.width}
                    onWidth={(m) => setOpeningWidth({ roomId: selectedRoom.id, kind: "door", index: i }, m)}
                    height={d.height ?? 2.1}
                    onHeight={(m) => setOpeningHeight({ roomId: selectedRoom.id, kind: "door", index: i }, m)}
                    positionT={d.t}
                    edgeLengthMm={openingEdgeLengthMm(selectedRoom.polygon, d.edgeIndex)}
                    onPositionT={(t) => setOpeningT({ roomId: selectedRoom.id, kind: "door", index: i }, t)}
                    door={{
                      hinge: d.hinge ?? "left",
                      swing: d.swing ?? "in",
                      onHinge: (h) => setDoorHinge({ roomId: selectedRoom.id, kind: "door", index: i }, h),
                      onSwing: (s) => setDoorSwing({ roomId: selectedRoom.id, kind: "door", index: i }, s),
                    }}
                    onRemove={() => removeOpening({ roomId: selectedRoom.id, kind: "door", index: i })}
                  />
                ),
              )}
            </div>
          )}

          <p className="text-[11px] text-[var(--muted-foreground)]">
            {t("project.editPlanSidebarHint")}
          </p>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)] text-center py-4">
          {fpT(t, "selectRoom")}
        </p>
      )}
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  icon,
  label,
  disabled,
  large,
  iconOnly,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  /** Bigger, accented primary action (e.g. Add window/door in per-room mode). */
  large?: boolean;
  /** Hide the text label (icon-only) — used for secondary actions on mobile. */
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={iconOnly ? label : undefined}
      className={`flex items-center justify-center gap-1.5 rounded-lg font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
        large
          ? "px-4 py-2.5 text-sm font-semibold border-[var(--primary)] text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/15 min-h-[44px]"
          : "px-3 py-2 text-xs border-[var(--border)] bg-[var(--muted)] hover:bg-[var(--muted)]/80"
      }`}
    >
      {icon}
      {!iconOnly && label}
    </button>
  );
}

/** Compact icon button for the zoom controls overlaid on the plan. */
function ZoomButton({
  onClick,
  label,
  disabled,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  /** Highlight as a pressed/active toggle (e.g. the hand/move tool). */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm backdrop-blur transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
        active
          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
          : "border-[var(--border)] bg-[var(--background)]/90 text-[var(--foreground)] hover:bg-[var(--muted)]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One window/door row in the selected-room panel: label + remove on the top line,
 * size inputs (width, and height for windows) below, plus hinge/swing toggles for doors.
 */
function OpeningRow({
  icon,
  title,
  subtitle,
  width,
  onWidth,
  onRemove,
  height,
  onHeight,
  positionT,
  edgeLengthMm: edgeLen,
  onPositionT,
  door,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  width: number;
  onWidth: (metres: number) => void;
  onRemove: () => void;
  height?: number;
  onHeight?: (metres: number) => void;
  positionT?: number;
  edgeLengthMm?: number;
  onPositionT?: (t: number) => void;
  door?: {
    hinge: "left" | "right";
    swing: "in" | "out";
    onHinge: (hinge: "left" | "right") => void;
    onSwing: (swing: "in" | "out") => void;
  };
}) {
  const { t } = useTranslation();
  const posMetres = positionT !== undefined && edgeLen
    ? Math.round((positionT * edgeLen) / 10) / 100
    : undefined;
  return (
    <div className="flex flex-col gap-1.5 py-1">
      <div className="flex items-center gap-2">
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 min-w-0 truncate text-xs text-[var(--foreground)]">{title}</span>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded-md hover:bg-[var(--muted)] text-[var(--muted-foreground)] cursor-pointer"
          aria-label={fpT(t, "removeOpening")}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {subtitle && (
        <span className="pl-6 text-[10px] text-[var(--muted-foreground)] truncate">{subtitle}</span>
      )}
      <div className="flex items-center gap-3 pl-6 flex-wrap">
        <SizeField label={fpT(t, "widthAbbr")} value={width} onCommit={onWidth} metreAbbr={fpT(t, "metreAbbr")} />
        {onHeight && height !== undefined && (
          <SizeField label={fpT(t, "heightAbbr")} value={height} onCommit={onHeight} metreAbbr={fpT(t, "metreAbbr")} />
        )}
        {posMetres !== undefined && onPositionT && edgeLen && (
          <SizeField
            label={fpT(t, "positionAbbr")}
            value={posMetres}
            metreAbbr={fpT(t, "metreAbbr")}
            onCommit={(m) => {
              const t = Math.min(1, Math.max(0, (m * 1000) / edgeLen));
              onPositionT(t);
            }}
          />
        )}
      </div>
      {door && (
        <div className="pl-6 pt-1">
          <DoorSwingPicker
            hinge={door.hinge}
            swing={door.swing}
            onChange={({ hinge, swing }) => {
              if (hinge !== door.hinge) door.onHinge(hinge);
              if (swing !== door.swing) door.onSwing(swing);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Compact labelled metre input for an opening dimension. */
function SizeField({
  label,
  value,
  onCommit,
  metreAbbr,
}: {
  label: string;
  value: number;
  onCommit: (metres: number) => void;
  metreAbbr: string;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-[10px] text-[var(--muted-foreground)]">{label}</span>
      <input
        type="number"
        step="0.1"
        min="0"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n > 0) onCommit(n);
        }}
        className="w-14 px-2 py-1 rounded-lg bg-[var(--muted)] border border-[var(--border)] text-xs"
        aria-label={`${label} (${metreAbbr})`}
      />
      <span className="text-[10px] text-[var(--muted-foreground)]">{metreAbbr}</span>
    </label>
  );
}

/**
 * Editable dimension field. Holds a local string buffer so partial typing ("3." / "3.5")
 * doesn't rescale the polygon mid-edit; commits on blur and on Enter, then resyncs to the
 * authoritative value (which may differ slightly after geometry rounding).
 */
function DimensionInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (metres: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);

  // Resync the buffer when the value changes from elsewhere (dragging, snap, reset).
  // Adjusting state during render is React's recommended alternative to a setState effect.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next > 0) onCommit(next);
    else setDraft(String(value)); // revert invalid input
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase text-[var(--muted-foreground)]">{label}</span>
      <input
        type="number"
        step="0.1"
        min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="px-2 py-1.5 rounded-lg bg-[var(--muted)] border border-[var(--border)] text-sm"
      />
    </label>
  );
}

/** Ceiling-height field — live numeric input (no shape geometry, so it commits on change). */
function HeightInput({ value, onChange }: { value: number; onChange: (height: number) => void }) {
  const { t } = useTranslation();
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase text-[var(--muted-foreground)]">{fpT(t, "height")}</span>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="px-2 py-1.5 rounded-lg bg-[var(--muted)] border border-[var(--border)] text-sm"
      />
    </label>
  );
}
