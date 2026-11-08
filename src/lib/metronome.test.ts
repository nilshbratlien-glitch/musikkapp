import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onClick, recordBest, secondsPerNote, type ClickState } from "./metronome.ts";

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
});
