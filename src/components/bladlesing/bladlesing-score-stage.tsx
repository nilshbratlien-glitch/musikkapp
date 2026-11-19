import { useRef, useState } from "react";
import { BladlesingDuetBar } from "@/components/bladlesing/bladlesing-duet-bar";
import type { BladlesingSettings, DuetViewPart } from "@/lib/bladlesing-config";

export function BladlesingScoreStage({
  scoreHostRef,
  ready,
  error,
  settings,
  practiceLine,
  yielded,
  yieldColor,
  countInBeat,
  beatsPerBar,
  autoNextLeft,
  duetPaired,
  onZoomChange,
  onSwipeNext,
  onSwipeAgain,
  onCancelAutoNext,
  onSetDuetViewPart,
  onToggleDuetPaired,
  onUpdateSettings,
}: {
  scoreHostRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  error: string | null;
  settings: BladlesingSettings;
  practiceLine: string;
  yielded: boolean;
  yieldColor: string | null;
  countInBeat: number | null;
  beatsPerBar: number;
  autoNextLeft: number | null;
  duetPaired: boolean;
  onZoomChange: (zoom: number) => void;
  onSwipeNext: () => void;
  onSwipeAgain: () => void;
  onCancelAutoNext: () => void;
  onSetDuetViewPart: (part: DuetViewPart) => void;
  onToggleDuetPaired: () => void;
  onUpdateSettings: (patch: Partial<BladlesingSettings>, opts?: { regenerate?: boolean }) => void;
}) {
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const swipeStartRef = useRef<{ id: number; x: number; y: number; time: number } | null>(null);
  const [gestureHint, setGestureHint] = useState<string | null>(null);

  function flashHint(text: string) {
    setGestureHint(text);
    window.setTimeout(() => {
      setGestureHint((cur) => (cur === text ? null : cur));
    }, 900);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      pinchStartRef.current = { dist: Math.max(10, dist), zoom: settings.zoom };
      swipeStartRef.current = null;
    } else if (pointersRef.current.size === 1 && e.pointerType === "touch") {
      swipeStartRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, time: Date.now() };
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      const scale = dist / pinchStartRef.current.dist;
      const nextZoom = Math.round(pinchStartRef.current.zoom * scale * 20) / 20;
      onZoomChange(nextZoom);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }
    const swipe = swipeStartRef.current;
    if (swipe && swipe.id === e.pointerId) {
      swipeStartRef.current = null;
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      const dt = Date.now() - swipe.time;
      if (dt < 550 && Math.abs(dx) > 76 && Math.abs(dy) < 42) {
        if (dx < 0) {
          flashHint("Ny etyde");
          onSwipeNext();
        } else {
          flashHint("Igjen (saktere)");
          onSwipeAgain();
        }
      }
    }
  }

  return (
    <div className="stage relative min-h-0 flex-1 overflow-y-auto bg-bg px-3 pt-6 pb-3 md:px-5 md:pb-4">
      {/* Reserved 24px top slot so showing the yield status never shifts the score down */}
      <p
        id="pulseNote"
        role="status"
        hidden={!yielded}
        style={yieldColor ? ({ "--block": yieldColor } as React.CSSProperties) : undefined}
        className="pointer-events-none absolute top-0.5 right-3 left-3 m-0 overflow-hidden text-center text-[13px] leading-[18px] font-semibold text-ellipsis whitespace-nowrap text-[var(--block,var(--color-accent))]"
      >
        Øveplan styrer metronomen
      </p>

      <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p
            id="practiceLine"
            className="min-w-0 truncate text-xs font-medium text-muted md:text-[13px]"
          >
            {practiceLine}
          </p>
          {countInBeat != null ? (
            <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-fg tabular-nums">
              Opptelling {countInBeat}/{beatsPerBar}
            </span>
          ) : autoNextLeft != null ? (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent tabular-nums">
              <span>Neste etyde om {autoNextLeft}s</span>
              <button
                type="button"
                onClick={onCancelAutoNext}
                className="underline decoration-accent/60 underline-offset-2 hover:text-fg"
              >
                Avbryt
              </button>
            </span>
          ) : gestureHint ? (
            <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-semibold text-fg">
              {gestureHint}
            </span>
          ) : null}
        </div>

        <BladlesingDuetBar
          settings={settings}
          duetPaired={duetPaired}
          onSetViewPart={onSetDuetViewPart}
          onTogglePaired={onToggleDuetPaired}
          onUpdateSettings={onUpdateSettings}
        />

        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: "pan-y" }}
          className="bladlesing-paper relative min-h-[260px] flex-1 rounded-card border border-line bg-[var(--color-paper)] p-2 pb-6 text-[#1a1a1a] shadow-[var(--shadow-paper)] md:px-5 md:pt-4 md:pb-8"
        >
          {error ? (
            <p className="p-6 text-sm font-medium text-no">Kunne ikke laste bladlesing: {error}</p>
          ) : !ready ? (
            <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted">
              Laster noteark …
            </div>
          ) : null}
          <div id="score" ref={scoreHostRef} className="w-full" />
        </div>
      </div>
    </div>
  );
}
