const ENGINE_VER = "v35";

const ENGINE_SCRIPTS = [
  `/malletsight/abcjs.js?${ENGINE_VER}`,
  `/malletsight/theory.js?${ENGINE_VER}`,
  `/malletsight/generator.js?${ENGINE_VER}`,
  `/malletsight/renderer.js?${ENGINE_VER}`,
  `/malletsight/audio.js?${ENGINE_VER}`,
];

export interface InstrumentDef {
  id: string;
  name: string;
  low: number;
  high: number;
  writtenOff?: number;
}

export interface KeyDef {
  id: string;
  name: string;
  mode: "major" | "harmonic" | "minor";
  fifths: number;
  flats?: boolean;
}

export interface TimeSigDef {
  id: string;
  num: number;
  den: number;
  ticks?: number;
}

export interface DurationDef {
  id: string;
  name: string;
  group?: boolean;
}

export interface TheoryApi {
  INSTRUMENTS: InstrumentDef[];
  KEYS: KeyDef[];
  TIMES: TimeSigDef[];
  DURATIONS: DurationDef[];
  clamp: (v: number, lo: number, hi: number) => number;
  writtenOff: (instrumentId: string) => number;
  midiToName: (midi: number, flats?: boolean) => string;
  midiOctave: (midi: number) => number;
  transposeKeyForBb?: (keyId: string) => KeyDef;
}

export interface GeneratedScore {
  isDuet?: boolean;
  time: TimeSigDef;
  key?: KeyDef;
  concertKey?: KeyDef;
  trumpetKey?: KeyDef;
  measures: unknown[];
  malletInstrumentId?: string;
  settingsSnapshot?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GeneratorApi {
  generate: (settings: Record<string, unknown>) => GeneratedScore;
  generateDuet: (settings: Record<string, unknown>) => GeneratedScore;
}

export interface BeatTimingEntry {
  elements: Element[];
}

export interface ScoreRendererApi {
  renderScore: (
    container: HTMLElement,
    score: GeneratedScore,
    settings: Record<string, unknown>,
  ) => unknown;
  prepareCursor: (visual: unknown, quarterBpm: number, beatTicks?: number) => BeatTimingEntry[];
  showBeat: (beats: BeatTimingEntry[], index: number) => void;
  clearBeat: () => void;
}

export interface AudioPlayCue {
  phase: "countin" | "play";
  beat: number;
  beats: number;
  musicBeats: number;
}

export interface AudioPlayOptions {
  quarterBpm: number;
  clickBpm: number;
  beatsPerBar: number;
  beatTicks?: number;
  subdiv?: number;
  countIn?: number;
  clicks?: boolean;
  muteTrumpet?: boolean;
  muteMallets?: boolean;
  onCue?: (cue: AudioPlayCue) => void;
  done?: () => void;
}

export interface AudioMetroOptions {
  subdiv?: number;
  countIn?: number;
  musicClicks?: number;
  onBeat?: (
    beat: number,
    beatsPerBar: number,
    fromClick?: boolean,
    cue?: { phase: "countin" | "music"; beat: number },
  ) => void;
  done?: () => void;
}

export interface AudioEngineApi {
  loadInstrument: (instrumentId: string) => Promise<void>;
  scoreMusicClicks?: (score: GeneratedScore | null, beatsPerBar: number) => number;
  startMetronome: (bpm: number, beatsPerBar: number, opts?: AudioMetroOptions) => void;
  stopMetronome: () => void;
  setTempo: (bpm: number) => void;
  setSubdiv: (subdiv: number) => void;
  playAlong: (score: GeneratedScore, opts: AudioPlayOptions) => void;
  setClicks: (on: boolean) => void;
  stopPlayback: () => void;
  isPlaying: () => boolean;
  isMetro: () => boolean;
  onHalt: (fn: (() => void) | null) => void;
  ac: () => AudioContext | null;
}

export interface BladlesingEngine {
  Theory: TheoryApi;
  Generator: GeneratorApi;
  ScoreRenderer: ScoreRendererApi;
  AudioEngine: AudioEngineApi;
}

declare global {
  interface Window {
    Theory?: TheoryApi;
    Generator?: GeneratorApi;
    ScoreRenderer?: ScoreRendererApi;
    AudioEngine?: AudioEngineApi;
  }
}

let enginePromise: Promise<BladlesingEngine> | null = null;

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-ms-engine="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === "1") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.dataset.msEngine = src;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

export function loadBladlesingEngine(): Promise<BladlesingEngine> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Bladlesing engine requires browser environment"));
  }
  if (window.Theory && window.Generator && window.ScoreRenderer && window.AudioEngine) {
    return Promise.resolve({
      Theory: window.Theory,
      Generator: window.Generator,
      ScoreRenderer: window.ScoreRenderer,
      AudioEngine: window.AudioEngine,
    });
  }
  if (!enginePromise) {
    enginePromise = (async () => {
      for (const src of ENGINE_SCRIPTS) {
        await loadScript(src);
      }
      if (!window.Theory || !window.Generator || !window.ScoreRenderer || !window.AudioEngine) {
        throw new Error("MalletSight engine globals did not initialize");
      }
      return {
        Theory: window.Theory,
        Generator: window.Generator,
        ScoreRenderer: window.ScoreRenderer,
        AudioEngine: window.AudioEngine,
      };
    })().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}
