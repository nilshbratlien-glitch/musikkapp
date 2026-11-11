import {
  blockName,
  emptyPlanStore,
  fmtClock,
  loadPlanStore,
  nextUndone,
  playingSum,
  savePlanStore,
  todayStamp,
  clampBpm,
  countdownSeconds,
  type PlanItem,
  type PlanLog,
  type PlanStore,
  blockTool,
  playsMetronome,
  type BlockId,
  BLOCK_COLOR,
} from "./oveplan.ts";
import { chime, getState as pulseState, type PulseStart, setBpm as pulseBpm, setMeter as pulseMeter, onStall, start as pulseStart, stop as pulseStop, subscribe as subscribePulse } from "./pulse.ts";

export type PlanClock = {
  store: PlanStore;
  activeId: string | null;
  forceSetup: boolean;
  blockLeft: number;
  blockPaused: boolean;
  blockEndsAt: number;
  blockRemainMs: number;
  timer: number | null;
  metroRunning: boolean;
  metroHeld: boolean;
  taps: number[];
  live: string;
  startLabel: string;
  logOpen: boolean;
  presetName: string;
  logNote: string;
  wake: WakeLockSentinel | null;
};

function freshClock(): PlanClock {
  return {
    store: emptyPlanStore(),
    activeId: null,
    forceSetup: false,
    blockLeft: 0,
    blockPaused: false,
    blockEndsAt: 0,
    blockRemainMs: 0,
    timer: null,
    metroRunning: false,
    metroHeld: false,
    taps: [],
    live: "Klar",
    startLabel: "Start",
    logOpen: false,
    presetName: "",
    logNote: "",
    wake: null,
  };
}

const clock = freshClock();

let navigate: (to: string) => void = () => {};

/** The shell hands in client-side routing, so blocks can open their tool without a reload. */
export function bindPlanNavigate(fn: (to: string) => void) {
  navigate = fn;
}

export type PlanBroadcastHook = {
  onStart?: (item: PlanItem, endsAt: number) => void;
  onArm?: (item: PlanItem) => void;
  onPause?: (remainMs: number) => void;
  onResume?: (endsAt: number) => void;
  onStop?: () => void;
  onBpm?: (bpm: number) => void;
  onMeter?: (beats: number, sub: number) => void;
};

let planBroadcastHook: PlanBroadcastHook | null = null;

export function setPlanBroadcastHook(hook: PlanBroadcastHook) {
  planBroadcastHook = hook;
}

let ready = false;
let version = 0;
const listeners = new Set<() => void>();

export function getPlanClock() {
  return clock;
}

export function getPlanClockVersion() {
  return version;
}

