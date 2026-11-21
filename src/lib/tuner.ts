import { getProfile, type InstrumentProfile } from "./profile.ts";
import { audio, auxOutput, unlock } from "./pulse.ts";
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
export type DroneOctave = 2 | 3 | 4 | 5;
export type TunerSensitivity = "quiet" | "normal" | "loud";

export interface SensitivityOption {
  id: TunerSensitivity;
  label: string;
  description: string;
  minRms: number;
}

export const SENSITIVITY_OPTIONS: ReadonlyArray<SensitivityOption> = [
  { id: "quiet", label: "Stille", description: "Stille øverom / svak klang", minRms: 0.005 },
  { id: "normal", label: "Normal", description: "Standard øving", minRms: 0.012 },
  { id: "loud", label: "Korpssal", description: "Støyende rom / samspill", minRms: 0.026 },
];

export interface TunerSettings {
  a4Hz: number;
  transposition: TunerTransposition;
  droneOctave: DroneOctave;
  droneWave: DroneWave;
  droneVolume: number;
  sensitivity: TunerSensitivity;
}

export const DEFAULT_A4_HZ = 442;
export const MIN_A4_HZ = 435;
export const MAX_A4_HZ = 448;
export const IN_TUNE_CENTS = 5;
export const DEFAULT_DRONE_VOLUME = 0.7;

export function defaultTunerSettings(profile: InstrumentProfile = getProfile()): TunerSettings {
  return {
    a4Hz: DEFAULT_A4_HZ,
    transposition: profile === "trumpet" ? "Bb" : "C",
    droneOctave: 4,
    droneWave: "triangle",
    droneVolume: DEFAULT_DRONE_VOLUME,
    sensitivity: "normal",
  };
}

export function clampA4(hz: number): number {
  if (!Number.isFinite(hz)) return DEFAULT_A4_HZ;
  return Math.max(MIN_A4_HZ, Math.min(MAX_A4_HZ, Math.round(hz)));
}

export function clampDroneVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_DRONE_VOLUME;
  return Math.max(0.1, Math.min(1, Math.round(volume * 100) / 100));
}

export function getSensitivityMinRms(sensitivity: TunerSensitivity): number {
  return SENSITIVITY_OPTIONS.find((s) => s.id === sensitivity)?.minRms ?? 0.012;
}

export function loadTunerSettings(profile: InstrumentProfile = getProfile()): TunerSettings {
  const fallback = defaultTunerSettings(profile);
  const raw = readToolStore("tuner", profile);
  const a4Hz = typeof raw.a4Hz === "number" ? clampA4(raw.a4Hz) : fallback.a4Hz;
  const transposition: TunerTransposition =
    raw.transposition === "C" || raw.transposition === "Bb" || raw.transposition === "Eb" || raw.transposition === "F"
      ? raw.transposition
      : fallback.transposition;
  const droneOctave: DroneOctave =
    raw.droneOctave === 2 || raw.droneOctave === 3 || raw.droneOctave === 4 || raw.droneOctave === 5
      ? raw.droneOctave
      : fallback.droneOctave;
  const droneWave: DroneWave =
    raw.droneWave === "sine" || raw.droneWave === "triangle" ? raw.droneWave : fallback.droneWave;
  const droneVolume =
    typeof raw.droneVolume === "number" ? clampDroneVolume(raw.droneVolume) : fallback.droneVolume;
  const sensitivity: TunerSensitivity =
    raw.sensitivity === "quiet" || raw.sensitivity === "normal" || raw.sensitivity === "loud"
      ? raw.sensitivity
      : fallback.sensitivity;
  return { a4Hz, transposition, droneOctave, droneWave, droneVolume, sensitivity };
}

