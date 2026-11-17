import { useEffect, useState, useSyncExternalStore } from "react";
import { listSetlists, listSheets } from "@/lib/noter-db";
import type { SetlistRecord, SheetMeta } from "@/lib/noter";
import {
  applyPreset,
  blockName,
  bpmFromTaps,
  bumpItem,
  enableBladlesingDuet,
  fmtClock,
  liveItems,
  playingSum,
  SAMSPILL_DUET_PRESET,
  savePlanStore,
  BLOCK_COLOR,
  type PlanItem,
  type PlanPreset,
  type RepTarget,
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
  resumeFromBladlesing,
  setPlanBpm,
  setPlanMeter,
  subscribePlanClock,
  syncLeft,
  syncWake,
  togglePlanClock,
  togglePlanMetro,
  touchPlanClock,
} from "@/lib/plan-clock";
import { getProfileVersion, subscribeProfile } from "@/lib/profile";
import {
  isDuetViewPaired,
  setDuetViewPaired,
  subscribeDuetViewPaired,
  syncDuetViewPart,
  syncPlanPause,
  syncPlanResume,
  syncPlanStop,
  syncSightAction,
} from "@/lib/sync/bridge";
import type { DuetViewPart } from "@/lib/sync/types";

type Clock = ReturnType<typeof getPlanClock>;

