import type { InstrumentProfile } from "./profile.ts";

export type DuetViewPart = "score" | "trumpet" | "mallets";
export type DuetStyle = "harmony" | "call_response" | "melody_comp";

export interface BladlesingSettings {
  instrumentId: string;
  mallets: number;
  texture: string;
  chordChance: number;
  clef: string;
  keyId: string;
  keyIds: string[];
  keyIndex: number;
  keyFilter: string;
  timeId: string;
  measures: number;
  tempo: number;
  rangeLow: number;
  rangeHigh: number;
  maxLeap: number;
  rhythms: string[];
  rests: string[];
  allowRests: boolean;
  rhythmDensity: number;
  syncopation: boolean;
  ties: boolean;
  accidentals: boolean;
  startTonic: boolean;
  endTonic: boolean;
  accents: boolean;
  staccato: boolean;
  legato: boolean;
  dynamics: boolean;
  rolls: string;
  showSticking: boolean;
  annotate: string;
  doubleStopChance: number;
  threeDouble: string;
  handSpanMin: number;
  handSpanMax: number;
  innerGapMax: number;
  maxGripShift: number;
  zoom: number;
  stopIntervals: string[];
  stopPlace: string;
  voicing: string;
  blockSize: string;
  duetEnabled: boolean;
  duetMalletInstrument: string;
  duetStyle: DuetStyle;
  duetViewPart: DuetViewPart;
  duetPlayTrumpet: boolean;
  duetPlayMallets: boolean;
  duetRangeTptLow: number;
  duetRangeTptHigh: number;
  duetRangeMalletLow: number;
  duetRangeMalletHigh: number;
  duetMallets: number;
  duetAllowChords: boolean;
  /** Sight-Reading Flow Mode: 1-bar count-in before playback starts. */
  flowCountIn: boolean;
  /** Sight-Reading Flow Mode: automatically generate & start next etude after playback finishes. */
  flowAutoNext: boolean;
  /** Seconds to wait before auto-advancing to the next etude. */
  flowAutoNextDelay: number;
  /** Sight-Reading Flow Mode ("Les forover"): fade out measures as playback enters them. */
  flowDisappearing: boolean;
}

export interface LevelPreset {
  rhythms: string[];
  rests: string[];
  maxLeap: number;
  rhythmDensity: number;
  measures: number;
  allowRests: boolean;
  syncopation: boolean;
  ties: boolean;
  accidentals: boolean;
  dynamics: boolean;
  hint: string;
}

export interface PracticeRecipe {
  id: string;
  label: string;
  description: string;
  patch: Partial<BladlesingSettings>;
}

export const LEGACY_STORAGE_KEY = "mallet-sr-settings-v3";

export const LOCAL_ONLY_SETTING_KEYS = new Set<keyof BladlesingSettings>([
  "duetViewPart",
  "duetPlayTrumpet",
  "duetPlayMallets",
  "zoom",
  "flowCountIn",
  "flowAutoNext",
  "flowAutoNextDelay",
  "flowDisappearing",
]);

export const DEFAULTS: BladlesingSettings = {
  instrumentId: "mar50",
  mallets: 2,
  texture: "mixed",
  chordChance: 0.28,
  clef: "auto",
  keyId: "C",
  keyIds: ["C"],
  keyIndex: 0,
  keyFilter: "all",
  timeId: "4/4",
  measures: 8,
  tempo: 80,
  rangeLow: 60,
  rangeHigh: 84,
  maxLeap: 5,
  rhythms: ["h", "q", "8"],
  rests: ["q", "8"],
  allowRests: true,
  rhythmDensity: 2,
  syncopation: false,
  ties: false,
  accidentals: false,
  startTonic: true,
  endTonic: true,
  accents: false,
  staccato: false,
  legato: false,
  dynamics: false,
  rolls: "off",
  showSticking: false,
  annotate: "off",
  doubleStopChance: 0.25,
  threeDouble: "auto",
  handSpanMin: 3,
  handSpanMax: 12,
  innerGapMax: 16,
  maxGripShift: 12,
  zoom: 1,
  stopIntervals: ["3", "4", "5", "6", "8"],
  stopPlace: "below",
  voicing: "closed",
  blockSize: "mix",
  duetEnabled: false,
  duetMalletInstrument: "xylo",
  duetStyle: "harmony",
  duetViewPart: "score",
  duetPlayTrumpet: true,
  duetPlayMallets: true,
  duetRangeTptLow: 60,
  duetRangeTptHigh: 74,
  duetRangeMalletLow: 60,
  duetRangeMalletHigh: 84,
  duetMallets: 2,
  duetAllowChords: true,
  flowCountIn: true,
  flowAutoNext: false,
  flowAutoNextDelay: 10,
  flowDisappearing: false,
};

