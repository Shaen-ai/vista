"use client";

import React from "react";
import { LANDING_MODE_IMAGES } from "@/lib/landingModeAssets";

// ─── Easing ───────────────────────────────────────────────────────────────────

const Easing = {
  linear: (t: number) => t,
  easeInQuad:    (t: number) => t * t,
  easeOutQuad:   (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic:    (t: number) => t * t * t,
  easeOutCubic:   (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeOutQuart:   (t: number) => 1 - (--t) * t * t * t,
  easeInOutExpo: (t: number) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    if (t < 0.5) return 0.5 * Math.pow(2, 20 * t - 10);
    return 1 - 0.5 * Math.pow(2, -20 * t + 10);
  },
  easeOutSine: (t: number) => Math.sin((t * Math.PI) / 2),
  easeOutBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInBack: (t: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function interpolate(
  input: number[],
  output: number[],
  ease: ((t: number) => number) | ((t: number) => number)[] = Easing.linear,
) {
  return (t: number) => {
    if (t <= input[0]) return output[0];
    if (t >= input[input.length - 1]) return output[output.length - 1];
    for (let i = 0; i < input.length - 1; i++) {
      if (t >= input[i] && t <= input[i + 1]) {
        const span = input[i + 1] - input[i];
        const local = span === 0 ? 0 : (t - input[i]) / span;
        const easeFn = Array.isArray(ease) ? (ease[i] ?? Easing.linear) : ease;
        const eased = easeFn(local);
        return output[i] + (output[i + 1] - output[i]) * eased;
      }
    }
    return output[output.length - 1];
  };
}

function animate({
  from = 0,
  to = 1,
  start = 0,
  end = 1,
  ease = Easing.easeInOutCubic,
}: {
  from?: number;
  to?: number;
  start?: number;
  end?: number;
  ease?: (t: number) => number;
}) {
  return (t: number) => {
    if (t <= start) return from;
    if (t >= end) return to;
    const local = (t - start) / (end - start);
    return from + (to - from) * ease(local);
  };
}
void animate;

// ─── Timeline context ─────────────────────────────────────────────────────────

interface TimelineCtx {
  time: number;
  duration: number;
  playing: boolean;
  setTime: (t: number | ((prev: number) => number)) => void;
  setPlaying: (v: boolean | ((prev: boolean) => boolean)) => void;
}

const TimelineContext = React.createContext<TimelineCtx>({
  time: 0,
  duration: 10,
  playing: false,
  setTime: () => {},
  setPlaying: () => {},
});

const useTime = () => React.useContext(TimelineContext).time;
const useTimeline = () => React.useContext(TimelineContext);

// ─── Sprite ───────────────────────────────────────────────────────────────────

interface SpriteCtx {
  localTime: number;
  progress: number;
  duration: number;
  visible: boolean;
}

const SpriteContext = React.createContext<SpriteCtx>({ localTime: 0, progress: 0, duration: 0, visible: false });
const useSprite = () => React.useContext(SpriteContext);

function Sprite({
  start = 0,
  end = Infinity,
  children,
  keepMounted = false,
}: {
  start?: number;
  end?: number;
  children: React.ReactNode | ((ctx: SpriteCtx) => React.ReactNode);
  keepMounted?: boolean;
}) {
  const { time } = useTimeline();
  const visible = time >= start && time <= end;
  if (!visible && !keepMounted) return null;

  const dur = end - start;
  const localTime = Math.max(0, time - start);
  const progress = dur > 0 && isFinite(dur) ? clamp(localTime / dur, 0, 1) : 0;
  const value: SpriteCtx = { localTime, progress, duration: dur, visible };

  return (
    <SpriteContext.Provider value={value}>
      {typeof children === "function" ? children(value) : children}
    </SpriteContext.Provider>
  );
}

// ─── PlaybackBar ──────────────────────────────────────────────────────────────

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 28, height: 28,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: hover ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 6,
        color: "#f6f4ef",
        cursor: "pointer",
        padding: 0,
        transition: "background 120ms",
      }}
    >
      {children}
    </button>
  );
}

function PlaybackBar({
  time,
  duration,
  playing,
  onPlayPause,
  onReset,
  onSeek,
  onHover,
}: {
  time: number;
  duration: number;
  playing: boolean;
  onPlayPause: () => void;
  onReset: () => void;
  onSeek: (t: number) => void;
  onHover: (t: number | null) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const timeFromEvent = React.useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      return x * duration;
    },
    [duration],
  );

  const onTrackMove = (e: React.MouseEvent) => {
    if (!trackRef.current) return;
    const t = timeFromEvent(e);
    if (dragging) onSeek(t);
    else onHover(t);
  };

  const onTrackLeave = () => {
    if (!dragging) onHover(null);
  };

  const onTrackDown = (e: React.MouseEvent) => {
    setDragging(true);
    onSeek(timeFromEvent(e));
    onHover(null);
  };

  React.useEffect(() => {
    if (!dragging) return;
    const onUp = () => setDragging(false);
    const onMove = (e: MouseEvent) => {
      if (!trackRef.current) return;
      onSeek(timeFromEvent(e));
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
    };
  }, [dragging, timeFromEvent, onSeek]);

  const pct = duration > 0 ? (time / duration) * 100 : 0;
  const fmt = (t: number) => {
    const total = Math.max(0, t);
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    const cs = Math.floor((total * 100) % 100);
    return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  };
  const mono = "JetBrains Mono, ui-monospace, SFMono-Regular, monospace";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "8px 16px",
      background: "rgba(20,20,20,0.92)",
      borderTop: "1px solid rgba(255,255,255,0.08)",
      width: "100%", maxWidth: 680, alignSelf: "center",
      borderRadius: 8, color: "#f6f4ef",
      fontFamily: "Inter, system-ui, sans-serif",
      userSelect: "none", flexShrink: 0,
    }}>
      <IconButton onClick={onReset} title="Return to start (0)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 2v10M12 2L5 7l7 5V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </IconButton>
      <IconButton onClick={onPlayPause} title="Play/pause (space)">
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="3" y="2" width="3" height="10" fill="currentColor" />
            <rect x="8" y="2" width="3" height="10" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 2l9 5-9 5V2z" fill="currentColor" />
          </svg>
        )}
      </IconButton>
      <div style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: "tabular-nums", width: 64, textAlign: "right", color: "#f6f4ef" }}>
        {fmt(time)}
      </div>
      <div
        ref={trackRef}
        onMouseMove={onTrackMove}
        onMouseLeave={onTrackLeave}
        onMouseDown={onTrackDown}
        style={{ flex: 1, height: 22, position: "relative", cursor: "pointer", display: "flex", alignItems: "center" }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: 4, background: "oklch(72% 0.12 250)", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: `${pct}%`, top: "50%", width: 12, height: 12, marginLeft: -6, marginTop: -6, background: "#fff", borderRadius: 6, boxShadow: "0 2px 4px rgba(0,0,0,0.4)" }} />
      </div>
      <div style={{ fontFamily: mono, fontSize: 12, fontVariantNumeric: "tabular-nums", width: 64, textAlign: "left", color: "rgba(246,244,239,0.55)" }}>
        {fmt(duration)}
      </div>
    </div>
  );
}

