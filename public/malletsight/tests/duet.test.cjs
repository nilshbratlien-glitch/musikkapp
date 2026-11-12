const test = require("node:test");
const assert = require("node:assert/strict");
const { load, settings } = require("./helpers.cjs");

test("Theory.transposeKeyForBb transposes concert keys to Bb-instrument keys correctly", () => {
  const { Theory } = load(1);
  assert.equal(Theory.transposeKeyForBb("C").id, "D");
  assert.equal(Theory.transposeKeyForBb("F").id, "G");
  assert.equal(Theory.transposeKeyForBb("Bb").id, "C");
  assert.equal(Theory.transposeKeyForBb("Eb").id, "F");
  assert.equal(Theory.transposeKeyForBb("Ab").id, "Bb");
  assert.equal(Theory.transposeKeyForBb("G").id, "A");
  assert.equal(Theory.transposeKeyForBb("D").id, "E");
  assert.equal(Theory.transposeKeyForBb("Am").id, "Bm");
  assert.equal(Theory.transposeKeyForBb("Dm").id, "Em");
  assert.equal(Theory.transposeKeyForBb("Gm").id, "Am");
});

test("Generator.generateDuet generates valid duet scores in harmony style", () => {
  const { Generator } = load(42);
  const duet = Generator.generateDuet(settings({
    keyId: "C",
    measures: 8,
    style: "harmony",
    malletInstrument: "xylo",
    showSticking: true,
  }));

  assert.equal(duet.isDuet, true);
  assert.equal(duet.trumpetKey.id, "C");
  assert.equal(duet.key.id, "Bb");
  assert.equal(duet.trumpetMeasures.length, 8);
  assert.equal(duet.malletMeasures.length, 8);

  // Both voices have sounding pitches and trumpet has valve fingerings
  duet.trumpetMeasures.forEach((m) => {
    m.events.forEach((ev) => {
      if (!ev.rest && ev.pitches.length) {
        assert.ok(typeof ev.sticking === "string", "Trumpet note should have valve fingering");
        assert.ok(ev.pitches[0] >= 58 && ev.pitches[0] <= 76, "Trumpet written pitch within standard range");
      }
    });
  });

  duet.malletMeasures.forEach((m) => {
    m.events.forEach((ev) => {
      if (!ev.rest && ev.pitches.length) {
        assert.ok(ev.pitches[0] >= 65 && ev.pitches[0] <= 108, "Xylophone sounding pitch within range");
      }
    });
  });
});

test("Generator.generateDuet supports call_response style (ekkolek)", () => {
  const { Generator } = load(123);
  const duet = Generator.generateDuet(settings({
    keyId: "F",
    measures: 8,
    style: "call_response",
    malletInstrument: "mar43",
  }));

  assert.equal(duet.isDuet, true);
  assert.equal(duet.trumpetKey.id, "F");
  assert.equal(duet.key.id, "Eb");

  // Bars 1-2: Trumpet plays, Mallets rest
  assert.ok(duet.trumpetMeasures[0].events.some((e) => !e.rest), "Trumpet active in bar 1");
  assert.ok(duet.malletMeasures[0].events.every((e) => e.rest), "Mallets resting in bar 1");

  // Bars 3-4: Mallets answer, Trumpet rests
  assert.ok(duet.trumpetMeasures[2].events.every((e) => e.rest), "Trumpet resting in bar 3");
  assert.ok(duet.malletMeasures[2].events.some((e) => !e.rest), "Mallets active in bar 3");
});

test("Generator.generateDuet supports melody_comp style", () => {
  const { Generator } = load(77);
  const duet = Generator.generateDuet(settings({
    keyId: "Bb",
    measures: 8,
    style: "melody_comp",
    malletInstrument: "mar50",
  }));

  assert.equal(duet.isDuet, true);
  assert.equal(duet.trumpetKey.id, "Bb");
  assert.equal(duet.key.id, "Ab");

  // Trumpet plays melody, mallets plays pulse chords/arpeggio
  assert.ok(duet.trumpetMeasures.some((m) => m.events.some((e) => !e.rest)));
  assert.ok(duet.malletMeasures.some((m) => m.events.some((e) => !e.rest)));
});

