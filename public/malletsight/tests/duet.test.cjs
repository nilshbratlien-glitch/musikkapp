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
  assert.ok(fullScoreAbc.includes("%%staves"), "Full score should have dual staves");
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
  assert.ok(abc.includes("[K:D]"), "Trumpet line should specify K:D");
  assert.ok(abc.includes("[K:C"), "Mallet line should specify K:C");

  const parsed = ABCJS.parseOnly(abc);
  assert.equal(parsed[0].warnings, undefined, "ABCJS should have no parse warnings");

  // Verify titles on line 0
  assert.equal(parsed[0].lines[0].staff[0].title[0], "Trompet (B)");
  assert.equal(parsed[0].lines[0].staff[1].title[0], "Xylofon (C)");

  // Verify staff 0 (trumpet) has 2 sharps (f# and c#), NOT natural signs on line 0
  const staff0Key = parsed[0].lines[0].staff[0].key;
  assert.equal(staff0Key.root, "D");
  assert.equal(staff0Key.accidentals.length, 2);
  staff0Key.accidentals.forEach((acc) => {
    assert.equal(acc.acc, "sharp", "Trumpet key signature must be sharps, never natural cancellations");
  });

  // Verify line 1 (bar 5) preserves titles and has no natural cancellation signs
  if (parsed[0].lines.length > 1) {
    assert.equal(parsed[0].lines[1].staff[0].title[0], "Tpt");
    assert.equal(parsed[0].lines[1].staff[1].title[0], "Xyl");
    const staff0KeyL1 = parsed[0].lines[1].staff[0].key;
    assert.equal(staff0KeyL1.accidentals.length, 2);
    staff0KeyL1.accidentals.forEach((acc) => {
      assert.equal(acc.acc, "sharp", "Trumpet line 2 must not have natural cancellation signs");
    });
  }
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

test("AudioEngine.playAlong preloads both trumpet and mallet instruments for duets", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const fetched = [];
  const fakeCtx = { state: "suspended", decodeAudioData: () => Promise.resolve({}) };
  const ctx = vm.createContext({
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve({ ok: false });
    },
    MusikkPulse: {
      audio: () => fakeCtx,
      output: () => ({}),
      start: () => {},
      stop: () => {},
      setClicks: () => {},
    },
    Theory: { TICKS: { quarter: 24 }, soundOff: () => -2 },
    setTimeout,
    clearTimeout,
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "audio.js"), "utf8"), ctx);

  const { Generator } = load(123);
  const duet = Generator.generateDuet(settings({ keyId: "C", measures: 4, malletInstrument: "mar50" }));
  ctx.AudioEngine.playAlong(duet, { quarterBpm: 100 });
  ctx.AudioEngine.stopPlayback();

  assert.ok(fetched.some((url) => url.includes("sample-trumpet")), "Must preload trumpet samples for duet playback");
  assert.ok(fetched.some((url) => url.includes("sample-marimba")), "Must preload mallet samples for duet playback");
});

test("Generator.generateDuet generates high variety of unique procedural melodies across multiple runs", () => {
  const contours = new Set();
  const totalRuns = 15;
  for (let i = 0; i < totalRuns; i++) {
    const { Generator } = load(100 + i);
    const duet = Generator.generateDuet(settings({ keyId: "C", measures: 8, style: "harmony" }));
    const pitches = [];
    duet.trumpetMeasures.forEach((m) => {
      m.events.forEach((ev) => {
        if (!ev.rest && ev.pitches.length) pitches.push(ev.pitches[0]);
      });
    });
    contours.add(pitches.join("-"));
  }
  // With algorithmic periodic generation, different seeds must produce different melodic contours
  assert.ok(contours.size >= 12, `Expected at least 12 unique melodic contours out of 15 runs, got ${contours.size}`);
});

