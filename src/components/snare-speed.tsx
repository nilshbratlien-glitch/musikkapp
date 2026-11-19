import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  RUDIMENTS,
  commitBest,
  onClick,
  recordBest,
  type ClickState,
  type MetronomeSettings,
  type RudimentId,
} from "@/lib/metronome";
import { getState, setBpm as pulseBpm, start as pulseStart, stop as pulseStop, subscribe } from "@/lib/pulse";
import { readToolStore, writeToolStore } from "@/lib/tools";

const RUDIMENT_LABELS: { id: RudimentId; label: string }[] = [
  { id: "singles", label: "Singles (RLRL)" },
  { id: "doubles", label: "Doubles (RRLL)" },
  { id: "paradiddle", label: "Paradiddle (RLRR LRLL)" },
  { id: "flam", label: "Flam (lR rL)" },
  { id: "accentSingles", label: "Accented Singles" },
];

function loadBests() {
  const raw = readToolStore("metronom").bests;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const bests: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") bests[key] = value;
  }
  return bests;
}

export function SnareSpeed() {
  const [displayBpm, setDisplayBpm] = useState(120);
  const [status, setStatus] = useState("Klar");
  const playing = useSyncExternalStore(subscribe, getState, getState).owner === "snare";
  const [active, setActive] = useState(-1);
  const [pattern, setPattern] = useState<readonly string[]>([]);
  const [rudiment, setRudiment] = useState<RudimentId>("singles");
  const [startBpm, setStartBpm] = useState(100);
  const [inc, setInc] = useState(2);
  const [bars, setBars] = useState(4);
  const [sub, setSub] = useState(8);
  const [bests, setBests] = useState<Record<string, number>>({});

  const settingsRef = useRef<MetronomeSettings>({
    start: 100,
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

  settingsRef.current = { start: startBpm, inc, bars, sub, rudiment };

  useEffect(() => {
    setBests(loadBests());
    return () => {
      pulseStop("snare");
    };
  }, []);

  /** Called by the pulse core for every scheduled click; steps the BPM after the set number of bars. */
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
    if (step.stepped) {
      pulseBpm(step.state.bpm);
      setDisplayBpm(step.state.bpm);
      setStatus(`Økt til ${step.state.bpm}`);
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
    setStatus("Spiller…");
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

  function markClean() {
    const bpm = stateRef.current.bpmLive;
    const next = recordBest(bests, rudiment, bpm);
    if (!next.updated) return;
    const store = readToolStore("metronom");
    const saved = writeToolStore("metronom", { ...store, bests: next.bests });
    const outcome = commitBest(next.updated, saved);
    if (outcome === "failed") {
      setStatus("Kunne ikke lagre");
      return;
    }
    if (outcome !== "saved") return;
    setBests(next.bests);
    setStatus(`Ny best: ${bpm}`);
  }

  function markBroke() {
    setStatus("Merket brutt");
  }

  const best = bests[rudiment];
  const shownPattern = playing && pattern.length > 0 ? pattern : RUDIMENTS[rudiment];

  return (
    <section className="metro pb-4 md:grid md:grid-cols-[1.05fr_0.95fr] md:items-stretch md:gap-5 lg:gap-6">
      <div className="space-y-4 md:flex md:flex-col md:justify-between md:space-y-5">
        <div className="metro-hero rounded-card px-4 py-7 md:px-6 md:py-12">
          <p className="text-center text-8xl leading-none font-bold tracking-tight tabular-nums md:text-[9rem] lg:text-[10.5rem]">
            {displayBpm}
          </p>
          <p className="mt-3 min-h-5 text-center text-sm text-muted md:mt-4 md:text-base">{status}</p>
        </div>
        <div className="flex min-h-12 flex-wrap items-center justify-center gap-2 md:min-h-16 md:gap-3">
          {shownPattern.map((stick, index) => (
            <span
              key={`${stick}-${index}`}
              className={
                playing && index === active
                  ? "metro-badge is-active flex min-h-12 min-w-12 items-center justify-center rounded-xl bg-accent px-3 py-2 text-center text-2xl font-bold text-accent-fg md:min-h-16 md:min-w-16 md:text-3xl"
                  : "metro-badge flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-line bg-surface px-3 py-2 text-center text-2xl font-semibold md:min-h-16 md:min-w-16 md:text-3xl"
              }
            >
              {stick}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:gap-3">
          <button
            type="button"
            onClick={start}
            disabled={playing}
            className="metro-press min-h-14 rounded-xl bg-accent text-base font-semibold text-accent-fg disabled:border disabled:border-line disabled:bg-surface/60 disabled:text-muted md:min-h-16 md:text-lg"
          >
            Start
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={!playing}
            className="metro-press min-h-14 rounded-xl border border-line bg-surface text-base font-semibold text-fg disabled:bg-surface/60 disabled:text-muted md:min-h-16 md:text-lg"
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
              className="metro-field min-h-11 max-w-[62%] rounded-md border border-line bg-header px-2.5 text-fg md:min-h-12"
            >
              {RUDIMENT_LABELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 rounded-xl border border-line/70 bg-header/40 p-3 text-sm">
              <span className="text-xs font-medium text-muted">Start-BPM</span>
              <span className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Reduser Start-BPM"
                  onClick={() => setStartBpm((v) => Math.max(40, v - 5))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-header text-base font-semibold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={40}
                  max={300}
                  value={startBpm}
                  onChange={(event) => setStartBpm(Number(event.target.value))}
                  className="metro-field min-h-11 w-20 rounded-md border border-line bg-header px-2 text-center font-semibold text-fg tabular-nums"
                />
                <button
                  type="button"
                  aria-label="Øk Start-BPM"
                  onClick={() => setStartBpm((v) => Math.min(300, v + 5))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-header text-base font-semibold"
                >
                  +
                </button>
              </span>
            </label>

            <label className="flex flex-col gap-1.5 rounded-xl border border-line/70 bg-header/40 p-3 text-sm">
              <span className="text-xs font-medium text-muted">Økning</span>
              <span className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Reduser økning"
                  onClick={() => setInc((v) => Math.max(1, v - 1))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-header text-base font-semibold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={inc}
                  onChange={(event) => setInc(Number(event.target.value))}
                  className="metro-field min-h-11 w-20 rounded-md border border-line bg-header px-2 text-center font-semibold text-fg tabular-nums"
                />
                <button
                  type="button"
                  aria-label="Øk økning"
                  onClick={() => setInc((v) => Math.min(10, v + 1))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-header text-base font-semibold"
                >
                  +
                </button>
              </span>
            </label>

            <label className="flex flex-col gap-1.5 rounded-xl border border-line/70 bg-header/40 p-3 text-sm">
              <span className="text-xs font-medium text-muted">Takter per steg</span>
              <span className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  aria-label="Færre takter per steg"
                  onClick={() => setBars((v) => Math.max(1, v - 1))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-header text-base font-semibold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={bars}
                  onChange={(event) => setBars(Number(event.target.value))}
                  className="metro-field min-h-11 w-20 rounded-md border border-line bg-header px-2 text-center font-semibold text-fg tabular-nums"
                />
                <button
                  type="button"
                  aria-label="Flere takter per steg"
                  onClick={() => setBars((v) => Math.min(32, v + 1))}
                  className="metro-press flex size-11 items-center justify-center rounded-md border border-line bg-header text-base font-semibold"
                >
                  +
                </button>
              </span>
            </label>

            <label className="flex flex-col gap-1.5 rounded-xl border border-line/70 bg-header/40 p-3 text-sm">
              <span className="text-xs font-medium text-muted">Underdeling</span>
              <select
                value={sub}
                onChange={(event) => setSub(Number(event.target.value))}
                className="metro-field min-h-11 w-full rounded-md border border-line bg-header px-2.5 text-fg"
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
            <button type="button" onClick={markClean} className="metro-press min-h-12 rounded-lg border border-line bg-header font-medium md:min-h-14">
              Merk ren
            </button>
            <button type="button" onClick={markBroke} className="metro-press min-h-12 rounded-lg border border-line bg-header font-medium md:min-h-14">
              Merk brutt
            </button>
          </div>
          <p className="text-center text-sm text-muted">
            {best ? `Beste (${rudiment}): ${best} BPM` : "Beste: —"}
          </p>
        </div>
      </div>
    </section>
  );
}