export const TRUMPET_DEFAULTS: BladlesingSettings = {
  ...DEFAULTS,
  instrumentId: "trumpet",
  clef: "treble",
  mallets: 1,
  rangeLow: 60,
  rangeHigh: 72,
  maxLeap: 4,
  tempo: 76,
  showSticking: true,
  texture: "melody",
  rolls: "off",
  chordChance: 0,
  doubleStopChance: 0,
};

export const LEVELS: LevelPreset[] = [
  { rhythms: ["h", "q"], rests: ["q"], maxLeap: 2, rhythmDensity: 1, measures: 4, allowRests: false, syncopation: false, ties: false, accidentals: false, dynamics: false, hint: "Halvnoter og fjerdedeler. Bare trinn." },
  { rhythms: ["h", "q"], rests: ["h", "q"], maxLeap: 3, rhythmDensity: 1, measures: 4, allowRests: true, syncopation: false, ties: false, accidentals: false, dynamics: false, hint: "Pauser, og sprang på en ters." },
  { rhythms: ["h", "q", "8"], rests: ["q", "8"], maxLeap: 3, rhythmDensity: 2, measures: 4, allowRests: true, syncopation: false, ties: false, accidentals: false, dynamics: false, hint: "Åttendeler kommer inn. Sprangene er små." },
  { rhythms: ["hd", "h", "q", "8"], rests: ["h", "q", "8"], maxLeap: 4, rhythmDensity: 2, measures: 8, allowRests: true, syncopation: false, ties: false, accidentals: false, dynamics: false, hint: "Punkterte halvnoter. Sprang på en kvart." },
  { rhythms: ["h", "q", "qd", "8"], rests: ["q", "8"], maxLeap: 5, rhythmDensity: 3, measures: 8, allowRests: true, syncopation: false, ties: true, accidentals: false, dynamics: false, hint: "Punkterte fjerdedeler og bindebuer. Sprang på en kvint." },
  { rhythms: ["q", "qd", "8", "8d", "16"], rests: ["q", "8"], maxLeap: 5, rhythmDensity: 3, measures: 8, allowRests: true, syncopation: false, ties: true, accidentals: false, dynamics: false, hint: "Sekstendeler og punkterte åttendeler." },
  { rhythms: ["q", "qd", "8", "8d", "16"], rests: ["q", "8", "16"], maxLeap: 6, rhythmDensity: 4, measures: 8, allowRests: true, syncopation: true, ties: true, accidentals: true, dynamics: true, hint: "Synkoper, løse fortegn og dynamikk. Sprang på en sekst." },
  { rhythms: ["q", "qd", "8", "16", "8t"], rests: ["q", "8"], maxLeap: 6, rhythmDensity: 4, measures: 12, allowRests: true, syncopation: true, ties: true, accidentals: true, dynamics: true, hint: "Åttendelstrioler." },
  { rhythms: ["q", "qd", "8", "8d", "16", "16d", "8t"], rests: ["q", "8", "16"], maxLeap: 8, rhythmDensity: 5, measures: 12, allowRests: true, syncopation: true, ties: true, accidentals: true, dynamics: true, hint: "Punkterte sekstendeler og oktavsprang." },
  { rhythms: ["q", "qd", "qdd", "8", "8d", "16", "16d", "32", "8t", "16t"], rests: ["q", "8", "16"], maxLeap: 8, rhythmDensity: 5, measures: 12, allowRests: true, syncopation: true, ties: true, accidentals: true, dynamics: true, hint: "Trettitodeler og sekstendelstrioler. Full miks." },
];

