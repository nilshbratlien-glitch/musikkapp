export const RUDIMENTS = {
  singles: ["R", "L", "R", "L"],
  doubles: ["R", "R", "L", "L"],
  paradiddle: ["R", "L", "R", "R", "L", "R", "L", "L"],
  flam: ["lR", "rL"],
  accentSingles: ["R", "L", "R", "L"],
} as const;

export type RudimentId = keyof typeof RUDIMENTS;

export type MetronomeSettings = {
  start: number;
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

export function onClick(state: ClickState, settings: Pick<MetronomeSettings, "sub" | "bars" | "inc">) {
  const notesPerBeat = settings.sub / 4;
  const isDownbeat = state.beat % notesPerBeat === 0;
  const accent = isDownbeat && (state.beat / notesPerBeat) % 4 === 0;
  const beat = state.beat + 1;
  let bpm = state.bpm;
  let barCount = state.barCount;
  let stepped = false;
  if (beat % (notesPerBeat * 4) === 0) {
    barCount += 1;
    if (barCount >= settings.bars) {
      bpm += settings.inc;
      barCount = 0;
      stepped = true;
    }
  }
  return {
    accent,
    stepped,
    state: { bpm, beat, barCount },
  };
}

export function recordBest(bests: Record<string, number>, rudiment: string, bpm: number) {
  if (!bests[rudiment] || bpm > bests[rudiment]) {
    return { bests: { ...bests, [rudiment]: bpm }, updated: true };
  }
  return { bests, updated: false };
}