test("ScoreRenderer.duetToAbc formats ABC for score, trumpet, and mallets views", () => {
  const { Generator, ScoreRenderer } = load(99);
  const duet = Generator.generateDuet(settings({
    keyId: "C",
    measures: 4,
    style: "harmony",
    malletInstrument: "xylo",
  }));

  const fullScoreAbc = ScoreRenderer.duetToAbc(duet, { viewPart: "score" });
  assert.ok(fullScoreAbc.includes("%%staves {(1) (2)}"), "Full score should have dual staves");
  assert.ok(fullScoreAbc.includes('V:1 clef=treble name="Trompet (B)"'), "V:1 should be Trumpet in B");
  assert.ok(fullScoreAbc.includes("K:C"), "Trumpet voice should be in C-dur");
  assert.ok(fullScoreAbc.includes('V:2 clef=treble name="Xylofon (C)"'), "V:2 should be Xylophone in C");
  assert.ok(fullScoreAbc.includes("K:Bb"), "Mallets voice should be in Bb-dur");

  const trumpetOnlyAbc = ScoreRenderer.duetToAbc(duet, { viewPart: "trumpet" });
  assert.ok(!trumpetOnlyAbc.includes("%%staves"), "Single part should not have %%staves");
  assert.ok(trumpetOnlyAbc.includes("K:C"), "Trumpet part should be in C-dur");
  assert.ok(!trumpetOnlyAbc.includes("Xylofon"), "Trumpet part should not have Xylofon staff");

  const malletsOnlyAbc = ScoreRenderer.duetToAbc(duet, { viewPart: "mallets" });
  assert.ok(!malletsOnlyAbc.includes("%%staves"), "Single part should not have %%staves");
  assert.ok(malletsOnlyAbc.includes("K:Bb"), "Mallets part should be in Bb-dur");
  assert.ok(!malletsOnlyAbc.includes("Trompet"), "Mallets part should not have Trompet staff");
});

test("Generator.generateDuet works across all melodic percussion instruments", () => {
  const instruments = ["xylo", "mar43", "mar50", "vibes", "glock"];
  const { Generator, Theory } = load(1234);

  for (const instId of instruments) {
    const inst = Theory.INSTRUMENTS.find((i) => i.id === instId);
    const duet = Generator.generateDuet(settings({
      keyId: "G",
      measures: 4,
      style: "harmony",
      malletInstrument: instId,
    }));

    assert.equal(duet.malletInstrumentId, instId);
    duet.malletMeasures.forEach((m) => {
      m.events.forEach((ev) => {
        if (!ev.rest && ev.pitches.length) {
          const p = ev.pitches[0];
          assert.ok(p >= inst.low && p <= inst.high, `Sounding pitch ${p} outside range for ${inst.name} [${inst.low}, ${inst.high}]`);
        }
      });
    });
  }
});

test("Generator.generateDuet respects custom trumpet and mallet register ranges", () => {
  const { Generator } = load(777);
  const duet = Generator.generateDuet(settings({
    keyId: "C",
    measures: 8,
    style: "harmony",
    malletInstrument: "xylo",
    duetRangeTptLow: 60, // C4
    duetRangeTptHigh: 67, // G4 (beginner trumpet range)
    duetRangeMalletLow: 60, // C4 written
    duetRangeMalletHigh: 76, // E5 written
  }));

  const tptPitches = duet.trumpetMeasures.flatMap((m) => m.events.flatMap((e) => e.pitches));
  const malPitches = duet.malletMeasures.flatMap((m) => m.events.flatMap((e) => e.pitches));

  tptPitches.forEach((p) => {
    assert.ok(p >= 60 && p <= 67, `Trumpet written pitch ${p} outside custom bounds [60, 67]`);
  });
  malPitches.forEach((p) => {
    // Xylo written is p - 12
    const written = p - 12;
    assert.ok(written >= 60 && written <= 76, `Xylo written pitch ${written} outside custom bounds [60, 76]`);
  });
});

test("Generator.generateDuet generates sixteenth notes and triplets when enabled in rhythms", () => {
  const { Generator } = load(888);
  const duet = Generator.generateDuet(settings({
    keyId: "C",
    measures: 8,
    style: "harmony",
    malletInstrument: "mar43",
    rhythms: ["w", "h", "q", "8", "16", "8t", "8d"],
  }));

  const allDurIds = duet.trumpetMeasures.flatMap((m) => m.events.map((e) => e.dur.id));
  const has16thOrTriplet = allDurIds.some((id) => id === "16" || id === "8t" || id === "8d");
  assert.ok(has16thOrTriplet, "Should generate advanced rhythms (16th, triplet or dotted) when enabled");
});