test("Generator.generateDuet varies trumpet pitches and never stays on a single note across consecutive bars", () => {
  for (const style of ["harmony", "call_response", "melody_comp"]) {
    for (const [tptLo, tptHi] of [[60, 67], [60, 74]]) {
      for (let seed = 1; seed <= 30; seed++) {
        const { Generator } = load(seed);
        const duet = Generator.generateDuet(settings({
          keyId: "C",
          timeId: "4/4",
          measures: 8,
          style,
          duetRangeTptLow: tptLo,
          duetRangeTptHigh: tptHi,
          rhythms: ["h", "q", "8"],
        }));
        let curBarPitch = null;
        let curBarRun = 0;
        for (const m of duet.trumpetMeasures) {
          const ps = m.events.filter((e) => !e.rest).flatMap((e) => e.pitches);
          if (!ps.length) continue;
          const uniq = [...new Set(ps)];
          if (uniq.length === 1 && (curBarPitch === null || curBarPitch === uniq[0])) {
            curBarPitch = uniq[0];
            curBarRun++;
          } else {
            curBarPitch = uniq.length === 1 ? uniq[0] : null;
            curBarRun = uniq.length === 1 ? 1 : 0;
          }
          assert.ok(curBarRun <= 1, `${style} [${tptLo},${tptHi}] seed ${seed}: trumpet stuck on pitch ${curBarPitch} for ${curBarRun} bars`);
        }
      }
    }
  }
});

test("Theory.transposeTrumpetToConcert transposes all 24 keys a major 2nd down in matching mode", () => {
  const { Theory } = load(1);
  assert.equal(Theory.KEYS.length, 24);

  for (const k of Theory.KEYS) {
    const concert = Theory.transposeTrumpetToConcert(k);
    assert.ok(concert, `Expected concert key for ${k.id}`);
    assert.ok(Theory.KEYS.some((entry) => entry.id === concert.id), `Concert key ${concert.id} must be in Theory.KEYS`);
    assert.equal(concert.tonic, (k.tonic + 10) % 12, `Tonic mismatch for ${k.id} -> ${concert.id}`);
    assert.equal(concert.mode, k.mode, `Mode mismatch for ${k.id} -> ${concert.id}`);
  }

  assert.equal(Theory.transposeTrumpetToConcert("Ab").id, "F#");
  assert.equal(Theory.transposeTrumpetToConcert("Cm").id, "Bbm");
  assert.equal(Theory.transposeTrumpetToConcert("Fm").id, "Ebm");
  assert.equal(Theory.transposeTrumpetToConcert("Bbm").id, "G#m");
  assert.equal(Theory.transposeTrumpetToConcert("Ebm").id, "C#m");
});

test("Generator.generateDuet keeps narrow trumpet range [60, 67] in high-tonic B major strictly diatonic", () => {
  for (const style of ["harmony", "call_response", "melody_comp"]) {
    for (let seed = 1; seed <= 10; seed++) {
      const { Generator, Theory } = load(seed);
      const duet = Generator.generateDuet(settings({
        keyId: "B",
        measures: 8,
        style,
        malletInstrument: "mar43",
        duetRangeTptLow: 60,
        duetRangeTptHigh: 67,
        rhythms: ["h", "q", "8"],
      }));

      const tptPcs = new Set(Theory.scalePcs(duet.trumpetKey));
      for (const m of duet.trumpetMeasures) {
        for (const ev of m.events) {
          if (ev.rest) continue;
          for (const p of ev.pitches) {
            assert.ok(p >= 60 && p <= 67, `${style} seed ${seed}: trumpet pitch ${p} out of [60, 67]`);
            const pc = ((p % 12) + 12) % 12;
            assert.ok(tptPcs.has(pc), `${style} seed ${seed}: trumpet pitch ${p} (pc=${pc}) not diatonic in ${duet.trumpetKey.id}`);
          }
        }
      }
    }
  }
});

