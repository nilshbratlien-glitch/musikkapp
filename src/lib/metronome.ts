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

export function commitBest(updated: boolean, saved: boolean) {
  if (!updated) return "same" as const;
  if (!saved) return "failed" as const;
  return "saved" as const;
}

export const METERS = ["4/4", "3/4", "2/4", "6/8"] as const;

export type Meter = (typeof METERS)[number];

export function beatsInMeter(meter: Meter) {
  if (meter === "3/4") return 3;
  if (meter === "2/4") return 2;
  if (meter === "6/8") return 6;
  return 4;
}

export function nextPulse(beat: number, meter: Meter) {
  const beats = beatsInMeter(meter);
  const index = beat % beats;
  return { accent: index === 0, index, beat: beat + 1 };
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
