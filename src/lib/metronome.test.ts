import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commitBest, nextClick, nextPulse, onClick, recordBest, secondsPerNote, type ClickState } from "./metronome.ts";

describe("snare-speed metronome", () => {
  it("steps BPM after the configured number of bars", () => {
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
  });

  it("accents only the first note of each bar", () => {
    const first = onClick({ bpm: 80, beat: 0, barCount: 0 }, { sub: 8, bars: 4, inc: 2 });
    const second = onClick(first.state, { sub: 8, bars: 4, inc: 2 });
    assert.equal(first.accent, true);
    assert.equal(second.accent, false);
    assert.equal(secondsPerNote(120, 8), 0.25);
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

  it("accents only beat 1 in each meter", () => {
    for (const meter of ["4/4", "3/4", "2/4", "6/8"] as const) {
      const first = nextPulse(0, meter);
      const second = nextPulse(first.beat, meter);
      assert.equal(first.accent, true);
      assert.equal(second.accent, false);
      assert.equal(first.index, 0);
    }
    assert.equal(nextPulse(5, "6/8").accent, false);
    assert.equal(nextPulse(6, "6/8").accent, true);
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
});