export function saveTunerSettings(settings: TunerSettings, profile: InstrumentProfile = getProfile()): void {
  writeToolStore(
    "tuner",
    {
      a4Hz: clampA4(settings.a4Hz),
      transposition: settings.transposition,
      droneOctave: settings.droneOctave,
      droneWave: settings.droneWave,
      droneVolume: clampDroneVolume(settings.droneVolume),
      sensitivity: settings.sensitivity,
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

/** Returns the written Norwegian note label for a concert MIDI note under the active transposition. */
export function getWrittenDroneLabel(concertMidi: number, transposition: TunerTransposition): string {
  const transDef = TRANSPOSITION_OPTIONS.find((t) => t.id === transposition) ?? TRANSPOSITION_OPTIONS[0]!;
  return midiToNorwegianLabel(concertMidi + transDef.writtenOffset).full;
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
  if (!Number.isFinite(hz) || hz < 27.5 || hz > 4300) return null;
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

export interface YinWorkspace {
  diff: Float32Array;
  cmnd: Float32Array;
}

export function createYinWorkspace(maxBufferSize = 4096): YinWorkspace {
  const half = Math.floor(maxBufferSize / 2) + 2;
  return {
    diff: new Float32Array(half),
    cmnd: new Float32Array(half),
  };
}

export interface YinOptions {
  minHz?: number;
  maxHz?: number;
  minRms?: number;
  threshold?: number;
  workspace?: YinWorkspace;
}

/**
 * YIN fundamental frequency estimator with Cumulative Mean Normalized Difference (CMND),
 * octave-down protection, optional zero-allocation workspace, and parabolic lag interpolation
 * for sub-cent chromatic tuner accuracy up to C8 (4200 Hz).
 */
export function detectPitchYin(
  buffer: Float32Array,
  sampleRate: number,
  opts: YinOptions = {},
): YinDetectionResult | null {
  const n = buffer.length;
  if (n < 512 || !Number.isFinite(sampleRate) || sampleRate < 8000) return null;

  const minHz = opts.minHz ?? 40;
  const maxHz = opts.maxHz ?? 4300;
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

  const needed = maxTau + 2;
  const ws = opts.workspace;
  const diff = ws && ws.diff.length >= needed ? ws.diff : new Float32Array(needed);
  const cmnd = ws && ws.cmnd.length >= needed ? ws.cmnd : new Float32Array(needed);

  diff[0] = 0;
  for (let tau = 1; tau <= maxTau + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const d = buffer[i]! - buffer[i + tau]!;
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalized difference function (CMND)
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

  // Fallback to best true local minimum if slightly above threshold (helpful for percussive mallet attacks),
  // with octave-down protection favoring tau / 2 when nearly as deep.
  if (tauEst === -1) {
    let bestTau = -1;
    let bestVal = 0.24;
    const scanStart = Math.max(minTau, 2);
    const scanEnd = maxTau - 1;
    for (let tau = scanStart; tau <= scanEnd; tau++) {
      const v = cmnd[tau]!;
      if (v < bestVal && v <= cmnd[tau - 1]! && v <= cmnd[tau + 1]!) {
        bestVal = v;
        bestTau = tau;
      }
    }
    if (bestTau === -1) return null;

    // Guard against octave-down lock (2·T having slightly lower CMND than T)
    const halfCenter = Math.round(bestTau / 2);
    if (halfCenter >= minTau + 1) {
      let halfBestTau = -1;
      let halfBestVal = Math.min(0.24, bestVal + 0.06);
      const lo = Math.max(minTau, halfCenter - 2);
      const hi = Math.min(scanEnd, halfCenter + 2);
      for (let t = lo; t <= hi; t++) {
        const v = cmnd[t]!;
        if (v <= halfBestVal && v <= cmnd[t - 1]! && v <= cmnd[t + 1]!) {
          halfBestVal = v;
          halfBestTau = t;
        }
      }
      if (halfBestTau !== -1) {
        bestTau = halfBestTau;
      }
    }

    tauEst = bestTau;
  }

  // Parabolic interpolation on raw diff[] (YIN Step 5) to avoid CMND slope bias at small lags (high register)
  let betterTau = tauEst;
  if (tauEst > 1 && tauEst < maxTau) {
    const s0 = diff[tauEst - 1]!;
    const s1 = diff[tauEst]!;
    const s2 = diff[tauEst + 1]!;
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
 * Smooths rapid frame-to-frame pitch jitter in log-frequency (cents) space
 * while requiring `confirmFrames` consistent readings before snapping across
 * a large jump (> `resetCents`), preventing single-frame octave glitches.
 */
export class PitchSmoother {
  private hz: number | null = null;
  private pendingHz: number | null = null;
  private pendingCount = 0;
  private readonly alpha: number;
  private readonly resetCents: number;
  private readonly confirmFrames: number;

  constructor(alpha = 0.28, resetCents = 80, confirmFrames = 1) {
    this.alpha = alpha;
    this.resetCents = resetCents;
    this.confirmFrames = Math.max(1, Math.round(confirmFrames));
  }

  push(nextHz: number): number {
    if (this.hz === null) {
      this.hz = nextHz;
      this.pendingHz = null;
      this.pendingCount = 0;
      return nextHz;
    }

    const diffCents = Math.abs(1200 * Math.log2(nextHz / this.hz));
    if (diffCents > this.resetCents) {
      if (this.confirmFrames <= 1) {
        this.hz = nextHz;
        this.pendingHz = null;
        this.pendingCount = 0;
        return nextHz;
      }

      if (this.pendingHz !== null) {
        const pendingDiff = Math.abs(1200 * Math.log2(nextHz / this.pendingHz));
        if (pendingDiff <= this.resetCents) {
          this.pendingCount += 1;
          this.pendingHz = this.pendingHz * 2 ** (0.5 * Math.log2(nextHz / this.pendingHz));
          if (this.pendingCount >= this.confirmFrames) {
            this.hz = this.pendingHz;
            this.pendingHz = null;
            this.pendingCount = 0;
          }
          return this.hz;
        }
      }

      this.pendingHz = nextHz;
      this.pendingCount = 1;
      return this.hz;
    }

    this.pendingHz = null;
    this.pendingCount = 0;
    this.hz = this.hz * 2 ** (this.alpha * Math.log2(nextHz / this.hz));
    return this.hz;
  }

  reset(): void {
    this.hz = null;
    this.pendingHz = null;
    this.pendingCount = 0;
  }
}

/** Shared single-AudioContext chromatic drone generator for Tuner. */
interface ActiveDrone {
  osc: OscillatorNode;
  filter: BiquadFilterNode | null;
  gain: GainNode;
  midi: number;
  wave: DroneWave;
}

let activeDrone: ActiveDrone | null = null;

function targetDroneGain(wave: DroneWave, volume: number): number {
  const safeVol = clampDroneVolume(volume);
  const base = wave === "triangle" ? 0.22 : 0.26;
  return Math.max(0.0001, base * safeVol);
}

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
  volume: number = DEFAULT_DRONE_VOLUME,
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
    const dest = auxOutput() ?? ctx.destination;
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
    gain.gain.exponentialRampToValueAtTime(targetDroneGain(wave, volume), now + 0.04);
    gain.connect(dest);
    osc.start(now);

    const handle: ActiveDrone = { osc, filter, gain, midi: concertMidi, wave };
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

export function setTunerDroneVolume(volume: number): void {
  if (!activeDrone) return;
  try {
    const ctx = activeDrone.gain.context;
    activeDrone.gain.gain.setTargetAtTime(
      targetDroneGain(activeDrone.wave, volume),
      ctx.currentTime,
      0.02,
    );
  } catch {
    /* ignore */
  }
}
