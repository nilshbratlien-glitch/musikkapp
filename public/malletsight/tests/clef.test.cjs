const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, settings } = require("./helpers.cjs");

function minimalScore(measures, clef = "auto") {
  return {
    clef,
    key: { id: "C", name: "C major" },
    time: { id: "4/4", ticks: 64 },
    settingsSnapshot: { instrument: "mar50", mallets: 2, tempo: 80, texture: "melody" },
    measures,
  };
}

function bar(pitches) {
  const ticks = Math.floor(64 / pitches.length);
  return {
    events: pitches.map((p) => ({
      pitches: [p],
      rest: false,
      dur: { ticks, id: "q" },
      mallets: [1],
    })),
  };
}

test("measureClef: low midpoint selects bass", () => {
  const context = load(1);
  const score = minimalScore([bar([48, 52])]); // mid = 50 ≤ 58
  const abc = context.ScoreRenderer.scoreToAbc(score, {});
  assert.match(abc, /clef=bass/);
});

test("measureClef: high lowShare selects bass", () => {
  const context = load(1);
  // 3 of 4 notes ≤ 58 → 75 % ≥ 40 %
  const score = minimalScore([bar([50, 54, 56, 70])]);
  const abc = context.ScoreRenderer.scoreToAbc(score, {});
  assert.match(abc, /clef=bass/);
});

test("measureClef: high midpoint stays treble", () => {
  const context = load(1);
  const score = minimalScore([bar([64, 67, 72])]); // mid ≈ 67.7 ≥ 62
  const abc = context.ScoreRenderer.scoreToAbc(score, {});
  assert.match(abc, /clef=treble/);
});

test("defaultClef treble instruments stay treble even with low pitches", () => {
  const context = load(1);
  const score = minimalScore([bar([50, 52])], "auto");
  score.settingsSnapshot.instrument = "xylo";
  const abc = context.ScoreRenderer.scoreToAbc(score, {});
  assert.match(abc, /clef=treble/);
});
