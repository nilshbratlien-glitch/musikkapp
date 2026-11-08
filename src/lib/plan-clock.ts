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
} from "@/lib/oveplan";

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
  metroTimer: number | null;
  metroNext: number;
  metroCount: number;
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
    metroTimer: null,
    metroNext: 0,
    metroCount: 0,
    taps: [],
    live: "Klar",
    startLabel: "Start",
    logOpen: false,
    presetName: "",
    logNote: "",
    wake: null,
  };
}

let metroHooks = {
  stop: () => {},
  start: () => {},
};

const clock = freshClock();

export function bindPlanMetro(hooks: { stop: () => void; start: () => void }) {
  metroHooks = hooks;
}
let ready = false;
let version = 0;
let audioCtx: AudioContext | null = null;
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

export function stopTimer() {
  if (clock.timer != null) window.clearInterval(clock.timer);
  clock.timer = null;
}

function persist() {
  savePlanStore(clock.store);
}

function audio() {
  const Context = window.AudioContext;
  if (!Context) return null;
  if (!audioCtx) audioCtx = new Context();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
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

function findItem(id: string) {
  return clock.store.items.find((item) => item.id === id) ?? null;
}

function saveBlockBpm(id: string | null) {
  if (!id) return;
  clock.store.bpmMap[id] = clock.store.bpm;
  persist();
}

export function setPlanBpm(value: number) {
  clock.store.bpm = clampBpm(value);
  persist();
  touchPlanClock();
}

function applyBlockBpm(id: string) {
  const saved = clock.store.bpmMap[id];
  if (saved) setPlanBpm(saved);
}

function markDone(id: string) {
  if (!clock.store.done.includes(id)) clock.store.done = [...clock.store.done, id];
  persist();
}

function chime() {
  try {
    navigator.vibrate?.([40, 80, 120]);
  } catch {
    /* ignore */
  }
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime;
  const tone = (freq: number, when: number, dur: number, vol: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  };
  tone(523.25, start, 0.2, 0.22);
  tone(783.99, start + 0.18, 0.42, 0.26);
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
  syncWake();
  touchPlanClock();
}

export function endCurrent(justId: string) {
  clock.metroHeld = false;
  if (clock.metroRunning) metroHooks.stop();
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
    chime();
    endCurrent(id);
    return;
  }
  touchPlanClock();
}

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
  audio();
  if (!quiet) {
    try {
      navigator.vibrate?.(25);
    } catch {
      /* ignore */
    }
  }
  clock.startLabel = "Pause";
  startTimer();
  syncWake();
  tick();
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
    metroHooks.stop();
  }
  clock.live = `${blockName(clock.activeId)} — ${fmtClock(clock.blockLeft)}`;
  clock.startLabel = "Fortsett";
  syncWake();
  touchPlanClock();
}

export function resumeBlock() {
  if (!clock.activeId || remainingMs() <= 0) return;
  clock.forceSetup = false;
  clock.blockPaused = false;
  clock.blockEndsAt = Date.now() + clock.blockRemainMs;
  clock.startLabel = "Pause";
  syncLeft();
  startTimer();
  if (clock.metroHeld) {
    clock.metroHeld = false;
    metroHooks.start();
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
    if (clock.metroRunning) metroHooks.stop();
    clearClock();
    clock.startLabel = "Start";
    clock.live = "Ferdig";
    saveSession("");
    syncWake();
    touchPlanClock();
    return;
  }
  beginBlock(next);
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

export function planClockRunning() {
  return !!clock.activeId && clock.timer != null && !clock.blockPaused;
}
