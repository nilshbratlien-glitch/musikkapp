import { useEffect, useRef, useState } from "react";
import {
  RUDIMENTS,
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
  const [status, setStatus] = useState("Ready");
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
        setStatus(`Increased to ${step.state.bpm}`);
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
    setStatus("Playing…");
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
    setStatus("Stopped");
  }

  function markClean() {
    const bpm = stateRef.current.bpmLive;
    const next = recordBest(bests, rudiment, bpm);
    setBests(next.bests);
    const store = readToolStore("metronom");
    writeToolStore("metronom", { ...store, bests: next.bests });
    if (next.updated) setStatus(`New best: ${bpm}`);
  }

  function markBroke() {
    setStatus("Marked broke");
  }

  const best = bests[rudiment];

  return (
    <section className="pb-4">
      <p className="text-center text-7xl leading-none font-bold tracking-tight tabular-nums">{displayBpm}</p>
      <p className="mt-2 min-h-5 text-center text-sm text-muted">{status}</p>
      <div className="mt-4 flex min-h-10 flex-wrap items-center justify-center gap-2">
        {pattern.map((stick, index) => (
          <span
            key={`${stick}-${index}`}
            className={
              index === active
                ? "min-w-9 rounded-md bg-accent px-2.5 py-1 text-center text-xl font-semibold text-bg"
                : "min-w-9 rounded-md bg-header px-2.5 py-1 text-center text-xl font-semibold"
            }
          >
            {stick}
          </span>
        ))}
      </div>
      <div className="mt-4 grid gap-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          Rudiment
          <select
            value={rudiment}
            onChange={(event) => setRudiment(event.target.value as RudimentId)}
            className="min-h-11 max-w-[58%] rounded-md border border-line bg-header px-2 text-fg"
          >
            {RUDIMENT_LABELS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Start BPM
          <input
            type="number"
            min={40}
            max={300}
            value={startBpm}
            onChange={(event) => setStartBpm(Number(event.target.value))}
            className="min-h-11 w-24 rounded-md border border-line bg-header px-2 text-fg"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Increment
          <input
            type="number"
            min={1}
            max={10}
            value={inc}
            onChange={(event) => setInc(Number(event.target.value))}
            className="min-h-11 w-24 rounded-md border border-line bg-header px-2 text-fg"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Bars per step
          <input
            type="number"
            min={1}
            max={32}
            value={bars}
            onChange={(event) => setBars(Number(event.target.value))}
            className="min-h-11 w-24 rounded-md border border-line bg-header px-2 text-fg"
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Subdivision
          <select
            value={sub}
            onChange={(event) => setSub(Number(event.target.value))}
            className="min-h-11 max-w-[58%] rounded-md border border-line bg-header px-2 text-fg"
          >
            <option value={4}>Quarter</option>
            <option value={8}>Eighth</option>
            <option value={16}>Sixteenth</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={start}
            disabled={playing}
            className="min-h-12 rounded-lg bg-accent font-semibold text-bg disabled:opacity-50"
          >
            Start
          </button>
          <button
            type="button"
            onClick={stop}
            disabled={!playing}
            className="min-h-12 rounded-lg bg-surface font-medium disabled:opacity-50"
          >
            Stop
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={markClean} className="min-h-12 rounded-lg bg-surface font-medium">
            Mark Clean
          </button>
          <button type="button" onClick={markBroke} className="min-h-12 rounded-lg bg-surface font-medium">
            Mark Broke
          </button>
        </div>
      </div>
      <p className="mt-3 text-center text-sm text-muted">
        {best ? `Best (${rudiment}): ${best} BPM` : "Best: —"}
      </p>
    </section>
  );
}
