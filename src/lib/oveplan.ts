import type { CSSProperties } from "react";
import { getProfile, type InstrumentProfile } from "./profile.ts";
import { readToolStore, writeToolStore } from "./tools.ts";

export const BLOCKS = [
  { id: "twomallet", name: "2-mallet" },
  { id: "fourmallet", name: "4-mallet" },
  { id: "srf", name: "Bladlesing" },
  { id: "rep", name: "Repertoar" },
] as const;

export const TRUMPET_BLOCK_NAMES: Record<BlockId, string> = {
  twomallet: "Oppvarming",
  fourmallet: "Teknikk & skala",
  srf: "Bladlesing",
  rep: "Korpslekse",
};

export type BlockId = (typeof BLOCKS)[number]["id"];

export type PlanItem = { id: BlockId; on: boolean; mins: number; skipped: boolean };

export type PlanPreset = { id: string; name: string; blocks: { id: BlockId; mins: number }[] };

export type PlanLog = {
  t: number;
  playing: number;
  done: string[];
  planned: string[];
  note: string;
};

export type PlanStore = {
  items: PlanItem[];
  done: string[];
  log: PlanLog[];
  presets: PlanPreset[];
  sessionDate: string;
  bpmMap: Record<string, number>;
  bpm: number;
  beats: number;
  sub: number;
};

export const DEFAULT_MINS: Record<BlockId, number> = {
  twomallet: 12,
  fourmallet: 8,
  srf: 12,
  rep: 15,
};

export const TRUMPET_DEFAULT_MINS: Record<BlockId, number> = {
  twomallet: 3,
  fourmallet: 4,
  srf: 4,
  rep: 5,
};

export const TRUMPET_DEFAULT_PRESETS: PlanPreset[] = [
  {
    id: "trumpet-quick",
    name: "Kjapp 10 min",
    blocks: [
      { id: "twomallet", mins: 2 },
      { id: "fourmallet", mins: 3 },
      { id: "srf", mins: 2 },
      { id: "rep", mins: 3 },
    ],
  },
  {
    id: "trumpet-standard",
    name: "Korpsøkt 16 min",
    blocks: [
      { id: "twomallet", mins: 3 },
      { id: "fourmallet", mins: 4 },
      { id: "srf", mins: 4 },
      { id: "rep", mins: 5 },
    ],
  },
  {
    id: "trumpet-super",
    name: "Superøkt 25 min",
    blocks: [
      { id: "twomallet", mins: 4 },
      { id: "fourmallet", mins: 6 },
      { id: "srf", mins: 6 },
      { id: "rep", mins: 9 },
    ],
  },
];

export function defaultMinsFor(profile: InstrumentProfile = getProfile()): Record<BlockId, number> {
  return profile === "trumpet" ? TRUMPET_DEFAULT_MINS : DEFAULT_MINS;
}

export type ExerciseCard = {
  title: string;
  items: string[];
};

export const TRUMPET_EXERCISES: Record<BlockId, ExerciseCard> = {
  twomallet: {
    title: "Oppvarming",
    items: [
      "Spill på munnstykke. Lag sirene-lyd eller spill et morsomt stykke.",
      "Spill lange toner. Hold hver tone i åtte slag, med åtte slag pause i mellom! Husk god pust!",
    ],
  },
  fourmallet: {
    title: "Teknikk og skalaer",
    items: [
      "Lip slurs. Skift toner uten å bruke ventiler. C – G – C. Jobb deg stegvis nedover.",
      "Femtoneskala: Spill C – D – E – F – G – F – E – D – C. Sakte i starten. Øk tempo gradvis når teknikken sitter.",
      "Spill skalaen både legato og staccato.",
    ],
  },
  rep: {
    title: "Korpslekse",
    items: [
      "Øv på det vanskelige i små biter. For eksempel én takt av gangen. Begynn sakte, så kommer tempoet av seg selv!",
    ],
  },
  srf: {
    title: "Bladlesing",
    items: [
      "Se igjennom notene før du spiller. Sjekk toneart, taktart og rytmer!",
    ],
  },
};

