import { getProfile, type InstrumentProfile } from "./profile.ts";
import { audio, output, unlock } from "./pulse.ts";
import { readToolStore, writeToolStore } from "./tools.ts";

/** Norwegian chromatic pitch-class names (B = Bb, H = B natural). */
export const NOTE_NAMES_NB = [
  "C",
  "C♯",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "A♭",
  "A",
  "B",
  "H",
] as const;

export type TunerTransposition = "C" | "Bb" | "Eb" | "F";

export interface TranspositionOption {
  id: TunerTransposition;
  label: string;
  description: string;
  /** Semitones added to concert MIDI to get written pitch. */
  writtenOffset: number;
}

export const TRANSPOSITION_OPTIONS: ReadonlyArray<TranspositionOption> = [
  { id: "C", label: "C", description: "Klingende (slagverk / piano)", writtenOffset: 0 },
  { id: "Bb", label: "B", description: "B-trompet / klarinett (+2)", writtenOffset: 2 },
  { id: "Eb", label: "E♭", description: "Altsaksofon / ess-horn (+9)", writtenOffset: 9 },
  { id: "F", label: "F", description: "Valthorn (+7)", writtenOffset: 7 },
];

export type DroneWave = "sine" | "triangle";

export interface TunerSettings {
  a4Hz: number;
  transposition: TunerTransposition;
  droneOctave: 3 | 4 | 5;
  droneWave: DroneWave;
}

export const DEFAULT_A4_HZ = 442;
export const MIN_A4_HZ = 435;
export const MAX_A4_HZ = 448;
export const IN_TUNE_CENTS = 5;

export function defaultTunerSettings(profile: InstrumentProfile = getProfile()): TunerSettings {
  return {
    a4Hz: DEFAULT_A4_HZ,
    transposition: profile === "trumpet" ? "Bb" : "C",
    droneOctave: 4,
    droneWave: "triangle",
  };
}

export function clampA4(hz: number): number {
  if (!Number.isFinite(hz)) return DEFAULT_A4_HZ;
  return Math.max(MIN_A4_HZ, Math.min(MAX_A4_HZ, Math.round(hz)));
}

export function loadTunerSettings(profile: InstrumentProfile = getProfile()): TunerSettings {
  const fallback = defaultTunerSettings(profile);
  const raw = readToolStore("tuner", profile);
  const a4Hz = typeof raw.a4Hz === "number" ? clampA4(raw.a4Hz) : fallback.a4Hz;
  const transposition: TunerTransposition =
    raw.transposition === "C" || raw.transposition === "Bb" || raw.transposition === "Eb" || raw.transposition === "F"
      ? raw.transposition
      : fallback.transposition;
  const droneOctave: 3 | 4 | 5 =
    raw.droneOctave === 3 || raw.droneOctave === 4 || raw.droneOctave === 5
      ? raw.droneOctave
      : fallback.droneOctave;
  const droneWave: DroneWave =
    raw.droneWave === "sine" || raw.droneWave === "triangle" ? raw.droneWave : fallback.droneWave;
  return { a4Hz, transposition, droneOctave, droneWave };
}

export function saveTunerSettings(settings: TunerSettings, profile: InstrumentProfile = getProfile()): void {
  writeToolStore(
    "tuner",
    {
      a4Hz: clampA4(settings.a4Hz),
      transposition: settings.transposition,
      droneOctave: settings.droneOctave,
      droneWave: settings.droneWave,
    },
    profile,
  );
}

export function midiToFrequency(midi: number, a4Hz: number = DEFAULT_A4_HZ): number {
  return clampA4(a4Hz) * 2 ** ((midi - 69) / 12);
}

export function midiToNorwegianLabel(midi: number): { name: string; octave: number; full: string } {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  const name = NOTE_NAMES_NB[pc]!;
  return { name, octave, full: `${name}${octave}` };
}

