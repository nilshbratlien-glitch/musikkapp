import { clickStep } from "./metronome.ts";

/**
 * The one metronome and sound core: a single AudioContext, a single output bus and
 * a single active owner. Starting a new owner stops the previous one (onStop
 * "replaced") and cuts everything it had scheduled.
 */
export type PulseOwner = "metronom" | "snare" | "oveplan" | "bladlesing";
export type PulseStopReason = "stopped" | "replaced" | "stalled";
export type PulseClick = { tick: number; time: number; accent: boolean; downbeat: boolean; beatIndex: number };
export type PulseStart = {
  owner: PulseOwner;
  bpm: number;
  beats?: number;
  sub?: number;
  /** AudioContext time of the first click; defaults to just after now. */
  at?: number;
  /** Stop scheduling clicks after this many; the owner keeps the bus until stop(). */
  count?: number;
  onClick?: (click: PulseClick) => void;
  onStop?: (reason: PulseStopReason) => void;
};
export type PulseState = {
  owner: PulseOwner | null;
  running: boolean;
  bpm: number;
  beats: number;
  sub: number;
  /** Beat of the latest scheduled downbeat, -1 when stopped. */
  beat: number;
};

const LOOKAHEAD_MS = 25;
const AHEAD_S = 0.1;
/** A click this late means the clock jumped (background tab, sleep), not a slow loop. */
const LATE_S = 0.05;
/** A context that is not running, or whose clock stands still, this long gets one resume(); after another such wait playback stops. */
const STALL_MS = 600;

let ctx: AudioContext | null = null;
/** The context did not run again after resume(), so the next Start/Play replaces it. */
let spent = false;
let bus: GainNode | null = null;
let clickBus: GainNode | null = null;
let clicksOn = true;
let timer: ReturnType<typeof setTimeout> | null = null;
let run: (PulseStart & { next: number; tick: number; seenTime?: number; seenAt?: number; passAt?: number; resumed?: boolean }) | null = null;
let state: PulseState = { owner: null, running: false, bpm: 80, beats: 4, sub: 1, beat: -1 };
const listeners = new Set<() => void>();