export const RHYTHM_PRESETS: Record<string, string[]> = {
  simple: ["w", "h", "q", "8"],
  dotted: ["hd", "h", "qd", "q", "8d", "8", "16"],
  triplets: ["h", "q", "8", "8t", "16"],
  all: ["w", "hd", "h", "qd", "q", "qdd", "8d", "8", "16d", "16", "32", "8t", "16t"],
};

export const MALLET_RECIPES: PracticeRecipe[] = [
  {
    id: "warmup",
    label: "Oppvarming",
    description: "Rolig 2-køllers lesing i C, F og G-dur",
    patch: {
      duetEnabled: false,
      mallets: 2,
      texture: "melody",
      rhythms: ["h", "q", "8"],
      rests: ["q", "8"],
      allowRests: true,
      maxLeap: 3,
      rhythmDensity: 2,
      measures: 8,
      tempo: 76,
      keyIds: ["C", "F", "G"],
      syncopation: false,
      ties: false,
      accidentals: false,
      dynamics: false,
    },
  },
  {
    id: "rhythm",
    label: "Rytmefokus",
    description: "Synkoper, punkteringer og sekstendeler",
    patch: {
      duetEnabled: false,
      mallets: 2,
      texture: "melody",
      rhythms: ["q", "qd", "8", "8d", "16"],
      rests: ["q", "8", "16"],
      allowRests: true,
      maxLeap: 5,
      rhythmDensity: 4,
      measures: 8,
      tempo: 84,
      syncopation: true,
      ties: true,
      accidentals: false,
      dynamics: true,
    },
  },
  {
    id: "fourmallet",
    label: "4-køller",
    description: "Akkorder og koralgrep med 4 køller",
    patch: {
      duetEnabled: false,
      mallets: 4,
      texture: "mixed",
      chordChance: 0.45,
      rhythms: ["h", "q", "8"],
      rests: ["q"],
      allowRests: true,
      maxLeap: 4,
      rhythmDensity: 2,
      measures: 8,
      tempo: 68,
      syncopation: false,
      ties: false,
      accidentals: false,
    },
  },
  {
    id: "duet",
    label: "Korps-duett",
    description: "Samspill med trompet og slagverk",
    patch: {
      duetEnabled: true,
      duetStyle: "harmony",
      duetViewPart: "score",
    },
  },
];

export const TRUMPET_RECIPES: PracticeRecipe[] = [
  {
    id: "warmup",
    label: "Oppvarming",
    description: "Behagelig mellomregister med ventilgrep",
    patch: {
      duetEnabled: false,
      rangeLow: 60,
      rangeHigh: 69,
      rhythms: ["h", "q", "8"],
      rests: ["q"],
      allowRests: true,
      maxLeap: 3,
      rhythmDensity: 2,
      measures: 8,
      tempo: 72,
      showSticking: true,
      keyIds: ["C", "F", "Bb"],
      syncopation: false,
      ties: false,
      accidentals: false,
      legato: true,
    },
  },
  {
    id: "rhythm",
    label: "Rytmefokus",
    description: "Punkterte rytmer, synkoper og frasering",
    patch: {
      duetEnabled: false,
      rhythms: ["q", "qd", "8", "8d", "16"],
      rests: ["q", "8"],
      allowRests: true,
      maxLeap: 4,
      rhythmDensity: 3,
      measures: 8,
      tempo: 84,
      syncopation: true,
      ties: true,
      dynamics: true,
      legato: true,
    },
  },
  {
    id: "range",
    label: "Register & sprang",
    description: "Utvidet register og større intervallsprang",
    patch: {
      duetEnabled: false,
      rangeLow: 58,
      rangeHigh: 76,
      rhythms: ["h", "q", "qd", "8"],
      rests: ["q", "8"],
      allowRests: true,
      maxLeap: 6,
      rhythmDensity: 3,
      measures: 8,
      tempo: 80,
      ties: true,
      legato: true,
    },
  },
  {
    id: "duet",
    label: "Korps-duett",
    description: "Samspill med slagverk og trompet",
    patch: {
      duetEnabled: true,
      duetStyle: "harmony",
      duetViewPart: "score",
    },
  },
];

