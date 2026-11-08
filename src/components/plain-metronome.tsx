import { useEffect, useRef, useState } from "react";
import { METERS, SUBDIVISIONS, beatsInMeter, nextClick, type Meter, type Subdivision } from "@/lib/metronome";
import { readToolStore, writeToolStore } from "@/lib/tools";

function scheduleClick(audio: AudioContext, time: number, kind: "accent" | "beat" | "sub") {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.frequency.value = kind === "accent" ? 1200 : kind === "beat" ? 800 : 640;
  gain.gain.setValueAtTime(kind === "accent" ? 0.35 : kind === "beat" ? 0.2 : 0.09, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
  osc.start(time);
  osc.stop(time + 0.05);
}

function savedMeter(value: unknown): Meter {
  return METERS.includes(value as Meter) ? (value as Meter) : "4/4";
}

function savedSubdivision(value: unknown): Subdivision {
  return SUBDIVISIONS.includes(value as Subdivision) ? (value as Subdivision) : 1;
}

const SUB_LABELS: Record<Subdivision, string> = {
  1: "Slag",
  2: "2",
  3: "Triol",
  4: "4",
};

export function PlainMetronome() {
  const [bpm, setBpm] = useState(80);
  const [meter, setMeter] = useState<Meter>("4/4");
  const [subdivision, setSubdivision] = useState<Subdivision>(1);
  const [playing, setPlaying] = useState(false);
  const [pulse, setPulse] = useState(-1);
  const bpmRef = useRef(80);
  const meterRef = useRef<Meter>("4/4");
  const subRef = useRef<Subdivision>(1);
  const beatRef = useRef(0);
  const nextRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const playingRef = useRef(false);

  bpmRef.current = bpm;
  meterRef.current = meter;
  subRef.current = subdivision;

  useEffect(() => {
    const store = readToolStore("metronom");
    if (typeof store.bpm === "number" && store.bpm >= 40 && store.bpm <= 240) setBpm(store.bpm);
    setMeter(savedMeter(store.meter));
    setSubdivision(savedSubdivision(store.subdiv));
    return () => {
      playingRef.current = false;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function remember() {
    const store = readToolStore("metronom");
    writeToolStore("metronom", {
      ...store,
      bpm: bpmRef.current,
      meter: meterRef.current,
      subdiv: subRef.current,
    });
  }

  function scheduler() {
    const audio = audioRef.current;
    if (!audio || !playingRef.current) return;
    const seconds = 60 / bpmRef.current / subRef.current;
    while (nextRef.current < audio.currentTime + 0.1) {
      const step = nextClick(beatRef.current, meterRef.current, subRef.current);
      const kind = step.accent ? "accent" : step.downbeat ? "beat" : "sub";
      scheduleClick(audio, nextRef.current, kind);
      setPulse(step.beatIndex);
      beatRef.current = step.tick;
      nextRef.current += seconds;
    }
    timerRef.current = window.setTimeout(scheduler, 25);
  }

  function start() {
    if (playingRef.current) return;
    if (!audioRef.current) audioRef.current = new AudioContext();
    const audio = audioRef.current;
    if (audio.state === "suspended") void audio.resume();
    beatRef.current = 0;
    nextRef.current = audio.currentTime + 0.05;
    playingRef.current = true;
    setPlaying(true);
    setPulse(0);
    scheduler();
  }

  function stop() {
    playingRef.current = false;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
    setPulse(-1);
  }

  function changeBpm(next: number) {
    const value = Math.min(240, Math.max(40, next));
    setBpm(value);
    bpmRef.current = value;
    remember();
  }

  function changeMeter(next: Meter) {
    setMeter(next);
    meterRef.current = next;
    beatRef.current = 0;
    setPulse(playingRef.current ? 0 : -1);
    remember();
  }

  function changeSubdivision(next: Subdivision) {
    setSubdivision(next);
    subRef.current = next;
    beatRef.current = 0;
    setPulse(playingRef.current ? 0 : -1);
    remember();
  }

  const beats = beatsInMeter(meter);

  return (
    <div>
      <div className="metro-hero rounded-card px-4 py-8">
        <p className="text-center text-8xl leading-none font-bold tracking-tight tabular-nums">{bpm}</p>
        <p className="mt-3 text-center text-sm text-muted">{meter}</p>
      </div>
      <div className="mt-4 flex min-h-12 items-center justify-center gap-2">
        {Array.from({ length: beats }, (_, index) => (
          <span
            key={index}
            className={
              index === pulse
                ? "metro-badge is-active size-4 rounded-full bg-accent"
                : "metro-badge size-4 rounded-full bg-header"
            }
          />
        ))}
      </div>
      <div className="mt-4 grid gap-3 rounded-card border border-line bg-surface p-4">
        <div className="grid grid-cols-4 gap-1.5">
          {METERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => changeMeter(item)}
              className={
                item === meter
                  ? "metro-press min-h-11 rounded-lg border border-accent bg-header text-sm font-semibold"
                  : "metro-press min-h-11 rounded-lg border border-line text-sm text-muted"
              }
            >
              {item}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">Underdeling</p>
        <div className="grid grid-cols-4 gap-1.5">
          {SUBDIVISIONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => changeSubdivision(item)}
              className={
                item === subdivision
                  ? "metro-press min-h-11 rounded-lg border border-accent bg-header text-sm font-semibold"
                  : "metro-press min-h-11 rounded-lg border border-line text-sm text-muted"
              }
            >
              {SUB_LABELS[item]}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={() => changeBpm(bpm - 1)} className="metro-press min-h-12 min-w-12 rounded-lg border border-line bg-header text-xl">
            −
          </button>
          <button type="button" onClick={() => changeBpm(bpm + 1)} className="metro-press min-h-12 min-w-12 rounded-lg border border-line bg-header text-xl">
            +
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={start} disabled={playing} className="metro-press min-h-12 rounded-lg bg-accent font-semibold text-bg disabled:opacity-50">
            Start
          </button>
          <button type="button" onClick={stop} disabled={!playing} className="metro-press min-h-12 rounded-lg bg-header font-medium disabled:opacity-50">
            Stopp
          </button>
        </div>
      </div>
    </div>
  );
}
