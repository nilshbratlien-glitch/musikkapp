import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { METERS, SUBDIVISIONS, beatsInMeter, meterForBeats, type Meter, type Subdivision } from "@/lib/metronome";
import { BLOCK_COLOR, blockStyle, type BlockId } from "@/lib/oveplan";
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
import { getState, setBpm as pulseBpm, setMeter as pulseMeter, stop as pulseStop, subscribe } from "@/lib/pulse";
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

  bpmRef.current = bpm;
  meterRef.current = meter;
  subRef.current = subdivision;

  useEffect(() => {
    const store = readToolStore("metronom");
    if (typeof store.bpm === "number" && store.bpm >= 40 && store.bpm <= 240) setBpm(store.bpm);
    setMeter(savedMeter(store.meter));
    setSubdivision(savedSubdivision(store.subdiv));
    return () => {
      pulseStop("metronom");
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

  function start() {
    if (playing) return;
    startFromMetronom({ owner: "metronom", bpm: bpmRef.current, beats: beatsInMeter(meterRef.current), sub: subRef.current });
  }

  function stop() {
    stopFromMetronom();
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
  }

  // While the plan runs the tab, every readout comes from the pulse (playing) or the plan store (paused).
  const beats = owns ? pulse.beats : plan ? clock.store.beats : beatsInMeter(meter);
  const shownSub = owns ? pulse.sub : plan ? clock.store.sub : subdivision;
  const shownBpm = owns ? pulse.bpm : plan ? clock.store.bpm : bpm;
  const shownMeter = plan ? meterForBeats(beats) : meter;
  const block = (clock.activeId ?? "twomallet") as BlockId;

  return (
    <div>
      <div className="metro-hero rounded-card px-4 py-8">
        <p className="text-center text-8xl leading-none font-bold tracking-tight tabular-nums">{shownBpm}</p>
        <p className="mt-3 text-center text-sm text-muted">
          {plan ? (
            <span className="plan-chip" style={blockStyle(block)}>
              <span className="plan-chip-dot" aria-hidden="true" />
              Øveplan · {beats} slag
            </span>
          ) : (
            meter
          )}
        </p>
      </div>
      <div className="mt-4 flex min-h-12 items-center justify-center gap-2">
        {Array.from({ length: beats }, (_, index) => (
          <span
            key={index}
            className={
              index === (playing ? pulse.beat : -1)
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
              aria-pressed={item === shownMeter}
              className={
                item === shownMeter
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
              aria-pressed={item === shownSub}
              className={
                item === shownSub
                  ? "metro-press min-h-11 rounded-lg border border-accent bg-header text-sm font-semibold"
                  : "metro-press min-h-11 rounded-lg border border-line text-sm text-muted"
              }
            >
              {SUB_LABELS[item]}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={() => changeBpm(shownBpm - 1)} className="metro-press min-h-12 min-w-12 rounded-lg border border-line bg-header text-xl">
            −
          </button>
          <button type="button" onClick={() => changeBpm(shownBpm + 1)} className="metro-press min-h-12 min-w-12 rounded-lg border border-line bg-header text-xl">
            +
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={start} disabled={playing} className="metro-press min-h-12 rounded-lg bg-accent font-semibold text-bg disabled:bg-header disabled:text-muted">
            Start
          </button>
          <button type="button" onClick={stop} disabled={!(pulse.owner === "metronom" || (owns && planMalletBlock()))}
            style={plan ? ({ "--block": BLOCK_COLOR[block] } as CSSProperties) : undefined}
            className="metro-press min-h-12 rounded-lg border border-[var(--block,var(--color-accent))] bg-header font-semibold disabled:border-transparent disabled:bg-header disabled:text-muted"
          >
            Stopp
          </button>
        </div>
      </div>
    </div>
  );
}
