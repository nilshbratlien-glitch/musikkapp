import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_CLICK_SOUND,
  DEFAULT_CLICK_VOLUME,
  RUDIMENTS,
  clampClickVolume,
  commitBest,
  isClickSound,
  onClick,
  recordBest,
  stepBackOnBreak,
  type ClickState,
  type MetronomeSettings,
  type RudimentId,
} from "@/lib/metronome";
import {
  getState,
  setBpm as pulseBpm,
  setClickSound as pulseClickSound,
  setClickVolume as pulseClickVolume,
  start as pulseStart,
  stop as pulseStop,
  subscribe,
} from "@/lib/pulse";
import { readToolStore, writeToolStore } from "@/lib/tools";

const RUDIMENT_LABELS: { id: RudimentId; label: string }[] = [
  { id: "singles", label: "Singles (RLRL)" },
  { id: "doubles", label: "Doubles (RRLL)" },
  { id: "paradiddle", label: "Paradiddle (RLRR LRLL)" },
  { id: "paradiddleDiddle", label: "Paradiddle-diddle (RLRRLL)" },
  { id: "flam", label: "Flam (lR rL)" },
  { id: "accentSingles", label: "Accented Singles (R> l r l)" },
  { id: "tripleStroke", label: "Trippelslag (RRR LLL)" },
  { id: "sixStrokeRoll", label: "Six-stroke roll (R> ll rr L>)" },
];

function isRudimentId(value: unknown): value is RudimentId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RUDIMENTS, value);
}

function loadBests() {
  const raw = readToolStore("metronom").bests;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const bests: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") bests[key] = value;
  }
  return bests;
}

function loadRudimentPrefs() {
  const raw = readToolStore("metronom").snare;
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rudiment: RudimentId = isRudimentId(obj.rudiment) ? obj.rudiment : "singles";
  const startBpm = typeof obj.startBpm === "number" && obj.startBpm >= 40 && obj.startBpm <= 300 ? obj.startBpm : 100;
  const maxBpm = typeof obj.maxBpm === "number" && obj.maxBpm >= startBpm && obj.maxBpm <= 300 ? obj.maxBpm : Math.max(160, startBpm);
  const inc = typeof obj.inc === "number" && obj.inc >= 1 && obj.inc <= 10 ? obj.inc : 2;
  const bars = typeof obj.bars === "number" && obj.bars >= 1 && obj.bars <= 32 ? obj.bars : 4;
  const sub = obj.sub === 4 || obj.sub === 8 || obj.sub === 16 ? obj.sub : 8;
  return { rudiment, startBpm, maxBpm, inc, bars, sub };
}