test("Generator.generateDuet melody_comp clamps mallet pitches to custom duetRangeMalletLow/High and concertKey scale", () => {
  const cases = [
    { inst: "mar50", low: 55, high: 72, writtenOff: 0 },
    { inst: "xylo", low: 60, high: 74, writtenOff: -12 },
  ];

  for (const c of cases) {
    for (const mCount of [2, 3, 4]) {
      for (let seed = 1; seed <= 8; seed++) {
        const { Generator, Theory } = load(seed + mCount * 100);
        const duet = Generator.generateDuet(settings({
          keyId: "Eb",
          measures: 8,
          style: "melody_comp",
          malletInstrument: c.inst,
          duetMallets: mCount,
          duetAllowChords: true,
          duetRangeMalletLow: c.low,
          duetRangeMalletHigh: c.high,
        }));

        const malPcs = new Set(Theory.scalePcs(duet.key));
        const soundLow = c.low - c.writtenOff;
        const soundHigh = c.high - c.writtenOff;
        for (const m of duet.malletMeasures) {
          for (const ev of m.events) {
            if (ev.rest) continue;
            for (const p of ev.pitches) {
              assert.ok(
                p >= soundLow && p <= soundHigh,
                `${c.inst} mallets=${mCount} seed ${seed}: sounding pitch ${p} outside [${soundLow}, ${soundHigh}]`
              );
              const pc = ((p % 12) + 12) % 12;
              assert.ok(malPcs.has(pc), `${c.inst} seed ${seed}: mallet pitch ${p} (pc=${pc}) not diatonic in ${duet.key.id}`);
            }
          }
        }
      }
    }
  }
});

test("Generator.generateDuet strictly obeys rhythms: ['w'] and rhythms: ['q'] even in cadence bars", () => {
  for (const style of ["harmony", "call_response", "melody_comp"]) {
    for (const onlyDur of ["w", "q"]) {
      for (let seed = 1; seed <= 5; seed++) {
        const { Generator } = load(seed);
        const duet = Generator.generateDuet(settings({
          keyId: "C",
          timeId: "4/4",
          measures: 8,
          style,
          malletInstrument: "mar43",
          rhythms: [onlyDur],
        }));

        duet.trumpetMeasures.forEach((m, idx) => {
          m.events.forEach((ev) => {
            assert.equal(
              ev.dur.id,
              onlyDur,
              `${style} rhythms=[${onlyDur}] seed ${seed} bar ${idx + 1}: trumpet emitted ${ev.dur.id}`
            );
          });
        });

        if (style !== "melody_comp") {
          duet.malletMeasures.forEach((m, idx) => {
            m.events.forEach((ev) => {
              assert.equal(
                ev.dur.id,
                onlyDur,
                `${style} rhythms=[${onlyDur}] seed ${seed} bar ${idx + 1}: mallet emitted ${ev.dur.id}`
              );
            });
          });
        }
      }
    }
  }
});

test("Generator.generateDuet produces exact time.ticks in every bar across all 8 meters and all 3 styles", () => {
  const meters = ["4/4", "3/4", "2/4", "2/2", "6/8", "3/8", "5/8", "7/8"];
  for (const timeId of meters) {
    for (const style of ["harmony", "call_response", "melody_comp"]) {
      const { Generator } = load(42);
      const duet = Generator.generateDuet(settings({
        keyId: "G",
        timeId,
        measures: 8,
        style,
        malletInstrument: "vibes",
        duetMallets: 3,
        duetAllowChords: true,
        rhythms: ["h", "q", "8"],
      }));

      assert.equal(duet.time.id, timeId);
      duet.trumpetMeasures.forEach((m, idx) => {
        const sum = m.events.reduce((acc, ev) => acc + ev.dur.ticks, 0);
        assert.equal(sum, duet.time.ticks, `${timeId} ${style} trumpet bar ${idx + 1}: ${sum} !== ${duet.time.ticks}`);
      });
      duet.malletMeasures.forEach((m, idx) => {
        const sum = m.events.reduce((acc, ev) => acc + ev.dur.ticks, 0);
        assert.equal(sum, duet.time.ticks, `${timeId} ${style} mallet bar ${idx + 1}: ${sum} !== ${duet.time.ticks}`);
      });
    }
  }
});