test("ScoreRenderer.duetToAbc renders proper key signature without natural cancellation signs in score view", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const abcjsCode = fs.readFileSync(path.join(__dirname, "..", "abcjs.js"), "utf8");
  const abcCtx = vm.createContext({ window: {} });
  abcCtx.window = abcCtx;
  vm.runInContext(abcjsCode, abcCtx);
  const ABCJS = abcCtx.window.ABCJS;

  const { Generator, ScoreRenderer } = load(555);
  const duet = Generator.generateDuet(settings({
    keyId: "D",
    measures: 8,
    style: "harmony",
    malletInstrument: "xylo",
  }));

  const abc = ScoreRenderer.duetToAbc(duet, { viewPart: "score" });
  assert.ok(abc.includes("[V:1] [K:D]"), "Trumpet line should specify K:D");
  assert.ok(abc.includes("[V:2] [K:C"), "Mallet line should specify K:C");

  const parsed = ABCJS.parseOnly(abc);
  assert.equal(parsed[0].warnings, undefined, "ABCJS should have no parse warnings");

  // Verify staff 0 (trumpet) has 2 sharps (f# and c#), NOT natural signs
  const staff0Key = parsed[0].lines[0].staff[0].key;
  assert.equal(staff0Key.root, "D");
  assert.equal(staff0Key.accidentals.length, 2);
  staff0Key.accidentals.forEach((acc) => {
    assert.equal(acc.acc, "sharp", "Trumpet key signature must be sharps, never natural cancellations");
  });
});

test("ScoreRenderer.duetToAbc dynamically switches Marimba clef to avoid excessive ledger lines", () => {
  const { Generator, ScoreRenderer } = load(333);
  const duet = Generator.generateDuet(settings({
    keyId: "C",
    measures: 8,
    style: "melody_comp",
    malletInstrument: "mar50",
    duetRangeMalletLow: 36, // C2
    duetRangeMalletHigh: 60, // C4
  }));

  const abc = ScoreRenderer.duetToAbc(duet, { viewPart: "score" });
  assert.ok(abc.includes("clef=bass"), "Low marimba notes should trigger bass clef");
});

test("Generator.generateDuet supports 2, 3, and 4 mallets with appropriate chord voicings across styles", () => {
  const { Generator } = load(444);
  for (const mCount of [2, 3, 4]) {
    // Test melody_comp
    const duetComp = Generator.generateDuet(settings({
      keyId: "C",
      measures: 8,
      style: "melody_comp",
      malletInstrument: "mar43",
      duetMallets: mCount,
      mallets: mCount,
      duetAllowChords: true,
    }));

    assert.equal(duetComp.settingsSnapshot.duetMallets, mCount);
    const maxPitchesComp = Math.max(...duetComp.malletMeasures.flatMap((m) => m.events.map((e) => (e.pitches ? e.pitches.length : 0))));
    assert.ok(maxPitchesComp >= 2, `With ${mCount} mallets in melody_comp, should produce multi-note voicings (got max ${maxPitchesComp})`);

    // Test harmony style (Terser & sekster) - phrase endings and cadences should have chords for 2+ mallets
    const duetHarm = Generator.generateDuet(settings({
      keyId: "C",
      measures: 8,
      style: "harmony",
      malletInstrument: "mar50",
      duetMallets: mCount,
      mallets: mCount,
      duetAllowChords: true,
    }));

    const maxPitchesHarm = Math.max(...duetHarm.malletMeasures.flatMap((m) => m.events.map((e) => (e.pitches ? e.pitches.length : 0))));
    assert.ok(maxPitchesHarm >= 2, `With ${mCount} mallets in harmony style, should produce chord at cadences/phrase ends (got max ${maxPitchesHarm})`);
  }
});

test("ScoreRenderer.duetToAbc includes clear key indication for both concert and trumpet", () => {
  const { Generator, ScoreRenderer } = load(111);
  const duet = Generator.generateDuet(settings({
    keyId: "C",
    measures: 8,
    style: "harmony",
    malletInstrument: "mar50",
  }));

  const abc = ScoreRenderer.duetToAbc(duet, { viewPart: "score" });
  assert.ok(abc.includes("C-dur (Slagverk: B-dur)"), "Title should clarify both trumpet and mallet keys");
});

test("Generator.generateDuet respects duetAllowChords: false by generating strictly monophonic mallet parts", () => {
  const { Generator } = load(789);
  const duet = Generator.generateDuet(settings({
    keyId: "C",
    measures: 8,
    style: "melody_comp",
    malletInstrument: "mar50",
    duetMallets: 4,
    duetAllowChords: false,
  }));

  assert.equal(duet.settingsSnapshot.duetAllowChords, false);
  const maxPitches = Math.max(...duet.malletMeasures.flatMap((m) => m.events.map((e) => (e.pitches ? e.pitches.length : 0))));
  assert.equal(maxPitches, 1, "With duetAllowChords: false, no chords should be generated even with 4 mallets");
});



