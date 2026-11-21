import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLICK_SOUND_OPTIONS,
  GAP_PRESETS,
  RUDIMENTS,
  beatsInMeter,
  clampClickVolume,
  commitBest,
  cycleBeatAccent,
  defaultBeatAccents,
  isBarMutedInGap,
  meterForBeats,
  nextClick,
  nextPulse,
  onClick,
  recordBest,
  secondsPerNote,
  stepBackOnBreak,
  tempoMarking,
  type ClickState,
} from "./metronome.ts";

describe("snare-speed metronome", () => {
  it("steps BPM after the configured number of bars and respects optional maxBpm", () => {
    let state: ClickState = { bpm: 100, beat: 0, barCount: 0 };
    const settings = { sub: 8, bars: 4, inc: 2 };
    let stepped = false;
    for (let i = 0; i < 31; i++) {
      const next = onClick(state, settings);
      state = next.state;
      stepped = next.stepped;
    }
    assert.equal(stepped, false);
    assert.equal(state.bpm, 100);
    const last = onClick(state, settings);
    assert.equal(last.stepped, true);
    assert.equal(last.state.bpm, 102);
    assert.equal(last.state.barCount, 0);

    // Respects maxBpm cap
    let capped: ClickState = { bpm: 118, beat: 0, barCount: 0 };
    let finalStep = onClick(capped, { sub: 4, bars: 1, inc: 5, maxBpm: 120 });
    for (let i = 1; i < 4; i++) {
      finalStep = onClick(finalStep.state, { sub: 4, bars: 1, inc: 5, maxBpm: 120 });
    }
    assert.equal(finalStep.state.bpm, 120);
    assert.equal(finalStep.stepped, true);
    assert.equal(finalStep.reachedMax, true);

    // Subsequent bars hold at maxBpm without exceeding it
    let hold = finalStep;
    for (let i = 0; i < 4; i++) {
      hold = onClick(hold.state, { sub: 4, bars: 1, inc: 5, maxBpm: 120 });
    }
    assert.equal(hold.state.bpm, 120);
    assert.equal(hold.stepped, false);
    assert.equal(hold.reachedMax, true);
  });

  it("steps tempo back cleanly on break without going below start BPM", () => {
    assert.equal(stepBackOnBreak(134, 2, 100), 130);
    assert.equal(stepBackOnBreak(134, 5, 100), 124);
    assert.equal(stepBackOnBreak(102, 2, 100), 100);
  });

  it("accents only the first note of each bar and defines all 8 rudiments", () => {
    const first = onClick({ bpm: 80, beat: 0, barCount: 0 }, { sub: 8, bars: 4, inc: 2 });
    const second = onClick(first.state, { sub: 8, bars: 4, inc: 2 });
    assert.equal(first.accent, true);
    assert.equal(second.accent, false);
    assert.equal(secondsPerNote(120, 8), 0.25);
    assert.equal(Object.keys(RUDIMENTS).length, 8);
    assert.ok(RUDIMENTS.accentSingles[0].includes(">"));
    assert.ok(RUDIMENTS.sixStrokeRoll[0].includes(">"));
  });

  it("keeps a best only when the new tempo is higher", () => {
    const first = recordBest({}, "singles", 100);
    assert.equal(first.updated, true);
    const lower = recordBest(first.bests, "singles", 96);
    assert.equal(lower.updated, false);
    assert.equal(lower.bests.singles, 100);
    const higher = recordBest(lower.bests, "singles", 110);
    assert.equal(higher.updated, true);
    assert.equal(higher.bests.singles, 110);
  });

  it("does not treat a failed save as a new best", () => {
    assert.equal(commitBest(true, false), "failed");
    assert.equal(commitBest(true, true), "saved");
    assert.equal(commitBest(false, false), "same");
  });

  it("accents only beat 1 in each meter including odd meters 5/4 and 7/8", () => {
    for (const meter of ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8"] as const) {
      const first = nextPulse(0, meter);
      const second = nextPulse(first.beat, meter);
      assert.equal(first.accent, true);
      assert.equal(second.accent, false);
      assert.equal(first.index, 0);
    }
    assert.equal(beatsInMeter("5/4"), 5);
    assert.equal(beatsInMeter("7/8"), 7);
    assert.equal(nextPulse(4, "5/4").accent, false);
    assert.equal(nextPulse(5, "5/4").accent, true);
    assert.equal(nextPulse(6, "7/8").accent, false);
    assert.equal(nextPulse(7, "7/8").accent, true);
    assert.equal(nextPulse(5, "6/8").accent, false);
    assert.equal(nextPulse(6, "6/8").accent, true);
    assert.equal(meterForBeats(5), null);
    assert.equal(meterForBeats(7), null);
  });

  it("cycles beat accents, clamps click volume, and schedules gap-trainer silent bars", () => {
    assert.deepEqual(defaultBeatAccents(4), ["accent", "normal", "normal", "normal"]);
    assert.equal(cycleBeatAccent("normal"), "accent");
    assert.equal(cycleBeatAccent("accent"), "mute");
    assert.equal(cycleBeatAccent("mute"), "normal");

    assert.equal(CLICK_SOUND_OPTIONS.length, 4);
    assert.equal(GAP_PRESETS.length, 5);
    assert.equal(clampClickVolume(0), 0.1);
    assert.equal(clampClickVolume(1.5), 1);
    assert.equal(clampClickVolume(0.75), 0.75);

    // 3 play bars + 1 silent bar: bars 0,1,2 audible, bar 3 muted, bar 4 audible
    assert.equal(isBarMutedInGap(0, 3, 1), false);
    assert.equal(isBarMutedInGap(2, 3, 1), false);
    assert.equal(isBarMutedInGap(3, 3, 1), true);
    assert.equal(isBarMutedInGap(4, 3, 1), false);
    assert.equal(isBarMutedInGap(7, 3, 1), true);
    assert.equal(isBarMutedInGap(3, 0, 0), false);
  });

  it("subdivides a beat and keeps the accent on 1", () => {
    const first = nextClick(0, "4/4", 2);
    const inside = nextClick(1, "4/4", 2);
    const nextBeat = nextClick(2, "4/4", 2);
    assert.equal(first.accent, true);
    assert.equal(first.downbeat, true);
    assert.equal(inside.downbeat, false);
    assert.equal(inside.beatIndex, 0);
    assert.equal(nextBeat.beatIndex, 1);
    assert.equal(nextBeat.downbeat, true);
    assert.equal(nextClick(8, "4/4", 2).accent, true);
    assert.equal(nextClick(3, "3/4", 3).beatIndex, 1);
  });

  it("maps BPM ranges to traditional Italian tempo markings", () => {
    assert.equal(tempoMarking(40), "Larghissimo");
    assert.equal(tempoMarking(52), "Largo");
    assert.equal(tempoMarking(72), "Adagio");
    assert.equal(tempoMarking(80), "Andante");
    assert.equal(tempoMarking(112), "Moderato");
    assert.equal(tempoMarking(132), "Allegro");
    assert.equal(tempoMarking(168), "Vivace");
    assert.equal(tempoMarking(184), "Presto");
    assert.equal(tempoMarking(220), "Prestissimo");
  });
});