test("Generator.generateDuet call_response 4-bar form gives mallet a solo/echo bar at m=1", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { Generator } = load(seed);
    const duet = Generator.generateDuet(settings({
      keyId: "F",
      measures: 4,
      style: "call_response",
      malletInstrument: "mar43",
    }));

    assert.equal(duet.trumpetMeasures.length, 4);
    assert.equal(duet.malletMeasures.length, 4);

    // Bar 1 (m=0): Trumpet call, Mallet rests
    assert.ok(duet.trumpetMeasures[0].events.some((e) => !e.rest), `seed ${seed}: trumpet active in bar 1`);
    assert.ok(duet.malletMeasures[0].events.every((e) => e.rest), `seed ${seed}: mallet rests in bar 1`);

    // Bar 2 (m=1): Mallet echo solo, Trumpet rests
    assert.ok(duet.trumpetMeasures[1].events.every((e) => e.rest), `seed ${seed}: trumpet rests in bar 2`);
    assert.ok(duet.malletMeasures[1].events.some((e) => !e.rest), `seed ${seed}: mallet active in bar 2`);

    // Bar 3 (m=2): Trumpet call, Mallet rests
    assert.ok(duet.trumpetMeasures[2].events.some((e) => !e.rest), `seed ${seed}: trumpet active in bar 3`);
    assert.ok(duet.malletMeasures[2].events.every((e) => e.rest), `seed ${seed}: mallet rests in bar 3`);

    // Bar 4 (m=3): Joint cadence
    assert.ok(duet.trumpetMeasures[3].events.some((e) => !e.rest), `seed ${seed}: trumpet active in bar 4`);
    assert.ok(duet.malletMeasures[3].events.some((e) => !e.rest), `seed ${seed}: mallet active in bar 4`);
  }
});

test("Generator.generateDuet harmony style uses both 3rds and 6ths and reserves chords for phrase endings/cadences", () => {
  let thirdCount = 0;
  let sixthCount = 0;
  let nonCadenceChords = 0;
  let cadenceChords = 0;

  for (let seed = 1; seed <= 20; seed++) {
    const { Generator } = load(seed);
    const duet = Generator.generateDuet(settings({
      keyId: "C",
      measures: 8,
      style: "harmony",
      malletInstrument: "mar50",
      duetMallets: 3,
      duetAllowChords: true,
      rhythms: ["h", "q", "8"],
    }));

    for (let m = 0; m < duet.trumpetMeasures.length; m++) {
      const tEvents = duet.trumpetMeasures[m].events;
      const mEvents = duet.malletMeasures[m].events;
      const isCadenceBar = m === 3 || m === 7;

      // Check chords placement
      for (const ev of mEvents) {
        if (!ev.rest && ev.pitches && ev.pitches.length > 1) {
          if (isCadenceBar) cadenceChords++;
          else nonCadenceChords++;
        }
      }

      // Match simultaneous attack ticks for single-note harmonic intervals
      let tTick = 0;
      const tByTick = new Map();
      for (const ev of tEvents) {
        if (!ev.rest && ev.pitches && ev.pitches.length) tByTick.set(tTick, ev.pitches[0] - 2);
        tTick += ev.dur.ticks;
      }
      let mTick = 0;
      for (const ev of mEvents) {
        if (!ev.rest && ev.pitches && ev.pitches.length === 1 && tByTick.has(mTick)) {
          const diff = Math.abs(ev.pitches[0] - tByTick.get(mTick)) % 12;
          if (diff === 3 || diff === 4) thirdCount++;
          else if (diff === 8 || diff === 9) sixthCount++;
        }
        mTick += ev.dur.ticks;
      }
    }
  }

  assert.ok(thirdCount > 0, `Expected 3rds in harmony style, got ${thirdCount}`);
  assert.ok(sixthCount > 0, `Expected 6ths in harmony style, got ${sixthCount}`);
  assert.ok(cadenceChords > 0, "Expected chords at phrase endings/cadences when duetAllowChords is true");
  assert.equal(nonCadenceChords, 0, `Expected 0 chords in non-cadence bars in harmony style, got ${nonCadenceChords}`);
});