// ─── Stage ────────────────────────────────────────────────────────────────────

function Stage({
  width = 1280,
  height = 720,
  duration = 10,
  background = "#f6f4ef",
  loop = true,
  autoplay = true,
  persistKey = "animstage",
  children,
}: {
  width?: number;
  height?: number;
  duration?: number;
  background?: string;
  loop?: boolean;
  autoplay?: boolean;
  persistKey?: string;
  children?: React.ReactNode;
}) {
  const [time, setTime] = React.useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(persistKey + ":t") ?? "0");
      return isFinite(v) ? clamp(v, 0, duration) : 0;
    } catch { return 0; }
  });
  const [playing, setPlaying] = React.useState(autoplay);
  const [hoverTime, setHoverTime] = React.useState<number | null>(null);
  const [scale, setScale] = React.useState(1);

  const stageRef = React.useRef<HTMLDivElement>(null);
  const rafRef = React.useRef<number | null>(null);
  const lastTsRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    try { localStorage.setItem(persistKey + ":t", String(time)); } catch {}
  }, [time, persistKey]);

  React.useEffect(() => {
    if (!stageRef.current) return;
    const el = stageRef.current;
    const measure = () => {
      const barH = 44;
      const s = Math.min(el.clientWidth / width, (el.clientHeight - barH) / height);
      setScale(Math.max(0.05, s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [width, height]);

  React.useEffect(() => {
    if (!playing) { lastTsRef.current = null; return; }
    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setTime((t) => {
        let next = t + dt;
        if (next >= duration) {
          if (loop) next = next % duration;
          else { next = duration; setPlaying(false); }
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastTsRef.current = null; };
  }, [playing, duration, loop]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      if (e.code === "Space") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.code === "ArrowLeft") setTime((t) => clamp(t - (e.shiftKey ? 1 : 0.1), 0, duration));
      else if (e.code === "ArrowRight") setTime((t) => clamp(t + (e.shiftKey ? 1 : 0.1), 0, duration));
      else if (e.key === "0" || e.code === "Home") setTime(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration]);

  const displayTime = hoverTime != null ? hoverTime : time;

  const ctxValue = React.useMemo(
    () => ({ time: displayTime, duration, playing, setTime, setPlaying }),
    [displayTime, duration, playing],
  );

  return (
    <div
      ref={stageRef}
      style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", background: "#0a0a0a", fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}>
        <div
          style={{
            width, height, background, position: "relative",
            transform: `scale(${scale})`, transformOrigin: "center",
            flexShrink: 0, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", overflow: "hidden",
          }}
        >
          <TimelineContext.Provider value={ctxValue}>
            {children}
          </TimelineContext.Provider>
        </div>
      </div>
      <PlaybackBar
        time={displayTime}
        duration={duration}
        playing={playing}
        onPlayPause={() => setPlaying((p) => !p)}
        onReset={() => setTime(0)}
        onSeek={(t) => setTime(t)}
        onHover={(t) => setHoverTime(t)}
      />
    </div>
  );
}

// ─── Design constants ──────────────────────────────────────────────────────────

const VISTA = {
  cream: "#f2eee7",
  creamSoft: "#ebe4d8",
  ink: "#1a1814",
  inkSoft: "#3a342c",
  muted: "#857d6f",
  border: "#d8d0bf",
  orange: "#d96a21",
  orangeSoft: "#e8772e",
  vega:  { bg: "#dbeafe", fg: "#1d4ed8" },
  domus: { bg: "#dcfce7", fg: "#15803d" },
  jysk:  { bg: "#e8f0fb", fg: "#1e40af" },
};

const BRAND = '"Fraunces", "EB Garamond", Georgia, serif';
const SERIF = '"Noto Serif Armenian", "Fraunces", "EB Garamond", Georgia, serif';
const SANS  = '"Noto Sans Armenian", "Inter Tight", "Inter", system-ui, sans-serif';
const MONO  = '"JetBrains Mono", ui-monospace, monospace';

const HERO_ROOM = "/video/refs/room8.jpg";

const REEL_ROOMS = [
  { src: "/video/refs/room3.jpg", label: "Մուտք",           meta: "NCS-S-1505-Y50R" },
  { src: "/video/refs/room8.jpg", label: "Ճաշասենյակ",      meta: "Ջահ · կաղնի · ագաթ" },
  { src: "/video/refs/room7.jpg", label: "Սան. սենյակ",     meta: "NCS-S-0300-N · ընկուզենի" },
];

function clamp01(t: number) { return Math.max(0, Math.min(1, t)); }

function pillStyle(): React.CSSProperties {
  return {
    padding: "8px 16px", borderRadius: 999,
    border: `1px solid ${VISTA.border}`,
    background: "#fff",
    fontFamily: SANS, fontSize: 15, fontWeight: 500, color: VISTA.inkSoft,
    display: "inline-flex", alignItems: "center", gap: 8,
    whiteSpace: "nowrap",
  };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Watermark() {
  return (
    <div style={{ position: "absolute", left: 56, bottom: 40, fontFamily: MONO, fontSize: 13, color: VISTA.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
      vista.tunzone.com
    </div>
  );
}

function Cursor({ x, y }: { x: number; y: number }) {
  return (
    <svg style={{ position: "absolute", left: x, top: y, pointerEvents: "none" }} width="28" height="32" viewBox="0 0 28 32">
      <path d="M2 2 L2 22 L8 17 L12 28 L16 26 L12 16 L20 16 Z" fill={VISTA.ink} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SparkleIcon({ size = 18, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3 L13.5 9.5 L20 11 L13.5 12.5 L12 19 L10.5 12.5 L4 11 L10.5 9.5 Z" fill={color} />
      <path d="M19 3 L19.7 5.3 L22 6 L19.7 6.7 L19 9 L18.3 6.7 L16 6 L18.3 5.3 Z" fill={color} opacity="0.8" />
    </svg>
  );
}

function AppChrome({ children, showCursor }: { children: React.ReactNode; showCursor?: { x: number; y: number } }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: VISTA.cream, padding: "48px 80px", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ fontFamily: BRAND, fontStyle: "italic", fontWeight: 400, fontSize: 42, color: VISTA.ink, letterSpacing: "-0.03em", lineHeight: 1 }}>
          vista
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={pillStyle()}>Հայաստան</span>
          <span style={pillStyle()}>ՀԱՅ</span>
          <span style={{ ...pillStyle(), background: VISTA.ink, color: VISTA.cream, borderColor: VISTA.ink }}>◆ 240</span>
        </div>
      </div>
      <div style={{ flex: 1, marginTop: 28, minHeight: 0, position: "relative" }}>
        {children}
      </div>
      {showCursor && <Cursor x={showCursor.x} y={showCursor.y} />}
    </div>
  );
}

// ─── Scene 1: Title ───────────────────────────────────────────────────────────

function SceneTitle() {
  const { localTime, duration } = useSprite();
  const fadeIn  = clamp01(localTime / 0.8);
  const fadeOut = clamp01((duration - 0.5 - localTime) / 0.5);
  const opacity = Math.min(Easing.easeOutCubic(fadeIn), fadeOut);
  const subOpacity = clamp01((localTime - 0.6) / 0.7);
  const lineW = Easing.easeOutCubic(clamp01((localTime - 0.3) / 1.2));

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", background: VISTA.cream }}>
      <div style={{ opacity, textAlign: "center", transform: `translateY(${(1 - fadeIn) * 14}px)` }}>
        <div style={{ fontFamily: BRAND, fontWeight: 300, fontSize: 220, color: VISTA.ink, letterSpacing: "-0.04em", lineHeight: 0.9, fontStyle: "italic" }}>
          vista
        </div>
        <div style={{ height: 1, width: `${lineW * 360}px`, margin: "32px auto 0", background: VISTA.ink, opacity: 0.4 }} />
        <div style={{ marginTop: 28, fontFamily: SANS, fontSize: 22, letterSpacing: "0.35em", textTransform: "uppercase", color: VISTA.inkSoft, opacity: subOpacity }}>
          ինտերիերի դիզայն
        </div>
      </div>
      <Watermark />
    </div>
  );
}

// ─── Scene 2: Modes ───────────────────────────────────────────────────────────

function ModeCard({
  opacity, active, tag, title, desc, cost, subcost, image, accent,
}: {
  opacity: number; active: boolean; tag: string; title: string;
  desc: string; cost: string; subcost: string; image: string; accent: string;
}) {
  return (
    <div style={{
      width: 540, height: 480, borderRadius: 18, background: "#fff",
      border: `2px solid ${active ? VISTA.ink : VISTA.border}`,
      overflow: "hidden", opacity,
      transform: `translateY(${(1 - opacity) * 20}px) scale(${active ? 1.02 : 1})`,
      transition: "transform 0.3s, border-color 0.3s",
      boxShadow: active ? "0 30px 60px -20px rgba(60,40,20,0.28)" : "0 10px 30px -12px rgba(60,40,20,0.12)",
      display: "flex", flexDirection: "column", flexShrink: 0,
    }}>
      <div style={{ height: 240, width: "100%", backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center", position: "relative", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 16, left: 16, padding: "6px 12px", borderRadius: 999, background: "rgba(255,255,255,0.92)", fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: VISTA.ink, backdropFilter: "blur(8px)", whiteSpace: "nowrap" }}>
          {tag}
        </div>
      </div>
      <div style={{ padding: "24px 28px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: 34, color: VISTA.ink, letterSpacing: "-0.02em", lineHeight: 1 }}>{title}</div>
        <div style={{ fontFamily: SANS, fontSize: 15, color: VISTA.inkSoft, marginTop: 10, lineHeight: 1.45, flex: 1 }}>{desc}</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 16, paddingTop: 16, borderTop: `1px solid ${VISTA.border}` }}>
          <div style={{ fontFamily: SANS, fontSize: 22, fontWeight: 700, color: accent, fontVariantNumeric: "tabular-nums" }}>{cost}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: VISTA.muted, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{subcost}</div>
        </div>
      </div>
    </div>
  );
}

function SceneModes() {
  const { localTime } = useSprite();
  const headIn  = clamp01(localTime / 0.5);
  const leftIn  = clamp01((localTime - 0.3) / 0.6);
  const rightIn = clamp01((localTime - 0.55) / 0.6);

  const cursorX = interpolate([0, 0.9, 1.8, 2.6, 6.5], [560, 560, 1360, 1360, 1360], Easing.easeInOutCubic)(localTime);
  const cursorY = interpolate([0, 0.9, 1.8, 2.6, 6.5], [560, 560, 600, 600, 600],  Easing.easeInOutCubic)(localTime);
  const rightActive = localTime > 1.7;

  return (
    <div style={{ position: "absolute", inset: 0, background: VISTA.cream, overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 48, left: 80, right: 80, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: headIn }}>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: 42, color: VISTA.ink, letterSpacing: "-0.03em" }}>vista</div>
        <div style={{ display: "flex", gap: 12 }}>
          <span style={pillStyle()}>Հայաստան</span>
          <span style={pillStyle()}>ՀԱՅ</span>
          <span style={{ ...pillStyle(), background: VISTA.ink, color: VISTA.cream, borderColor: VISTA.ink }}>◆ 20</span>
        </div>
      </div>

      <div style={{ position: "absolute", top: 150, left: 0, right: 0, textAlign: "center", opacity: headIn, transform: `translateY(${(1 - headIn) * 12}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.24em", textTransform: "uppercase", color: VISTA.muted }}>քայլ 01 / ընտրեք ռեժիմը</div>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: 64, color: VISTA.ink, letterSpacing: "-0.025em", marginTop: 10, lineHeight: 1 }}>Մեկ սենյակ կամ ողջ բնակարանը։</div>
      </div>

      <div style={{ position: "absolute", top: 350, left: "50%", transform: `translateX(-50%) translateY(${(1 - headIn) * 12}px)`, display: "flex", gap: 6, padding: 6, borderRadius: 999, background: "#fff", border: `1px solid ${VISTA.border}`, opacity: headIn }}>
        <div style={{ padding: "10px 22px", borderRadius: 999, background: rightActive ? "transparent" : VISTA.ink, color: rightActive ? VISTA.inkSoft : VISTA.cream, fontFamily: SANS, fontSize: 15, fontWeight: 600, transition: "all 0.3s" }}>Արագ սենյակ</div>
        <div style={{ padding: "10px 22px", borderRadius: 999, background: rightActive ? VISTA.ink : "transparent", color: rightActive ? VISTA.cream : VISTA.inkSoft, fontFamily: SANS, fontSize: 15, fontWeight: 600, transition: "all 0.3s" }}>Ամբողջ նախագիծ</div>
      </div>

      <div style={{ position: "absolute", top: 460, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 40 }}>
        <ModeCard opacity={leftIn} active={!rightActive} tag="արագ սենյակ" title="Մեկ սենյակ, մեկ կադր։" desc="Բեռնեք ցանկացած սենյակի լուսանկարը։ ստացեք դիզայն և պատվիրելի կահույք 18 վայրկյանում։" cost="10 ◆" subcost="≈ 400 ֏ · 18 վրկ." image={LANDING_MODE_IMAGES.quick} accent={VISTA.orange} />
        <ModeCard opacity={rightIn} active={rightActive} tag="ամբողջ նախագիծ" title="Ողջ բնակարանը։" desc="Մեկ անգամ նկարագրեք. ստացեք ամեն սենյակը—համախառն դիզայնով և մեկ ընդհանուր ցանկով։" cost="սկսած 40 ◆" subcost="5+ սենյակ" image={LANDING_MODE_IMAGES.project} accent={VISTA.ink} />
      </div>

      <Cursor x={cursorX} y={cursorY} />
    </div>
  );
}

// ─── Scene 3: Upload ──────────────────────────────────────────────────────────

function SceneUpload() {
  const { localTime, duration } = useSprite();
  const photoIn   = clamp01((localTime - 0.2) / 0.8);
  const sidebarIn = clamp01((localTime - 0.6) / 0.7);
  const labelIn   = clamp01((localTime - 1.2) / 0.6);

  const cursorX = interpolate([0, 1.0, 2.2, duration], [1760, 1480, 1480, 1480], Easing.easeInOutCubic)(localTime);
  const cursorY = interpolate([0, 1.0, 2.2, duration], [1020, 980, 980, 980],  Easing.easeInOutCubic)(localTime);

  return (
    <AppChrome showCursor={{ x: cursorX, y: cursorY }}>
      {/* Left sidebar */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 260, opacity: sidebarIn, transform: `translateX(${(1 - sidebarIn) * -12}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: VISTA.muted, marginBottom: 14 }}>շուկա</div>
        <div style={{ padding: "10px 14px", border: `1px solid ${VISTA.border}`, borderRadius: 12, background: "#fff", fontFamily: SANS, fontSize: 13, color: VISTA.muted, display: "flex", alignItems: "center", gap: 8 }}>
          <span>⌕</span><span>Որոնել 12 400 ապրանք</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
          {[{ bg: "#dbeafe", label: "Vega" }, { bg: "#dcfce7", label: "Domus" }, { bg: "#e8f0fb", label: "JYSK" }, { bg: "#f5e6d8", label: "+12" }].map((p, i) => (
            <div key={i} style={{ aspectRatio: "1 / 1", borderRadius: 10, background: p.bg, display: "flex", alignItems: "flex-end", padding: 10, fontFamily: SANS, fontSize: 13, fontWeight: 600, color: VISTA.inkSoft, opacity: clamp01((localTime - 0.8 - i * 0.08) / 0.4) }}>{p.label}</div>
          ))}
        </div>
      </div>

      {/* Center */}
      <div style={{ position: "absolute", left: 300, right: 300, top: 0, bottom: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: VISTA.muted, marginBottom: 12, opacity: labelIn, flexShrink: 0 }}>քայլ 01 / ձեր սենյակը</div>
        <div style={{ position: "relative", flex: 1, minHeight: 0, borderRadius: 18, overflow: "hidden", border: `1px solid ${VISTA.border}`, background: "#e9e1d2", opacity: photoIn, transform: `scale(${0.96 + 0.04 * photoIn})`, transformOrigin: "center", boxShadow: "0 30px 60px -20px rgba(60,40,20,0.18)" }}>
          <img src={HERO_ROOM} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 65%", filter: "saturate(0.18) brightness(0.78) contrast(0.94)" }} />
          <div style={{ position: "absolute", top: 16, left: 16, padding: "7px 12px", borderRadius: 999, background: "rgba(20,18,15,0.78)", color: "#fff", fontFamily: SANS, fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, backdropFilter: "blur(6px)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: "#5dd07a" }} />
            բեռնված · room-living.jpg
          </div>
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", flexShrink: 0, opacity: clamp01((localTime - 1.8) / 0.5) }}>
          <div style={{ padding: "12px 22px", borderRadius: 12, background: VISTA.orange, color: "#fff", fontFamily: SANS, fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em", boxShadow: "0 6px 16px -4px rgba(217,106,33,0.5)", display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
            <SparkleIcon size={15} /> Ստեղծել դիզայն
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 260, opacity: sidebarIn, transform: `translateX(${(1 - sidebarIn) * 12}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: VISTA.muted, marginBottom: 14 }}>ոճ</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {["Մոդեռն", "Սկանդի", "Մինիմալ", "Արտ Դեկո"].map((s, i) => (
            <div key={s} style={{ padding: "12px 16px", borderRadius: 10, border: `1px solid ${i === 0 ? VISTA.ink : VISTA.border}`, background: i === 0 ? VISTA.ink : "#fff", color: i === 0 ? VISTA.cream : VISTA.inkSoft, fontFamily: SANS, fontSize: 14, fontWeight: 500, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: clamp01((localTime - 1.0 - i * 0.1) / 0.4) }}>
              <span>{s}</span>
              {i === 0 && <span>●</span>}
            </div>
          ))}
        </div>
      </div>
    </AppChrome>
  );
}

// ─── Scene 4: Analyze ────────────────────────────────────────────────────────

function Dots({ t }: { t: number }) {
  const n = Math.floor((t * 2) % 4);
  return <span style={{ width: 24, display: "inline-block", fontFamily: MONO, textAlign: "left" }}>{"."
    .repeat(n)}</span>;
}

function SceneAnalyze() {
  const { localTime, duration } = useSprite();
  const zoom = Easing.easeInOutCubic(clamp01(localTime / 1.2));
  const chromeOpacity = 1 - 0.85 * zoom;
  const markers = [
    { x: 0.625, y: 0.81, label: "ԲԱՒՄՈՒԹԻ · 280×95", delay: 0.7,  side: "right" },
    { x: 0.43,  y: 0.28, label: "ՋԱՀ",                delay: 1.0,  side: "right" },
    { x: 0.46,  y: 0.86, label: "ՍԵՂԱՆ",               delay: 1.3,  side: "left"  },
    { x: 0.17,  y: 0.44, label: "ՀԵՌ. · 65\"",         delay: 1.6,  side: "right" },
    { x: 0.74,  y: 0.44, label: "ՆԿԱՐ",                delay: 1.9,  side: "left"  },
  ];
  const scanT = clamp01((localTime - 0.4) / 1.4);
  const photoScale = 1 + 0.05 * zoom;

  return (
    <div style={{ position: "absolute", inset: 0, background: VISTA.cream, overflow: "hidden" }}>
      <div style={{ opacity: chromeOpacity, position: "absolute", inset: 0, pointerEvents: "none" }}>
        <AppChrome><div /></AppChrome>
      </div>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${photoScale})`, transformOrigin: "center", overflow: "hidden" }}>
        <img src={HERO_ROOM} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: `saturate(${0.18 + 0.4 * zoom}) brightness(${0.78 + 0.12 * zoom})` }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: `${scanT * 100}%`, height: 60, marginTop: -30, background: `linear-gradient(180deg, transparent 0%, ${VISTA.orange}40 50%, transparent 100%)`, opacity: scanT > 0 && scanT < 1 ? 1 : 0, mixBlendMode: "screen" }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: `${scanT * 100}%`, height: 2, background: VISTA.orange, opacity: scanT > 0 && scanT < 1 ? 0.9 : 0, boxShadow: `0 0 16px ${VISTA.orange}` }} />
        {markers.map((m, i) => {
          const t = clamp01((localTime - m.delay) / 0.5);
          const popT = Easing.easeOutBack(t);
          return (
            <div key={i} style={{ position: "absolute", left: `${m.x * 100}%`, top: `${m.y * 100}%`, opacity: t }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: VISTA.orange, border: "3px solid #fff", boxShadow: `0 0 0 4px ${VISTA.orange}40, 0 2px 8px rgba(0,0,0,0.3)`, transform: `translate(-50%, -50%) scale(${popT})` }} />
              <div style={{ position: "absolute", left: m.side === "right" ? 16 : "auto", right: m.side === "left" ? 16 : "auto", top: -10, padding: "4px 10px", background: "rgba(20,18,15,0.92)", color: "#fff", fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em", borderRadius: 4, whiteSpace: "nowrap", opacity: clamp01((localTime - m.delay - 0.2) / 0.3) }}>{m.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: "50%", bottom: 60, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", background: "rgba(20,18,15,0.92)", color: "#fff", borderRadius: 999, fontFamily: SANS, fontSize: 17, fontWeight: 500, opacity: clamp01((localTime - 0.3) / 0.4) * clamp01((duration - 0.4 - localTime) / 0.4), backdropFilter: "blur(8px)" }}>
        <SparkleIcon size={18} />
        <span style={{ whiteSpace: "nowrap" }}>Վերլուծում է սենյակը</span>
        <Dots t={localTime} />
      </div>
    </div>
  );
}

// ─── Scene 5: Reveal ──────────────────────────────────────────────────────────

function SceneReveal() {
  const { localTime, duration } = useSprite();
  const wipe = Easing.easeInOutCubic(clamp01((localTime - 0.2) / 1.4));
  const kb   = clamp01((localTime - 1.5) / (duration - 1.5));
  const labelOpacity = clamp01((localTime - 1.7) / 0.6) * clamp01((duration - 0.4 - localTime) / 0.5);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0a0907", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${1 + 0.05 * kb}) translateX(${-kb * 30}px)`, transformOrigin: "center" }}>
        <img src={HERO_ROOM} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${wipe * 100}%)`, WebkitClipPath: `inset(0 0 0 ${wipe * 100}%)` }}>
        <img src={HERO_ROOM} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "saturate(0.12) brightness(0.62) contrast(0.92)" }} />
      </div>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${wipe * 100}%`, width: 3, background: "#fff", boxShadow: `0 0 32px 4px #fff, 0 0 60px 8px ${VISTA.orange}80`, opacity: wipe > 0 && wipe < 1 ? 1 : 0 }} />
      <div style={{ position: "absolute", top: 50, left: 60, fontFamily: MONO, fontSize: 14, letterSpacing: "0.24em", textTransform: "uppercase", color: "#fff", opacity: 0.65, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>մինչ</div>
      <div style={{ position: "absolute", top: 50, right: 60, fontFamily: MONO, fontSize: 14, letterSpacing: "0.24em", textTransform: "uppercase", color: "#fff", opacity: 0.85, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>հետո</div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 80, textAlign: "center", opacity: labelOpacity, pointerEvents: "none" }}>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: 64, color: "#fff", letterSpacing: "-0.02em", textShadow: "0 4px 24px rgba(0,0,0,0.6)" }}>ստեղծված է 18 վայրկյանում</div>
        <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 13, letterSpacing: "0.24em", textTransform: "uppercase", color: "#fff", opacity: 0.75, textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>«մոդեռն կլասիկ» · 80 մ²</div>
      </div>
    </div>
  );
}

// ─── Scene 6: Shoppable ───────────────────────────────────────────────────────

function ProductMarker({
  x, y, cardX, cardY, brand, name, price, crop, opacity, pop,
}: {
  x: number; y: number; cardX: number; cardY: number;
  brand: string; name: string; price: string;
  crop: { x: number; y: number; w: number; h: number };
  opacity: number; pop: number;
}) {
  const brandColor = brand === "Vega" ? VISTA.vega : brand === "Domus" ? VISTA.domus : VISTA.jysk;
  const cropStyle: React.CSSProperties = {
    backgroundImage: `url(${HERO_ROOM})`,
    backgroundSize: `${100 / crop.w}% ${100 / crop.h}%`,
    backgroundPosition: `${(crop.x / Math.max(0.001, 1 - crop.w)) * 100}% ${(crop.y / Math.max(0.001, 1 - crop.h)) * 100}%`,
  };
  const pinPx = { x: x * 1920, y: y * 1080 };
  const cardPx = { x: cardX * 1920, y: cardY * 1080 };
  const dx = cardPx.x + 130 - pinPx.x;
  const dy = cardPx.y + 50 - pinPx.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  return (
    <div style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: pinPx.x, top: pinPx.y, width: len * pop, height: 1.5, background: VISTA.orange, opacity: 0.7, transformOrigin: "0 50%", transform: `rotate(${angle}deg)` }} />
      <div style={{ position: "absolute", left: pinPx.x, top: pinPx.y, width: 22, height: 22, borderRadius: 11, background: "#fff", border: `3px solid ${VISTA.orange}`, transform: `translate(-50%, -50%) scale(${pop})`, boxShadow: `0 0 0 6px ${VISTA.orange}30, 0 2px 12px rgba(0,0,0,0.4)` }} />
      <div style={{ position: "absolute", left: cardPx.x, top: cardPx.y, width: 260, background: "rgba(20,18,15,0.92)", backdropFilter: "blur(12px)", borderRadius: 14, padding: 14, display: "flex", gap: 12, transform: `scale(${pop})`, transformOrigin: "center", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 16px 40px -10px rgba(0,0,0,0.6)" }}>
        <div style={{ width: 64, height: 64, borderRadius: 8, flexShrink: 0, backgroundColor: "#ddd", ...cropStyle }} />
        <div style={{ flex: 1, minWidth: 0, color: "#fff" }}>
          <div style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: brandColor.bg, color: brandColor.fg, fontFamily: SANS, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{brand}</div>
          <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, marginTop: 6, lineHeight: 1.2 }}>{name}</div>
          <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: VISTA.orangeSoft, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{price}</div>
        </div>
      </div>
    </div>
  );
}

function SceneShoppable() {
  const { localTime, duration } = useSprite();
  const t = clamp01(localTime / duration);
  const products = [
    { x: 0.625, y: 0.81, cardX: 0.34, cardY: 0.62, delay: 0.3, brand: "Vega",  name: "Տաքտակային բազմոց", price: "780,000 ֏", crop: { x: 0.50, y: 0.62, w: 0.34, h: 0.30 } },
    { x: 0.43,  y: 0.28, cardX: 0.49, cardY: 0.10, delay: 1.0, brand: "Domus", name: "Արույրե ջահ",        price: "320,000 ֏", crop: { x: 0.34, y: 0.18, w: 0.20, h: 0.18 } },
    { x: 0.17,  y: 0.44, cardX: 0.04, cardY: 0.20, delay: 1.7, brand: "JYSK",  name: "Պատից կախվող TV",    price: "545,000 ֏", crop: { x: 0.08, y: 0.36, w: 0.20, h: 0.16 } },
  ];

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0a0907", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${1.04 + 0.04 * t})`, transformOrigin: "center" }}>
        <img src={HERO_ROOM} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.82)" }} />
      </div>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0.55) 100%)" }} />
      {products.map((p, i) => {
        const appear = clamp01((localTime - p.delay) / 0.5);
        const exit   = clamp01((duration - 0.3 - localTime) / 0.4);
        return <ProductMarker key={i} {...p} opacity={appear * exit} pop={Easing.easeOutBack(appear)} />;
      })}
      <div style={{ position: "absolute", top: 60, left: 60, width: 700, opacity: clamp01((localTime - 0.1) / 0.5) * clamp01((duration - 0.4 - localTime) / 0.4) }}>
        <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.24em", textTransform: "uppercase", color: "#fff", opacity: 0.7, textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>ամեն իր</div>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: 72, color: "#fff", letterSpacing: "-0.02em", marginTop: 6, lineHeight: 1, textShadow: "0 2px 12px rgba(0,0,0,0.5)", whiteSpace: "nowrap" }}>պատվիրելի է։</div>
      </div>
      <div style={{ position: "absolute", bottom: 60, right: 60, opacity: clamp01((localTime - 2.4) / 0.5) * clamp01((duration - 0.4 - localTime) / 0.4), textAlign: "right" }}>
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#fff", opacity: 0.6, textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>ընդամենը · 12 իր</div>
        <div style={{ fontFamily: SANS, fontSize: 38, fontWeight: 500, color: "#fff", marginTop: 4, fontVariantNumeric: "tabular-nums", textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>1,847,000 ֏</div>
      </div>
    </div>
  );
}

