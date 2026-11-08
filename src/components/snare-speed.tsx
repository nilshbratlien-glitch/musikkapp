import { useEffect, useRef, useState } from "react";
import {
  RUDIMENTS,
  commitBest,
  onClick,
  recordBest,
  secondsPerNote,
  type ClickState,
  type MetronomeSettings,
  type RudimentId,
} from "@/lib/metronome";
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

function scheduleClick(audio: AudioContext, time: number, isAccent: boolean) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.frequency.value = isAccent ? 1200 : 800;
  gain.gain.setValueAtTime(isAccent ? 0.35 : 0.2, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
  osc.start(time);
  osc.stop(time + 0.05);
}

export function SnareSpeed() {
  const [displayBpm, setDisplayBpm] = useState(120);
  const [status, setStatus] = useState("Klar");
  const [playing, setPlaying] = useState(false);
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
  const stateRef = useRef<ClickState & { next: number; timer: number | null; bpmLive: number }>({
    bpm: 100,
    beat: 0,
    barCount: 0,
    next: 0,
    timer: null,
    bpmLive: 100,
  });
  const audioRef = useRef<AudioContext | null>(null);
  const playingRef = useRef(false);

  settingsRef.current = { start: startBpm, inc, bars, sub, rudiment };

  useEffect(() => {
    setBests(loadBests());
    return () => {
      playingRef.current = false;
      const timer = stateRef.current.timer;
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  function scheduler() {
    const audio = audioRef.current;
    if (!audio || !playingRef.current) return;
    const settings = settingsRef.current;
    const live = stateRef.current;
    const seconds = secondsPerNote(live.bpm, settings.sub);
    const sticks = RUDIMENTS[settings.rudiment];
    while (live.next < audio.currentTime + 0.1) {
      const step = onClick(live, settings);
      scheduleClick(audio, live.next, step.accent);
      setPattern(sticks);
      setActive(live.beat % sticks.length);
      live.beat = step.state.beat;
      live.barCount = step.state.barCount;
      live.bpm = step.state.bpm;
      live.bpmLive = step.state.bpm;
      live.next += seconds;
      if (step.stepped) {
        setDisplayBpm(step.state.bpm);
        setStatus(`Økt til ${step.state.bpm}`);
      }
    }
    live.timer = window.setTimeout(scheduler, 25);
  }

  function start() {
    if (playingRef.current) return;
    const settings = settingsRef.current;
    const live = stateRef.current;
    live.bpm = settings.start;
    live.bpmLive = settings.start;
    live.beat = 0;
    live.barCount = 0;
    setDisplayBpm(settings.start);
    setStatus("Spiller…");
    if (!audioRef.current) audioRef.current = new AudioContext();
    const audio = audioRef.current;
    if (audio.state === "suspended") void audio.resume();
    live.next = audio.currentTime + 0.05;
    playingRef.current = true;
    setPlaying(true);
    setPattern(RUDIMENTS[settings.rudiment]);
    setActive(0);
    scheduler();
  }

  function stop() {
    if (!playingRef.current) return;
    playingRef.current = false;
    const timer = stateRef.current.timer;
    if (timer != null) window.clearTimeout(timer);
    stateRef.current.timer = null;
    setPlaying(false);
    setStatus("Stoppet");
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

  return (
    <section className="metro pb-4">
      <div className="metro-hero rounded-card px-4 py-8">
        <p className="text-center text-8xl leading-none font-bold tracking-tight tabular-nums">{displayBpm}</p>
        <p className="mt-3 min-h-5 text-center text-sm text-muted">{status}</p>
      </div>
      <div className="mt-4 flex min-h-12 flex-wrap items-center justify-center gap-2">
        {pattern.map((stick, index) => (
          <span
            key={`${stick}-${index}`}
            className={
              index === active
                ? "metro-badge is-active min-w-12 rounded-lg bg-accent px-3 py-2 text-center text-2xl font-semibold text-bg"
                : "metro-badge min-w-12 rounded-lg bg-header px-3 py-2 text-center text-2xl font-semibold"
            }
          >
            {stick}
          </span>
        ))}
      </div>
      <div className="mt-4 grid gap-3 rounded-card border border-line bg-surface p-4 shadow-[0_12px_28px_rgba(0,0,0,0.28)]">
        <label className="flex items-center justify-between gap-3 text-sm">
          Rudiment
          <select
            value={rudiment}
            onChange={(event) => setRudiment(event.target.value as RudimentId)}
            className="metro-field min-h-11 max-w-[58%] rounded-md border border-line bg-header px-2 text-fg"
          >
            {RUDIMENT_LABELS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Start-BPM
          <input
            type="number"
            min={40}
            max={300}
            value={startBpm}
            onChange={(event) => setStartBpm(Number(event.target.value))}
            className="metro-field min-h-11 w-24 rounded-md border border-line bg-header px-2 text-fg"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Økning
          <input
            type="number"
            min={1}
            max={10}
            value={inc}
            onChange={(event) => setInc(Number(event.target.value))}
            className="metro-field min-h-11 w-24 rounded-md border border-line bg-header px-2 text-fg"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Takker per steg
          <input
            type="number"
            min={1}
            max={32}
            value={bars}
            onChange={(event) => setBars(Number(event.target.value))}
            className="metro-field min-h-11 w-24 rounded-md border border-line bg-header px-2 text-fg"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Underdeling
          <select
            value={sub}
            onChange={(event) => setSub(Number(event.target.value))}
            className="metro-field min-h-11 max-w-[58%] rounded-md border border-line bg-header px-2 text-fg"
          >
            <option value={4}>Fjerdedel</option>
            <option value={8}>Åttendel</option>
            <option value={16}>Sekstendel</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={start}
            disabled={playing}
            className="metro-press min-h-12 rounded-lg bg-accent font-semibold text-bg disabled:opacity-50"
          >
            Start
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={!playing}
            className="metro-press min-h-12 rounded-lg bg-header font-medium disabled:opacity-50"
          >
            Stopp
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={markClean} className="metro-press min-h-12 rounded-lg bg-header font-medium">
            Merk ren
          </button>
          <button type="button" onClick={markBroke} className="metro-press min-h-12 rounded-lg bg-header font-medium">
            Merk brutt
          </button>
        </div>
        <p className="text-center text-sm text-muted">
          {best ? `Beste (${rudiment}): ${best} BPM` : "Beste: —"}
        </p>
      </div>
    </section>
  );
}