test("Generator.generateDuet shows melodic variation without bar-8 double-hits or multi-bar locks across 25 duets", () => {
  const intervalSizes = new Set();

  for (let seed = 1; seed <= 25; seed++) {
    const style = ["harmony", "call_response", "melody_comp"][seed % 3];
    const { Generator } = load(seed * 7);
    const duet = Generator.generateDuet(settings({
      keyId: "C",
      timeId: "4/4",
      measures: 8,
      style,
      malletInstrument: "mar43",
      rhythms: ["h", "q", "8"],
    }));

    // No bar-8 penultimate-to-final identical pitch double-hit
    const bar8Notes = duet.trumpetMeasures[7].events.filter((e) => !e.rest && e.pitches.length).map((e) => e.pitches[0]);
    if (bar8Notes.length >= 2) {
      assert.notEqual(
        bar8Notes[bar8Notes.length - 2],
        bar8Notes[bar8Notes.length - 1],
        `seed ${seed} (${style}): bar 8 ended with double-hit on pitch ${bar8Notes[bar8Notes.length - 1]}`
      );
    }

    // Collect melodic intervals and verify no multi-bar single-note lock
    let prevPitch = null;
    let curBarPitch = null;
    let curBarRun = 0;
    for (const m of duet.trumpetMeasures) {
      const ps = m.events.filter((e) => !e.rest && e.pitches.length).map((e) => e.pitches[0]);
      for (const p of ps) {
        if (prevPitch !== null) intervalSizes.add(Math.abs(p - prevPitch));
        prevPitch = p;
      }
      if (!ps.length) continue;
      const uniq = [...new Set(ps)];
      if (uniq.length === 1 && (curBarPitch === null || curBarPitch === uniq[0])) {
        curBarPitch = uniq[0];
        curBarRun++;
      } else {
        curBarPitch = uniq.length === 1 ? uniq[0] : null;
        curBarRun = uniq.length === 1 ? 1 : 0;
      }
      assert.ok(curBarRun <= 1, `seed ${seed} (${style}): trumpet locked on pitch ${curBarPitch} for ${curBarRun} bars`);
    }
  }

  assert.ok(intervalSizes.size >= 4, `Expected at least 4 distinct melodic interval sizes, got ${intervalSizes.size}`);
});

test("ScoreRenderer.duetToAbc produces zero ABCJS.parseOnly warnings across all 3 styles and all view parts", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const abcjsCode = fs.readFileSync(path.join(__dirname, "..", "abcjs.js"), "utf8");
  const abcCtx = vm.createContext({ window: {} });
  abcCtx.window = abcCtx;
  vm.runInContext(abcjsCode, abcCtx);
  const ABCJS = abcCtx.window.ABCJS;

  for (const keyId of ["D", "Eb"]) {
    for (const style of ["harmony", "call_response", "melody_comp"]) {
      const { Generator, ScoreRenderer } = load(2026);
      const duet = Generator.generateDuet(settings({
        keyId,
        measures: 8,
        style,
        malletInstrument: "mar50",
        duetMallets: 3,
        duetAllowChords: true,
      }));

      for (const viewPart of ["score", "trumpet", "mallets"]) {
        const abc = ScoreRenderer.duetToAbc(duet, { viewPart });
        const parsed = ABCJS.parseOnly(abc);
        assert.equal(
          parsed[0].warnings,
          undefined,
          `ABCJS.parseOnly warnings for key=${keyId}, style=${style}, viewPart=${viewPart}: ${JSON.stringify(parsed[0].warnings)}`
        );
      }
    }
  }
});