export function recipesForProfile(profile: InstrumentProfile): PracticeRecipe[] {
  return profile === "trumpet" ? TRUMPET_RECIPES : MALLET_RECIPES;
}

export function bladlesingStorageKey(profile: InstrumentProfile): string {
  return profile === "trumpet" ? "musikkapp.trumpet.bladlesing" : "musikkapp.bladlesing";
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function sameIds(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return [...(a ?? [])].sort().join("|") === [...(b ?? [])].sort().join("|");
}

export function detectLevelIndex(settings: BladlesingSettings): number {
  for (let i = 0; i < LEVELS.length; i++) {
    const p = LEVELS[i]!;
    if (!sameIds(p.rhythms, settings.rhythms)) continue;
    if (!sameIds(p.rests, settings.rests)) continue;
    if (p.maxLeap !== settings.maxLeap) continue;
    if (p.rhythmDensity !== settings.rhythmDensity) continue;
    if (Number(p.measures) !== Number(settings.measures)) continue;
    if (Boolean(p.allowRests) !== Boolean(settings.allowRests)) continue;
    if (Boolean(p.syncopation) !== Boolean(settings.syncopation)) continue;
    if (Boolean(p.ties) !== Boolean(settings.ties)) continue;
    if (Boolean(p.accidentals) !== Boolean(settings.accidentals)) continue;
    if (Boolean(p.dynamics) !== Boolean(settings.dynamics)) continue;
    const expectedLegato = settings.instrumentId === "trumpet" ? i + 1 >= 3 : false;
    if (Boolean(settings.legato) !== expectedLegato) continue;
    return i;
  }
  return -1;
}

export function applyLevelPreset(settings: BladlesingSettings, levelNumber: number): BladlesingSettings {
  const p = LEVELS[levelNumber - 1];
  if (!p) return settings;
  const next: BladlesingSettings = {
    ...settings,
    rhythms: [...p.rhythms],
    rests: [...p.rests],
    maxLeap: p.maxLeap,
    rhythmDensity: p.rhythmDensity,
    measures: p.measures,
    allowRests: p.allowRests,
    syncopation: p.syncopation,
    ties: p.ties,
    accidentals: p.accidentals,
    dynamics: p.dynamics,
    legato: settings.instrumentId === "trumpet" ? levelNumber >= 3 : false,
  };
  if (settings.instrumentId === "trumpet") {
    next.rangeLow = levelNumber <= 4 ? 60 : levelNumber <= 6 ? 58 : 55;
    next.rangeHigh = levelNumber <= 2 ? 67 : levelNumber <= 4 ? 72 : levelNumber <= 6 ? 74 : 79;
  }
  return next;
}

export function applyPracticeRecipe(settings: BladlesingSettings, recipe: PracticeRecipe): BladlesingSettings {
  const next: BladlesingSettings = {
    ...settings,
    ...recipe.patch,
  };
  if (recipe.patch.keyIds) {
    next.keyIds = [...recipe.patch.keyIds];
    next.keyId = recipe.patch.keyIds[0] ?? "C";
  }
  if (recipe.patch.rhythms) next.rhythms = [...recipe.patch.rhythms];
  if (recipe.patch.rests) next.rests = [...recipe.patch.rests];
  return next;
}

export function matchActiveRecipeId(settings: BladlesingSettings, profile: InstrumentProfile): string | null {
  const recipes = recipesForProfile(profile);
  if (settings.duetEnabled) {
    const duetRecipe = recipes.find((r) => r.patch.duetEnabled);
    if (duetRecipe) return duetRecipe.id;
  }
  for (const recipe of recipes) {
    if (recipe.patch.duetEnabled) continue;
    let matched = true;
    for (const [k, v] of Object.entries(recipe.patch)) {
      if (k === "tempo" || k === "keyIds" || k === "rangeLow" || k === "rangeHigh" || k === "chordChance") continue;
      const cur = settings[k as keyof BladlesingSettings];
      if (Array.isArray(v) && Array.isArray(cur)) {
        if (!sameIds(cur as string[], v as string[])) {
          matched = false;
          break;
        }
      } else if (cur !== v) {
        matched = false;
        break;
      }
    }
    if (matched) return recipe.id;
  }
  return null;
}

export function compactSyncSettings(settings: BladlesingSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(settings) as Array<keyof BladlesingSettings>) {
    if (!LOCAL_ONLY_SETTING_KEYS.has(key)) {
      out[key] = settings[key];
    }
  }
  return out;
}