// ─── Scene 7: Multi-room ──────────────────────────────────────────────────────

function SceneMultiRoom() {
  const { localTime, duration } = useSprite();
  const rooms = REEL_ROOMS;
  const cardW = 560, cardH = 720, gap = 28;
  const totalW = rooms.length * (cardW + gap) - gap;
  const startX = 200;
  const panT = Easing.easeInOutCubic(clamp01((localTime - 0.3) / (duration - 0.3)));
  const pan = -panT * (totalW - 1920 + startX + 100);

  return (
    <div style={{ position: "absolute", inset: 0, background: VISTA.cream, overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 60, left: 80, right: 80, display: "flex", justifyContent: "space-between", alignItems: "flex-end", opacity: clamp01(localTime / 0.5) }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.24em", textTransform: "uppercase", color: VISTA.muted }}>նախագիծ · ալբերտ</div>
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: 56, color: VISTA.ink, letterSpacing: "-0.02em", marginTop: 6 }}>Ողջ բնակարանը։</div>
        </div>
        <div style={{ fontFamily: SANS, fontSize: 18, color: VISTA.inkSoft, textAlign: "right" }}>
          <div style={{ fontWeight: 500 }}>5 սենյակ · 1 նախագիծ</div>
          <div style={{ color: VISTA.muted, fontSize: 14, marginTop: 4 }}>«Կոմիտաս Պարկ» · 8-րդ մասնաշ.</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, top: 280, height: cardH, right: 0 }}>
        <div style={{ position: "absolute", left: startX, top: 0, display: "flex", gap, transform: `translateX(${pan}px)`, willChange: "transform" }}>
          {rooms.map((r, i) => (
            <div key={i} style={{ width: cardW, height: cardH, flexShrink: 0, position: "relative", borderRadius: 16, overflow: "hidden", border: `1px solid ${VISTA.border}`, boxShadow: "0 30px 60px -20px rgba(60,40,20,0.25)", background: "#eee" }}>
              <img src={r.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", left: 18, bottom: 18, padding: "10px 14px", background: "rgba(20,18,15,0.85)", color: "#fff", borderRadius: 10, backdropFilter: "blur(8px)" }}>
                <div style={{ fontFamily: SANS, fontSize: 18, fontWeight: 600 }}>{r.label}</div>
                <div style={{ fontFamily: MONO, fontSize: 11, opacity: 0.75, letterSpacing: "0.08em", marginTop: 2 }}>{r.meta}</div>
              </div>
              <div style={{ position: "absolute", top: 18, right: 18, padding: "6px 10px", borderRadius: 999, background: "#fff", fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: VISTA.ink }}>{String(i + 1).padStart(2, "0")} / {String(rooms.length).padStart(2, "0")}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Scene 8: Tokens & Referral ───────────────────────────────────────────────

function SceneTokens() {
  const { localTime } = useSprite();
  const headIn = clamp01(localTime / 0.5);
  const welcomeIn = Easing.easeOutBack(clamp01((localTime - 0.4) / 0.7));
  const counter = Math.round(interpolate([0.4, 1.4], [0, 20], Easing.easeOutCubic)(localTime));
  const priceIn = clamp01((localTime - 1.0) / 0.5);
  const referralIn = clamp01((localTime - 1.6) / 0.7);
  const friendT = clamp01((localTime - 2.4) / 1.1);

  return (
    <div style={{ position: "absolute", inset: 0, background: VISTA.creamSoft, overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 80, left: 80, right: 80, opacity: headIn, transform: `translateY(${(1 - headIn) * 12}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.24em", textTransform: "uppercase", color: VISTA.muted }}>թոքեններով աշխատող</div>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: 72, color: VISTA.ink, letterSpacing: "-0.025em", marginTop: 8, lineHeight: 1 }}>
          Մուտք գործեք։ <span style={{ color: VISTA.orange }}>20 թոքեն—նվեր։</span>
        </div>
      </div>

      <div style={{ position: "absolute", top: 290, left: 80, opacity: clamp01(welcomeIn), transform: `translateY(${(1 - welcomeIn) * 24}px) scale(${0.92 + 0.08 * Math.min(1, welcomeIn)})`, display: "flex", alignItems: "center", gap: 22, padding: "24px 32px", borderRadius: 18, background: VISTA.ink, color: VISTA.cream, boxShadow: "0 20px 50px -16px rgba(60,40,20,0.4)", minWidth: 480 }}>
        <div style={{ width: 64, height: 64, borderRadius: 12, background: VISTA.orange, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, color: "#fff", fontFamily: SANS }}>◆</div>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.6, whiteSpace: "nowrap" }}>ողջույնի թոքեններ</div>
          <div style={{ fontFamily: SANS, fontSize: 52, fontWeight: 600, lineHeight: 1, marginTop: 6, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
            +{counter} <span style={{ fontSize: 22, opacity: 0.7, fontWeight: 500 }}>թոքեն</span>
          </div>
        </div>
      </div>

      <div style={{ position: "absolute", top: 320, right: 80, width: 480, opacity: priceIn, transform: `translateY(${(1 - priceIn) * 16}px)`, background: "#fff", borderRadius: 16, border: `1px solid ${VISTA.border}`, padding: 22, boxShadow: "0 12px 32px -16px rgba(60,40,20,0.18)" }}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: VISTA.muted, marginBottom: 14 }}>ինչի համար են թոքենները</div>
        {[{ label: "Դիզայն ստեղծել", cost: 10 }, { label: "Կրկին ստեղծել", cost: 5 }, { label: "Խմբագրել", cost: 3 }].map((row, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${VISTA.border}`, opacity: clamp01((localTime - 1.1 - i * 0.12) / 0.4) }}>
            <span style={{ fontFamily: SANS, fontSize: 16, color: VISTA.ink, fontWeight: 500, whiteSpace: "nowrap" }}>{row.label}</span>
            <span style={{ fontFamily: SANS, fontSize: 17, fontWeight: 700, color: VISTA.orange, fontVariantNumeric: "tabular-nums" }}>{row.cost} ◆</span>
          </div>
        ))}
        <div style={{ marginTop: 8, paddingTop: 10, borderTop: `1px solid ${VISTA.border}`, fontFamily: MONO, fontSize: 11, color: VISTA.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>1 ◆ = 40 ֏ · լիցքավորեք ցանկացած պահին</div>
      </div>

      <div style={{ position: "absolute", left: 80, right: 80, bottom: 60, background: "#fff", borderRadius: 18, border: `1px solid ${VISTA.border}`, padding: "28px 36px", opacity: referralIn, transform: `translateY(${(1 - referralIn) * 24}px)`, boxShadow: "0 20px 40px -20px rgba(60,40,20,0.2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 40 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: VISTA.muted }}>հրավեր</div>
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 400, fontSize: 38, color: VISTA.ink, letterSpacing: "-0.02em", marginTop: 6, lineHeight: 1 }}>
            Հրավիրեք ընկերոջը, <span style={{ color: VISTA.orange }}>շահում եք դուք։</span>
          </div>
          <div style={{ fontFamily: SANS, fontSize: 15, color: VISTA.inkSoft, marginTop: 10 }}>
            Նա ստանում է <b style={{ color: VISTA.ink }}>+20 ◆</b> · Դուք՝ <b style={{ color: VISTA.ink }}>+20 ◆</b> յուրաքանչյուր ընկերոջ համար
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
          {[{ c: "#d96a21", label: "Ա" }, { c: "#3a6b9c", label: "Մ" }, { c: "#5b8a4a", label: "Լ" }, { c: "#8a4a7a", label: "Ս" }, { c: "#b58a3a", label: "Կ" }].map((p, i) => {
            const av = clamp01((friendT * 5) - i);
            return (
              <div key={i} style={{ width: 56, height: 56, borderRadius: 28, marginLeft: i === 0 ? 0 : -14, background: p.c, border: "3px solid #fff", color: "#fff", fontFamily: SANS, fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", opacity: av, transform: `scale(${0.6 + 0.4 * av})`, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 10 - i }}>
                {p.label}
              </div>
            );
          })}
          <div style={{ marginLeft: 22, fontFamily: SANS, fontSize: 28, fontWeight: 700, color: VISTA.orange, fontVariantNumeric: "tabular-nums", opacity: clamp01((friendT - 0.5) / 0.5), whiteSpace: "nowrap" }}>+100 ◆</div>
        </div>
      </div>
    </div>
  );
}

// ─── Scene 9: Endcard ─────────────────────────────────────────────────────────

function SceneEndcard() {
  const { localTime } = useSprite();
  const fadeIn = clamp01(localTime / 0.8);
  const lineW  = Easing.easeOutCubic(clamp01((localTime - 0.3) / 1.0));
  const ctaIn  = clamp01((localTime - 1.2) / 0.6);

  return (
    <div style={{ position: "absolute", inset: 0, background: VISTA.cream, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", opacity: fadeIn, transform: `translateY(${(1 - fadeIn) * 16}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 13, letterSpacing: "0.32em", textTransform: "uppercase", color: VISTA.muted, marginBottom: 28 }}>vista · by tunzone</div>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 300, fontSize: 140, color: VISTA.ink, letterSpacing: "-0.035em", lineHeight: 1.15, whiteSpace: "nowrap" }}>Ձեր սենյակը,</div>
        <div style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 300, fontSize: 140, color: VISTA.orange, letterSpacing: "-0.035em", lineHeight: 1.15, whiteSpace: "nowrap" }}>նորովի։</div>
        <div style={{ margin: "48px auto 0", height: 1, width: `${lineW * 480}px`, background: VISTA.ink, opacity: 0.4 }} />
        <div style={{ marginTop: 40, display: "inline-flex", alignItems: "center", gap: 16, padding: "20px 36px", borderRadius: 14, background: VISTA.ink, color: VISTA.cream, fontFamily: SANS, fontSize: 22, fontWeight: 500, letterSpacing: "-0.005em", opacity: ctaIn, transform: `translateY(${(1 - ctaIn) * 12}px)` }}>
          <SparkleIcon size={20} color={VISTA.cream} />
          vista.tunzone.com
        </div>
      </div>
    </div>
  );
}

// ─── Timeline label ───────────────────────────────────────────────────────────

function TimeLabel() {
  const t = useTime();
  React.useEffect(() => {
    const sec = Math.floor(t);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    document.body.setAttribute("data-screen-label", `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} vista video`);
  }, [Math.floor(t)]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const DURATION = 32.5;

const T = {
  title:     [0,    3.0],
  modes:     [3.0,  6.5],
  upload:    [6.5,  10.0],
  analyze:   [10.0, 13.5],
  reveal:    [13.5, 17.5],
  shoppable: [17.5, 21.0],
  multiroom: [21.0, 24.0],
  tokens:    [24.0, 29.0],
  endcard:   [29.0, 32.5],
};

export default function VistaVideoPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300..600;1,300..600&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Noto+Serif+Armenian:wght@300;400;500;600;700&family=Noto+Sans+Armenian:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ position: "fixed", inset: 0 }}>
        <Stage width={1920} height={1080} duration={DURATION} background="#f2eee7" persistKey="vista-vid-v2">
          <TimeLabel />
          <Sprite start={T.title[0]}     end={T.title[1]}>     <SceneTitle />    </Sprite>
          <Sprite start={T.modes[0]}     end={T.modes[1]}>     <SceneModes />    </Sprite>
          <Sprite start={T.upload[0]}    end={T.upload[1]}>    <SceneUpload />   </Sprite>
          <Sprite start={T.analyze[0]}   end={T.analyze[1]}>   <SceneAnalyze />  </Sprite>
          <Sprite start={T.reveal[0]}    end={T.reveal[1]}>    <SceneReveal />   </Sprite>
          <Sprite start={T.shoppable[0]} end={T.shoppable[1]}> <SceneShoppable /></Sprite>
          <Sprite start={T.multiroom[0]} end={T.multiroom[1]}> <SceneMultiRoom /></Sprite>
          <Sprite start={T.tokens[0]}    end={T.tokens[1]}>    <SceneTokens />   </Sprite>
          <Sprite start={T.endcard[0]}   end={T.endcard[1]}>   <SceneEndcard />  </Sprite>
        </Stage>
      </div>
    </>
  );
}
