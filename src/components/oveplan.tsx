import { useEffect, useRef, useState } from "react";
import {
  applyPreset,
  blockName,
  bpmFromTaps,
  bumpItem,
  clampBpm,
  emptyPlanStore,
  fmtClock,
  liveItems,
  loadPlanStore,
  nextUndone,
  playingSum,
  savePlanStore,
  todayStamp,
  type PlanItem,
  type PlanLog,
  type PlanPreset,
  type PlanStore,
} from "@/lib/oveplan";

type Clock = {
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

function freshClock(store: PlanStore): Clock {
  return {
    store,
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

export function Oveplan() {
  const clock = useRef<Clock>(freshClock(emptyPlanStore()));
  const audioRef = useRef<AudioContext | null>(null);
  const api = useRef({ tick: () => {}, metro: () => {} });
  const [, bump] = useState(0);
  const redraw = () => bump((n) => n + 1);

  function persist() {
    savePlanStore(clock.current.store);
  }

  function remainingMs() {
    const cur = clock.current;
    if (cur.blockPaused) return Math.max(0, cur.blockRemainMs);
    if (cur.blockEndsAt) return Math.max(0, cur.blockEndsAt - Date.now());
    return Math.max(0, cur.blockLeft * 1000);
  }

  function syncLeft() {
    const ms = remainingMs();
    clock.current.blockLeft = ms <= 0 ? 0 : Math.ceil(ms / 1000);
    return ms;
  }

  function stopTimer() {
    const cur = clock.current;
    if (cur.timer != null) window.clearInterval(cur.timer);
    cur.timer = null;
  }

  function audio() {
    const Context = window.AudioContext;
    if (!Context) return null;
    if (!audioRef.current) audioRef.current = new Context();
    if (audioRef.current.state === "suspended") void audioRef.current.resume();
    return audioRef.current;
  }

  function metroStop() {
    const cur = clock.current;
    cur.metroRunning = false;
    if (cur.metroTimer != null) window.clearTimeout(cur.metroTimer);
    cur.metroTimer = null;
    syncWake();
  }

  function clickAt(time: number, accent: boolean) {
    const ctx = audioRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1320 : 880;
    gain.gain.setValueAtTime(accent ? 0.22 : 0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  function metroLoop() {
    const cur = clock.current;
    const ctx = audioRef.current;
    if (!cur.metroRunning || !ctx) return;
    while (cur.metroNext < ctx.currentTime + 0.12) {
      clickAt(cur.metroNext, cur.metroCount % (cur.store.beats * cur.store.sub) === 0);
      cur.metroNext += 60 / cur.store.bpm / cur.store.sub;
      cur.metroCount += 1;
    }
    cur.metroTimer = window.setTimeout(() => api.current.metro(), 25);
  }
  api.current.metro = metroLoop;

  function metroStart() {
    const ctx = audio();
    if (!ctx) return;
    const cur = clock.current;
    cur.metroRunning = true;
    cur.metroCount = 0;
    cur.metroNext = ctx.currentTime + 0.05;
    syncWake();
    metroLoop();
    redraw();
  }

  function setBpm(value: number) {
    clock.current.store.bpm = clampBpm(value);
    persist();
    redraw();
  }

  function wantAwake() {
    const cur = clock.current;
    return cur.metroRunning || (!!cur.activeId && !cur.blockPaused && cur.timer != null);
  }

  function syncWake() {
    const cur = clock.current;
    const on = wantAwake();
    if (!navigator.wakeLock) return;
    if (!on) {
      const lock = cur.wake;
      cur.wake = null;
      void lock?.release().catch(() => {});
      return;
    }
    if (cur.wake) return;
    void navigator.wakeLock.request("screen").then((lock) => {
      if (!wantAwake()) {
        void lock.release().catch(() => {});
        return;
      }
      clock.current.wake = lock;
    }).catch(() => {});
  }

  function clearClock() {
    stopTimer();
    const cur = clock.current;
    cur.blockEndsAt = 0;
    cur.blockRemainMs = 0;
    cur.blockLeft = 0;
    cur.blockPaused = false;
  }

  function findItem(id: string) {
    return clock.current.store.items.find((item) => item.id === id) ?? null;
  }

  function replaceItem(next: PlanItem) {
    clock.current.store.items = clock.current.store.items.map((item) => (item.id === next.id ? next : item));
  }

  function saveBlockBpm(id: string | null) {
    if (!id) return;
    clock.current.store.bpmMap[id] = clock.current.store.bpm;
    persist();
  }

  function applyBlockBpm(id: string) {
    const saved = clock.current.store.bpmMap[id];
    if (saved) setBpm(saved);
  }

  function markDone(id: string) {
    const cur = clock.current;
    if (!cur.store.done.includes(id)) cur.store.done = [...cur.store.done, id];
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
    const cur = clock.current;
    const doneNames = cur.store.done.map(blockName);
    if (!doneNames.length && !note) return;
    const entry: PlanLog = {
      t: Date.now(),
      playing: playingSum(cur.store.items),
      done: doneNames,
      planned: liveItems(cur.store.items).map((item) => `${blockName(item.id)} ${item.mins}m`),
      note,
    };
    cur.store.log = [entry, ...cur.store.log].slice(0, 60);
    persist();
  }

  function armBlock(next: PlanItem) {
    const cur = clock.current;
    cur.forceSetup = false;
    cur.activeId = next.id;
    cur.blockRemainMs = Math.max(0, next.mins * 60 * 1000);
    cur.blockEndsAt = 0;
    cur.blockPaused = true;
    cur.metroHeld = false;
    stopTimer();
    syncLeft();
    applyBlockBpm(next.id);
    cur.startLabel = "Start";
    cur.live = blockName(next.id);
    syncWake();
    redraw();
  }

  function endCurrent(justId: string) {
    const cur = clock.current;
    cur.metroHeld = false;
    if (cur.metroRunning) metroStop();
    const next = nextUndone(cur.store.items, cur.store.done, justId);
    if (!next) {
      cur.activeId = null;
      cur.forceSetup = false;
      clearClock();
      cur.startLabel = "Start";
      cur.live = "Ferdig";
      saveSession("");
      syncWake();
      redraw();
      return;
    }
    armBlock(next);
  }

  function tick() {
    const cur = clock.current;
    const id = cur.activeId;
    if (!id) {
      stopTimer();
      syncWake();
      return;
    }
    const ms = syncLeft();
    cur.live = `${blockName(id)} — ${fmtClock(cur.blockLeft)}`;
    if (ms <= 0) {
      saveBlockBpm(id);
      markDone(id);
      chime();
      endCurrent(id);
      return;
    }
    redraw();
  }
  api.current.tick = tick;

  function startTimer() {
    stopTimer();
    clock.current.timer = window.setInterval(() => api.current.tick(), 200);
  }

  function beginBlock(next: PlanItem, quiet = false) {
    const cur = clock.current;
    if (cur.activeId && cur.activeId !== next.id) saveBlockBpm(cur.activeId);
    cur.forceSetup = false;
    cur.activeId = next.id;
    cur.blockRemainMs = Math.max(0, next.mins * 60 * 1000);
    cur.blockEndsAt = Date.now() + cur.blockRemainMs;
    cur.blockPaused = false;
    cur.metroHeld = false;
    applyBlockBpm(next.id);
    audio();
    if (!quiet) {
      try {
        navigator.vibrate?.(25);
      } catch {
        /* ignore */
      }
    }
    cur.startLabel = "Pause";
    startTimer();
    syncWake();
    tick();
  }

  function pauseBlock() {
    const cur = clock.current;
    if (!cur.activeId || cur.blockPaused || cur.timer == null) return;
    cur.blockRemainMs = remainingMs();
    cur.blockPaused = true;
    cur.blockEndsAt = 0;
    stopTimer();
    syncLeft();
    if (cur.metroRunning) {
      cur.metroHeld = true;
      metroStop();
    }
    cur.live = `${blockName(cur.activeId)} — ${fmtClock(cur.blockLeft)}`;
    cur.startLabel = "Fortsett";
    syncWake();
    redraw();
  }

  function resumeBlock() {
    const cur = clock.current;
    if (!cur.activeId || remainingMs() <= 0) return;
    cur.forceSetup = false;
    cur.blockPaused = false;
    cur.blockEndsAt = Date.now() + cur.blockRemainMs;
    cur.startLabel = "Pause";
    syncLeft();
    startTimer();
    if (cur.metroHeld) {
      cur.metroHeld = false;
      metroStart();
    }
    syncWake();
    redraw();
  }

  function onStart() {
    const cur = clock.current;
    if (cur.activeId && cur.timer != null && !cur.blockPaused) {
      pauseBlock();
      return;
    }
    if (cur.activeId && cur.blockPaused && remainingMs() > 0 && !cur.store.done.includes(cur.activeId)) {
      resumeBlock();
      return;
    }
    const next = nextUndone(cur.store.items, cur.store.done, null);
    if (!next) {
      cur.activeId = null;
      if (cur.metroRunning) metroStop();
      clearClock();
      cur.startLabel = "Start";
      cur.live = "Ferdig";
      saveSession("");
      syncWake();
      redraw();
      return;
    }
    beginBlock(next);
  }

  useEffect(() => {
    const loaded = loadPlanStore();
    clock.current.store = loaded;
    persist();
    redraw();
    const onVis = () => {
      if (document.visibilityState !== "visible") {
        const lock = clock.current.wake;
        clock.current.wake = null;
        void lock?.release().catch(() => {});
        return;
      }
      if (!clock.current.activeId) {
        const today = todayStamp();
        if (clock.current.store.sessionDate !== today) {
          clock.current.store.done = [];
          clock.current.store.items = clock.current.store.items.map((item) => ({ ...item, skipped: false }));
          clock.current.store.sessionDate = today;
          persist();
          redraw();
        }
      }
      syncWake();
      if (clock.current.activeId && !clock.current.blockPaused && clock.current.timer != null) api.current.tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopTimer();
      metroStop();
      const lock = clock.current.wake;
      clock.current.wake = null;
      void lock?.release().catch(() => {});
      void audioRef.current?.close();
      audioRef.current = null;
    };
  }, []);

  const cur = clock.current;
  const playing = !!cur.activeId && !cur.forceSetup;
  const sum = playingSum(cur.store.items);

  return (
    <section className="pb-4">
      {playing ? (
        <div className="plan-hero text-center">
          <p className="text-2xl font-semibold tracking-tight">{cur.activeId ? blockName(cur.activeId) : ""}</p>
          <button
            type="button"
            onClick={onStart}
            className={cur.blockPaused ? "mt-2 text-7xl font-bold tracking-tight text-muted tabular-nums" : "mt-2 text-7xl font-bold tracking-tight text-accent tabular-nums"}
          >
            {fmtClock(cur.blockLeft)}
          </button>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {liveItems(cur.store.items).map((item) => {
              const done = cur.store.done.includes(item.id) && cur.activeId !== item.id;
              const on = cur.activeId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === cur.activeId || !item.on || item.skipped) return;
                    saveBlockBpm(cur.activeId);
                    cur.store.done = cur.store.done.filter((id) => id !== item.id);
                    persist();
                    beginBlock(item, true);
                  }}
                  className={
                    on
                      ? "min-h-11 rounded-full bg-accent px-3 text-xs font-semibold tracking-wide text-bg uppercase"
                      : done
                        ? "min-h-11 rounded-full border border-line px-3 text-xs font-semibold tracking-wide text-muted uppercase line-through opacity-40"
                        : "min-h-11 rounded-full border border-line px-3 text-xs font-semibold tracking-wide text-muted uppercase"
                  }
                >
                  {blockName(item.id)}
                  <small className="block text-[10px] tracking-widest">{item.mins}m</small>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {cur.store.presets.map((preset) => (
              <span key={preset.id} className="inline-flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    cur.store.items = applyPreset(preset);
                    cur.store.done = [];
                    cur.activeId = null;
                    clearClock();
                    cur.live = "Klar";
                    persist();
                    redraw();
                  }}
                  className="metro-press min-h-10 rounded-full border border-line px-3 text-sm font-semibold"
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  aria-label={`Slett ${preset.name}`}
                  onClick={() => {
                    cur.store.presets = cur.store.presets.filter((item) => item.id !== preset.id);
                    persist();
                    redraw();
                  }}
                  className="metro-press min-h-10 min-w-10 rounded-full border border-line text-muted"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <input
              value={cur.presetName}
              maxLength={32}
              placeholder="Presetnavn"
              onChange={(event) => {
                cur.presetName = event.target.value;
                redraw();
              }}
              className="metro-field min-h-11 min-w-36 flex-1 rounded-xl border border-line bg-header px-3 text-fg"
            />
            <button
              type="button"
              onClick={() => {
                const name = cur.presetName.trim();
                const blocks = liveItems(cur.store.items).map((item) => ({ id: item.id, mins: item.mins }));
                if (!name || !blocks.length) return;
                const preset: PlanPreset = { id: `u${Date.now()}`, name, blocks };
                cur.store.presets = [preset, ...cur.store.presets.filter((item) => item.name !== name)].slice(0, 8);
                cur.presetName = "";
                persist();
                redraw();
              }}
              className="metro-press min-h-11 rounded-full border border-line px-3 text-sm font-semibold"
            >
              Lagre
            </button>
            <button type="button" onClick={() => { cur.logOpen = !cur.logOpen; redraw(); }} className="metro-press min-h-11 rounded-full border border-line px-3 text-sm font-semibold">
              Logg
            </button>
            <button
              type="button"
              onClick={() => {
                cur.store.done = [];
                cur.activeId = null;
                cur.forceSetup = false;
                cur.metroHeld = false;
                if (cur.metroRunning) metroStop();
                cur.store.items = cur.store.items.map((item) => ({ ...item, skipped: false }));
                clearClock();
                cur.startLabel = "Start";
                cur.live = "Klar";
                cur.store.sessionDate = todayStamp();
                persist();
                syncWake();
                redraw();
              }}
              className="metro-press min-h-11 rounded-full border border-line px-3 text-sm font-semibold"
            >
              Nullstill
            </button>
          </div>
          <p className="mb-3 text-sm text-muted">
            <b className="rounded-full bg-header px-2.5 py-1 font-semibold text-fg">{sum}</b> min
          </p>
          <ol className="grid list-none gap-2 p-0">
            {cur.store.items.map((item) => {
              const dim = !item.on || item.skipped || cur.store.done.includes(item.id);
              return (
                <li
                  key={item.id}
                  className={
                    cur.activeId === item.id
                      ? "grid grid-cols-[28px_1fr_auto_auto] items-center gap-2.5 rounded-card border border-accent bg-accent/10 py-3 pr-3 pl-3.5"
                      : "grid grid-cols-[28px_1fr_auto_auto] items-center gap-2.5 rounded-card border border-line bg-surface py-3 pr-3 pl-3.5"
                  }
                  style={{ boxShadow: `inset 3px 0 0 var(--color-${item.id})`, opacity: dim && cur.activeId !== item.id ? 0.4 : 1 }}
                >
                  <input
                    type="checkbox"
                    checked={item.on && !item.skipped}
                    aria-label={blockName(item.id)}
                    onChange={(event) => {
                      replaceItem({ ...item, on: event.target.checked, skipped: event.target.checked ? false : item.skipped });
                      persist();
                      redraw();
                    }}
                    className="size-6 accent-accent"
                  />
                  <span className={item.skipped || cur.store.done.includes(item.id) ? "font-semibold line-through" : "font-semibold"}>
                    {blockName(item.id)}
                  </span>
                  <span className="min-w-8 text-right text-xl font-bold text-accent tabular-nums">
                    {item.skipped || !item.on ? "—" : item.mins}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" disabled={!item.on || item.skipped || item.mins <= 1} onClick={() => changeMins(item.id, -1)} className="metro-press size-10 rounded-xl border border-line disabled:opacity-30">−</button>
                    <button type="button" onClick={() => changeMins(item.id, 1)} className="metro-press size-10 rounded-xl border border-line">+</button>
                    <button type="button" disabled={!item.on || item.skipped} onClick={() => skip(item.id)} className="min-h-10 rounded-xl border border-line px-2 text-sm disabled:opacity-30">Hopp</button>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {cur.logOpen ? (
        <div className="mt-3 rounded-card border border-line bg-surface p-3">
          <h2 className="text-sm font-semibold">Logg</h2>
          <textarea
            value={cur.logNote}
            maxLength={240}
            onChange={(event) => {
              cur.logNote = event.target.value;
              redraw();
            }}
            className="mt-2 min-h-16 w-full rounded-xl border border-line bg-header px-3 py-2 text-fg"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                saveSession(cur.logNote.trim());
                cur.logNote = "";
                redraw();
              }}
              className="min-h-11 rounded-xl bg-accent px-3 font-semibold text-bg"
            >
              Lagre
            </button>
            <button type="button" onClick={() => { cur.logOpen = false; redraw(); }} className="min-h-11 rounded-xl border border-line px-3">
              Lukk
            </button>
            <button
              type="button"
              onClick={() => {
                cur.store.log = [];
                persist();
                redraw();
              }}
              className="min-h-11 rounded-xl border border-line px-3"
            >
              Tøm
            </button>
          </div>
          <div className="mt-2">
            {cur.store.log.map((entry, index) => (
              <div key={`${entry.t}-${index}`} className="border-t border-line py-2 text-sm">
                <p className="font-semibold text-accent">
                  {stamp(entry.t)} · {entry.playing} min
                </p>
                <p className="text-muted">{entry.done.length ? entry.done.join(", ") : "—"}</p>
                {entry.note ? <p className="text-muted">{entry.note}</p> : null}
                <button
                  type="button"
                  onClick={() => {
                    cur.store.log = cur.store.log.filter((_, item) => item !== index);
                    persist();
                    redraw();
                  }}
                  className="mt-1 text-sm text-muted"
                >
                  Slett
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 rounded-card border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-12 text-xl font-bold tabular-nums">{cur.store.bpm}</span>
          <button type="button" onClick={() => setBpm(cur.store.bpm - 2)} className="min-h-10 rounded-lg border border-line px-3">−</button>
          <button type="button" onClick={() => setBpm(cur.store.bpm + 2)} className="min-h-10 rounded-lg border border-line px-3">+</button>
          <button
            type="button"
            onClick={() => {
              const now = Date.now();
              cur.taps = [...cur.taps.filter((tap) => now - tap < 3000), now];
              const next = bpmFromTaps(cur.taps);
              if (next != null) setBpm(next);
              else redraw();
            }}
            className="min-h-10 rounded-lg border border-line px-3"
          >
            Bank
          </button>
          <select
            aria-label="Takter"
            value={cur.store.beats}
            onChange={(event) => {
              cur.store.beats = Number(event.target.value) || 4;
              cur.metroCount = 0;
              persist();
              redraw();
            }}
            className="metro-field min-h-10 rounded-lg border border-line bg-header px-2"
          >
            {[2, 3, 4, 5, 6, 7].map((beat) => (
              <option key={beat} value={beat}>{beat}</option>
            ))}
          </select>
          <select
            aria-label="Underdeling"
            value={cur.store.sub}
            onChange={(event) => {
              cur.store.sub = Number(event.target.value) || 1;
              cur.metroCount = 0;
              persist();
              redraw();
            }}
            className="metro-field min-h-10 rounded-lg border border-line bg-header px-2"
          >
            <option value={1}>Fjerdedel</option>
            <option value={2}>Åttendel</option>
            <option value={3}>Triol</option>
          </select>
          <button
            type="button"
            onClick={() => (cur.metroRunning ? metroStop() : metroStart())}
            className={cur.metroRunning ? "min-h-10 rounded-lg bg-accent px-3 font-semibold text-bg" : "min-h-10 rounded-lg border border-line px-3"}
          >
            {cur.metroRunning ? "Stopp" : "Spill"}
          </button>
        </div>
        <p className="text-sm font-semibold text-accent">{cur.live}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onStart} className="metro-press min-h-12 rounded-xl bg-fg font-semibold text-bg">
            {cur.startLabel}
          </button>
          {cur.activeId ? (
            <button
              type="button"
              onClick={() => {
                const id = cur.activeId;
                if (!id) return;
                saveBlockBpm(id);
                markDone(id);
                endCurrent(id);
              }}
              className="metro-press min-h-12 rounded-xl border border-line font-semibold"
            >
              Ferdig
            </button>
          ) : null}
          {cur.activeId ? (
            <button
              type="button"
              onClick={() => {
                if (cur.activeId && cur.timer != null && !cur.blockPaused) pauseBlock();
                cur.forceSetup = true;
                syncWake();
                redraw();
              }}
              className="metro-press min-h-12 rounded-xl border border-line font-semibold"
            >
              Liste
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );

  function changeMins(id: string, dir: number) {
    const item = findItem(id);
    if (!item) return;
    const next = bumpItem(item, dir);
    if (!next) return;
    replaceItem(next);
    if (cur.activeId === id) {
      if (cur.blockPaused) cur.blockRemainMs = Math.max(1000, cur.blockRemainMs + dir * 60000);
      else if (cur.blockEndsAt) cur.blockEndsAt += dir * 60000;
      syncLeft();
    }
    persist();
    redraw();
  }

  function skip(id: string) {
    const item = findItem(id);
    if (!item || item.skipped || !item.on) return;
    replaceItem({ ...item, skipped: true });
    cur.store.done = cur.store.done.filter((done) => done !== id);
    persist();
    if (cur.activeId === id) {
      saveBlockBpm(id);
      endCurrent(id);
      return;
    }
    redraw();
  }
}

function stamp(ts: number) {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
