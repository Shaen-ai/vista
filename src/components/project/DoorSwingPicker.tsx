"use client";

/**
 * Visual door-swing picker. The user taps the corner the door opens toward,
 * which sets both `hinge` (which wall end the leaf pivots on) and `swing`
 * (which side it opens) in one gesture. A live preview redraws the leaf + arc,
 * mirroring how `doorSwingPath` renders the glyph on the plan.
 *
 * Mapping (wall drawn horizontally, room = bottom "In", exterior = top "Out"):
 *   top-left  → hinge left,  swing out      bottom-left  → hinge left,  swing in
 *   top-right → hinge right, swing out      bottom-right → hinge right, swing in
 */

import { useTranslation } from "@/i18n/VistaLocaleProvider";
import { fpT } from "@/lib/project/floorPlanEditorI18n";

type Hinge = "left" | "right";
type Swing = "in" | "out";

const WALL_Y = 50;
const WALL_X0 = 18;
const WALL_X1 = 82;
const LEAF = 30;

function quadrant(hinge: Hinge, swing: Swing) {
  const hx = hinge === "left" ? WALL_X0 : WALL_X1;
  // "in" opens toward the room (drawn at the bottom, +y); "out" toward the top (−y).
  const dir = swing === "in" ? 1 : -1;
  const tipY = WALL_Y + dir * LEAF;
  // Closed leaf lies along the wall toward the opposite end.
  const closedX = hinge === "left" ? hx + LEAF : hx - LEAF;
  // Sweep flag chosen so the arc bulges on the swing side.
  const sweep = (hinge === "left") === (swing === "in") ? 1 : 0;
  return {
    hx,
    tipY,
    closedX,
    arc: `M ${closedX} ${WALL_Y} A ${LEAF} ${LEAF} 0 0 ${sweep} ${hx} ${tipY}`,
  };
}

export default function DoorSwingPicker({
  hinge,
  swing,
  onChange,
}: {
  hinge: Hinge;
  swing: Swing;
  onChange: (next: { hinge: Hinge; swing: Swing }) => void;
}) {
  const { t } = useTranslation();
  const { hx, tipY, closedX, arc } = quadrant(hinge, swing);
  const inRoomLabel = fpT(t, "doorSwingInRoom");
  const outLabel = fpT(t, "doorSwingOut");

  const corner = (h: Hinge, s: Swing, label: string, pos: string) => {
    const active = h === hinge && s === swing;
    return (
      <button
        type="button"
        onClick={() => onChange({ hinge: h, swing: s })}
        aria-pressed={active}
        aria-label={label}
        className={`absolute ${pos} w-1/2 h-1/2 flex items-start justify-start p-1.5 ${
          active ? "" : "opacity-0 hover:opacity-100"
        }`}
      >
        <span
          className={`text-[9px] font-semibold px-1 rounded ${
            active ? "bg-[var(--primary)] text-white" : "bg-[var(--muted)] text-[var(--muted-foreground)]"
          }`}
        >
          {label}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-[var(--muted-foreground)]">{fpT(t, "doorSwingHint")}</span>
      <div className="relative w-[120px] h-[120px] rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 overflow-hidden select-none">
        <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none">
          {/* Room (In) side shaded at the bottom. */}
          <rect x="0" y={WALL_Y} width="100" height={100 - WALL_Y} fill="rgba(59,130,246,0.06)" />
          <text x="50" y="96" textAnchor="middle" fontSize="7" fill="var(--muted-foreground)">{inRoomLabel}</text>
          <text x="50" y="10" textAnchor="middle" fontSize="7" fill="var(--muted-foreground)">{outLabel}</text>
          {/* Wall. */}
          <line x1={WALL_X0} y1={WALL_Y} x2={WALL_X1} y2={WALL_Y} stroke="var(--foreground)" strokeWidth="3" strokeLinecap="round" />
          {/* Swing arc + open leaf. */}
          <path d={arc} fill="none" stroke="rgb(217,119,6)" strokeWidth="1.5" strokeDasharray="3 2" />
          <line x1={hx} y1={WALL_Y} x2={hx} y2={tipY} stroke="rgb(217,119,6)" strokeWidth="2.5" strokeLinecap="round" />
          <line x1={hx} y1={WALL_Y} x2={closedX} y2={WALL_Y} stroke="rgb(217,119,6)" strokeWidth="1" strokeOpacity="0.4" />
          {/* Hinge dot. */}
          <circle cx={hx} cy={WALL_Y} r="3" fill="rgb(217,119,6)" />
        </svg>
        {corner("left", "out", "↖", "top-0 left-0")}
        {corner("right", "out", "↗", "top-0 right-0")}
        {corner("left", "in", "↙", "bottom-0 left-0")}
        {corner("right", "in", "↘", "bottom-0 right-0")}
      </div>
    </div>
  );
}