export interface PitchReading {
  /** Measured fundamental frequency in Hz. */
  hz: number;
  /** Exact target frequency of the nearest chromatic note in Hz. */
  targetHz: number;
  /** Concert MIDI note number (A4 = 69). */
  concertMidi: number;
  /** Written MIDI note number after applying transposition. */
  writtenMidi: number;
  /** Written Norwegian note name (e.g. "C", "B", "H", "F♯"). */
  noteName: string;
  /** Written octave number. */
  octave: number;
  /** Written full label (e.g. "C4"). */
  label: string;
  /** Concert full label (e.g. "B3") for reference when transposed. */
  concertLabel: string;
  /** Deviation from nearest semitone in cents (-50 .. +50). */
  cents: number;
  /** True when within ±IN_TUNE_CENTS (5 cents). */
  inTune: boolean;
}

export function freqToPitchReading(
  hz: number,
  a4Hz: number = DEFAULT_A4_HZ,
  transposition: TunerTransposition = "C",
): PitchReading | null {
  if (!Number.isFinite(hz) || hz < 27.5 || hz > 4200) return null;
  const safeA4 = clampA4(a4Hz);
  const exactMidi = 69 + 12 * Math.log2(hz / safeA4);
  const concertMidi = Math.round(exactMidi);
  const cents = Math.max(-50, Math.min(50, (exactMidi - concertMidi) * 100));
  const targetHz = midiToFrequency(concertMidi, safeA4);

  const transDef = TRANSPOSITION_OPTIONS.find((t) => t.id === transposition) ?? TRANSPOSITION_OPTIONS[0]!;
  const writtenMidi = concertMidi + transDef.writtenOffset;

  const written = midiToNorwegianLabel(writtenMidi);
  const concert = midiToNorwegianLabel(concertMidi);

  return {
    hz,
    targetHz,
    concertMidi,
    writtenMidi,
    noteName: written.name,
    octave: written.octave,
    label: written.full,
    concertLabel: concert.full,
    cents,
    inTune: Math.abs(cents) <= IN_TUNE_CENTS,
  };
}

export interface YinDetectionResult {
  hz: number;
  clarity: number;
  rms: number;
}

export interface YinOptions {
  minHz?: number;
  maxHz?: number;
  minRms?: number;
  threshold?: number;
}

/**
 * YIN fundamental frequency estimator with Cumulative Mean Normalized Difference (CMND)
 * and parabolic lag interpolation for sub-cent chromatic tuner accuracy.
 */
export function detectPitchYin(
  buffer: Float32Array,
  sampleRate: number,
  opts: YinOptions = {},
): YinDetectionResult | null {
  const n = buffer.length;
  if (n < 512 || !Number.isFinite(sampleRate) || sampleRate < 8000) return null;

  const minHz = opts.minHz ?? 32;
  const maxHz = opts.maxHz ?? 2200;
  const minRms = opts.minRms ?? 0.012;
  const threshold = opts.threshold ?? 0.15;

  // Compute RMS & remove DC offset
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buffer[i]!;
  mean /= n;

  let energy = 0;
  for (let i = 0; i < n; i++) {
    const v = buffer[i]! - mean;
    energy += v * v;
  }
  const rms = Math.sqrt(energy / n);
  if (rms < minRms) return null;

  const half = Math.floor(n / 2);
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxTau = Math.min(half - 2, Math.ceil(sampleRate / minHz));
  if (maxTau <= minTau + 2) return null;

  const diff = new Float32Array(maxTau + 2);
  for (let tau = 1; tau <= maxTau + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const d = buffer[i]! - buffer[i + tau]!;
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalized difference function (CMND)
  const cmnd = new Float32Array(maxTau + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau + 1; tau++) {
    running += diff[tau]!;
    cmnd[tau] = running > 0 ? (diff[tau]! * tau) / running : 1;
  }

  // Absolute threshold search: pick the first local minimum below threshold
  let tauEst = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmnd[tau]! < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1]! < cmnd[tau]!) {
        tau++;
      }
      tauEst = tau;
      break;
    }
  }

  // Fallback to global minimum if slightly above threshold (helpful for percussive mallet attacks)
  if (tauEst === -1) {
    let bestTau = -1;
    let bestVal = 0.24;
    for (let tau = minTau; tau <= maxTau; tau++) {
      const v = cmnd[tau]!;
      if (v < bestVal) {
        bestVal = v;
        bestTau = tau;
      }
    }
    if (bestTau === -1) return null;
    tauEst = bestTau;
  }

  // Parabolic interpolation around tauEst for sub-sample lag precision
  let betterTau = tauEst;
  if (tauEst > 1 && tauEst < maxTau) {
    const s0 = cmnd[tauEst - 1]!;
    const s1 = cmnd[tauEst]!;
    const s2 = cmnd[tauEst + 1]!;
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-12) {
      const shift = (s2 - s0) / denom;
      if (Math.abs(shift) < 1) {
        betterTau = tauEst + shift;
      }
    }
  }

  const hz = sampleRate / betterTau;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) return null;

  const clarity = Math.max(0, Math.min(1, 1 - cmnd[tauEst]!));
  return { hz, clarity, rms };
}

