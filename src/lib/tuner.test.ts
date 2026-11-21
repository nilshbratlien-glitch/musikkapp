import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setProfile } from "./profile.ts";
import {
  DEFAULT_A4_HZ,
  DEFAULT_DRONE_VOLUME,
  PitchSmoother,
  clampA4,
  clampDroneVolume,
  createYinWorkspace,
  detectPitchYin,
  freqToPitchReading,
  getSensitivityMinRms,
  getWrittenDroneLabel,
  loadTunerSettings,
  midiToFrequency,
  midiToNorwegianLabel,
  saveTunerSettings,
} from "./tuner.ts";

function makeTone(
  hz: number,
  sampleRate = 48000,
  length = 4096,
  harmonics: ReadonlyArray<readonly [number, number]> = [[1, 0.7], [2, 0.2], [3, 0.1]],
): Float32Array {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let v = 0;
    for (const [mult, amp] of harmonics) {
      v += amp * Math.sin((2 * Math.PI * hz * mult * i) / sampleRate);
    }
    buf[i] = v;
  }
  return buf;
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe("tuner DSP, Norwegian note names, transposition & settings", () => {
  const prevStorage = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: prevStorage, configurable: true });
    setProfile("mallets");
  });

  it("defaults to A4 = 442 Hz and clamps calibration & volume cleanly", () => {
    assert.equal(DEFAULT_A4_HZ, 442);
    assert.equal(DEFAULT_DRONE_VOLUME, 0.7);
    assert.equal(clampA4(442), 442);
    assert.equal(clampA4(400), 435);
    assert.equal(clampA4(500), 448);
    assert.equal(clampA4(Number.NaN), 442);

    assert.equal(clampDroneVolume(0.75), 0.75);
    assert.equal(clampDroneVolume(0), 0.1);
    assert.equal(clampDroneVolume(2), 1);
    assert.equal(clampDroneVolume(Number.NaN), 0.7);

    assert.ok(getSensitivityMinRms("quiet") < getSensitivityMinRms("normal"));
    assert.ok(getSensitivityMinRms("normal") < getSensitivityMinRms("loud"));
  });

  it("uses Norwegian note names (B for Bb, H for B natural)", () => {
    assert.equal(midiToNorwegianLabel(60).full, "C4");
    assert.equal(midiToNorwegianLabel(69).full, "A4");
    assert.equal(midiToNorwegianLabel(70).full, "B4");
    assert.equal(midiToNorwegianLabel(71).full, "H4");
    assert.equal(midiToNorwegianLabel(58).full, "B3");
    assert.equal(midiToNorwegianLabel(59).full, "H3");
    assert.equal(getWrittenDroneLabel(58, "Bb"), "C4");
    assert.equal(getWrittenDroneLabel(65, "F"), "C5");
  });

  it("detects synthetic pitches from C2 up to glockenspiel C8 with reusable workspace", () => {
    const sampleRate = 48000;
    const workspace = createYinWorkspace(4096);
    const cases = [
      { label: "C2", hz: midiToFrequency(36, 442) },
      { label: "B3", hz: midiToFrequency(58, 442) },
      { label: "A4 (440)", hz: 440 },
      { label: "A4 (442)", hz: 442 },
      { label: "C6", hz: midiToFrequency(84, 442) },
      { label: "G7", hz: midiToFrequency(103, 442) },
      { label: "C8 (glockenspiel)", hz: midiToFrequency(108, 442) },
      { label: "A4 +17c", hz: 442 * 2 ** (17 / 1200) },
      { label: "E4 -23c", hz: midiToFrequency(64, 442) * 2 ** (-23 / 1200) },
    ];
    for (const c of cases) {
      const result = detectPitchYin(makeTone(c.hz, sampleRate), sampleRate, { workspace });
      assert.ok(result, `expected pitch lock for ${c.label}`);
      const errCents = Math.abs(1200 * Math.log2(result.hz / c.hz));
      assert.ok(errCents < 1.5, `${c.label}: error ${errCents.toFixed(2)} cents (got ${result.hz.toFixed(2)} Hz)`);
    }
  });

  it("rejects silence and very quiet background noise", () => {
    const silence = new Float32Array(4096);
    assert.equal(detectPitchYin(silence, 48000), null);

    const quiet = new Float32Array(4096);
    for (let i = 0; i < quiet.length; i++) quiet[i] = ((i % 7) - 3) * 0.001;
    assert.equal(detectPitchYin(quiet, 48000), null);
  });

  it("applies C, Bb, Eb, and F transpositions accurately", () => {
    const concertBb3 = midiToFrequency(58, 442);
    const inC = freqToPitchReading(concertBb3, 442, "C");
    assert.ok(inC);
    assert.equal(inC.label, "B3");
    assert.equal(inC.concertLabel, "B3");
    assert.equal(inC.inTune, true);

    const inBb = freqToPitchReading(concertBb3, 442, "Bb");
    assert.ok(inBb);
    assert.equal(inBb.label, "C4");
    assert.equal(inBb.concertLabel, "B3");
    assert.ok(Math.abs(inBb.cents) < 0.1);

    const concertF4 = midiToFrequency(65, 442);
    const inF = freqToPitchReading(concertF4, 442, "F");
    assert.ok(inF);
    assert.equal(inF.label, "C5");
    assert.equal(inF.concertLabel, "F4");

    const concertEb4 = midiToFrequency(63, 442);
    const inEb = freqToPitchReading(concertEb4, 442, "Eb");
    assert.ok(inEb);
    assert.equal(inEb.label, "C5");
    assert.equal(inEb.concertLabel, "E♭4");
  });

  it("smooths small jitter in log-cents space and supports hysteresis against 1-frame octave glitches", () => {
    const immediate = new PitchSmoother(0.25, 80);
    assert.equal(immediate.push(442), 442);
    const nudged = immediate.push(444);
    assert.ok(nudged > 442 && nudged < 444, "small deviation is smoothed");
    const jumped = immediate.push(523.25);
    assert.equal(jumped, 523.25, "default confirmFrames=1 snaps immediately");

    const guarded = new PitchSmoother(0.28, 80, 2);
    assert.equal(guarded.push(442), 442);
    // Single-frame octave glitch should NOT snap
    assert.equal(guarded.push(884), 442, "single-frame octave spike is ignored");
    // Returning to A4 clears pending spike
    const back = guarded.push(443);
    assert.ok(back > 442 && back < 443.5);
    // Two consecutive frames of a real note change (C5 = 523.25 Hz) snap cleanly
    assert.ok(guarded.push(523.25) < 445, "first frame of jump waits for confirmation");
    const confirmed = guarded.push(524.0);
    assert.ok(confirmed > 522 && confirmed < 525, "second consistent frame locks onto new note");
  });

  it("persists tuner settings per instrument profile (including octave 2, volume & sensitivity)", () => {
    Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true });
    const malletDefault = loadTunerSettings("mallets");
    assert.equal(malletDefault.a4Hz, 442);
    assert.equal(malletDefault.transposition, "C");
    assert.equal(malletDefault.droneVolume, 0.7);
    assert.equal(malletDefault.sensitivity, "normal");

    const trumpetDefault = loadTunerSettings("trumpet");
    assert.equal(trumpetDefault.a4Hz, 442);
    assert.equal(trumpetDefault.transposition, "Bb");

    saveTunerSettings(
      {
        a4Hz: 440,
        transposition: "Eb",
        droneOctave: 2,
        droneWave: "sine",
        droneVolume: 0.45,
        sensitivity: "loud",
      },
      "mallets",
    );
    const reloaded = loadTunerSettings("mallets");
    assert.deepEqual(reloaded, {
      a4Hz: 440,
      transposition: "Eb",
      droneOctave: 2,
      droneWave: "sine",
      droneVolume: 0.45,
      sensitivity: "loud",
    });
    assert.equal(loadTunerSettings("trumpet").transposition, "Bb");
  });
});
