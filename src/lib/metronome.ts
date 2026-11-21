export const RUDIMENTS = {
  singles: ["R", "L", "R", "L"],
  doubles: ["R", "R", "L", "L"],
  paradiddle: ["R", "L", "R", "R", "L", "R", "L", "L"],
  paradiddleDiddle: ["R", "L", "R", "R", "L", "L"],
  flam: ["lR", "rL"],
  accentSingles: ["R>", "l", "r", "l"],
  tripleStroke: ["R", "R", "R", "L", "L", "L"],
  sixStrokeRoll: ["R>", "l", "l", "r", "r", "L>"],
} as const;

export type RudimentId = keyof typeof RUDIMENTS;

export type MetronomeSettings = {
  start: number;
  maxBpm?: number;
  inc: number;
  bars: number;
  sub: number;
  rudiment: RudimentId;
};

export type ClickState = {
  bpm: number;
  beat: number;
  barCount: number;
};

export function secondsPerNote(bpm: number, subdivision: number) {
  const notesPerBeat = subdivision / 4;
  return 60 / bpm / notesPerBeat;
}

export function onClick(
  state: ClickState,
  settings: Pick<MetronomeSettings, "sub" | "bars" | "inc" | "maxBpm">,
) {
  const notesPerBeat = settings.sub / 4;
  const isDownbeat = state.beat % notesPerBeat === 0;
  const accent = isDownbeat && (state.beat / notesPerBeat) % 4 === 0;
  const beat = state.beat + 1;
  let bpm = state.bpm;
  let barCount = state.barCount;
  let stepped = false;
  let reachedMax = false;
  const cap = typeof settings.maxBpm === "number" && Number.isFinite(settings.maxBpm) ? settings.maxBpm : null;

  if (beat % (notesPerBeat * 4) === 0) {
    barCount += 1;
    if (barCount >= settings.bars) {
      barCount = 0;
      if (cap !== null && bpm >= cap) {
        reachedMax = true;
      } else {
        const nextBpm = cap !== null ? Math.min(cap, bpm + settings.inc) : bpm + settings.inc;
        if (nextBpm !== bpm) {
          bpm = nextBpm;
          stepped = true;
        }
        if (cap !== null && bpm >= cap) {
          reachedMax = true;
        }
      }
    }
  }
  return {
    accent,
    stepped,
    reachedMax,
    state: { bpm, beat, barCount },
  };
}

/** Step tempo back cleanly when a rudiment breaks down so the player can rebuild control. */
export function stepBackOnBreak(currentBpm: number, inc: number, minBpm: number): number {
  const drop = Math.max(4, Math.round(inc) * 2);
  return Math.max(minBpm, Math.round(currentBpm - drop));
}

export function recordBest(bests: Record<string, number>, rudiment: string, bpm: number) {
  if (!bests[rudiment] || bpm > bests[rudiment]) {
    return { bests: { ...bests, [rudiment]: bpm }, updated: true };
  }
  return { bests, updated: false };
}

export function commitBest(updated: boolean, saved: boolean) {
  if (!updated) return "same" as const;
  if (!saved) return "failed" as const;
  return "saved" as const;
}

export const METERS = ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8"] as const;

export type Meter = (typeof METERS)[number];

export function beatsInMeter(meter: Meter) {
  if (meter === "2/4") return 2;
  if (meter === "3/4") return 3;
  if (meter === "5/4") return 5;
  if (meter === "6/8") return 6;
  if (meter === "7/8") return 7;
  return 4;
}

export function nextPulse(beat: number, meter: Meter) {
  const beats = beatsInMeter(meter);
  const index = beat % beats;
  return { accent: index === 0, index, beat: beat + 1 };
}

/** The simple-meter chip for a beat count, or null (5, 7, and 6: plan beat counts are not compound/odd chips). */
export function meterForBeats(beats: number): Meter | null {
  if (beats === 2) return "2/4";
  if (beats === 3) return "3/4";
  if (beats === 4) return "4/4";
  return null;
}

export const SUBDIVISIONS = [1, 2, 3, 4] as const;

export type Subdivision = (typeof SUBDIVISIONS)[number];

