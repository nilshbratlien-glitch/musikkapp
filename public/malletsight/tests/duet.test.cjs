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
  assert.equal(duet.key.id, "C");
  assert.equal(duet.trumpetKey.id, "D");
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
  assert.equal(duet.key.id, "F");
  assert.equal(duet.trumpetKey.id, "G");

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
  assert.equal(duet.key.id, "Bb");
  assert.equal(duet.trumpetKey.id, "C");

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
  assert.ok(fullScoreAbc.includes("K:D"), "Trumpet voice should be in D-dur");
  assert.ok(fullScoreAbc.includes('V:2 clef=treble name="Xylofon (C)"'), "V:2 should be Xylophone in C");
  assert.ok(fullScoreAbc.includes("K:C"), "Mallets voice should be in C-dur");

  const trumpetOnlyAbc = ScoreRenderer.duetToAbc(duet, { viewPart: "trumpet" });
  assert.ok(!trumpetOnlyAbc.includes("%%staves"), "Single part should not have %%staves");
  assert.ok(trumpetOnlyAbc.includes("K:D"), "Trumpet part should be in D-dur");
  assert.ok(!trumpetOnlyAbc.includes("Xylofon"), "Trumpet part should not have Xylofon staff");

  const malletsOnlyAbc = ScoreRenderer.duetToAbc(duet, { viewPart: "mallets" });
  assert.ok(!malletsOnlyAbc.includes("%%staves"), "Single part should not have %%staves");
  assert.ok(malletsOnlyAbc.includes("K:C"), "Mallets part should be in C-dur");
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