export function SnareSpeed() {
  const [displayBpm, setDisplayBpm] = useState(100);
  const [barProgress, setBarProgress] = useState(0);
  const [status, setStatus] = useState("Klar");
  const playing = useSyncExternalStore(subscribe, getState, getState).owner === "snare";
  const [active, setActive] = useState(-1);
  const [pattern, setPattern] = useState<readonly string[]>([]);
  const [rudiment, setRudiment] = useState<RudimentId>("singles");
  const [startBpm, setStartBpm] = useState(100);
  const [maxBpm, setMaxBpm] = useState(160);
  const [inc, setInc] = useState(2);
  const [bars, setBars] = useState(4);
  const [sub, setSub] = useState(8);
  const [bests, setBests] = useState<Record<string, number>>({});
  const hydratedRef = useRef(false);

  const settingsRef = useRef<MetronomeSettings>({
    start: 100,
    maxBpm: 160,
    inc: 2,
    bars: 4,
    sub: 8,
    rudiment: "singles",
  });
  const stateRef = useRef<ClickState & { bpmLive: number }>({
    bpm: 100,
    beat: 0,
    barCount: 0,
    bpmLive: 100,
  });

  settingsRef.current = { start: startBpm, maxBpm, inc, bars, sub, rudiment };

  useEffect(() => {
    const prefs = loadRudimentPrefs();
    setRudiment(prefs.rudiment);
    setStartBpm(prefs.startBpm);
    setMaxBpm(prefs.maxBpm);
    setDisplayBpm(prefs.startBpm);
    setInc(prefs.inc);
    setBars(prefs.bars);
    setSub(prefs.sub);
    setBests(loadBests());

    // Apply persisted click sound & volume from metronom store
    const store = readToolStore("metronom");
    pulseClickSound(isClickSound(store.sound) ? store.sound : DEFAULT_CLICK_SOUND);
    pulseClickVolume(typeof store.volume === "number" ? clampClickVolume(store.volume) : DEFAULT_CLICK_VOLUME);
    hydratedRef.current = true;

    return () => {
      pulseStop("snare");
    };
  }, []);

  // Persist Rudiment settings automatically whenever changed
  useEffect(() => {
    if (!hydratedRef.current) return;
    const store = readToolStore("metronom");
    writeToolStore("metronom", {
      ...store,
      snare: { rudiment, startBpm, maxBpm, inc, bars, sub },
    });
  }, [rudiment, startBpm, maxBpm, inc, bars, sub]);

  // Screen Wake Lock with visibilitychange re-acquire while SnareSpeed is playing
  useEffect(() => {
    if (!playing) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let disposed = false;
    let sentinel: { release: () => Promise<void> } | null = null;

    const acquire = () => {
      if (disposed || document.visibilityState !== "visible") return;
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      };
      if (!nav.wakeLock) return;
      void nav.wakeLock
        .request("screen")
        .then((lock) => {
          if (disposed) void lock.release().catch(() => {});
          else sentinel = lock;
        })
        .catch(() => {});
    };

    acquire();
    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVis);
      if (sentinel) {
        void sentinel.release().catch(() => {});
        sentinel = null;
      }
    };
  }, [playing]);

  /** Called by the pulse core for every scheduled click; steps the BPM after the set number of bars up to maxBpm. */
  function onPulseClick() {
    const settings = settingsRef.current;
    const live = stateRef.current;
    const sticks = RUDIMENTS[settings.rudiment];
    const step = onClick(live, settings);
    setPattern(sticks);
    setActive(live.beat % sticks.length);
    live.beat = step.state.beat;
    live.barCount = step.state.barCount;
    live.bpm = step.state.bpm;
    live.bpmLive = step.state.bpm;
    setBarProgress(step.state.barCount);
    if (step.stepped) {
      pulseBpm(step.state.bpm);
      setDisplayBpm(step.state.bpm);
      setStatus(step.reachedMax ? `Mål nådd (${step.state.bpm} BPM)` : `Økt til ${step.state.bpm}`);
    } else if (step.reachedMax) {
      setStatus(`Holder måltempo (${step.state.bpm} BPM)`);
    }
  }

  function start() {
    if (playing) return;
    const settings = settingsRef.current;
    const live = stateRef.current;
    live.bpm = settings.start;
    live.bpmLive = settings.start;
    live.beat = 0;
    live.barCount = 0;
    setDisplayBpm(settings.start);
    setBarProgress(0);
    setStatus(`Spiller mot ${settings.maxBpm ?? settings.start} BPM…`);
    setPattern(RUDIMENTS[settings.rudiment]);
    setActive(0);
    pulseStart({
      owner: "snare",
      bpm: settings.start,
      beats: 4,
      sub: Math.max(1, settings.sub / 4),
      onClick: onPulseClick,
      onStop: () => setStatus("Stoppet"),
    });
  }

  function stop() {
    pulseStop("snare");
  }

  // Space keyboard shortcut to Start/Stopp Rudiment trainer
  const controlsRef = useRef({ start, stop, playing });
  controlsRef.current = { start, stop, playing };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
        e.preventDefault();
        if (controlsRef.current.playing) controlsRef.current.stop();
        else controlsRef.current.start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function markClean() {
    const bpm = stateRef.current.bpmLive;
    const next = recordBest(bests, rudiment, bpm);
    if (!next.updated) {
      setStatus(`Allerede beste (${bests[rudiment]} BPM)`);
      return;
    }
    const store = readToolStore("metronom");
    const saved = writeToolStore("metronom", { ...store, bests: next.bests });
    const outcome = commitBest(next.updated, saved);
    if (outcome === "failed") {
      setStatus("Kunne ikke lagre");
      return;
    }
    if (outcome !== "saved") return;
    setBests(next.bests);
    setStatus(`Ny best: ${bpm} BPM`);
  }

  function markBroke() {
    const prevBpm = stateRef.current.bpmLive;
    const dropped = stepBackOnBreak(prevBpm, settingsRef.current.inc, settingsRef.current.start);
    stateRef.current.bpm = dropped;
    stateRef.current.bpmLive = dropped;
    stateRef.current.barCount = 0;
    setBarProgress(0);
    setDisplayBpm(dropped);
    if (playing) {
      pulseBpm(dropped);
    }
    setStatus(
      dropped < prevBpm
        ? `Brutt ved ${prevBpm} → tilbake til ${dropped} BPM`
        : `Brutt ved ${prevBpm} BPM (holder starttempo)`,
    );
  }

  function updateStartBpm(next: number) {
    const clamped = Math.max(40, Math.min(300, Number.isFinite(next) ? Math.round(next) : 100));
    setStartBpm(clamped);
    if (!playing) setDisplayBpm(clamped);
    if (clamped > maxBpm) setMaxBpm(clamped);
  }

  function updateMaxBpm(next: number) {
    const clamped = Math.max(startBpm, Math.min(300, Number.isFinite(next) ? Math.round(next) : 160));
    setMaxBpm(clamped);
  }

  const best = bests[rudiment];
  const activeRudimentLabel = RUDIMENT_LABELS.find((r) => r.id === rudiment)?.label ?? rudiment;
  const shownPattern = playing && pattern.length > 0 ? pattern : RUDIMENTS[rudiment];
  const goalSpan = Math.max(1, maxBpm - startBpm);
  const goalProgressPct = Math.min(100, Math.max(0, Math.round(((displayBpm - startBpm) / goalSpan) * 100)));

  return (
    <section className="metro pb-4 md:grid md:grid-cols-[1.05fr_0.95fr] md:items-stretch md:gap-5 lg:gap-6">
      <div className="space-y-4 md:flex md:flex-col md:justify-between md:space-y-5">
        <div className="metro-hero rounded-card px-4 py-7 md:px-6 md:py-10">
          <p className="text-center text-8xl leading-none font-bold tracking-tight tabular-nums md:text-[9rem] lg:text-[10.5rem]">
            {displayBpm}
          </p>
          <p className="mt-3 min-h-5 text-center text-sm text-muted md:mt-4 md:text-base">{status}</p>
          <div className="mx-auto mt-4 max-w-xs space-y-1">
            <div className="flex justify-between text-[11px] font-medium text-muted tabular-nums">
              <span>{playing ? `Takt ${Math.min(bars, barProgress + 1)} / ${bars}` : `Start ${startBpm}`}</span>
              <span>Mål {maxBpm} BPM</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-header">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${goalProgressPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex min-h-12 flex-wrap items-center justify-center gap-2 md:min-h-16 md:gap-3">
          {shownPattern.map((stick, index) => {
            const isAccentedStick = stick.includes(">");
            const isCurrent = playing && index === active;
            return (
              <span
                key={`${stick}-${index}`}
                style={
                  !isCurrent && isAccentedStick
                    ? {
                        borderColor: "rgb(var(--color-accent-rgb) / 0.55)",
                        backgroundColor: "rgb(var(--color-accent-rgb) / 0.1)",
                      }
                    : undefined
                }
                className={
                  isCurrent
                    ? "metro-badge is-active flex min-h-12 min-w-12 items-center justify-center rounded-xl bg-accent px-3 py-2 text-center text-2xl font-bold text-accent-fg md:min-h-16 md:min-w-16 md:text-3xl"
                    : isAccentedStick
                      ? "metro-badge flex min-h-12 min-w-12 items-center justify-center rounded-xl border-2 px-3 py-2 text-center text-2xl font-bold text-accent md:min-h-16 md:min-w-16 md:text-3xl"
                      : "metro-badge flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-line bg-surface px-3 py-2 text-center text-2xl font-semibold md:min-h-16 md:min-w-16 md:text-3xl"
                }
              >
                {stick}
              </span>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2.5 md:gap-3">
          <button
            type="button"
            onClick={start}
            disabled={playing}
            className="metro-press min-h-14 rounded-xl bg-accent text-base font-semibold text-accent-fg disabled:border disabled:border-line disabled:bg-header disabled:text-muted md:min-h-16 md:text-lg"
          >
            Start
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={!playing}
            className="metro-press min-h-14 rounded-xl border border-line bg-surface text-base font-semibold text-fg disabled:bg-header disabled:text-muted md:min-h-16 md:text-lg"
          >
            Stopp
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-4 md:mt-0">
        <div className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-card)] md:p-5">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-muted">Rudiment</span>
            <select
              value={rudiment}
              onChange={(event) => setRudiment(event.target.value as RudimentId)}
              className="metro-field min-h-11 max-w-[65%] rounded-md border border-line bg-header px-2.5 text-fg md:min-h-12"
            >
              {RUDIMENT_LABELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 rounded-xl border border-line bg-header p-3 text-sm">
              <span className="text-xs font-medium text-muted">Start-BPM</span>
              <span className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Reduser Start-BPM"
                  onClick={() => updateStartBpm(startBpm - 5)}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-surface text-base font-semibold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={40}
                  max={300}
                  value={startBpm}
                  onChange={(event) => updateStartBpm(Number(event.target.value))}
                  className="metro-field min-h-11 w-20 rounded-md border border-line bg-surface px-2 text-center font-semibold text-fg tabular-nums"
                />
                <button
                  type="button"
                  aria-label="Øk Start-BPM"
                  onClick={() => updateStartBpm(startBpm + 5)}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-surface text-base font-semibold"
                >
                  +
                </button>
              </span>
            </label>

            <label className="flex flex-col gap-1.5 rounded-xl border border-line bg-header p-3 text-sm">
              <span className="text-xs font-medium text-muted">Mål-BPM</span>
              <span className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Reduser Mål-BPM"
                  onClick={() => updateMaxBpm(maxBpm - 5)}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-surface text-base font-semibold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={startBpm}
                  max={300}
                  value={maxBpm}
                  onChange={(event) => updateMaxBpm(Number(event.target.value))}
                  className="metro-field min-h-11 w-20 rounded-md border border-line bg-surface px-2 text-center font-semibold text-fg tabular-nums"
                />
                <button
                  type="button"
                  aria-label="Øk Mål-BPM"
                  onClick={() => updateMaxBpm(maxBpm + 5)}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-surface text-base font-semibold"
                >
                  +
                </button>
              </span>
            </label>

            <label className="flex flex-col gap-1.5 rounded-xl border border-line bg-header p-3 text-sm">
              <span className="text-xs font-medium text-muted">Økning</span>
              <span className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Reduser økning"
                  onClick={() => setInc((v) => Math.max(1, v - 1))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-surface text-base font-semibold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={inc}
                  onChange={(event) => setInc(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}
                  className="metro-field min-h-11 w-20 rounded-md border border-line bg-surface px-2 text-center font-semibold text-fg tabular-nums"
                />
                <button
                  type="button"
                  aria-label="Øk økning"
                  onClick={() => setInc((v) => Math.min(10, v + 1))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-surface text-base font-semibold"
                >
                  +
                </button>
              </span>
            </label>

            <label className="flex flex-col gap-1.5 rounded-xl border border-line bg-header p-3 text-sm">
              <span className="text-xs font-medium text-muted">Takter per steg</span>
              <span className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Færre takter per steg"
                  onClick={() => setBars((v) => Math.max(1, v - 1))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-surface text-base font-semibold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={bars}
                  onChange={(event) => setBars(Math.max(1, Math.min(32, Number(event.target.value) || 1)))}
                  className="metro-field min-h-11 w-20 rounded-md border border-line bg-surface px-2 text-center font-semibold text-fg tabular-nums"
                />
                <button
                  type="button"
                  aria-label="Flere takter per steg"
                  onClick={() => setBars((v) => Math.min(32, v + 1))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-surface text-base font-semibold"
                >
                  +
                </button>
              </span>
            </label>

            <label className="flex flex-col gap-1.5 rounded-xl border border-line bg-header p-3 text-sm sm:col-span-2">
              <span className="text-xs font-medium text-muted">Underdeling</span>
              <select
                value={sub}
                onChange={(event) => setSub(Number(event.target.value))}
                className="metro-field min-h-11 w-full rounded-md border border-line bg-surface px-2.5 text-fg"
              >
                <option value={4}>Fjerdedel</option>
                <option value={8}>Åttendel</option>
                <option value={16}>Sekstendel</option>
              </select>
            </label>
          </div>
        </div>

        <div className="grid gap-3 rounded-card border border-line bg-surface p-4 md:p-5">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={markClean}
              style={{
                borderColor: "rgb(var(--color-ok-rgb) / 0.45)",
                backgroundColor: "rgb(var(--color-ok-rgb) / 0.12)",
              }}
              className="metro-press min-h-12 rounded-lg border font-semibold text-ok md:min-h-14"
            >
              Merk ren
            </button>
            <button
              type="button"
              onClick={markBroke}
              style={{
                borderColor: "rgb(var(--color-no-rgb) / 0.45)",
                backgroundColor: "rgb(var(--color-no-rgb) / 0.1)",
              }}
              className="metro-press min-h-12 rounded-lg border font-semibold text-no md:min-h-14"
            >
              Merk brutt
            </button>
          </div>
          <p className="text-center text-sm text-muted tabular-nums">
            {best ? `Beste (${activeRudimentLabel}): ${best} BPM` : "Beste: —"}
          </p>
        </div>
      </div>
    </section>
  );
}