/** The tool a block opens when it starts: 2- and 4-mallet practise with the metronome, SRF is sight-reading, and trumpet Korpslekse opens metronome with exercise instructions. */
export function blockTool(id: BlockId, profile: InstrumentProfile = getProfile()) {
  if (id === "twomallet" || id === "fourmallet") return "/metronom";
  if (id === "srf") return "/";
  if (id === "rep" && profile === "trumpet") return "/metronom";
  return null;
}

/** Each block's colour token; the plan list, the header pill and the Metronom chip share it. */
export const BLOCK_COLOR: Record<BlockId, string> = {
  twomallet: "var(--color-twomallet)",
  fourmallet: "var(--color-fourmallet)",
  srf: "var(--color-accent)",
  rep: "var(--color-rep)",
};

/** BLOCK_COLOR as rgb channels, for `rgb(var(--block-rgb) / a)` tints; Safari 15 has no color-mix(). */
export const BLOCK_RGB: Record<BlockId, string> = {
  twomallet: "var(--color-twomallet-rgb)",
  fourmallet: "var(--color-fourmallet-rgb)",
  srf: "var(--color-accent-rgb)",
  rep: "var(--color-rep-rgb)",
};

/** Inline style that sets a block's colour and its rgb channels. */
export function blockStyle(id: BlockId | null | undefined) {
  return {
    "--block": (id && BLOCK_COLOR[id]) ?? "var(--color-accent)",
    "--block-rgb": (id && BLOCK_RGB[id]) ?? "var(--color-accent-rgb)",
  } as CSSProperties;
}

export function playsMetronome(id: string | null) {
  return id === "twomallet" || id === "fourmallet";
}

export function blockName(id: string, profile: InstrumentProfile = getProfile()) {
  if (profile === "trumpet" && id in TRUMPET_BLOCK_NAMES) {
    return TRUMPET_BLOCK_NAMES[id as BlockId];
  }
  return BLOCKS.find((block) => block.id === id)?.name ?? id;
}

export function todayStamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fmtClock(secs: number) {
  const safe = Math.max(0, secs);
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function countdownSeconds(now: number, endsAt: number, remainMs: number, paused: boolean) {
  const ms = paused || !endsAt ? remainMs : endsAt - now;
  const safe = Math.max(0, ms);
  return safe <= 0 ? 0 : Math.ceil(safe / 1000);
}

export function clampBpm(value: number) {
  return Math.max(40, Math.min(220, Math.round(value)));
}

export function bpmFromTaps(taps: number[]) {
  if (taps.length < 2) return null;
  const span = taps[taps.length - 1]! - taps[0]!;
  if (span <= 0) return null;
  return clampBpm((60000 / span) * (taps.length - 1));
}

function isBlockId(value: unknown): value is BlockId {
  return BLOCKS.some((block) => block.id === value);
}

export function ensureItems(raw: unknown, profile: InstrumentProfile = getProfile()): PlanItem[] {
  const minsMap = defaultMinsFor(profile);
  const have = new Map<string, PlanItem>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Partial<PlanItem>;
      if (!isBlockId(row.id)) continue;
      have.set(row.id, {
        id: row.id,
        on: typeof row.on === "boolean" ? row.on : true,
        mins: typeof row.mins === "number" && row.mins > 0 ? row.mins : minsMap[row.id],
        skipped: !!row.skipped,
      });
    }
  }
  return BLOCKS.map((block) => {
    const prev = have.get(block.id);
    return (
      prev ?? { id: block.id, on: true, mins: minsMap[block.id], skipped: false }
    );
  });
}

export function liveItems(items: PlanItem[]) {
  return items.filter((item) => item.on && !item.skipped && item.mins > 0);
}

export function playingSum(items: PlanItem[]) {
  return liveItems(items).reduce((sum, item) => sum + item.mins, 0);
}

export function nextUndone(items: PlanItem[], done: string[], exceptId: string | null) {
  return liveItems(items).find((item) => item.id !== exceptId && !done.includes(item.id)) ?? null;
}