/** One click in a bar of `beats` beats with `sub` clicks per beat. */
export function clickStep(tick: number, beats: number, sub: number) {
  const clicks = beats * sub;
  const index = tick % clicks;
  const subIndex = index % sub;
  return {
    accent: index === 0,
    downbeat: subIndex === 0,
    beatIndex: Math.floor(index / sub),
    tick: tick + 1,
  };
}

export function nextClick(tick: number, meter: Meter, subdivision: Subdivision) {
  return clickStep(tick, beatsInMeter(meter), subdivision);
}

export type ClickSound = "woodblock" | "rimshot" | "soft" | "beep";

export const DEFAULT_CLICK_SOUND: ClickSound = "woodblock";
export const DEFAULT_CLICK_VOLUME = 0.85;

export const CLICK_SOUND_OPTIONS: ReadonlyArray<{
  id: ClickSound;
  label: string;
  description: string;
}> = [
  { id: "woodblock", label: "Trekloss", description: "Tydelig trekloss-klikk for slagverk og korps" },
  { id: "rimshot", label: "Rimshot", description: "Skarp kantslag-klikk som skjærer gjennom lyd" },
  { id: "soft", label: "Myk", description: "Behagelig, varm klikk for lange økter" },
  { id: "beep", label: "Digital", description: "Klassisk digital metronom-pip" },
];

export function clampClickVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_CLICK_VOLUME;
  return Math.max(0.1, Math.min(1, Math.round(volume * 100) / 100));
}

export function isClickSound(value: unknown): value is ClickSound {
  return value === "woodblock" || value === "rimshot" || value === "soft" || value === "beep";
}

export type BeatAccent = "accent" | "normal" | "mute";

export function defaultBeatAccents(beats: number): BeatAccent[] {
  const count = Math.max(1, Math.round(beats));
  return Array.from({ length: count }, (_, idx) => (idx === 0 ? "accent" : "normal"));
}

export function cycleBeatAccent(current: BeatAccent): BeatAccent {
  if (current === "normal") return "accent";
  if (current === "accent") return "mute";
  return "normal";
}

export type GapPresetId = "off" | "3-1" | "2-1" | "1-1" | "4-2";

export interface GapPreset {
  id: GapPresetId;
  label: string;
  description: string;
  playBars: number;
  muteBars: number;
}

export const GAP_PRESETS: ReadonlyArray<GapPreset> = [
  { id: "off", label: "Av", description: "Klikk i alle takter", playBars: 0, muteBars: 0 },
  { id: "3-1", label: "3 + 1", description: "3 takter med klikk, 1 stille takt", playBars: 3, muteBars: 1 },
  { id: "2-1", label: "2 + 1", description: "2 takter med klikk, 1 stille takt", playBars: 2, muteBars: 1 },
  { id: "1-1", label: "1 + 1", description: "Annenhver takt stille", playBars: 1, muteBars: 1 },
  { id: "4-2", label: "4 + 2", description: "4 takter med klikk, 2 stille takter", playBars: 4, muteBars: 2 },
];

export function isGapPresetId(value: unknown): value is GapPresetId {
  return value === "off" || value === "3-1" || value === "2-1" || value === "1-1" || value === "4-2";
}

export function getGapPreset(id: GapPresetId): GapPreset {
  return GAP_PRESETS.find((p) => p.id === id) ?? GAP_PRESETS[0]!;
}

/** True when `barIndex` (0-based) falls inside the silent portion of a gap-trainer cycle. */
export function isBarMutedInGap(barIndex: number, playBars: number, muteBars: number): boolean {
  if (playBars <= 0 || muteBars <= 0 || barIndex < 0) return false;
  const cycle = playBars + muteBars;
  return barIndex % cycle >= playBars;
}

export const QUICK_TEMPOS = [60, 72, 80, 92, 104, 120, 138, 160] as const;

/** Traditional Italian tempo marking for a BPM value. */
export function tempoMarking(bpm: number): string {
  if (bpm < 45) return "Larghissimo";
  if (bpm < 60) return "Largo";
  if (bpm < 66) return "Larghetto";
  if (bpm < 76) return "Adagio";
  if (bpm < 108) return "Andante";
  if (bpm < 120) return "Moderato";
  if (bpm < 156) return "Allegro";
  if (bpm < 176) return "Vivace";
  if (bpm < 200) return "Presto";
  return "Prestissimo";
}
