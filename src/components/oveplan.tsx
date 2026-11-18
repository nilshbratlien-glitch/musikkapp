import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { listSetlists, listSheets } from "@/lib/noter-db";
import type { SetlistRecord, SheetMeta } from "@/lib/noter";
import {
  applyPreset,
  BLOCK_COLOR,
  blockName,
  blockStyle,
  bpmFromTaps,
  bumpItem,
  clampBpm,
  enableBladlesingDuet,
  fmtClock,
  liveItems,
  playingSum,
  playsMetronome,
  SAMSPILL_DUET_PRESET,
  savePlanStore,
  TRUMPET_EXERCISES,
  type BlockId,
  type ExerciseCard,
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
import { getProfile, getProfileVersion, subscribeProfile } from "@/lib/profile";
import { getState as getPulseState, subscribe as subscribePulse } from "@/lib/pulse";
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

const MALLETS_EXERCISES: Record<BlockId, ExerciseCard> = {
  twomallet: {
    title: "2-mallet teknikk & klang",
    items: [
      "Skalaer og arpeggioer i jevnt tempo — fokuser på lik klang mellom høyre og venstre hånd.",
      "Dobbeltslag og virveløvelser med avslappede håndledd midt på stavene.",
    ],
  },
  fourmallet: {
    title: "4-mallet grep & uavhengighet",
    items: [
      "Akkordbrytninger og permutasjoner (1-2-3-4, 1-3-2-4) i rolig tempo.",
      "Intervallskifter (kvart til oktav) med stabile ytterkøller.",
    ],
  },
  srf: {
    title: "Bladlesing",
    items: [
      "Skann toneart, taktart og ytterpunkter før du starter — hold blikket én takt foran.",
    ],
  },
  rep: {
    title: "Repertoar & stykker",
    items: [
      "Isoler krevende overganger i 2–4 takter om gangen før du setter opp tempoet.",
    ],
  },
};

const MALLETS_QUICK_TEMPLATES: PlanPreset[] = [
  {
    id: "mallets-quick-15",
    name: "Kjapp 15 min",
    blocks: [
      { id: "twomallet", mins: 4 },
      { id: "fourmallet", mins: 3 },
      { id: "srf", mins: 4 },
      { id: "rep", mins: 4 },
    ],
  },
  {
    id: "mallets-standard-30",
    name: "Standard 30 min",
    blocks: [
      { id: "twomallet", mins: 8 },
      { id: "fourmallet", mins: 6 },
      { id: "srf", mins: 6 },
      { id: "rep", mins: 10 },
    ],
  },
];

const QUICK_MINS = [3, 5, 10, 15, 20] as const;
const QUICK_BPMS = [60, 80, 100, 120] as const;

export function Oveplan() {
  const navigate = useNavigate();
  const clock = {
    get current(): Clock {
      return getPlanClock();
    },
  };
  useSyncExternalStore(subscribePlanClock, getPlanClockVersion, getPlanClockVersion);
  useSyncExternalStore(subscribeProfile, getProfileVersion, getProfileVersion);
  const pulse = useSyncExternalStore(subscribePulse, getPulseState, getPulseState);
  const duetViewPaired = useSyncExternalStore(subscribeDuetViewPaired, isDuetViewPaired, () => false);
  const [pairedPart, setPairedPart] = useState<DuetViewPart>("score");
  const [noterSheets, setNoterSheets] = useState<SheetMeta[]>([]);
  const [noterSetlists, setNoterSetlists] = useState<SetlistRecord[]>([]);
  const [openTips, setOpenTips] = useState<Record<string, boolean>>({});
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
  const profile = getProfile();
  const playing = !!cur.activeId && !cur.forceSetup;
  const sum = playingSum(cur.store.items);
  const liveList = liveItems(cur.store.items);
  const activeItem = cur.activeId ? findItem(cur.activeId) : null;
  const firstLiveItem = liveList[0] ?? null;
  const heroBlockId = (activeItem?.id ?? firstLiveItem?.id ?? "twomallet") as BlockId;
  const doneCount = liveList.filter((item) => cur.store.done.includes(item.id)).length;
  const exercisesMap = profile === "trumpet" ? TRUMPET_EXERCISES : MALLETS_EXERCISES;
  const activeExercise = cur.activeId ? exercisesMap[cur.activeId as BlockId] : null;

  const activeTotalSecs = activeItem ? Math.max(1, activeItem.mins * 60) : 0;
  const activeProgressPct = activeItem
    ? Math.min(100, Math.max(0, Math.round(((activeTotalSecs - cur.blockLeft) / activeTotalSecs) * 100)))
    : 0;

  function applyQuickPreset(preset: PlanPreset) {
    cur.store.items = applyPreset(preset);
    cur.store.done = [];
    cur.activeId = null;
    clearClock();
    cur.live = "Klar";
    if (preset.duet) enableBladlesingDuet(true);
    persist();
    redraw();
    syncPlanStop();
  }

  function setExactMins(id: BlockId, mins: number) {
    const item = findItem(id);
    if (!item) return;
    const delta = mins - item.mins;
    if (!item.on || item.skipped) {
      replaceItem({ ...item, on: true, skipped: false, mins });
      persist();
      redraw();
      return;
    }
    if (delta !== 0) {
      changeMins(id, delta);
    }
  }

  function blockBpmFor(id: BlockId): number {
    if (cur.activeId === id) return cur.store.bpm;
    return cur.store.bpmMap[id] ?? cur.store.bpm;
  }

  function setBlockBpm(id: BlockId, nextBpm: number) {
    const clamped = clampBpm(nextBpm);
    cur.store.bpmMap[id] = clamped;
    if (cur.activeId === id || (!cur.activeId && firstLiveItem?.id === id)) {
      setPlanBpm(clamped);
      return;
    }
    persist();
    redraw();
  }

  function changeMetroBpm(nextBpm: number) {
    const clamped = clampBpm(nextBpm);
    if (cur.activeId && playsMetronome(cur.activeId)) {
      cur.store.bpmMap[cur.activeId] = clamped;
    }
    setPlanBpm(clamped);
  }

  function toolBadgeFor(item: PlanItem): string {
    if (item.id === "twomallet" || item.id === "fourmallet") {
      return `Metronom · ${blockBpmFor(item.id)} BPM`;
    }
    if (item.id === "srf") {
      return "Bladlesing";
    }
    if (cur.store.repTarget) {
      return `Noter · ${cur.store.repTarget.title}`;
    }
    return profile === "trumpet" ? "Metronom · Øvelse" : "Egen øving";
  }

  function openRepInNoter() {
    const target = cur.store.repTarget;
    if (target?.kind === "sheet" && target.id) {
      void navigate({
        to: "/noter" as "/",
        search: { sheet: target.id } as never,
      });
      return;
    }
    if (target?.kind === "setlist" && target.id) {
      void navigate({
        to: "/noter" as "/",
        search: { setlist: target.id } as never,
      });
      return;
    }
    void navigate({ to: "/noter" as "/" });
  }

  const extraTemplates =
    profile === "mallets"
      ? MALLETS_QUICK_TEMPLATES.filter(
          (tpl) => !cur.store.presets.some((p) => p.id === tpl.id || p.name === tpl.name),
        )
      : [];

  const topTimelineCard = (
    <div className="rounded-card border border-line bg-surface p-3.5 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold tracking-wider text-muted uppercase">Øktplan</span>
          <span className="rounded-lg border border-line bg-header px-3 py-1 text-xs font-semibold text-fg">
            Totalt: <b className="font-bold text-accent tabular-nums">{sum}</b> min
          </span>
          <span className="rounded-lg border border-line bg-header px-3 py-1 text-xs font-semibold text-muted">
            {doneCount} av {liveList.length} ferdig
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              cur.logOpen = !cur.logOpen;
              redraw();
            }}
            className={
              cur.logOpen
                ? "metro-press min-h-10 rounded-xl border border-accent bg-accent/15 px-3.5 text-xs font-semibold text-accent"
                : "metro-press min-h-10 rounded-xl border border-line bg-header px-3.5 text-xs font-semibold text-fg"
            }
          >
            Logg
          </button>
          <button
            type="button"
            onClick={resetPlan}
            className="metro-press min-h-10 rounded-xl border border-line bg-header px-3.5 text-xs font-semibold text-fg hover:border-accent/50"
          >
            Nullstill
          </button>
        </div>
      </div>

      {/* Interactive proportional visual session timeline bar */}
      <div className="mt-3 flex h-7 w-full gap-1 overflow-hidden rounded-xl bg-header p-1">
        {liveList.length > 0 ? (
          liveList.map((item) => {
            const isDone = cur.store.done.includes(item.id) && cur.activeId !== item.id;
            const isCurrent = cur.activeId === item.id;
            return (
              <div
                key={item.id}
                style={{
                  flexGrow: item.mins,
                  flexBasis: 0,
                  backgroundColor: BLOCK_COLOR[item.id],
                  opacity: isDone ? 0.38 : isCurrent ? 1 : 0.85,
                }}
                className={
                  isCurrent
                    ? "flex h-full min-w-0 items-center justify-center truncate rounded-lg px-2 text-[11px] font-extrabold text-[#12151b] ring-2 ring-fg transition-all"
                    : "flex h-full min-w-0 items-center justify-center truncate rounded-lg px-2 text-[11px] font-bold text-[#12151b] transition-all"
                }
                title={`${blockName(item.id)}: ${item.mins} min`}
              >
                <span className="truncate">
                  {blockName(item.id)} · {item.mins}m
                </span>
              </div>
            );
          })
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-lg bg-line/40 text-[11px] font-medium text-muted">
            Ingen aktive blokker
          </div>
        )}
      </div>

      {/* Presets & Save Preset row */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-muted">Hurtigmaler:</span>
          {cur.store.presets.map((preset) => (
            <span key={preset.id} className="inline-flex items-center overflow-hidden rounded-lg border border-line bg-header">
              <button
                type="button"
                onClick={() => applyQuickPreset(preset)}
                className="metro-press min-h-9 px-3 text-xs font-semibold text-fg hover:text-accent"
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
                className="metro-press flex min-h-9 min-w-7 items-center justify-center border-l border-line/70 px-1.5 text-xs text-muted hover:text-no"
              >
                ×
              </button>
            </span>
          ))}
          {!cur.store.presets.some((preset) => preset.id === SAMSPILL_DUET_PRESET.id) ? (
            <button
              type="button"
              onClick={() => applyQuickPreset(SAMSPILL_DUET_PRESET)}
              className="metro-press min-h-9 rounded-lg border border-accent/50 bg-accent/10 px-3 text-xs font-semibold text-accent"
            >
              {SAMSPILL_DUET_PRESET.name}
            </button>
          ) : null}
          {extraTemplates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyQuickPreset(tpl)}
              className="metro-press min-h-9 rounded-lg border border-line bg-header px-3 text-xs font-semibold text-muted hover:border-accent/40 hover:text-fg"
            >
              {tpl.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <input
            value={cur.presetName}
            maxLength={32}
            placeholder="Presetnavn"
            onChange={(event) => {
              cur.presetName = event.target.value;
              redraw();
            }}
            className="metro-field min-h-9 w-36 rounded-lg border border-line bg-header px-3 text-xs text-fg sm:w-44"
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
            className="metro-press min-h-9 rounded-lg border border-line bg-header px-3.5 text-xs font-semibold text-fg hover:border-accent/50"
          >
            Lagre
          </button>
        </div>
      </div>
    </div>
  );

  const heroAndControlsCard = (
    <div className="plan-hero p-4 md:p-5" style={blockStyle(heroBlockId)}>
      <div className="flex items-center justify-between gap-2">
        <span className="plan-chip text-xs">
          <span className="plan-chip-dot" />
          <span>
            {activeItem
              ? blockName(activeItem.id)
              : firstLiveItem
                ? `Klar: ${blockName(firstLiveItem.id)}`
                : "Ingen aktive blokker"}
          </span>
        </span>
        <span className="text-xs font-semibold text-accent">{cur.live}</span>
      </div>

      {/* Large Clock Display */}
      <div className="mt-3 text-center">
        {cur.activeId ? (
          <>
            <p className="text-lg font-semibold tracking-tight text-fg/90">{blockName(cur.activeId)}</p>
            <button
              type="button"
              onClick={togglePlanClock}
              className={
                cur.blockPaused
                  ? "mt-1 text-6xl font-extrabold tracking-tight text-muted tabular-nums lg:text-7xl"
                  : "mt-1 text-6xl font-extrabold tracking-tight text-accent tabular-nums lg:text-7xl"
              }
            >
              {fmtClock(cur.blockLeft)}
            </button>
            <div className="mx-auto mt-2.5 h-2 w-full max-w-xs overflow-hidden rounded-full bg-header">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${activeProgressPct}%`,
                  backgroundColor: BLOCK_COLOR[cur.activeId as BlockId] ?? "var(--color-accent)",
                }}
              />
            </div>
            {activeExercise?.items[0] ? (
              <p className="mx-auto mt-2 max-w-md text-xs font-medium text-muted">
                {activeExercise.items[0]}
              </p>
            ) : null}
          </>
        ) : (
          <div className="py-2">
            <p className="text-5xl font-extrabold tracking-tight text-fg tabular-nums lg:text-6xl">
              {fmtClock((firstLiveItem?.mins ?? 0) * 60)}
            </p>
            <p className="mt-1 text-xs font-medium text-muted">
              {firstLiveItem
                ? `Starter med ${blockName(firstLiveItem.id)} (${firstLiveItem.mins} min) · Totalt ${sum} min`
                : "Slå på minst én blokk til venstre for å starte økten"}
            </p>
          </div>
        )}
      </div>

      {/* Block Switcher Buttons inside .plan-hero (preserves E2E selector .plan-hero button) */}
      {liveList.length > 0 ? (
        <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
          {liveList.map((item) => {
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
                    ? "metro-press min-h-10 rounded-xl bg-accent px-3.5 text-xs font-bold tracking-wide text-bg uppercase"
                    : done
                      ? "metro-press min-h-10 rounded-xl border border-line bg-header/70 px-3 text-xs font-semibold tracking-wide text-muted uppercase line-through opacity-45"
                      : "metro-press min-h-10 rounded-xl border border-line bg-header px-3 text-xs font-semibold tracking-wide text-muted uppercase hover:border-accent/50 hover:text-fg"
                }
              >
                {blockName(item.id)}
                <small className="ml-1 text-[10px] tracking-widest opacity-85">{item.mins}m</small>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* +1 min / +5 min quick extenders when a block is active */}
      {cur.activeId ? (
        <div className="mt-2.5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => changeMins(cur.activeId!, 1)}
            className="metro-press min-h-9 rounded-lg border border-line bg-header px-3.5 text-xs font-semibold text-fg"
          >
            +1 min
          </button>
          <button
            type="button"
            onClick={() => changeMins(cur.activeId!, 5)}
            className="metro-press min-h-9 rounded-lg border border-line bg-header px-3.5 text-xs font-semibold text-fg"
          >
            +5 min
          </button>
        </div>
      ) : null}

      {/* Primary Session Transport Controls (Start / Pause / Fortsett / Ferdig / Liste) */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={togglePlanClock}
          className={
            cur.activeId
              ? "metro-press min-h-12 rounded-xl bg-fg text-base font-bold text-bg"
              : "metro-press col-span-2 min-h-13 rounded-xl bg-accent text-base font-bold text-[#1a1408] shadow-sm"
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
            className="metro-press min-h-12 rounded-xl border border-line bg-header text-base font-semibold text-fg"
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
            className="metro-press col-span-2 min-h-10 rounded-xl border border-line bg-header/80 text-xs font-semibold text-muted hover:text-fg"
          >
            Liste
          </button>
        ) : null}
      </div>
    </div>
  );

  const metronomeAndRemoteCard = (
    <div className="grid gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold tracking-wider text-muted uppercase">Metronom</span>
          <span className="text-2xl font-extrabold text-fg tabular-nums">{cur.store.bpm}</span>
          <span className="text-xs font-medium text-muted">BPM</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const now = Date.now();
              cur.taps = [...cur.taps.filter((tap) => now - tap < 3000), now];
              const next = bpmFromTaps(cur.taps);
              if (next != null) changeMetroBpm(next);
              else redraw();
            }}
            className="metro-press min-h-10 rounded-xl border border-line bg-header px-3 text-xs font-semibold text-fg"
          >
            Bank
          </button>
          <button
            type="button"
            onClick={togglePlanMetro}
            className={
              cur.metroRunning
                ? "metro-press min-h-10 rounded-xl bg-accent px-4 text-sm font-bold text-bg"
                : "metro-press min-h-10 rounded-xl border border-line bg-header px-4 text-sm font-semibold text-fg"
            }
          >
            {cur.metroRunning ? "Stopp" : "Spill"}
          </button>
        </div>
      </div>

      {/* Visual Beat Lamps (Slag-indikatorer) */}
      <div
        className="flex min-h-11 items-center justify-center gap-2.5 rounded-xl border border-line/60 bg-header/70 px-3 py-2"
        aria-label="Slag-indikator"
      >
        {Array.from({ length: cur.store.beats }, (_, index) => {
          const isPulseActive = cur.metroRunning && pulse.owner === "oveplan";
          const isBeat = isPulseActive && pulse.beat === index;
          const isDownbeat = index === 0;
          return (
            <span
              key={index}
              className={
                isBeat
                  ? `metro-badge is-active flex items-center justify-center rounded-full bg-accent font-extrabold text-bg ${isDownbeat ? "size-8 text-xs ring-2 ring-accent/40" : "size-7 text-[11px]"}`
                  : `metro-badge flex items-center justify-center rounded-full bg-surface font-bold text-muted ${isDownbeat ? "size-8 border border-accent/50 text-xs text-fg" : "size-7 border border-line text-[11px]"}`
              }
            >
              {index + 1}
            </span>
          );
        })}
      </div>

      {/* Tactile BPM Steppers + Range Slider */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => changeMetroBpm(cur.store.bpm - 5)}
          className="metro-press min-h-10 rounded-xl border border-line bg-header px-2.5 text-xs font-semibold text-muted hover:text-fg"
        >
          −5
        </button>
        <button
          type="button"
          onClick={() => changeMetroBpm(cur.store.bpm - 2)}
          className="metro-press min-h-10 min-w-10 rounded-xl border border-line bg-header px-3 text-base font-bold text-fg"
        >
          −
        </button>
        <input
          type="range"
          aria-label="Tempo (BPM)"
          min={40}
          max={220}
          value={cur.store.bpm}
          onChange={(event) => changeMetroBpm(Number(event.target.value) || 100)}
          className="h-2 min-w-0 flex-1 cursor-pointer accent-accent"
        />
        <button
          type="button"
          onClick={() => changeMetroBpm(cur.store.bpm + 2)}
          className="metro-press min-h-10 min-w-10 rounded-xl border border-line bg-header px-3 text-base font-bold text-fg"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => changeMetroBpm(cur.store.bpm + 5)}
          className="metro-press min-h-10 rounded-xl border border-line bg-header px-2.5 text-xs font-semibold text-muted hover:text-fg"
        >
          +5
        </button>
      </div>

      {/* 1-Tap Segmented Controls for Takter & Underdeling */}
      <div className="grid gap-2.5 border-t border-line/70 pt-2.5 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11px] font-bold tracking-wider text-muted uppercase">Takter (Slag)</p>
          <div className="grid grid-cols-6 gap-1" role="group" aria-label="Takter">
            {[2, 3, 4, 5, 6, 7].map((beat) => {
              const active = cur.store.beats === beat;
              return (
                <button
                  key={beat}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPlanMeter(beat, cur.store.sub)}
                  className={
                    active
                      ? "metro-press min-h-9 rounded-lg bg-accent text-xs font-bold text-bg"
                      : "metro-press min-h-9 rounded-lg border border-line bg-header text-xs font-semibold text-muted hover:text-fg"
                  }
                >
                  {beat}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-bold tracking-wider text-muted uppercase">Underdeling</p>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label="Underdeling">
            {(
              [
                { value: 1, label: "Fjerdedel" },
                { value: 2, label: "Åttendel" },
                { value: 3, label: "Triol" },
              ] as const
            ).map((sub) => {
              const active = cur.store.sub === sub.value;
              return (
                <button
                  key={sub.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPlanMeter(cur.store.beats, sub.value)}
                  className={
                    active
                      ? "metro-press min-h-9 rounded-lg bg-accent px-2 text-xs font-bold text-bg"
                      : "metro-press min-h-9 rounded-lg border border-line bg-header px-2 text-xs font-semibold text-muted hover:text-fg"
                  }
                >
                  {sub.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Remote control when Bladlesing (SRF) is active */}
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
                  ? "metro-press min-h-8 rounded-lg bg-accent px-2.5 text-xs font-semibold text-bg"
                  : "metro-press min-h-8 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-muted"
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
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold tracking-wide text-fg uppercase">Øvelogg</h2>
        <span className="rounded-lg bg-header px-2.5 py-0.5 text-xs font-semibold text-muted">
          {cur.store.log.length} økter
        </span>
      </div>
      <textarea
        value={cur.logNote}
        maxLength={240}
        placeholder="Noter hva du øvde på, tempo eller fokus til neste gang…"
        onChange={(event) => {
          cur.logNote = event.target.value;
          redraw();
        }}
        className="mt-2.5 min-h-16 w-full rounded-xl border border-line bg-header px-3 py-2 text-sm text-fg"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            saveSession(cur.logNote.trim());
            cur.logNote = "";
            redraw();
          }}
          className="metro-press min-h-10 rounded-xl bg-accent px-3.5 text-xs font-bold text-bg"
        >
          Lagre
        </button>
        <button
          type="button"
          onClick={() => {
            cur.logOpen = false;
            redraw();
          }}
          className="metro-press min-h-10 rounded-xl border border-line bg-header px-3 text-xs font-semibold text-fg"
        >
          Lukk
        </button>
        <button
          type="button"
          onClick={() => {
            cur.store.log = [];
            persist();
            redraw();
          }}
          className="metro-press min-h-10 rounded-xl border border-line bg-header px-3 text-xs font-semibold text-muted hover:text-no"
        >
          Tøm
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {cur.store.log.map((entry, index) => (
          <div key={`${entry.t}-${index}`} className="rounded-xl border border-line/70 bg-header/60 p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-accent">
                {stamp(entry.t)} · {entry.playing} min
              </p>
              <button
                type="button"
                onClick={() => {
                  cur.store.log = cur.store.log.filter((_, item) => item !== index);
                  persist();
                  redraw();
                }}
                className="text-xs font-medium text-muted hover:text-no"
              >
                Slett
              </button>
            </div>
            <p className="mt-1 text-muted">{entry.done.length ? entry.done.join(", ") : "—"}</p>
            {entry.note ? <p className="mt-1 font-medium text-fg">{entry.note}</p> : null}
          </div>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <section className="space-y-3.5 pb-6">
      {topTimelineCard}

      <div className="grid items-start gap-4 md:grid-cols-[1.22fr_0.92fr]">
        {/* Left Column: 4 Interactive Practice Block Cards */}
        <ol
          className={
            playing
              ? "order-2 grid list-none gap-3 p-0 md:order-1"
              : "order-1 grid list-none gap-3 p-0"
          }
        >
          {cur.store.items.map((item) => {
            const isDone = cur.store.done.includes(item.id);
            const isActive = cur.activeId === item.id;
            const enabled = item.on && !item.skipped;
            const dim = !enabled || isDone;
            const exercise = exercisesMap[item.id];
            const showTips = openTips[item.id] ?? (isActive || profile === "trumpet");
            const hasBlockBpm = playsMetronome(item.id);
            const itemBpm = blockBpmFor(item.id);

            return (
              <li
                key={item.id}
                className={isActive ? "oveplan-card is-active p-3.5 md:p-4" : "oveplan-card p-3.5 md:p-4"}
                style={{
                  ...blockStyle(item.id),
                  opacity: dim && !isActive ? 0.5 : 1,
                }}
              >
                {/* Row 1: Pill Switch, Title + Tool Badge, Minutes & Steppers */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <label className="oveplan-switch" data-checked={enabled}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        aria-label={blockName(item.id)}
                        onChange={(event) => {
                          replaceItem({
                            ...item,
                            on: event.target.checked,
                            skipped: event.target.checked ? false : item.skipped,
                          });
                          persist();
                          redraw();
                        }}
                        className="sr-only"
                      />
                      <span className="oveplan-switch-thumb" />
                    </label>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            item.skipped || (isDone && !isActive)
                              ? "truncate text-base font-bold line-through md:text-lg"
                              : "truncate text-base font-bold text-fg md:text-lg"
                          }
                        >
                          {blockName(item.id)}
                        </span>
                        <span className="rounded-lg border border-line bg-header px-2.5 py-0.5 text-[11px] font-semibold text-muted">
                          {toolBadgeFor(item)}
                        </span>
                        {isActive ? (
                          <span className="plan-chip text-[11px]">
                            <span className="plan-chip-dot" />
                            <span>{cur.blockPaused ? "Pause" : "Aktiv nå"}</span>
                          </span>
                        ) : isDone ? (
                          <span className="rounded-lg bg-ok/15 px-2 py-0.5 text-[11px] font-bold text-ok">
                            Ferdig ✓
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Minute Readout + Steppers */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className="min-w-12 text-right text-xl font-extrabold tabular-nums md:text-2xl"
                      style={{ color: BLOCK_COLOR[item.id] }}
                    >
                      {item.skipped || !item.on ? "—" : item.mins}
                    </span>
                    <span className="mr-1 text-xs font-semibold text-muted">min</span>
                    <button
                      type="button"
                      disabled={!item.on || item.skipped || item.mins <= 1}
                      onClick={() => changeMins(item.id, -1)}
                      className="metro-press size-10 rounded-xl border border-line bg-header text-base font-bold text-fg disabled:opacity-30"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => changeMins(item.id, 1)}
                      className="metro-press size-10 rounded-xl border border-line bg-header text-base font-bold text-fg"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      disabled={!item.on || item.skipped}
                      onClick={() => skip(item.id)}
                      className="metro-press min-h-10 rounded-xl border border-line bg-header px-2.5 text-xs font-semibold text-muted hover:text-fg disabled:opacity-30"
                    >
                      Hopp
                    </button>
                  </div>
                </div>

                {/* Row 2: Quick Duration Buttons + Per-Block BPM Buttons + Tips Toggle + Direct Launch */}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line/50 pt-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {QUICK_MINS.map((m) => {
                      const activeMin = enabled && item.mins === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setExactMins(item.id, m)}
                          className={
                            activeMin
                              ? "metro-press min-h-7 rounded-lg border border-accent/60 bg-accent/15 px-2.5 text-[11px] font-bold text-accent"
                              : "metro-press min-h-7 rounded-lg border border-line bg-header px-2.5 text-[11px] font-semibold text-muted hover:text-fg"
                          }
                        >
                          {m}m
                        </button>
                      );
                    })}

                    {hasBlockBpm ? (
                      <div className="ml-1.5 flex flex-wrap items-center gap-1 border-l border-line/60 pl-2">
                        {QUICK_BPMS.map((bpmVal) => {
                          const activeBpm = itemBpm === bpmVal;
                          return (
                            <button
                              key={bpmVal}
                              type="button"
                              onClick={() => setBlockBpm(item.id, bpmVal)}
                              className={
                                activeBpm
                                  ? "metro-press min-h-7 rounded-lg border border-accent/60 bg-accent/15 px-2 text-[11px] font-bold text-accent tabular-nums"
                                  : "metro-press min-h-7 rounded-lg border border-line bg-header px-2 text-[11px] font-semibold text-muted tabular-nums hover:text-fg"
                              }
                            >
                              {bpmVal} BPM
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {exercise ? (
                      <button
                        type="button"
                        aria-expanded={showTips}
                        onClick={() =>
                          setOpenTips((prev) => ({
                            ...prev,
                            [item.id]: !showTips,
                          }))
                        }
                        className="metro-press min-h-8 rounded-lg border border-line bg-header px-2.5 text-[11px] font-semibold text-muted hover:text-fg"
                      >
                        {showTips ? "Skjul tips" : "Øvelsestips"}
                      </button>
                    ) : null}

                    {enabled && !isActive ? (
                      <button
                        type="button"
                        onClick={() => {
                          saveBlockBpm(cur.activeId);
                          cur.store.done = cur.store.done.filter((id) => id !== item.id);
                          persist();
                          beginBlock(item, true);
                        }}
                        className="metro-press min-h-8 rounded-lg border border-line bg-header px-3 text-xs font-bold text-fg hover:border-accent/60 hover:text-accent"
                      >
                        Kjør blokk
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Row 3: Exercise Tips (Trumpet / Mallets) */}
                {exercise && showTips ? (
                  <div className="mt-2.5 rounded-xl border border-line/60 bg-header/70 px-3 py-2 text-xs">
                    <p className="font-bold text-fg/90">{exercise.title}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                      {exercise.items.map((tip, idx) => (
                        <li key={idx}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Row 4: Repertoar Noter / Setlist Linking Bar (always visible on rep card) */}
                {item.id === "rep" ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-line/70 bg-header/80 px-3 py-2">
                    <label htmlFor="oveplan-rep-target" className="shrink-0 text-xs font-semibold text-muted">
                      Koblet til Noter:
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
                      className="metro-field min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-fg"
                    >
                      <option value="">
                        {noterSheets.length === 0 && noterSetlists.length === 0
                          ? "Ingen kobling (last opp noteark i Noter først)"
                          : "Ingen kobling — velg noteark eller settliste…"}
                      </option>
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
                    <button
                      type="button"
                      onClick={openRepInNoter}
                      className="metro-press inline-flex min-h-9 shrink-0 items-center rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-accent hover:border-accent/60"
                    >
                      {cur.store.repTarget
                        ? "Åpne i Noter"
                        : noterSheets.length === 0
                          ? "+ Last opp i Noter"
                          : "Bibliotek"}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* Right Column: Live Session Hero + Command-Center Metronome + Log */}
        <div
          className={
            playing
              ? "order-1 space-y-3.5 md:order-2"
              : "order-2 space-y-3.5"
          }
        >
          {heroAndControlsCard}
          {metronomeAndRemoteCard}
          {logPanel}
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