function emit(patch: Partial<PulseState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function getState() {
  return state;
}

const stallListeners = new Set<(owner: PulseOwner | null) => void>();

/** Called after the pulse stopped by itself ("stalled"), whoever owned it. Returns the unsubscribe. */
export function onStall(listener: (owner: PulseOwner | null) => void) {
  stallListeners.add(listener);
  return () => {
    stallListeners.delete(listener);
  };
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The shared AudioContext, created on first use. A context that is not running gets resume(). */
export function audio() {
  if (ctx?.state === "closed") forget();
  if (!ctx) {
    const Context = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    ctx = new Context();
  }
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return ctx;
}

/**
 * The context for a Play/Start tap. A suspended one just gets resume(). One that is interrupted
 * (iOS, after the screen lock), closed, or marked spent by a stall is replaced here, inside the
 * user gesture: a context made later would start suspended and could not be resumed.
 */
export function unlock() {
  const now = ctx?.state as string | undefined;
  if (ctx && (spent || now === "interrupted" || now === "closed")) renew();
  return audio();
}

function forget() {
  spent = false;
  ctx = null;
  bus = null;
  clickBus = null;
}

/** Close the context and make a new one; nodes on the bus are rebuilt on next use. Only call it inside a user gesture. */
export function renew() {
  const old = ctx;
  forget();
  void old?.close().catch(() => {});
  return audio();
}

/** The one output bus. Every sound connects here; stop() disconnects it. */
let masterMuted = false;

export function output() {
  const c = audio();
  if (!c) return null;
  if (!bus) {
    bus = c.createGain();
    bus.gain.value = masterMuted ? 0 : 1;
    bus.connect(c.destination);
    clickBus = c.createGain();
    clickBus.gain.value = clicksOn ? 1 : 0;
    clickBus.connect(bus);
  }
  return bus;
}

function cut() {
  if (!bus || !ctx) return;
  try {
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.disconnect();
  } catch {
    /* already disconnected */
  }
  bus = null;
  clickBus = null;
}

/** Master mute for follower/controller sync (prevents double-click echo across devices). */
export function setMasterMuted(muted: boolean) {
  masterMuted = muted;
  if (bus && ctx) {
    bus.gain.setValueAtTime(muted ? 0 : 1, ctx.currentTime);
  }
}

/** Mute or unmute clicks without touching other sound on the bus. */
export function setClicks(on: boolean) {
  clicksOn = on;
  if (clickBus && ctx) clickBus.gain.setValueAtTime(on ? 1 : 0, ctx.currentTime);
}

function click(c: AudioContext, time: number, kind: "accent" | "beat" | "sub") {
  output();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(clickBus!);
  osc.frequency.value = kind === "accent" ? 1200 : kind === "beat" ? 800 : 640;
  gain.gain.setValueAtTime(kind === "accent" ? 0.35 : kind === "beat" ? 0.2 : 0.09, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
  osc.start(time);
  osc.stop(time + 0.05);
}

function loop() {
  timer = null;
  const live = run;
  const c = ctx;
  if (!live || !c) return;
  // A context that is not running (iOS suspended or interrupted it, e.g. after the screen was locked)
  // has a frozen clock: nothing is scheduled until it runs. After a wait it gets one resume(); if
  // the clock still stands, playback stops (the UI shows it) and the next Start/Play replaces the context.
  const now = Date.now();
  // Our own timer was frozen too (screen locked, tab asleep): that is not a stall yet.
  if (live.passAt !== undefined && now - live.passAt > 10 * LOOKAHEAD_MS) live.seenAt = now;
  live.passAt = now;
  if (c.state === "running" && c.currentTime !== live.seenTime) {
    live.seenTime = c.currentTime;
    live.seenAt = now;
    live.resumed = false;
  } else live.seenAt ??= now;
  if (now - live.seenAt > STALL_MS) {
    if (masterMuted) {
      live.seenAt = now;
    } else if (live.resumed) {
      spent = true;
      const owner = state.owner;
      stop(undefined, "stalled");
      for (const listener of stallListeners) listener(owner);
      return;
    } else {
      live.resumed = true;
      live.seenAt = now;
      void c.resume().catch(() => {});
    }
  }
  if (c.state !== "running") {
    timer = setTimeout(loop, LOOKAHEAD_MS);
    return;
  }
  const late = c.currentTime - live.next;
  if (late > LATE_S) {
    // Skip the clicks the jump swallowed instead of playing them in one burst. Ticks count
    // on by the skipped clicks, so the bar position (and the accent) stays where time puts it.
    // A click at most LATE_S old still plays (it was due just now); older ones are skipped.
    const period = 60 / state.bpm / state.sub;
    let missed = Math.floor(late / period);
    if (late - missed * period > LATE_S) missed += 1;
    live.tick += missed;
    live.next += missed * period;
  }
  while (live.next < c.currentTime + AHEAD_S) {
    if (live.count != null && live.tick >= live.count) return;
    const step = clickStep(live.tick, state.beats, state.sub);
    const time = live.next;
    click(c, time, step.accent ? "accent" : step.downbeat ? "beat" : "sub");
    if (step.downbeat) emit({ beat: step.beatIndex });
    live.onClick?.({ tick: live.tick, time, accent: step.accent, downbeat: step.downbeat, beatIndex: step.beatIndex });
    if (run !== live) return;
    live.tick = step.tick;
    live.next += 60 / state.bpm / state.sub;
  }
  timer = setTimeout(loop, LOOKAHEAD_MS);
}

/** Make `opts.owner` the only sound owner and start its clicks. */
export function start(opts: PulseStart) {
  const c = unlock();
  if (!c) return false;
  stop(undefined, "replaced");
  const beats = Math.max(1, opts.beats ?? 4);
  const sub = Math.max(1, opts.sub ?? 1);
  run = { ...opts, next: opts.at ?? c.currentTime + 0.05, tick: 0 };
  clicksOn = true;
  output();
  emit({ owner: opts.owner, running: true, bpm: Math.max(1, opts.bpm), beats, sub, beat: -1 });
  loop();
  return true;
}

/** Stop the current owner (or only `owner`, if given) and silence the bus. */
export function stop(owner?: PulseOwner, reason: PulseStopReason = "stopped") {
  if (!state.running) return false;
  if (owner && state.owner !== owner) return false;
  const live = run;
  if (timer != null) clearTimeout(timer);
  timer = null;
  run = null;
  cut();
  emit({ owner: null, running: false, beat: -1 });
  live?.onStop?.(reason);
  return true;
}

export function setBpm(bpm: number) {
  if (bpm > 0 && bpm !== state.bpm) emit({ bpm });
}

/** Change meter without restarting the bar: the next click keeps its beat, modulo the new beat count. */
export function setMeter(beats: number, sub: number) {
  const nextBeats = Math.max(1, beats);
  const nextSub = Math.max(1, sub);
  if (run) {
    const index = run.tick % (state.beats * state.sub);
    const beat = Math.floor(index / state.sub) % nextBeats;
    run.tick = beat * nextSub + ((index % state.sub) % nextSub);
  }
  emit({ beats: nextBeats, sub: nextSub });
}

/** Two-note end-of-block chime on the shared bus. */
export function chime() {
  const c = audio();
  const out = output();
  if (!c || !out) return;
  const begin = c.currentTime;
  const tone = (freq: number, when: number, dur: number, vol: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  };
  tone(523.25, begin, 0.2, 0.22);
  tone(783.99, begin + 0.18, 0.42, 0.26);
}

/**
 * Back in view: browsers suspend (or on iOS interrupt) audio while a page is hidden
 * or in the back/forward cache. Resume it if someone still owns the pulse.
 * Hiding the page (visibilitychange to hidden, pagehide) deliberately stops
 * nothing, so Øveplan keeps running; its countdown is computed from a timestamp.
 */
export function wake() {
  if (!ctx || !state.running) return false;
  const now = ctx.state as string;
  if (now !== "suspended" && now !== "interrupted") return false;
  void ctx.resume().catch(() => {});
  return true;
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wake();
  });
  window.addEventListener("pageshow", () => wake());
}

export const MusikkPulse = { start, stop, unlock, setBpm, setMeter, setClicks, chime, subscribe, getState, audio, output, wake };

declare global {
  interface Window {
    MusikkPulse?: typeof MusikkPulse;
  }
}

if (typeof window !== "undefined") window.MusikkPulse = MusikkPulse;
