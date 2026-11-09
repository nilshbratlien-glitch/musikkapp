import { useEffect, useSyncExternalStore } from "react";
import {
  applyPreset,
  blockName,
  bpmFromTaps,
  bumpItem,
  fmtClock,
  liveItems,
  playingSum,
  savePlanStore,
  BLOCK_COLOR,
  type PlanItem,
  type PlanPreset,
} from "@/lib/oveplan";
import {
  beginBlock,
  clearClock,
  endCurrent,
  ensurePlanClock,
  finishPlanBlock,
  getPlanClock,
  getPlanClockVersion,
  pauseBlock,
  resetPlan,
  setPlanBpm,
  setPlanMeter,
  subscribePlanClock,
  syncLeft,
  syncWake,
  togglePlanClock,
  togglePlanMetro,
  touchPlanClock,
} from "@/lib/plan-clock";

type Clock = ReturnType<typeof getPlanClock>;

export function Oveplan() {
  const clock = { get current(): Clock { return getPlanClock(); } };
  useSyncExternalStore(subscribePlanClock, getPlanClockVersion, getPlanClockVersion);
  const redraw = () => touchPlanClock();

  function persist() {
    savePlanStore(clock.current.store);
  }

  function savePreset() {
    const cur = clock.current;
    const name = cur.presetName.trim();
    const blocks = liveItems(cur.store.items).map((item) => ({ id: item.id, mins: item.mins }));
    if (!name || !blocks.length) return;
    const preset: PlanPreset = { id: `u${Date.now()}`, name, blocks };
    cur.store.presets = [preset, ...cur.store.presets.filter((item) => item.name !== name)].slice(0, 8);
    cur.presetName = "";
    persist();
    redraw();
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

  function saveSession(note: string) {
    const cur = clock.current;
    const doneNames = cur.store.done.map(blockName);
    if (!doneNames.length && !note) return;
    cur.store.log = [
      {
        t: Date.now(),
        playing: playingSum(cur.store.items),
        done: doneNames,
        planned: liveItems(cur.store.items).map((item) => `${blockName(item.id)} ${item.mins}m`),
        note,
      },
      ...cur.store.log,
    ].slice(0, 60);
    persist();
  }

  useEffect(() => {
    ensurePlanClock();
    touchPlanClock();
  }, []);


  const cur = clock.current;
  const playing = !!cur.activeId && !cur.forceSetup;
  const sum = playingSum(cur.store.items);

  return (
    <section className="pb-4">
      {playing ? (
        <div className="plan-hero py-6 text-center">
          <p className="text-2xl font-semibold tracking-tight">{cur.activeId ? blockName(cur.activeId) : ""}</p>
          <button
            type="button"
            onClick={togglePlanClock}
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
              onKeyDown={(event) => {
                if (event.key === "Enter") savePreset();
                else if (event.key === "Escape") {
                  cur.presetName = "";
                  event.currentTarget.blur();
                  redraw();
                }
              }}
              enterKeyHint="done"
              className="metro-field min-h-11 min-w-36 flex-1 rounded-xl border border-line bg-header px-3 text-fg"
            />
            <button
              type="button"
              onClick={savePreset}
              className="metro-press min-h-11 rounded-full border border-line px-3 text-sm font-semibold"
            >
              Lagre
            </button>
            <button type="button" onClick={() => { cur.logOpen = !cur.logOpen; redraw(); }} className="metro-press min-h-11 rounded-full border border-line px-3 text-sm font-semibold">
              Logg
            </button>
            <button
              type="button"
              onClick={resetPlan}
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
                  style={{ boxShadow: `inset 3px 0 0 ${BLOCK_COLOR[item.id]}`, opacity: dim && cur.activeId !== item.id ? 0.4 : 1 }}
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
                    <button type="button" disabled={!item.on || item.skipped} onClick={() => skip(item.id)} className="metro-press min-h-10 rounded-xl border border-line px-2 text-sm disabled:opacity-30">Hopp</button>
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
          <button type="button" onClick={() => setPlanBpm(cur.store.bpm - 2)} className="metro-press min-h-10 rounded-lg border border-line px-3">−</button>
          <button type="button" onClick={() => setPlanBpm(cur.store.bpm + 2)} className="metro-press min-h-10 rounded-lg border border-line px-3">+</button>
          <button
            type="button"
            onClick={() => {
              const now = Date.now();
              cur.taps = [...cur.taps.filter((tap) => now - tap < 3000), now];
              const next = bpmFromTaps(cur.taps);
              if (next != null) setPlanBpm(next);
              else redraw();
            }}
            className="min-h-10 rounded-lg border border-line px-3"
          >
            Bank
          </button>
          <select
            aria-label="Takter"
            value={cur.store.beats}
            onChange={(event) => setPlanMeter(Number(event.target.value) || 4, cur.store.sub)}
            className="metro-field min-h-10 rounded-lg border border-line bg-header px-2"
          >
            {[2, 3, 4, 5, 6, 7].map((beat) => (
              <option key={beat} value={beat}>{beat}</option>
            ))}
          </select>
          <select
            aria-label="Underdeling"
            value={cur.store.sub}
            onChange={(event) => setPlanMeter(cur.store.beats, Number(event.target.value) || 1)}
            className="metro-field min-h-10 rounded-lg border border-line bg-header px-2"
          >
            <option value={1}>Fjerdedel</option>
            <option value={2}>Åttendel</option>
            <option value={3}>Triol</option>
          </select>
          <button
            type="button"
            onClick={togglePlanMetro}
            className={cur.metroRunning ? "min-h-10 rounded-lg bg-accent px-3 font-semibold text-bg" : "min-h-10 rounded-lg border border-line px-3"}
          >
            {cur.metroRunning ? "Stopp" : "Spill"}
          </button>
        </div>
        <p className="text-sm font-semibold text-accent">{cur.live}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={togglePlanClock} className="metro-press min-h-12 rounded-xl bg-fg font-semibold text-bg">
            {cur.startLabel}
          </button>
          {cur.activeId ? (
            <button
              type="button"
              onClick={() => {
                const id = cur.activeId;
                if (!id) return;
                finishPlanBlock();
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