export function subscribePlanClock(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function touchPlanClock() {
  version += 1;
  for (const listener of listeners) listener();
}

export function ensurePlanClock() {
  if (ready) return clock;
  ready = true;
  clock.store = loadPlanStore();
  savePlanStore(clock.store);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  subscribePulse(followPulse);
  // The pulse gave up (its audio clock stood still), whoever played: pause the block like the pause button
  // does, keep the time left, and let the next Start/Play carry on (the plan's own metronome again).
  onStall((owner) => {
    const running = !!clock.activeId && !clock.blockPaused && clock.timer != null;
    pauseBlock();
    if (running && owner === "oveplan") clock.metroHeld = true;
  });
  return clock;
}

function remainingMs() {
  if (clock.blockPaused) return Math.max(0, clock.blockRemainMs);
  if (clock.blockEndsAt) return Math.max(0, clock.blockEndsAt - Date.now());
  return Math.max(0, clock.blockLeft * 1000);
}

export function syncLeft() {
  clock.blockLeft = countdownSeconds(Date.now(), clock.blockEndsAt, clock.blockRemainMs, clock.blockPaused);
  return remainingMs();
}

/** BPM or meter changed from another tab while the plan owns the metronome: keep the plan in step. */
function followPulse() {
  const pulse = pulseState();
  if (pulse.owner !== "oveplan") return;
  const bpm = clampBpm(pulse.bpm);
  if (bpm === clock.store.bpm && pulse.beats === clock.store.beats && pulse.sub === clock.store.sub) return;
  clock.store.bpm = bpm;
  clock.store.beats = pulse.beats;
  clock.store.sub = pulse.sub;
  persist();
  touchPlanClock();
}

export function startPlanMetro() {
  const started = pulseStart({
    owner: "oveplan",
    bpm: clock.store.bpm,
    beats: clock.store.beats,
    sub: clock.store.sub,
    onStop: () => {
      clock.metroRunning = false;
      syncWake();
      touchPlanClock();
    },
  });
  clock.metroRunning = started;
  syncWake();
  touchPlanClock();
}

export function stopPlanMetro() {
  pulseStop("oveplan");
}

export function togglePlanMetro() {
  if (clock.metroRunning) stopPlanMetro();
  else startPlanMetro();
}

export function setPlanMeter(beats: number, sub: number) {
  clock.store.beats = beats;
  clock.store.sub = sub;
  persist();
  if (clock.metroRunning) pulseMeter(beats, sub);
  touchPlanClock();
  planBroadcastHook?.onMeter?.(beats, sub);
}

export function stopTimer() {
  if (clock.timer != null) window.clearInterval(clock.timer);
  clock.timer = null;
}

function persist() {
  savePlanStore(clock.store);
}

function wantAwake() {
  return clock.metroRunning || (!!clock.activeId && !clock.blockPaused && clock.timer != null);
}

export function syncWake() {
  const on = wantAwake();
  if (!navigator.wakeLock) return;
  if (!on) {
    const lock = clock.wake;
    clock.wake = null;
    void lock?.release().catch(() => {});
    return;
  }
  if (clock.wake) return;
  void navigator.wakeLock.request("screen").then((lock) => {
    if (!wantAwake()) {
      void lock.release().catch(() => {});
      return;
    }
    clock.wake = lock;
  }).catch(() => {});
}

export function clearClock() {
  stopTimer();
  clock.blockEndsAt = 0;
  clock.blockRemainMs = 0;
  clock.blockLeft = 0;
  clock.blockPaused = false;
}

function saveBlockBpm(id: string | null) {
  if (!id) return;
  clock.store.bpmMap[id] = clock.store.bpm;
  persist();
}

export function setPlanBpm(value: number) {
  clock.store.bpm = clampBpm(value);
  persist();
  if (clock.metroRunning) pulseBpm(clock.store.bpm);
  touchPlanClock();
  planBroadcastHook?.onBpm?.(clock.store.bpm);
}

function applyBlockBpm(id: string) {
  const saved = clock.store.bpmMap[id];
  if (saved) setPlanBpm(saved);
}

function markDone(id: string) {
  if (!clock.store.done.includes(id)) clock.store.done = [...clock.store.done, id];
  persist();
}

function buzz() {
  try {
    navigator.vibrate?.([40, 80, 120]);
  } catch {
    /* ignore */
  }
}

function saveSession(note: string) {
  const doneNames = clock.store.done.map(blockName);
  if (!doneNames.length && !note) return;
  const entry: PlanLog = {
    t: Date.now(),
    playing: playingSum(clock.store.items),
    done: doneNames,
    planned: clock.store.items.filter((item) => item.on && !item.skipped && item.mins > 0).map((item) => `${blockName(item.id)} ${item.mins}m`),
    note,
  };
  clock.store.log = [entry, ...clock.store.log].slice(0, 60);
  persist();
}

function armBlock(next: PlanItem) {
  clock.forceSetup = false;
  clock.activeId = next.id;
  clock.blockRemainMs = Math.max(0, next.mins * 60 * 1000);
  clock.blockEndsAt = 0;
  clock.blockPaused = true;
  clock.metroHeld = false;
  stopTimer();
  syncLeft();
  applyBlockBpm(next.id);
  clock.startLabel = "Start";
  clock.live = blockName(next.id);
  openBlockTool(next.id);
  syncWake();
  touchPlanClock();
  planBroadcastHook?.onArm?.(next);
}

function openBlockTool(id: BlockId) {
  const to = blockTool(id);
  if (to) navigate(to);
}

/** A block's own sound: 2- and 4-mallet run the metronome, the others stop the previous block's. */
function blockSound(id: BlockId) {
  if (playsMetronome(id)) startPlanMetro();
  else stopPlanMetro();
}

export function endCurrent(justId: string) {
  clock.metroHeld = false;
  stopPlanMetro();
  const next = nextUndone(clock.store.items, clock.store.done, justId);
  if (!next) {
    clock.activeId = null;
    clock.forceSetup = false;
    clearClock();
    clock.startLabel = "Start";
    clock.live = "Ferdig";
    saveSession("");
    syncWake();
    touchPlanClock();
    planBroadcastHook?.onStop?.();
    return;
  }
  armBlock(next);
}

function tick() {
  const id = clock.activeId;
  if (!id) {
    stopTimer();
    syncWake();
    return;
  }
  const ms = syncLeft();
  clock.live = `${blockName(id)} — ${fmtClock(clock.blockLeft)}`;
  if (ms <= 0) {
    saveBlockBpm(id);
    markDone(id);
    buzz();
    endCurrent(id);
    chime();
    return;
  }
  touchPlanClock();
}

/** Idempotent: there is only ever one countdown interval, and it reads time from blockEndsAt. */
function startTimer() {
  stopTimer();
  clock.timer = window.setInterval(tick, 200);
}

export function beginBlock(next: PlanItem, quiet = false) {
  if (clock.activeId && clock.activeId !== next.id) saveBlockBpm(clock.activeId);
  clock.forceSetup = false;
  clock.activeId = next.id;
  clock.blockRemainMs = Math.max(0, next.mins * 60 * 1000);
  clock.blockEndsAt = Date.now() + clock.blockRemainMs;
  clock.blockPaused = false;
  clock.metroHeld = false;
  applyBlockBpm(next.id);
  if (!quiet) {
    try {
      navigator.vibrate?.(25);
    } catch {
      /* ignore */
    }
  }
  clock.startLabel = "Pause";
  startTimer();
  openBlockTool(next.id);
  blockSound(next.id);
  syncWake();
  tick();
  planBroadcastHook?.onStart?.(next, clock.blockEndsAt);
}

export function pauseBlock() {
  if (!clock.activeId || clock.blockPaused || clock.timer == null) return;
  clock.blockRemainMs = remainingMs();
  clock.blockPaused = true;
  clock.blockEndsAt = 0;
  stopTimer();
  syncLeft();
  if (clock.metroRunning) {
    clock.metroHeld = true;
    stopPlanMetro();
  }
  clock.live = `${blockName(clock.activeId)} — ${fmtClock(clock.blockLeft)}`;
  clock.startLabel = "Fortsett";
  syncWake();
  touchPlanClock();
  planBroadcastHook?.onPause?.(clock.blockRemainMs);
}

export function resumeBlock() {
  if (!clock.activeId || remainingMs() <= 0) return;
  clock.forceSetup = false;
  clock.blockPaused = false;
  clock.blockEndsAt = Date.now() + clock.blockRemainMs;
  clock.startLabel = "Pause";
  syncLeft();
  startTimer();
  if (clock.metroHeld || playsMetronome(clock.activeId)) {
    clock.metroHeld = false;
    startPlanMetro();
  }
  syncWake();
  touchPlanClock();
  planBroadcastHook?.onResume?.(clock.blockEndsAt);
}

/** Remote control methods invoked when receiving commands from a paired controller. */
export function beginBlockRemote(
  blockId: BlockId,
  mins: number,
  bpm: number,
  beats: number,
  sub: number,
  endsAt: number,
) {
  if (clock.activeId && clock.activeId !== blockId) saveBlockBpm(clock.activeId);
  clock.forceSetup = false;
  clock.activeId = blockId;
  clock.blockEndsAt = endsAt;
  clock.blockRemainMs = Math.max(0, endsAt - Date.now());
  clock.blockPaused = false;
  clock.metroHeld = false;
  clock.store.bpm = clampBpm(bpm);
  clock.store.beats = beats;
  clock.store.sub = sub;
  clock.startLabel = "Pause";
  startTimer();
  blockSound(blockId);
  syncWake();
  tick();
}

export function armBlockRemote(
  blockId: BlockId,
  mins: number,
  bpm: number,
  beats: number,
  sub: number,
) {
  if (clock.activeId && clock.activeId !== blockId) saveBlockBpm(clock.activeId);
  clock.forceSetup = false;
  clock.activeId = blockId;
  clock.blockRemainMs = Math.max(0, mins * 60 * 1000);
  clock.blockEndsAt = 0;
  clock.blockPaused = true;
  clock.metroHeld = false;
  clock.store.bpm = clampBpm(bpm);
  clock.store.beats = beats;
  clock.store.sub = sub;
  stopTimer();
  stopPlanMetro();
  syncLeft();
  clock.startLabel = "Start";
  clock.live = blockName(blockId);
  syncWake();
  touchPlanClock();
}

export function stopPlanRemote() {
  clock.activeId = null;
  clock.forceSetup = false;
  clock.metroHeld = false;
  stopPlanMetro();
  clearClock();
  clock.startLabel = "Start";
  clock.live = "Ferdig";
  syncWake();
  touchPlanClock();
}

export function pauseBlockRemote(remainMs: number) {
  if (!clock.activeId) return;
  clock.blockRemainMs = remainMs;
  clock.blockPaused = true;
  clock.blockEndsAt = 0;
  stopTimer();
  syncLeft();
  if (clock.metroRunning) {
    clock.metroHeld = true;
    stopPlanMetro();
  }
  clock.live = `${blockName(clock.activeId)} — ${fmtClock(clock.blockLeft)}`;
  clock.startLabel = "Fortsett";
  syncWake();
  touchPlanClock();
}

export function resumeBlockRemote(endsAt: number) {
  if (!clock.activeId) return;
  clock.forceSetup = false;
  clock.blockPaused = false;
  clock.blockEndsAt = endsAt;
  clock.blockRemainMs = Math.max(0, endsAt - Date.now());
  clock.startLabel = "Pause";
  syncLeft();
  startTimer();
  if (clock.metroHeld || playsMetronome(clock.activeId)) {
    clock.metroHeld = false;
    startPlanMetro();
  }
  syncWake();
  touchPlanClock();
}

export function togglePlanClock() {
  if (clock.activeId && clock.timer != null && !clock.blockPaused) {
    pauseBlock();
    return;
  }
  if (clock.activeId && clock.blockPaused && remainingMs() > 0 && !clock.store.done.includes(clock.activeId)) {
    resumeBlock();
    return;
  }
  const next = nextUndone(clock.store.items, clock.store.done, null);
  if (!next) {
    clock.activeId = null;
    stopPlanMetro();
    clearClock();
    clock.startLabel = "Start";
    clock.live = "Ferdig";
    saveSession("");
    syncWake();
    touchPlanClock();
    planBroadcastHook?.onStop?.();
    return;
  }
  beginBlock(next);
}

/** Nullstill: forget today's progress and stop the clock and the plan's metronome. */
export function resetPlan() {
  clock.store.done = [];
  clock.activeId = null;
  clock.forceSetup = false;
  clock.metroHeld = false;
  stopPlanMetro();
  clock.store.items = clock.store.items.map((item) => ({ ...item, skipped: false }));
  clearClock();
  clock.startLabel = "Start";
  clock.live = "Klar";
  clock.store.sessionDate = todayStamp();
  persist();
  syncWake();
  touchPlanClock();
  planBroadcastHook?.onStop?.();
}

export function finishPlanBlock() {
  const id = clock.activeId;
  if (!id) return;
  saveBlockBpm(id);
  markDone(id);
  endCurrent(id);
}

function onVisible() {
  if (document.visibilityState !== "visible") {
    const lock = clock.wake;
    clock.wake = null;
    void lock?.release().catch(() => {});
    return;
  }
  if (!clock.activeId) {
    const today = todayStamp();
    if (clock.store.sessionDate !== today) {
      clock.store.done = [];
      clock.store.items = clock.store.items.map((item) => ({ ...item, skipped: false }));
      clock.store.sessionDate = today;
      persist();
      touchPlanClock();
    }
  }
  syncWake();
  if (clock.activeId && !clock.blockPaused && clock.timer != null) tick();
}

/** A 2- or 4-mallet block is active (running or paused): the Metronom tab is the plan's. */
export function planMalletBlock() {
  return !!clock.activeId && playsMetronome(clock.activeId);
}

/** Metronom's Start: in a 2-/4-mallet block it resumes the block at the block's tempo, otherwise `local` starts. */
export function startFromMetronom(local: PulseStart) {
  if (!planMalletBlock()) {
    pulseStart(local);
    return;
  }
  if (clock.blockPaused || clock.timer == null) resumeBlock();
  else startPlanMetro();
}

/** Metronom's Stopp: pauses a running 2-/4-mallet block like the header does, otherwise stops only the tab's own clicks. */
export function stopFromMetronom() {
  if (planMalletBlock() && planClockRunning()) pauseBlock();
  else pulseStop("metronom");
}

/**
 * Bladlesing's Play: a paused SRF block carries on with the time it had left.
 * This is the only way Bladlesing touches the plan; nothing there pauses it.
 */
export function resumeFromBladlesing() {
  const id = clock.activeId;
  if (id !== "srf" || !clock.blockPaused || clock.store.done.includes(id)) return false;
  // Play brings its own clicks; a held plan metronome would only be replaced by them.
  clock.metroHeld = false;
  resumeBlock();
  return !clock.blockPaused;
}

/** The active block's colour token, so Bladlesing's status line matches the header pill. */
export function activeBlockColor() {
  return clock.activeId ? BLOCK_COLOR[clock.activeId as BlockId] : null;
}

export const MusikkPlan = { resumeFromBladlesing, activeBlockColor };

declare global {
  interface Window {
    MusikkPlan?: typeof MusikkPlan;
  }
}

if (typeof window !== "undefined") window.MusikkPlan = MusikkPlan;

export function planClockRunning() {
  return !!clock.activeId && clock.timer != null && !clock.blockPaused;
}
