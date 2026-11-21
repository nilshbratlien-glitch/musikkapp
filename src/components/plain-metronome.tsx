import { Maximize2, Minimize2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  CLICK_SOUND_OPTIONS,
  DEFAULT_CLICK_SOUND,
  DEFAULT_CLICK_VOLUME,
  GAP_PRESETS,
  METERS,
  QUICK_TEMPOS,
  SUBDIVISIONS,
  beatsInMeter,
  clampClickVolume,
  cycleBeatAccent,
  defaultBeatAccents,
  getGapPreset,
  isClickSound,
  isGapPresetId,
  meterForBeats,
  tempoMarking,
  type BeatAccent,
  type ClickSound,
  type GapPresetId,
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
import {
  getState,
  setBeatAccents as pulseBeatAccents,
  setBpm as pulseBpm,
  setClickSound as pulseClickSound,
  setClickVolume as pulseClickVolume,
  setGapTrainer as pulseGapTrainer,
  setMeter as pulseMeter,
  stop as pulseStop,
  subscribe,
} from "@/lib/pulse";
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

const ACCENT_LABEL_NB: Record<BeatAccent, string> = {
  accent: "Aksent",
  normal: "Vanlig",
  mute: "Stille",
};

export function PlainMetronome() {
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const profile = getProfile();
  const [bpm, setBpm] = useState(80);
  const [meter, setMeter] = useState<Meter>("4/4");
  const [subdivision, setSubdivision] = useState<Subdivision>(1);
  const [clickSound, setClickSound] = useState<ClickSound>(DEFAULT_CLICK_SOUND);
  const [clickVolume, setClickVolume] = useState<number>(DEFAULT_CLICK_VOLUME);
  const [beatAccents, setBeatAccents] = useState<BeatAccent[]>(() => defaultBeatAccents(4));
  const [gapPreset, setGapPreset] = useState<GapPresetId>("off");
  const [standMode, setStandMode] = useState(false);

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
  const soundRef = useRef<ClickSound>(DEFAULT_CLICK_SOUND);
  const volumeRef = useRef<number>(DEFAULT_CLICK_VOLUME);
  const accentsRef = useRef<BeatAccent[]>(beatAccents);
  const gapRef = useRef<GapPresetId>("off");
  const tapsRef = useRef<number[]>([]);

  bpmRef.current = bpm;
  meterRef.current = meter;
  subRef.current = subdivision;
  soundRef.current = clickSound;
  volumeRef.current = clickVolume;
  accentsRef.current = beatAccents;
  gapRef.current = gapPreset;

  useEffect(() => {
    const store = readToolStore("metronom");
    if (typeof store.bpm === "number" && store.bpm >= 40 && store.bpm <= 240) setBpm(store.bpm);
    else setBpm(80);
    const loadedMeter = savedMeter(store.meter);
    setMeter(loadedMeter);
    setSubdivision(savedSubdivision(store.subdiv));
    const loadedSound = isClickSound(store.sound) ? store.sound : DEFAULT_CLICK_SOUND;
    const loadedVol = typeof store.volume === "number" ? clampClickVolume(store.volume) : DEFAULT_CLICK_VOLUME;
    const loadedGap = isGapPresetId(store.gap) ? store.gap : "off";
    setClickSound(loadedSound);
    setClickVolume(loadedVol);
    setGapPreset(loadedGap);
    setBeatAccents(defaultBeatAccents(beatsInMeter(loadedMeter)));
    pulseClickSound(loadedSound);
    pulseClickVolume(loadedVol);
    return () => {
      pulseStop("metronom");
    };
  }, [profile]);

  // Screen Wake Lock with visibilitychange re-acquire while Metronom or stand mode is active
  useEffect(() => {
    if ((!playing || owns) && !standMode) return;
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
  }, [playing, owns, standMode]);

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
      sound: soundRef.current,
      volume: volumeRef.current,
      gap: gapRef.current,
    });
  }

  function currentGapPayload() {
    const def = getGapPreset(gapRef.current);
    return def.playBars > 0 && def.muteBars > 0 ? { playBars: def.playBars, muteBars: def.muteBars } : null;
  }

  function start() {
    if (playing) return;
    pulseClickSound(soundRef.current);
    pulseClickVolume(volumeRef.current);
    if (planMalletBlock()) {
      startFromMetronom({
        owner: "metronom",
        bpm: bpmRef.current,
        beats: beatsInMeter(meterRef.current),
        sub: subRef.current,
      });
      return;
    }
    startFromMetronom({
      owner: "metronom",
      bpm: bpmRef.current,
      beats: beatsInMeter(meterRef.current),
      sub: subRef.current,
      beatAccents: accentsRef.current,
      gap: currentGapPayload(),
    });
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

  // Space toggles Start/Stopp; Escape exits Notestativ-modus
  const startStopRef = useRef({ start, stop, playing, canStop: false });
  startStopRef.current = {
    start,
    stop,
    playing,
    canStop: pulse.owner === "metronom" || (owns && planMalletBlock()),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && standMode) {
        setStandMode(false);
        return;
      }
      if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
        e.preventDefault();
        if (startStopRef.current.playing) {
          if (startStopRef.current.canStop) startStopRef.current.stop();
        } else {
          startStopRef.current.start();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [standMode]);

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
    const nextBeats = beatsInMeter(next);
    const nextAccents = defaultBeatAccents(nextBeats);
    setMeter(next);
    meterRef.current = next;
    setBeatAccents(nextAccents);
    accentsRef.current = nextAccents;
    if (playing) {
      pulseMeter(nextBeats, subRef.current);
      pulseBeatAccents(nextAccents);
    }
    remember();
    syncMetroSet(bpmRef.current, nextBeats, subRef.current);
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

  function changeSound(next: ClickSound) {
    setClickSound(next);
    soundRef.current = next;
    pulseClickSound(next);
    remember();
  }

  function changeVolume(next: number) {
    const clamped = clampClickVolume(next);
    setClickVolume(clamped);
    volumeRef.current = clamped;
    pulseClickVolume(clamped);
    remember();
  }

  function toggleBeatAccent(index: number) {
    if (plan) return;
    const next = beatAccents.map((acc, i) => (i === index ? cycleBeatAccent(acc) : acc));
    setBeatAccents(next);
    accentsRef.current = next;
    if (playing) pulseBeatAccents(next);
  }

  function changeGapPreset(next: GapPresetId) {
    setGapPreset(next);
    gapRef.current = next;
    const def = getGapPreset(next);
    const payload = def.playBars > 0 && def.muteBars > 0 ? { playBars: def.playBars, muteBars: def.muteBars } : null;
    if (playing && !plan) {
      pulseGapTrainer(payload);
    }
    remember();
  }

  // While the plan runs the tab, every readout comes from the pulse (playing) or the plan store (paused).
  const beats = owns ? pulse.beats : plan ? clock.store.beats : beatsInMeter(meter);
  const shownSub = owns ? pulse.sub : plan ? clock.store.sub : subdivision;
  const shownBpm = owns ? pulse.bpm : plan ? clock.store.bpm : bpm;
  const shownMeter = plan ? meterForBeats(beats) : meter;
  const block = (clock.activeId ?? "twomallet") as BlockId;
  const activeAccents = plan ? defaultBeatAccents(beats) : beatAccents;
  const isGapSilent = playing && !plan && pulse.gapMuted;

  return (
    <div
      className={
        standMode
          ? "fixed inset-0 z-30 flex h-full min-h-0 flex-col justify-between gap-4 overflow-y-auto bg-bg px-4 py-4 text-fg sm:px-6"
          : "md:grid md:grid-cols-[1.05fr_0.95fr] md:items-stretch md:gap-5 lg:gap-6"
      }
    >
      <div className={standMode ? "mx-auto flex w-full max-w-3xl flex-1 flex-col justify-between gap-5" : "space-y-4 md:flex md:flex-col md:justify-between md:space-y-5"}>
        <div
          style={
            isGapSilent
              ? { borderColor: "rgb(var(--color-accent-rgb) / 0.55)" }
              : undefined
          }
          className="metro-hero relative rounded-card px-4 py-7 md:px-6 md:py-12"
        >
          <button
            type="button"
            onClick={() => setStandMode((s) => !s)}
            aria-pressed={standMode}
            aria-label={standMode ? "Avslutt notestativ-modus" : "Notestativ-modus (fullskjerm)"}
            title={standMode ? "Avslutt fullskjerm (Esc)" : "Notestativ-modus (fullskjerm)"}
            className={
              standMode
                ? "metro-press absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-xl border border-accent bg-[rgb(var(--color-accent-rgb)/0.14)] text-accent"
                : "metro-press absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-xl border border-line bg-header text-muted hover:text-fg"
            }
          >
            {standMode ? (
              <Minimize2 className="size-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-4" aria-hidden="true" />
            )}
          </button>

          <p
            className={
              standMode
                ? "text-center text-9xl leading-none font-bold tracking-tight tabular-nums sm:text-[11rem]"
                : "text-center text-8xl leading-none font-bold tracking-tight tabular-nums md:text-[9rem] lg:text-[10.5rem]"
            }
          >
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
                <span className="font-semibold text-fg">{meter}</span>
                <span aria-hidden="true">·</span>
                <span>{tempoMarking(shownBpm)}</span>
                {isGapSilent ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent bg-[rgb(var(--color-accent-rgb)/0.14)] px-2.5 py-0.5 text-xs font-bold text-accent">
                    <VolumeX className="size-3.5" aria-hidden="true" />
                    Stille takt
                  </span>
                ) : null}
              </>
            )}
          </p>
        </div>

        {/* Interactive beat accent/mute badges */}
        <div className="space-y-1.5">
          <div
            className="flex min-h-12 flex-wrap items-center justify-center gap-2 md:min-h-16 md:gap-2.5"
            role="group"
            aria-label="Slag og aksenter"
          >
            {Array.from({ length: beats }, (_, index) => {
              const isBeat = index === (playing ? pulse.beat : -1);
              const mode: BeatAccent = activeAccents[index] ?? (index === 0 ? "accent" : "normal");
              const isAccent = mode === "accent";
              const isMuted = mode === "mute";
              const sizeCls = standMode
                ? "h-16 min-w-14 flex-1 max-w-24 text-xl"
                : beats >= 6
                  ? "size-10 text-sm md:h-14 md:w-auto md:max-w-16 md:flex-1 md:text-base"
                  : "size-11 text-sm md:h-14 md:w-auto md:max-w-20 md:flex-1 md:text-lg";

              const baseStyle: CSSProperties | undefined = isBeat
                ? isGapSilent
                  ? { backgroundColor: "rgb(var(--color-accent-rgb) / 0.35)" }
                  : undefined
                : isAccent
                  ? {
                      borderColor: "rgb(var(--color-accent-rgb) / 0.55)",
                      backgroundColor: "rgb(var(--color-accent-rgb) / 0.1)",
                    }
                  : undefined;

              const cls = isBeat
                ? `metro-badge is-active relative flex items-center justify-center rounded-2xl font-bold tabular-nums ${sizeCls} ${
                    isGapSilent
                      ? "border-2 border-dashed border-accent text-accent"
                      : isMuted
                        ? "border-2 border-dashed border-line bg-header text-muted"
                        : "bg-accent text-accent-fg"
                  }`
                : `metro-badge relative flex items-center justify-center rounded-2xl font-semibold tabular-nums ${sizeCls} ${
                    isMuted
                      ? "border border-dashed border-line bg-header text-muted line-through opacity-55"
                      : isAccent
                        ? "border-2 text-fg"
                        : "border border-line bg-surface text-muted"
                  }`;

              if (plan) {
                return (
                  <span key={index} style={baseStyle} className={cls}>
                    {index + 1}
                  </span>
                );
              }

              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => toggleBeatAccent(index)}
                  aria-label={`Slag ${index + 1}: ${ACCENT_LABEL_NB[mode]}`}
                  title={`Slag ${index + 1}: ${ACCENT_LABEL_NB[mode]} (trykk for å endre)`}
                  style={baseStyle}
                  className={`${cls} metro-press`}
                >
                  {isAccent && !isBeat ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 size-1.5 rounded-full bg-accent"
                    />
                  ) : null}
                  <span>{index + 1}</span>
                </button>
              );
            })}
          </div>
          {!plan ? (
            <p className="text-center text-[11px] text-muted">
              Trykk på slag for å veksle mellom aksent, vanlig og stille
            </p>
          ) : null}
        </div>

        {/* Stand-mode compact tempo bar */}
        {standMode ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => changeBpm(shownBpm - 5)}
              aria-label="Senk tempo 5"
              className="metro-press min-h-14 min-w-14 flex-1 rounded-xl border border-line bg-surface text-base font-semibold"
            >
              −5
            </button>
            <button
              type="button"
              onClick={() => changeBpm(shownBpm - 1)}
              aria-label="Senk tempo"
              className="metro-press min-h-14 min-w-14 flex-1 rounded-xl border border-line bg-surface text-xl"
            >
              −
            </button>
            <button
              type="button"
              onClick={handleTap}
              style={{
                borderColor: "rgb(var(--color-accent-rgb) / 0.45)",
                backgroundColor: "rgb(var(--color-accent-rgb) / 0.12)",
              }}
              className="metro-press min-h-14 flex-[1.6] rounded-xl border px-4 text-base font-semibold text-accent"
            >
              Tap tempo
            </button>
            <button
              type="button"
              onClick={() => changeBpm(shownBpm + 1)}
              aria-label="Øk tempo"
              className="metro-press min-h-14 min-w-14 flex-1 rounded-xl border border-line bg-surface text-xl"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => changeBpm(shownBpm + 5)}
              aria-label="Øk tempo 5"
              className="metro-press min-h-14 min-w-14 flex-1 rounded-xl border border-line bg-surface text-base font-semibold"
            >
              +5
            </button>
          </div>
        ) : null}

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
            disabled={!(pulse.owner === "metronom" || (owns && planMalletBlock()))}
            style={plan ? ({ "--block": BLOCK_COLOR[block] } as CSSProperties) : undefined}
            className="metro-press min-h-14 rounded-xl border border-[var(--block,var(--color-accent))] bg-surface text-base font-semibold text-fg disabled:border-line disabled:bg-header disabled:text-muted md:min-h-16 md:text-lg"
          >
            Stopp
          </button>
        </div>
      </div>

      {!standMode ? (
        <div className="mt-4 space-y-4 md:mt-0">
          {/* Tempo Controls */}
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
                style={{
                  borderColor: "rgb(var(--color-accent-rgb) / 0.45)",
                  backgroundColor: "rgb(var(--color-accent-rgb) / 0.12)",
                }}
                className="metro-press min-h-12 flex-[1.6] rounded-lg border px-4 text-sm font-semibold text-accent md:min-h-14 md:text-base"
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
                  style={
                    shownBpm === preset
                      ? { backgroundColor: "rgb(var(--color-accent-rgb) / 0.14)" }
                      : undefined
                  }
                  className={
                    shownBpm === preset
                      ? "metro-press min-h-10 rounded-lg border border-accent text-sm font-semibold text-accent tabular-nums"
                      : "metro-press min-h-10 rounded-lg border border-line bg-header text-sm font-medium text-muted tabular-nums hover:text-fg"
                  }
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Meter, Subdivision & Gap Trainer */}
          <div className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-card)] md:p-5">
            <p className="text-sm font-medium text-muted">Taktart</p>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 md:gap-2" role="group" aria-label="Taktart">
              {METERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => changeMeter(item)}
                  aria-pressed={item === shownMeter}
                  style={
                    item === shownMeter
                      ? { backgroundColor: "rgb(var(--color-accent-rgb) / 0.14)" }
                      : undefined
                  }
                  className={
                    item === shownMeter
                      ? "metro-press min-h-11 rounded-lg border border-accent text-sm font-semibold text-accent md:min-h-12 md:text-base"
                      : "metro-press min-h-11 rounded-lg border border-line bg-header text-sm text-muted hover:text-fg md:min-h-12 md:text-base"
                  }
                >
                  {item}
                </button>
              ))}
            </div>

            <p className="text-sm font-medium text-muted">Underdeling</p>
            <div className="grid grid-cols-4 gap-1.5 md:gap-2" role="group" aria-label="Underdeling">
              {SUBDIVISIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => changeSubdivision(item)}
                  aria-pressed={item === shownSub}
                  style={
                    item === shownSub
                      ? { backgroundColor: "rgb(var(--color-accent-rgb) / 0.14)" }
                      : undefined
                  }
                  className={
                    item === shownSub
                      ? "metro-press min-h-11 rounded-lg border border-accent text-sm font-semibold text-accent md:min-h-12 md:text-base"
                      : "metro-press min-h-11 rounded-lg border border-line bg-header text-sm text-muted hover:text-fg md:min-h-12 md:text-base"
                  }
                >
                  {SUB_LABELS[item]}
                </button>
              ))}
            </div>

            {!plan ? (
              <>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <p className="text-sm font-medium text-muted">Stille takter (indre puls)</p>
                  <span className="text-[11px] text-muted">{getGapPreset(gapPreset).description}</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Stille takter">
                  {GAP_PRESETS.map((preset) => {
                    const active = gapPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        title={preset.description}
                        aria-pressed={active}
                        onClick={() => changeGapPreset(preset.id)}
                        style={
                          active
                            ? { backgroundColor: "rgb(var(--color-accent-rgb) / 0.14)" }
                            : undefined
                        }
                        className={
                          active
                            ? "metro-press min-h-10 rounded-lg border border-accent text-xs font-bold text-accent"
                            : "metro-press min-h-10 rounded-lg border border-line bg-header text-xs font-medium text-muted hover:text-fg"
                        }
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>

          {/* Click Sound & Volume */}
          <div className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-[var(--shadow-card)] md:p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
                <Volume2 className="size-4 text-accent" aria-hidden="true" />
                Klikkelyd & volum
              </span>
              <span className="text-xs font-semibold text-fg tabular-nums">{Math.round(clickVolume * 100)}%</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Klikkelyd">
              {CLICK_SOUND_OPTIONS.map((opt) => {
                const active = clickSound === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.description}
                    aria-pressed={active}
                    onClick={() => changeSound(opt.id)}
                    style={
                      active
                        ? { backgroundColor: "rgb(var(--color-accent-rgb) / 0.14)" }
                        : undefined
                    }
                    className={
                      active
                        ? "metro-press min-h-10 rounded-lg border border-accent text-xs font-bold text-accent"
                        : "metro-press min-h-10 rounded-lg border border-line bg-header text-xs font-medium text-muted hover:text-fg"
                    }
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(clickVolume * 100)}
              onChange={(e) => changeVolume(Number(e.target.value) / 100)}
              aria-label="Klikkvolum"
              className="h-2 w-full cursor-pointer accent-accent"
            />
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
              <ul className="space-y-2 text-sm text-fg sm:space-y-2.5">
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
      ) : null}
    </div>
  );
}
