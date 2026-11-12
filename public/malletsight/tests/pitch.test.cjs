const { test } = require("node:test");
const assert = require("node:assert/strict");
const abcjs = require("../abcjs.js");
const { load, settings, levels } = require("./helpers.cjs");

function audioNotes(abc) {
  return abcjs.parseOnly(abc)[0].setUpAudio().tracks.flat().filter(event => event.cmd === "note");
}

function assertWrittenPitches(context, score, label) {
  const notes = audioNotes(context.ScoreRenderer.scoreToAbc(score, {}));
  const offset = context.Theory.writtenOff(score.settingsSnapshot.instrument);
  let tick = 0;
  for (const measure of score.measures) {
    for (const event of measure.events) {
      const at = (tick + 0.001) / 96;
      const actual = [...new Set(notes.filter(n => n.start <= at && n.start + n.duration > at).map(n => n.pitch))].sort((a, b) => a - b);
      const expected = [...new Set(event.pitches.map(p => p + offset))].sort((a, b) => a - b);
      assert.deepEqual(actual, expected, `${label}, tick ${tick}`);
      tick += event.dur.ticks;
    }
  }
}

test("reported seed 4 phrase cancels F sharp: F^F2G G4 =F2G2", () => {
  const context = load(4);
  const score = context.Generator.generate(settings({ texture: "melody", measures: 1, timeId: "3/4" }));
  score.measures = [{ events: [
    [65, "16"], [66, "8"], [67, "16"], [67, "q"], [65, "8"], [67, "8"],
  ].map(([pitch, id]) => ({ pitches: [pitch], mallets: [1], rest: false, dur: context.Theory.DURATIONS.find(d => d.id === id) })) }];
  const abc = context.ScoreRenderer.scoreToAbc(score, {});
  assert.equal(audioNotes(abc)[4].pitch, 65, abc);
  assertWrittenPitches(context, score, "reported seed 4 fixture");
});

test("accidentals carry within a bar and reset at barlines, separately by octave and staff", () => {
  for (const [keyId, pitches] of [["C", [66, 66, 65, 65]], ["G", [65, 65, 66, 66]], ["F", [71, 71, 70, 70]]]) {
    for (const clef of ["treble", "grand"]) {
      const context = load(1);
      const score = context.Generator.generate(settings({ keyId, keyIds: [keyId], clef, measures: 2 }));
      const dur = context.Theory.DURATIONS.find(d => d.id === "q");
      score.measures = [pitches, [pitches[0], pitches[0] + 12, pitches[2], pitches[2] - 12]].map(bar => ({ events: bar.map(p => ({ pitches: clef === "grand" ? [p - 24, p] : [p], mallets: [1, 2], rest: false, dur })) }));
      assertWrittenPitches(context, score, `${keyId} ${clef}`);
    }
  }
});

for (const keyId of ["C", "G", "F", "Db", "Am"]) {
  test(`ABC audio matches generated MIDI across 30 seeds in ${keyId}`, () => {
    for (let seed = 1; seed <= 30; seed++) {
      const context = load(seed);
      const score = context.Generator.generate(settings({ ...levels[6], keyId, keyIds: [keyId], texture: seed % 2 ? "melody" : "mixed", mallets: seed % 2 ? 2 : 3, accidentals: true, ties: false, dynamics: false }));
      assertWrittenPitches(context, score, `${keyId}, seed ${seed}`);
    }
  });
}


test("ABC matches MIDI with instrument octave offsets, triplets, ties and grand staff", () => {
  for (const instrument of load().Theory.INSTRUMENTS) for (let seed = 1; seed <= 20; seed++) {
    const context = load(seed);
    const score = context.Generator.generate(settings({ ...levels[9], instrumentId: instrument.id, rangeLow: instrument.low, rangeHigh: instrument.high, mallets: 3, texture: "mixed", accidentals: true, dynamics: false }));
    assertWrittenPitches(context, score, `${instrument.id}, seed ${seed}`);
  }
});

test("trumpet generates strictly monophonic melody, renders valve fingerings, and sounds 2 semitones below written pitch", () => {
  const context = load(7);
  assert.equal(context.Theory.soundOff("trumpet"), -2);
  assert.equal(context.Theory.trumpetValve(60), "0");
  assert.equal(context.Theory.trumpetValve(62), "1-3");
  assert.equal(context.Theory.trumpetValve(64), "1-2");
  assert.equal(context.Theory.trumpetValve(65), "1");
  assert.equal(context.Theory.trumpetValve(67), "0");
  const score = context.Generator.generate(settings({
    ...levels[8],
    instrumentId: "trumpet",
    rangeLow: 60,
    rangeHigh: 72,
    mallets: 4,
    texture: "block",
    rolls: true,
    showSticking: true,
  }));
  for (const measure of score.measures) {
    for (const event of measure.events) {
      if (!event.rest) {
        assert.equal(event.pitches.length, 1, "trumpet event must be monophonic");
        assert.equal(Boolean(event.roll), false, "trumpet event must not have mallet rolls");
      }
    }
  }
  const abc = context.ScoreRenderer.scoreToAbc(score, { showSticking: true });
  assert.match(abc, /klinger i B/);
  assert.match(abc, /"\^[0123-]+"/);
});