/**
 * Smooths rapid frame-to-frame pitch jitter while snapping instantly
 * whenever the player moves to a different note (> 80 cents jump).
 */
export class PitchSmoother {
  private hz: number | null = null;
  private readonly alpha: number;
  private readonly resetCents: number;

  constructor(alpha = 0.28, resetCents = 80) {
    this.alpha = alpha;
    this.resetCents = resetCents;
  }

  push(nextHz: number): number {
    if (this.hz === null) {
      this.hz = nextHz;
      return nextHz;
    }
    const diffCents = Math.abs(1200 * Math.log2(nextHz / this.hz));
    if (diffCents > this.resetCents) {
      this.hz = nextHz;
      return nextHz;
    }
    this.hz = this.hz + this.alpha * (nextHz - this.hz);
    return this.hz;
  }

  reset(): void {
    this.hz = null;
  }
}

/** Shared single-AudioContext chromatic drone generator for Tuner. */
interface ActiveDrone {
  osc: OscillatorNode;
  filter: BiquadFilterNode | null;
  gain: GainNode;
  midi: number;
}

let activeDrone: ActiveDrone | null = null;

export function getActiveDroneMidi(): number | null {
  return activeDrone ? activeDrone.midi : null;
}

export function stopTunerDrone(): void {
  const cur = activeDrone;
  activeDrone = null;
  if (!cur) return;
  try {
    const ctx = cur.gain.context;
    const now = ctx.currentTime;
    cur.gain.gain.cancelScheduledValues(now);
    cur.gain.gain.setValueAtTime(Math.max(0.0001, cur.gain.gain.value), now);
    cur.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    cur.osc.stop(now + 0.055);
  } catch {
    try {
      cur.osc.stop();
    } catch {
      /* already stopped */
    }
  }
}

export function startTunerDrone(
  concertMidi: number,
  a4Hz: number = DEFAULT_A4_HZ,
  wave: DroneWave = "triangle",
): boolean {
  stopTunerDrone();
  try {
    const nav = globalThis.navigator as (Navigator & { audioSession?: { type: string } }) | undefined;
    if (nav?.audioSession) nav.audioSession.type = "playback";
  } catch {
    /* ignore */
  }
  const ctx = unlock() ?? audio();
  if (!ctx) return false;
  try {
    const dest = output() ?? ctx.destination;
    const freq = midiToFrequency(concertMidi, a4Hz);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    let filter: BiquadFilterNode | null = null;
    if (wave === "triangle") {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(Math.min(2800, freq * 3.8), ctx.currentTime);
      filter.Q.value = 0.7;
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(wave === "triangle" ? 0.16 : 0.2, now + 0.04);
    gain.connect(dest);
    osc.start(now);

    const handle: ActiveDrone = { osc, filter, gain, midi: concertMidi };
    activeDrone = handle;
    osc.onended = () => {
      if (activeDrone === handle) {
        activeDrone = null;
      }
    };
    return true;
  } catch {
    stopTunerDrone();
    return false;
  }
}

export function updateTunerDronePitch(concertMidi: number, a4Hz: number = DEFAULT_A4_HZ): void {
  if (!activeDrone) return;
  try {
    const ctx = activeDrone.gain.context;
    const freq = midiToFrequency(concertMidi, a4Hz);
    activeDrone.midi = concertMidi;
    activeDrone.osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.015);
    if (activeDrone.filter) {
      activeDrone.filter.frequency.setTargetAtTime(Math.min(2800, freq * 3.8), ctx.currentTime, 0.015);
    }
  } catch {
    /* ignore */
  }
}