export function loadBladlesingSettings(
  profile: InstrumentProfile,
  validKeyIds?: readonly string[],
  validInstrumentIds?: readonly string[],
): BladlesingSettings {
  const isTrumpet = profile === "trumpet";
  const key = bladlesingStorageKey(profile);
  const fallback = isTrumpet ? TRUMPET_DEFAULTS : DEFAULTS;
  const storage = browserStorage();
  if (!storage) return { ...fallback, keyIds: [...fallback.keyIds], rhythms: [...fallback.rhythms], rests: [...fallback.rests], stopIntervals: [...fallback.stopIntervals] };

  try {
    const raw = storage.getItem(key);
    let parsed: Record<string, unknown> | null = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const empty = !parsed || (typeof parsed === "object" && !parsed.instrumentId);
    if (empty && !isTrumpet) {
      const legacy = storage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        parsed = JSON.parse(legacy) as Record<string, unknown>;
        try {
          storage.setItem(key, JSON.stringify(parsed));
        } catch {
          /* ignore */
        }
      }
    }
    if (parsed && typeof parsed === "object") {
      const merged: BladlesingSettings = { ...fallback, ...(parsed as Partial<BladlesingSettings>) };
      if (isTrumpet) {
        merged.instrumentId = "trumpet";
        merged.clef = "treble";
        merged.mallets = 1;
        merged.texture = "melody";
        merged.rolls = "off";
        merged.chordChance = 0;
        merged.doubleStopChance = 0;
      } else if (
        merged.instrumentId === "trumpet" ||
        (validInstrumentIds && !validInstrumentIds.some((id) => id === merged.instrumentId && id !== "trumpet"))
      ) {
        merged.instrumentId = DEFAULTS.instrumentId;
      }
      if (!Array.isArray(parsed.keyIds)) {
        const legacyKey = typeof parsed.keyId === "string" ? parsed.keyId : "C";
        if (legacyKey === "random" && validKeyIds && validKeyIds.length) {
          merged.keyIds = [...validKeyIds];
        } else if (!validKeyIds || validKeyIds.includes(legacyKey)) {
          merged.keyIds = [legacyKey];
        } else {
          merged.keyIds = ["C"];
        }
      } else {
        const filtered = (parsed.keyIds as unknown[]).filter(
          (id): id is string => typeof id === "string" && (!validKeyIds || validKeyIds.includes(id)),
        );
        merged.keyIds = filtered.length ? filtered : ["C"];
      }
      return merged;
    }
  } catch {
    /* ignore */
  }
  return { ...fallback, keyIds: [...fallback.keyIds], rhythms: [...fallback.rhythms], rests: [...fallback.rests], stopIntervals: [...fallback.stopIntervals] };
}

export function saveBladlesingSettings(profile: InstrumentProfile, settings: BladlesingSettings): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(bladlesingStorageKey(profile), JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function clampZoom(zoom: number): number {
  return Math.round(Math.min(1.6, Math.max(0.7, zoom)) * 100) / 100;
}
