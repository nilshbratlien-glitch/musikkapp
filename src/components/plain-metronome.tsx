import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  METERS,
  QUICK_TEMPOS,
  SUBDIVISIONS,
  beatsInMeter,
  meterForBeats,
  tempoMarking,
  type Meter,
  type Subdivision,
} from "@/lib/metronome";
import { BLOCK_COLOR, blockName, blockStyle, bpmFromTaps, TRUMPET_EXERCISES, type BlockId } from "@/lib/oveplan";
import {
  getPlanClock,
  getPlanClockVersion,
  planMalletBlock,
  setPlanBpm,
  setPlanMeter,
  startFromMetronom,
  stopFromMetronom,
  subscribePlanClock,
} from "@/lib/plan-clock";
import { getProfile, getProfileVersion, subscribeProfile } from "@/lib/profile";
import { getState, setBpm as pulseBpm, setMeter as pulseMeter, stop as pulseStop, subscribe } from "@/lib/pulse";
import { syncMetroSet, syncMetroStart, syncMetroStop } from "@/lib/sync/bridge";
import { readToolStore, writeToolStore } from "@/lib/tools";

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
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const profile = getProfile();
  const [bpm, setBpm] = useState(80);
  const [meter, setMeter] = useState<Meter>("4/4");
  const [subdivision, setSubdivision] = useState<Subdivision>(1);
  const pulse = useSyncExternalStore(subscribe, getState, getState);
  useSyncExternalStore(subscribePlanClock, getPlanClockVersion, getPlanClockVersion);
  const clock = getPlanClock();
  const owns = pulse.owner === "oveplan";
  // The plan runs this tab while it owns the pulse or sits in a (paused) 2-/4-mallet block.
  const plan = owns || planMalletBlock();
  const playing = pulse.owner === "metronom" || owns;
  const bpmRef = useRef(80);
  const meterRef = useRef<Meter>("4/4");
  const subRef = useRef<Subdivision>(1);
  const tapsRef = useRef<number[]>([]);

  bpmRef.current = bpm;
  meterRef.current = meter;
  subRef.current = subdivision;

  useEffect(() => {
    const store = readToolStore("metronom");
    if (typeof store.bpm === "number" && store.bpm >= 40 && store.bpm <= 240) setBpm(store.bpm);
    else setBpm(80);
    setMeter(savedMeter(store.meter));
    setSubdivision(savedSubdivision(store.subdiv));
    return () => {
      pulseStop("metronom");
    };
  }, [profile]);

  useEffect(() => {
    if (!playing || owns) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let active = true;
    let sentinel: { release: () => Promise<void> } | null = null;
    const requestLock = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
        };
        const lock = await nav.wakeLock?.request("screen");
        if (!active) {
          void lock?.release();
          return;
        }
        sentinel = lock ?? null;
      } catch {
        /* ignore */
      }
    };
    void requestLock();
    return () => {
      active = false;
      void sentinel?.release();
    };
  }, [playing, owns]);

  function handleTap() {
    const now = Date.now();
    tapsRef.current = [...tapsRef.current.filter((tap) => now - tap < 3000), now];
    const next = bpmFromTaps(tapsRef.current);
    if (next != null) {
      changeBpm(next);
    }
  }

  function remember() {
    const store = readToolStore("metronom");
    writeToolStore("metronom", {
      ...store,
      bpm: bpmRef.current,
      meter: meterRef.current,
      subdiv: subRef.current,
    });
  }

  function start() {
    if (playing) return;
    if (planMalletBlock()) {
      startFromMetronom({ owner: "metronom", bpm: bpmRef.current, beats: beatsInMeter(meterRef.current), sub: subRef.current });
      return;
    }
    startFromMetronom({ owner: "metronom", bpm: bpmRef.current, beats: beatsInMeter(meterRef.current), sub: subRef.current });
    syncMetroStart(bpmRef.current, beatsInMeter(meterRef.current), subRef.current);
  }

  function stop() {
    if (planMalletBlock()) {
      stopFromMetronom();
      return;
    }
    stopFromMetronom();
    syncMetroStop();
  }

  function changeBpm(next: number) {
    const value = Math.min(240, Math.max(40, next));
    if (plan) {
      setPlanBpm(value);
      return;
    }
    setBpm(value);
    bpmRef.current = value;
    if (playing) pulseBpm(value);
    remember();
    syncMetroSet(value, beatsInMeter(meterRef.current), subRef.current);
  }

  function changeMeter(next: Meter) {
    if (plan) {
      setPlanMeter(beatsInMeter(next), shownSub);
      return;
    }
    setMeter(next);
    meterRef.current = next;
    if (playing) pulseMeter(beatsInMeter(next), subRef.current);
    remember();
    syncMetroSet(bpmRef.current, beatsInMeter(next), subRef.current);
  }

  function changeSubdivision(next: Subdivision) {
    if (plan) {
      setPlanMeter(beats, next);
      return;
    }
    setSubdivision(next);
    subRef.current = next;
    if (playing) pulseMeter(beatsInMeter(meterRef.current), next);
    remember();
    syncMetroSet(bpmRef.current, beatsInMeter(meterRef.current), next);
  }

  // While the plan runs the tab, every readout comes from the pulse (playing) or the plan store (paused).
  const beats = owns ? pulse.beats : plan ? clock.store.beats : beatsInMeter(meter);
  const shownSub = owns ? pulse.sub : plan ? clock.store.sub : subdivision;
  const shownBpm = owns ? pulse.bpm : plan ? clock.store.bpm : bpm;
  const shownMeter = plan ? meterForBeats(beats) : meter;
  const block = (clock.activeId ?? "twomallet") as BlockId;

  return (
    <div className="md:grid md:grid-cols-[1.05fr_0.95fr] md:items-stretch md:gap-5 lg:gap-6">
      <div className="space-y-4 md:flex md:flex-col md:justify-between md:space-y-5">
        <div className="metro-hero rounded-card px-4 py-7 md:px-6 md:py-12">
          <p className="text-center text-8xl leading-none font-bold tracking-tight tabular-nums md:text-[9rem] lg:text-[10.5rem]">
            {shownBpm}
          </p>
          <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-center text-sm text-muted md:mt-4 md:text-base">
            {plan ? (
              <>
                <span className="plan-chip" style={blockStyle(block)}>
                  <span className="plan-chip-dot" aria-hidden="true" />
                  {blockName(block, profile)} · {beats} slag
                </span>
                <span className="text-xs font-medium text-muted md:text-sm">{tempoMarking(shownBpm)}</span>
              </>
            ) : (
              <>
                <span className="font-semibold text-fg/90">{meter}</span>
                <span aria-hidden="true">·</span>
                <span>{tempoMarking(shownBpm)}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex min-h-12 items-center justify-center gap-2.5 md:min-h-16 md:gap-3">
          {Array.from({ length: beats }, (_, index) => {
            const isBeat = index === (playing ? pulse.beat : -1);
            const isDownbeat = index === 0;
            return (
              <span
                key={index}
                className={
                  isBeat
                    ? `metro-badge is-active flex size-10 items-center justify-center rounded-2xl bg-accent text-sm font-bold text-accent-fg tabular-nums md:h-14 md:w-auto md:max-w-20 md:flex-1 md:text-lg ${isDownbeat ? "ring-2 ring-accent/40" : ""}`
                    : `metro-badge flex size-10 items-center justify-center rounded-2xl bg-surface text-sm font-semibold tabular-nums md:h-14 md:w-auto md:max-w-20 md:flex-1 md:text-lg ${isDownbeat ? "border border-accent/40 text-fg" : "border border-line text-muted"}`
                }
              >
                {index + 1}
              </span>
            );
          })}
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
            disabled={!(pulse.owner === "metronom" || (owns && planMalletBlock()))}
            style={plan ? ({ "--block": BLOCK_COLOR[block] } as CSSProperties) : undefined}
            className="metro-press min-h-14 rounded-xl border border-[var(--block,var(--color-accent))] bg-surface text-base font-semibold text-fg disabled:border-line disabled:bg-surface/60 disabled:text-muted md:min-h-16 md:text-lg"
          >
            Stopp
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-4 md:mt-0">
        <div className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-card)] md:p-5">
          <p className="text-sm font-medium text-muted">Tempo</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => changeBpm(shownBpm - 5)}
              aria-label="Senk tempo 5"
              className="metro-press min-h-12 min-w-12 flex-1 rounded-lg border border-line bg-header px-2.5 text-sm font-semibold md:min-h-14 md:text-base"
            >
              −5
            </button>
            <button
              type="button"
              onClick={() => changeBpm(shownBpm - 1)}
              aria-label="Senk tempo"
              className="metro-press min-h-12 min-w-12 flex-1 rounded-lg border border-line bg-header text-xl md:min-h-14"
            >
              −
            </button>
            <button
              type="button"
              onClick={handleTap}
              className="metro-press min-h-12 flex-[1.6] rounded-lg border border-accent/40 bg-accent/10 px-4 text-sm font-semibold text-accent md:min-h-14 md:text-base"
            >
              Tap tempo
            </button>
            <button
              type="button"
              onClick={() => changeBpm(shownBpm + 1)}
              aria-label="Øk tempo"
              className="metro-press min-h-12 min-w-12 flex-1 rounded-lg border border-line bg-header text-xl md:min-h-14"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => changeBpm(shownBpm + 5)}
              aria-label="Øk tempo 5"
              className="metro-press min-h-12 min-w-12 flex-1 rounded-lg border border-line bg-header px-2.5 text-sm font-semibold md:min-h-14 md:text-base"
            >
              +5
            </button>
          </div>
          <div className="pt-1">
            <input
              type="range"
              min={40}
              max={240}
              value={shownBpm}
              aria-label="Tempo BPM"
              onChange={(e) => changeBpm(Number(e.target.value))}
              className="h-7 w-full cursor-pointer accent-accent"
            />
            <div className="mt-0.5 flex justify-between px-1 text-[11px] font-medium text-muted tabular-nums" aria-hidden="true">
              <span>40</span>
              <span>80</span>
              <span>120</span>
              <span>160</span>
              <span>200</span>
              <span>240</span>
            </div>
          </div>
          <div className="hidden gap-2 pt-1 sm:grid sm:grid-cols-4" role="group" aria-label="Hurtigtempo">
            {QUICK_TEMPOS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => changeBpm(preset)}
                className={
                  shownBpm === preset
                    ? "metro-press min-h-10 rounded-lg border border-accent bg-accent/10 text-sm font-semibold text-accent tabular-nums"
                    : "metro-press min-h-10 rounded-lg border border-line bg-header text-sm font-medium text-muted tabular-nums hover:text-fg"
                }
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-card)] md:p-5">
          <p className="text-sm font-medium text-muted">Taktart</p>
          <div className="grid grid-cols-4 gap-1.5 md:gap-2">
            {METERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => changeMeter(item)}
                aria-pressed={item === shownMeter}
                className={
                  item === shownMeter
                    ? "metro-press min-h-11 rounded-lg border border-accent bg-accent/10 text-sm font-semibold text-accent md:min-h-14 md:text-base"
                    : "metro-press min-h-11 rounded-lg border border-line bg-header text-sm text-muted hover:text-fg md:min-h-14 md:text-base"
                }
              >
                {item}
              </button>
            ))}
          </div>
          <p className="text-sm font-medium text-muted">Underdeling</p>
          <div className="grid grid-cols-4 gap-1.5 md:gap-2">
            {SUBDIVISIONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => changeSubdivision(item)}
                aria-pressed={item === shownSub}
                className={
                  item === shownSub
                    ? "metro-press min-h-11 rounded-lg border border-accent bg-accent/10 text-sm font-semibold text-accent md:min-h-14 md:text-base"
                    : "metro-press min-h-11 rounded-lg border border-line bg-header text-sm text-muted hover:text-fg md:min-h-14 md:text-base"
                }
              >
                {SUB_LABELS[item]}
              </button>
            ))}
          </div>
        </div>
        {plan && clock.activeId && profile === "trumpet" && TRUMPET_EXERCISES[block] && (
          <aside
            className="hidden sm:block rounded-card border border-line bg-surface p-4 sm:p-5 shadow-sm"
            style={blockStyle(block)}
            aria-label={TRUMPET_EXERCISES[block].title}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="plan-chip text-xs font-semibold" style={blockStyle(block)}>
                <span className="plan-chip-dot" aria-hidden="true" />
                {TRUMPET_EXERCISES[block].title}
              </span>
              <span className="text-xs text-muted font-medium">Instruksjoner for denne blokka</span>
            </div>
            <ul className="space-y-2 text-sm text-fg/90 sm:space-y-2.5">
              {TRUMPET_EXERCISES[block].items.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--block,var(--color-accent))]" aria-hidden="true" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