export function Oveplan() {
  const clock = { get current(): Clock { return getPlanClock(); } };
  useSyncExternalStore(subscribePlanClock, getPlanClockVersion, getPlanClockVersion);
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const duetViewPaired = useSyncExternalStore(subscribeDuetViewPaired, isDuetViewPaired, () => false);
  const [pairedPart, setPairedPart] = useState<DuetViewPart>("score");
  const [noterSheets, setNoterSheets] = useState<SheetMeta[]>([]);
  const [noterSetlists, setNoterSetlists] = useState<SetlistRecord[]>([]);
  const redraw = () => touchPlanClock();

  useEffect(() => {
    let active = true;
    void Promise.all([listSheets(), listSetlists()])
      .then(([sheets, setlists]) => {
        if (!active) return;
        setNoterSheets(sheets);
        setNoterSetlists(setlists);
      })
      .catch(() => {
        /* best effort when IndexedDB is unavailable */
      });
    return () => {
      active = false;
    };
  }, []);

  function persist() {
    savePlanStore(clock.current.store);
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
    const doneNames = cur.store.done.map((id) => blockName(id));
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

  const sessionControlCard = (
    <div className="grid gap-2.5 rounded-card border border-line bg-surface p-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={togglePlanClock}
          className={
            cur.activeId
              ? "metro-press min-h-12 rounded-xl bg-fg font-semibold text-bg"
              : "metro-press col-span-2 min-h-12 rounded-xl bg-accent text-base font-bold text-[#1a1408]"
          }
        >
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
            className="metro-press col-span-2 min-h-11 rounded-xl border border-line font-semibold"
          >
            Liste
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
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
      {cur.activeId === "srf" ? (
        <div className="rounded-xl border border-line bg-header p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              Bladlesing på skjerm
            </p>
            <button
              type="button"
              aria-pressed={duetViewPaired}
              onClick={() => {
                const next = !duetViewPaired;
                setDuetViewPaired(next);
                if (next) syncDuetViewPart(pairedPart);
              }}
              className={
                duetViewPaired
                  ? "metro-press min-h-8 rounded-full bg-accent px-2.5 text-xs font-semibold text-bg"
                  : "metro-press min-h-8 rounded-full border border-line bg-surface px-2.5 text-xs font-semibold text-muted"
              }
            >
              {duetViewPaired ? "Speil visning: På" : "Speil visning: Av"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => syncSightAction("generate")}
              className="metro-press min-h-11 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-fg"
            >
              Ny oppgave
            </button>
            <button
              type="button"
              onClick={() => {
                resumeFromBladlesing();
                syncSightAction("togglePlay");
              }}
              className="metro-press min-h-11 rounded-xl bg-accent px-3 text-sm font-semibold text-bg"
            >
              Spill / Stopp
            </button>
            <button
              type="button"
              onClick={() => syncSightAction("toggleMetro")}
              className="metro-press min-h-10 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-fg"
            >
              Metronom av/på
            </button>
            <button
              type="button"
              onClick={() => {
                resumeFromBladlesing();
                syncSightAction("again");
              }}
              className="metro-press min-h-10 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-fg"
            >
              Igjen −10
            </button>
          </div>
          {duetViewPaired ? (
            <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="Speilet duettvisning">
              {(
                [
                  { id: "score", label: "Partitur" },
                  { id: "trumpet", label: "Trompet (B)" },
                  { id: "mallets", label: "Slagverk (C)" },
                ] as const
              ).map((part) => (
                <button
                  key={part.id}
                  type="button"
                  onClick={() => {
                    setPairedPart(part.id);
                    syncDuetViewPart(part.id);
                  }}
                  className={
                    pairedPart === part.id
                      ? "metro-press min-h-9 rounded-lg bg-accent px-2 text-xs font-semibold text-bg"
                      : "metro-press min-h-9 rounded-lg border border-line bg-surface px-2 text-xs font-semibold text-fg"
                  }
                >
                  {part.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const logPanel = cur.logOpen ? (
    <div className="rounded-card border border-line bg-surface p-3.5">
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
  ) : null;

  return (
    <section className="pb-4">
      {playing ? (
        <div className="space-y-4 md:landscape:grid md:landscape:grid-cols-[1.15fr_0.85fr] md:landscape:items-stretch md:landscape:gap-5 md:landscape:space-y-0">
          <div className="plan-hero flex flex-col justify-center py-6 text-center md:py-8">
            <p className="text-2xl font-semibold tracking-tight md:text-3xl">{cur.activeId ? blockName(cur.activeId) : ""}</p>
            <button
              type="button"
              onClick={togglePlanClock}
              className={
                cur.blockPaused
                  ? "mt-2 text-7xl font-bold tracking-tight text-muted tabular-nums md:text-8xl"
                  : "mt-2 text-7xl font-bold tracking-tight text-accent tabular-nums md:text-8xl"
              }
            >
              {fmtClock(cur.blockLeft)}
            </button>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
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
                        ? "min-h-11 rounded-full bg-accent px-3.5 text-xs font-semibold tracking-wide text-bg uppercase md:px-4"
                        : done
                          ? "min-h-11 rounded-full border border-line px-3.5 text-xs font-semibold tracking-wide text-muted uppercase line-through opacity-40 md:px-4"
                          : "min-h-11 rounded-full border border-line px-3.5 text-xs font-semibold tracking-wide text-muted uppercase md:px-4"
                    }
                  >
                    {blockName(item.id)}
                    <small className="block text-[10px] tracking-widest">{item.mins}m</small>
                  </button>
                );
              })}
            </div>
            {cur.activeId ? (
              <div className="mt-3 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => changeMins(cur.activeId!, 1)}
                  className="metro-press min-h-10 rounded-full border border-line bg-surface px-3.5 text-xs font-semibold text-fg"
                >
                  +1 min
                </button>
                <button
                  type="button"
                  onClick={() => changeMins(cur.activeId!, 5)}
                  className="metro-press min-h-10 rounded-full border border-line bg-surface px-3.5 text-xs font-semibold text-fg"
                >
                  +5 min
                </button>
              </div>
            ) : null}
          </div>
          <div className="space-y-3">
            {sessionControlCard}
            {logPanel}
          </div>
        </div>
      ) : (
        <div className="space-y-3 md:landscape:grid md:landscape:grid-cols-[1.18fr_0.82fr] md:landscape:items-start md:landscape:gap-5 md:landscape:space-y-0">
          <ol className="grid list-none gap-2 p-0 md:landscape:order-1">
            {cur.store.items.map((item) => {
              const dim = !item.on || item.skipped || cur.store.done.includes(item.id);
              return (
                <li
                  key={item.id}
                  className={
                    cur.activeId === item.id
                      ? "grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-card border border-accent bg-accent/10 py-2.5 pr-3 pl-3 sm:grid-cols-[44px_minmax(0,1fr)_auto_auto] sm:pl-2"
                      : "grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-card border border-line bg-surface py-2.5 pr-3 pl-3 sm:grid-cols-[44px_minmax(0,1fr)_auto_auto] sm:pl-2"
                  }
                  style={{ boxShadow: `inset 3px 0 0 ${BLOCK_COLOR[item.id]}`, opacity: dim && cur.activeId !== item.id ? 0.4 : 1 }}
                >
                  <label className="flex size-7 cursor-pointer items-center justify-center sm:size-11">
                    <input
                      type="checkbox"
                      checked={item.on && !item.skipped}
                      aria-label={blockName(item.id)}
                      onChange={(event) => {
                        replaceItem({ ...item, on: event.target.checked, skipped: event.target.checked ? false : item.skipped });
                        persist();
                        redraw();
                      }}
                      className="size-5 accent-accent sm:size-6"
                    />
                  </label>
                  <span className={item.skipped || cur.store.done.includes(item.id) ? "min-w-0 truncate font-semibold line-through" : "min-w-0 truncate font-semibold"}>
                    {blockName(item.id)}
                  </span>
                  <span className="min-w-8 text-right text-xl font-bold text-accent tabular-nums">
                    {item.skipped || !item.on ? "—" : item.mins}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" disabled={!item.on || item.skipped || item.mins <= 1} onClick={() => changeMins(item.id, -1)} className="metro-press size-9 rounded-xl border border-line disabled:opacity-30 sm:size-10">−</button>
                    <button type="button" onClick={() => changeMins(item.id, 1)} className="metro-press size-9 rounded-xl border border-line sm:size-10">+</button>
                    <button type="button" disabled={!item.on || item.skipped} onClick={() => skip(item.id)} className="metro-press min-h-9 rounded-xl border border-line px-2 text-sm disabled:opacity-30 sm:min-h-10">Hopp</button>
                  </span>
                  {item.id === "rep" && (noterSheets.length > 0 || noterSetlists.length > 0 || cur.store.repTarget) ? (
                    <div className="col-span-4 mt-1 flex items-center gap-2 border-t border-line/60 pt-2">
                      <label htmlFor="oveplan-rep-target" className="shrink-0 text-xs font-medium text-muted">
                        Noter:
                      </label>
                      <select
                        id="oveplan-rep-target"
                        aria-label="Koblet noteark eller settliste"
                        value={
                          cur.store.repTarget
                            ? `${cur.store.repTarget.kind}:${cur.store.repTarget.id}`
                            : ""
                        }
                        onChange={(event) => {
                          const raw = event.target.value;
                          let next: RepTarget | null = null;
                          if (raw.startsWith("sheet:")) {
                            const id = raw.slice("sheet:".length);
                            const found = noterSheets.find((s) => s.id === id);
                            if (found) next = { kind: "sheet", id: found.id, title: found.title };
                          } else if (raw.startsWith("setlist:")) {
                            const id = raw.slice("setlist:".length);
                            const found = noterSetlists.find((sl) => sl.id === id);
                            if (found) next = { kind: "setlist", id: found.id, title: found.name };
                          }
                          cur.store.repTarget = next;
                          persist();
                          redraw();
                        }}
                        className="metro-field min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-header px-2.5 text-xs text-fg"
                      >
                        <option value="">Ingen kobling</option>
                        {noterSetlists.length > 0 ? (
                          <optgroup label="Settlister">
                            {noterSetlists.map((sl) => (
                              <option key={sl.id} value={`setlist:${sl.id}`}>
                                {sl.name} ({sl.sheetIds.length})
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        {noterSheets.length > 0 ? (
                          <optgroup label="Noteark">
                            {noterSheets.map((sheet) => (
                              <option key={sheet.id} value={`sheet:${sheet.id}`}>
                                {sheet.title}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        {cur.store.repTarget &&
                        ((cur.store.repTarget.kind === "sheet" &&
                          !noterSheets.some((s) => s.id === cur.store.repTarget?.id)) ||
                          (cur.store.repTarget.kind === "setlist" &&
                            !noterSetlists.some((sl) => sl.id === cur.store.repTarget?.id))) ? (
                          <option value={`${cur.store.repTarget.kind}:${cur.store.repTarget.id}`}>
                            {cur.store.repTarget.title}
                          </option>
                        ) : null}
                      </select>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <div className="space-y-3 md:order-2">
            {sessionControlCard}
            <div className="rounded-card border border-line bg-surface p-3.5">
              <p className="mb-2.5 text-sm text-muted">
                Totalt: <b className="rounded-full bg-header px-2.5 py-1 font-semibold text-fg">{sum}</b> min
              </p>
              <div className="mb-2.5 flex flex-wrap gap-1.5">
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
                        if (preset.duet) enableBladlesingDuet(true);
                        persist();
                        redraw();
                        syncPlanStop();
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
                {!cur.store.presets.some((preset) => preset.id === SAMSPILL_DUET_PRESET.id) ? (
                  <button
                    type="button"
                    onClick={() => {
                      cur.store.items = applyPreset(SAMSPILL_DUET_PRESET);
                      cur.store.done = [];
                      cur.activeId = null;
                      clearClock();
                      cur.live = "Klar";
                      enableBladlesingDuet(true);
                      persist();
                      redraw();
                      syncPlanStop();
                    }}
                    className="metro-press min-h-10 rounded-full border border-accent/50 bg-accent/10 px-3 text-sm font-semibold text-accent"
                  >
                    {SAMSPILL_DUET_PRESET.name}
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <input
                  value={cur.presetName}
                  maxLength={32}
                  placeholder="Presetnavn"
                  onChange={(event) => {
                    cur.presetName = event.target.value;
                    redraw();
                  }}
                  className="metro-field min-h-11 min-w-32 flex-1 rounded-xl border border-line bg-header px-3 text-fg"
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
                  onClick={resetPlan}
                  className="metro-press min-h-11 rounded-full border border-line px-3 text-sm font-semibold"
                >
                  Nullstill
                </button>
              </div>
            </div>
            {logPanel}
          </div>
        </div>
      )}
    </section>
  );

  function changeMins(id: string, dir: number) {
    const item = findItem(id);
    if (!item) return;
    const next = bumpItem(item, dir);
    if (!next) return;
    replaceItem(next);
    if (cur.activeId === id) {
      if (cur.blockPaused) {
        cur.blockRemainMs = Math.max(1000, cur.blockRemainMs + dir * 60000);
        syncLeft();
        syncPlanPause(cur.blockRemainMs);
      } else if (cur.blockEndsAt) {
        cur.blockEndsAt += dir * 60000;
        syncLeft();
        syncPlanResume(cur.blockEndsAt);
      }
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