export function bumpItem(item: PlanItem, dir: number): PlanItem | null {
  const mins = item.mins + dir;
  if (mins < 1 || mins > 90) return null;
  return { ...item, mins, on: true, skipped: false };
}

export function applyPreset(preset: PlanPreset, profile: InstrumentProfile = getProfile()): PlanItem[] {
  const minsMap = defaultMinsFor(profile);
  const chosen = new Map(preset.blocks.map((block) => [block.id, block.mins]));
  return BLOCKS.map((block) => ({
    id: block.id,
    on: chosen.has(block.id),
    mins: chosen.get(block.id) ?? minsMap[block.id],
    skipped: false,
  }));
}

export function emptyPlanStore(profile: InstrumentProfile = getProfile()): PlanStore {
  return {
    items: ensureItems([], profile),
    done: [],
    log: [],
    presets:
      profile === "trumpet"
        ? TRUMPET_DEFAULT_PRESETS.map((p) => ({
            id: p.id,
            name: p.name,
            blocks: p.blocks.map((b) => ({ ...b })),
          }))
        : [],
    sessionDate: "",
    bpmMap: {},
    bpm: 80,
    beats: 4,
    sub: 1,
  };
}

export function parsePlanStore(raw: unknown, profile: InstrumentProfile = getProfile()): PlanStore {
  const base = emptyPlanStore(profile);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const record = raw as Record<string, unknown>;
  base.items = ensureItems(record.items, profile);
  if (Array.isArray(record.done)) base.done = record.done.filter((id): id is string => typeof id === "string");
  base.done = base.done.filter((id) => base.items.some((item) => item.id === id));
  if (Array.isArray(record.log)) {
    base.log = record.log.filter((entry): entry is PlanLog => {
      if (!entry || typeof entry !== "object") return false;
      const row = entry as Partial<PlanLog>;
      return typeof row.t === "number" && Array.isArray(row.done) && Array.isArray(row.planned);
    });
  }
  if (Array.isArray(record.presets)) {
    base.presets = record.presets.flatMap((preset) => {
      if (!preset || typeof preset !== "object") return [];
      const row = preset as Partial<PlanPreset>;
      if (typeof row.id !== "string" || typeof row.name !== "string" || !Array.isArray(row.blocks)) return [];
      const blocks = row.blocks.flatMap((block) => {
        if (!block || typeof block !== "object") return [];
        const item = block as { id?: unknown; mins?: unknown };
        if (!isBlockId(item.id) || typeof item.mins !== "number") return [];
        return [{ id: item.id, mins: item.mins }];
      });
      return [{ id: row.id, name: row.name, blocks }];
    });
  }
  if (typeof record.sessionDate === "string") base.sessionDate = record.sessionDate;
  if (record.bpmMap && typeof record.bpmMap === "object" && !Array.isArray(record.bpmMap)) {
    for (const [key, value] of Object.entries(record.bpmMap)) {
      if (typeof value === "number") base.bpmMap[key] = value;
    }
  }
  if (typeof record.bpm === "number") base.bpm = clampBpm(record.bpm);
  if (typeof record.beats === "number") base.beats = record.beats;
  if (typeof record.sub === "number") base.sub = record.sub;
  return base;
}

export function rollSession(store: PlanStore, today = todayStamp()) {
  if (store.sessionDate === today) return { ...store, rolled: false };
  return {
    ...store,
    done: [],
    items: store.items.map((item) => ({ ...item, skipped: false })),
    sessionDate: today,
    rolled: true,
  };
}

export function loadPlanStore(now = new Date(), profile: InstrumentProfile = getProfile()) {
  return rollSession(parsePlanStore(readToolStore("oveplan", profile), profile), todayStamp(now));
}

export function savePlanStore(store: PlanStore, profile: InstrumentProfile = getProfile()) {
  return writeToolStore(
    "oveplan",
    {
      items: store.items,
      done: store.done,
      log: store.log,
      presets: store.presets,
      sessionDate: store.sessionDate,
      bpmMap: store.bpmMap,
      bpm: store.bpm,
      beats: store.beats,
      sub: store.sub,
    },
    profile,
  );
}
