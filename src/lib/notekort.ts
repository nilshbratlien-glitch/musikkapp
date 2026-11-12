import { readToolStore, writeToolStore } from "./tools.ts";

export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;

export const VALVE_COMBOS = ["0", "1", "2", "1-2", "2-3", "1-3", "1-2-3"] as const;
export type ValveCombo = (typeof VALVE_COMBOS)[number];
export type DrillMode = "names" | "valves";

export type Clef = "treble" | "bass";
export type Lang = "no" | "en";

export type NoteStats = { r: number; w: number };

export type NoteSelection = { treble: number[]; bass: number[] };

export type NoteState = {
  sel: NoteSelection;
  lang: Lang;
  stats: Record<string, NoteStats>;
  mode?: DrillMode;
};

export const CLEFS: Record<
  Clef,
  { label: string; bottom: number; min: number; max: number; presets: [string, number, number][] }
> = {
  treble: {
    label: "G-nøkkel",
    bottom: 30,
    min: 24,
    max: 56,
    presets: [
      ["I systemet", 30, 38],
      ["Under systemet", 24, 29],
      ["Over systemet", 39, 45],
    ],
  },
  bass: {
    label: "F-nøkkel",
    bottom: 18,
    min: 14,
    max: 35,
    presets: [
      ["I systemet", 18, 26],
      ["Under systemet", 14, 17],
      ["Over systemet", 27, 35],
    ],
  },
};

export const INSTRUMENTS: [string, number, number][] = [
  ["Klokkespill", 25, 42],
  ["Xylofon 3,5", 24, 49],
  ["Xylofon 4", 21, 49],
  ["Vibrafon 3", 24, 45],
  ["Marimba 4,3", 19, 49],
  ["Marimba 4,5", 17, 49],
  ["Marimba 5", 14, 49],
];

export const TRUMPET_INSTRUMENTS: [string, number, number][] = [
  ["Nybegynner (C4–G4)", 28, 32],
  ["Korps (C4–D5)", 28, 36],
  ["Utvidet (G3–G5)", 25, 39],
];

const NATURAL_VALVE_BY_IDX: Record<number, ValveCombo> = {
  24: "1-2-3", // F3
  25: "1-3",   // G3
  26: "1-2",   // A3
  27: "2",     // B3 / H3
  28: "0",     // C4
  29: "1-3",   // D4
  30: "1-2",   // E4
  31: "1",     // F4
  32: "0",     // G4
  33: "1-2",   // A4
  34: "2",     // B4 / H4
  35: "0",     // C5
  36: "1",     // D5
  37: "0",     // E5
  38: "1",     // F5
  39: "0",     // G5
  40: "1-2",   // A5
  41: "2",     // B5 / H5
  42: "0",     // C6
};

export function valveForIdx(idx: number): ValveCombo {
  if (idx in NATURAL_VALVE_BY_IDX) {
    return NATURAL_VALVE_BY_IDX[idx]!;
  }
  const mod = idx % 7;
  if (mod === 0 || mod === 4) return "0";
  if (mod === 3) return "1";
  if (mod === 6) return "2";
  if (mod === 2 || mod === 5) return "1-2";
  return "1-3";
}

export const STAFF = { gap: 14, bottom: 155, noteX: 152 };

export function emptyNoteState(): NoteState {
  return { sel: { treble: [], bass: [] }, lang: "no", stats: {} };
}

export function letterName(idx: number, lang: Lang) {
  const letter = LETTERS[idx % 7] ?? "C";
  return letter === "B" && lang === "no" ? "H" : letter;
}

export function fullName(idx: number, lang: Lang) {
  return letterName(idx, lang) + Math.floor(idx / 7);
}

export function poolOf(sel: NoteSelection) {
  const pool: string[] = [];
  for (const clef of ["treble", "bass"] as const) {
    for (const idx of sel[clef]) pool.push(`${clef}:${idx}`);
  }
  return pool;
}

export function drawCard(pool: string[], prev: string | null, rng: () => number = Math.random) {
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0] ?? null;
  let pick = pool[0] ?? null;
  do {
    pick = pool[Math.floor(rng() * pool.length)] ?? pick;
  } while (pick === prev);
  return pick;
}

export function yFor(clef: Clef, idx: number) {
  return STAFF.bottom - (idx - CLEFS[clef].bottom) * (STAFF.gap / 2);
}

export function ledgerSteps(clef: Clef, idx: number) {
  const step = idx - CLEFS[clef].bottom;
  const steps: number[] = [];
  for (let s = 10; s <= step; s += 2) steps.push(s);
  for (let s = -2; s >= step; s -= 2) steps.push(s);
  return steps;
}

export function viewBoxFor(keys: string[]) {
  let yMin = 99;
  let yMax = 155;
  for (const key of keys) {
    const [clef, raw] = key.split(":");
    if (clef !== "treble" && clef !== "bass") continue;
    const y = yFor(clef, Number(raw));
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const top = Math.min(yMin - 20, 58);
  const bot = Math.max(yMax + 20, 198);
  return `0 ${top} 220 ${bot - top}`;
}

export function worstNotes(stats: Record<string, NoteStats>, limit = 14) {
  return Object.keys(stats)
    .map((key) => {
      const stat = stats[key] ?? { r: 0, w: 0 };
      const n = stat.r + stat.w;
      return { key, n, pct: n ? stat.r / n : 0 };
    })
    .filter((row) => row.n > 0)
    .sort((a, b) => a.pct - b.pct || b.n - a.n)
    .slice(0, limit);
}

function numberList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

export function parseNoteState(raw: unknown): NoteState {
  const base = emptyNoteState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const record = raw as Record<string, unknown>;
  const sel = record.sel;
  if (sel && typeof sel === "object" && !Array.isArray(sel)) {
    const choice = sel as Record<string, unknown>;
    base.sel = { treble: numberList(choice.treble), bass: numberList(choice.bass) };
  }
  if (record.lang === "en" || record.lang === "no") base.lang = record.lang;
  if (record.mode === "names" || record.mode === "valves") base.mode = record.mode;
  if (record.stats && typeof record.stats === "object" && !Array.isArray(record.stats)) {
    for (const [key, value] of Object.entries(record.stats)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const stat = value as Record<string, unknown>;
      if (typeof stat.r === "number" && typeof stat.w === "number") {
        base.stats[key] = { r: stat.r, w: stat.w };
      }
    }
  }
  return base;
}

export function loadNoteState() {
  return parseNoteState(readToolStore("notekort"));
}

export function saveNoteState(state: NoteState) {
  const payload: Record<string, unknown> = {
    sel: state.sel,
    lang: state.lang,
    stats: state.stats,
  };
  if (state.mode) payload.mode = state.mode;
  return writeToolStore("notekort", payload);
}

export function selectionForInstrument(lo: number, hi: number): NoteSelection {
  const sel: NoteSelection = { treble: [], bass: [] };
  for (let idx = lo; idx <= hi; idx++) {
    if (idx >= CLEFS.treble.min && idx <= CLEFS.treble.max) sel.treble.push(idx);
    else if (idx >= CLEFS.bass.min && idx <= CLEFS.bass.max) sel.bass.push(idx);
  }
  return sel;
}
