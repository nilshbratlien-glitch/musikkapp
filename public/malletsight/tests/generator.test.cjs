const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, settings, levels } = require("./helpers.cjs");

for (let index = 0; index < levels.length; index++) {
  const samples = [];
  function scores() {
    if (!samples.length) for (let seed = 1; seed <= 30; seed++) {
      const config = settings({ ...levels[index], mallets: 2 + seed % 3, texture: ["melody", "mixed", "block"][seed % 3] });
      const score = load(seed).Generator.generate(config);
      samples.push({ score, config, seed });
    }
    return samples;
  }
  test(`level ${index + 1}: bar totals and range across 30 seeds`, () => {
    for (const { score, config, seed } of scores()) for (const [bar, measure] of score.measures.entries()) {
      assert.equal(measure.events.reduce((sum, e) => sum + e.dur.ticks, 0), score.time.ticks, `seed ${seed}, bar ${bar}`);
      for (const e of measure.events) for (const pitch of e.pitches) assert.ok(pitch >= config.rangeLow && pitch <= config.rangeHigh, `seed ${seed}: pitch ${pitch}`);
    }
  });
  test(`level ${index + 1}: only selected note and rest values, including phrase endings`, () => {
    for (const { score, config, seed } of scores()) for (const [bar, measure] of score.measures.entries()) for (const e of measure.events) {
      assert.ok(!e.rest || config.allowRests, `seed ${seed}, bar ${bar}: rest disabled`);
      assert.ok((e.rest ? config.rests : config.rhythms).includes(e.dur.id), `seed ${seed}, bar ${bar}: unselected ${e.rest ? "rest" : "note"} ${e.dur.id}`);
    }
  });
}

for (const profile of [
  { rhythms: ["h"], rests: ["h"], timeId: "4/4" },
  { rhythms: ["qd"], rests: ["qd"], timeId: "3/4" },
  { rhythms: ["8t"], rests: [], timeId: "4/4", allowRests: false },
  { rhythms: ["8", "16"], rests: ["q"], timeId: "5/8" },
  { rhythms: ["h", "q"], rests: ["16"], timeId: "4/4" },
  { rhythms: ["qdd", "16d", "32"], rests: ["8"], timeId: "7/8" },
]) {
  test(`selected rhythms in ${profile.timeId}: notes ${profile.rhythms}, rests ${profile.rests}`, () => {
    for (let seed = 1; seed <= 30; seed++) {
      const config = settings({ ...profile, syncopation: true, measures: 8 });
      const score = load(seed).Generator.generate(config);
      for (const [bar, measure] of score.measures.entries()) {
        assert.equal(measure.events.reduce((sum, e) => sum + e.dur.ticks, 0), score.time.ticks);
        for (const e of measure.events) assert.ok((e.rest ? config.rests : config.rhythms).includes(e.dur.id), `seed ${seed}, bar ${bar}: unselected ${e.rest ? "rest" : "note"} ${e.dur.id}`);
      }
    }
  });
}

for (const timeId of ["2/4", "2/2", "3/8", "6/8"]) {
  test(`selected rhythms and exact bar totals in ${timeId}`, () => {
    for (let seed = 1; seed <= 30; seed++) {
      const config = settings({ ...levels[9], timeId, measures: 4 });
      const score = load(seed).Generator.generate(config);
      for (const measure of score.measures) {
        assert.equal(measure.events.reduce((sum, e) => sum + e.dur.ticks, 0), score.time.ticks);
        for (const e of measure.events) assert.ok((e.rest ? config.rests : config.rhythms).includes(e.dur.id));
      }
    }
  });
}

test("impossible selections fail clearly instead of inserting unselected filler", () => {
  for (const overrides of [
    { rhythms: ["w"], rests: [], allowRests: false, timeId: "3/4" },
    { rhythms: ["qd"], rests: ["qd"], timeId: "4/4" },
    { rhythms: [], rests: [], timeId: "4/4" },
  ]) {
    assert.throws(() => load(1).Generator.generate(settings(overrides)), /Valgte note- og pauseverdier kan ikke fylle denne taktarten/);
  }
});

test("syncopated generation uses the injected RNG reproducibly", () => {
  const config = settings({ ...levels[9] });
  const generate = seed => JSON.stringify(load(seed).Generator.generate(config));
  assert.equal(generate(123), generate(123));
  assert.notEqual(generate(123), generate(456));
});

test("legato generates slurred groups of 2-4 notes and renders ABC slur parentheses", () => {
  const env = load(42);
  const config = settings({
    instrumentId: "trumpet",
    legato: true,
    measures: 4,
    rhythms: ["q", "8"],
    rests: [],
    allowRests: false,
  });
  const score = env.Generator.generate(config);
  assert.equal(score.settingsSnapshot.legato, true);

  let totalSlurs = 0;
  for (const m of score.measures) {
    let inSlur = false;
    let slurCount = 0;
    for (const ev of m.events) {
      if (ev.slurStart) {
        assert.equal(inSlur, false, "slur cannot start inside another slur");
        inSlur = true;
        slurCount = 1;
        assert.ok(!ev.articulations || !ev.articulations.includes("staccato"));
      } else if (inSlur) {
        slurCount++;
        assert.equal(ev.slurred, true);
        assert.ok(!ev.articulations || !ev.articulations.includes("staccato"));
        if (ev.slurEnd) {
          assert.ok(slurCount >= 2 && slurCount <= 4, `slur count ${slurCount} should be 2-4`);
          inSlur = false;
          totalSlurs++;
        }
      }
    }
    assert.equal(inSlur, false, "slur must be closed within the measure");
  }
  assert.ok(totalSlurs > 0, "should have generated at least one slur group across 4 measures");

  const abc = env.ScoreRenderer.scoreToAbc(score, { showSticking: true });
  assert.ok(abc.includes("("), "ABC output must include slur open parenthesis");
  assert.ok(abc.includes(")"), "ABC output must include slur close parenthesis");
});

test("trumpet legato: procedural slurs generated for trumpet when legato: true and level >= 3", () => {
  for (let lvl = 3; lvl <= 10; lvl++) {
    const p = levels[lvl - 1];
    const rangeLow = lvl <= 4 ? 60 : lvl <= 6 ? 58 : 55;
    const rangeHigh = lvl <= 2 ? 67 : lvl <= 4 ? 72 : lvl <= 6 ? 74 : 79;
    let foundSlursAcrossSeeds = 0;

    for (let seed = 1; seed <= 15; seed++) {
      const env = load(seed);
      const config = settings({
        ...p,
        instrumentId: "trumpet",
        legato: true,
        rangeLow,
        rangeHigh,
        measures: 8,
      });
      const score = env.Generator.generate(config);
      assert.equal(score.settingsSnapshot.legato, true);

      for (const measure of score.measures) {
        for (const ev of measure.events) {
          if (ev.slurStart) foundSlursAcrossSeeds++;
        }
      }
    }

    assert.ok(
      foundSlursAcrossSeeds > 0,
      `level ${lvl}: trumpet with legato: true must generate slurs across seeds (found ${foundSlursAcrossSeeds})`,
    );
  }
});

test("trumpet legato: determinism - identical seed produces identical score and identical slur placements", () => {
  const seeds = [42, 101, 777, 9999];
  for (const seed of seeds) {
    const makeConfig = () =>
      settings({
        ...levels[3], // level 4
        instrumentId: "trumpet",
        legato: true,
        rangeLow: 60,
        rangeHigh: 72,
        measures: 8,
      });

    const scoreA = load(seed).Generator.generate(makeConfig());
    const scoreB = load(seed).Generator.generate(makeConfig());
    const scoreDiff = load(seed + 1).Generator.generate(makeConfig());

    assert.equal(
      JSON.stringify(scoreA.measures),
      JSON.stringify(scoreB.measures),
      `seed ${seed} must produce identical measures`,
    );

    const slursA = scoreA.measures.map((m) =>
      m.events.map((e) => ({ start: !!e.slurStart, slurred: !!e.slurred, end: !!e.slurEnd })),
    );
    const slursB = scoreB.measures.map((m) =>
      m.events.map((e) => ({ start: !!e.slurStart, slurred: !!e.slurred, end: !!e.slurEnd })),
    );

    assert.equal(
      JSON.stringify(slursA),
      JSON.stringify(slursB),
      `seed ${seed} must have identical slur placements`,
    );

    // Ensure different seed differs
    assert.notEqual(
      JSON.stringify(scoreA.measures),
      JSON.stringify(scoreDiff.measures),
      `seed ${seed} and ${seed + 1} must produce different scores`,
    );
  }
});

test("trumpet legato: slur constraints - 2-4 notes per slur, intervals <= 7 semitones, no staccato, intra-measure", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const config = settings({
      ...levels[4], // level 5
      instrumentId: "trumpet",
      legato: true,
      rangeLow: 58,
      rangeHigh: 74,
      measures: 8,
    });
    const score = load(seed).Generator.generate(config);

    for (const [barIdx, measure] of score.measures.entries()) {
      let inSlur = false;
      let notesInSlur = [];

      for (const [evIdx, ev] of measure.events.entries()) {
        if (ev.slurStart) {
          assert.equal(inSlur, false, `seed ${seed}, bar ${barIdx}, ev ${evIdx}: nested slurStart not permitted`);
          assert.ok(!ev.rest, `seed ${seed}, bar ${barIdx}: slur cannot start on rest`);
          assert.ok(!ev.tie, `seed ${seed}, bar ${barIdx}: slur cannot start on tied note`);
          assert.ok(ev.pitches && ev.pitches.length > 0, `seed ${seed}, bar ${barIdx}: slur note must have pitch`);
          inSlur = true;
          notesInSlur = [ev];
        } else if (inSlur) {
          assert.equal(ev.slurred, true, `seed ${seed}, bar ${barIdx}, ev ${evIdx}: note inside slur must have slurred=true`);
          assert.ok(!ev.rest, `seed ${seed}, bar ${barIdx}: rest cannot occur inside slur`);
          notesInSlur.push(ev);

          if (ev.slurEnd) {
            const count = notesInSlur.length;
            assert.ok(
              count >= 2 && count <= 4,
              `seed ${seed}, bar ${barIdx}: slur group length must be 2-4 notes (got ${count})`,
            );

            // Interval constraint: consecutive slurred notes <= 7 semitones apart
            for (let k = 1; k < notesInSlur.length; k++) {
              const pPrev = notesInSlur[k - 1].pitches[0];
              const pCurr = notesInSlur[k].pitches[0];
              const interval = Math.abs(pCurr - pPrev);
              assert.ok(
                interval <= 7,
                `seed ${seed}, bar ${barIdx}: interval ${interval} between slurred notes exceeds 7 semitones (${pPrev} -> ${pCurr})`,
              );
              assert.notEqual(
                pCurr,
                pPrev,
                `seed ${seed}, bar ${barIdx}: repeated pitch (${pCurr}) not allowed in slur`,
              );
            }

            // No staccato allowed on slurred notes
            for (const note of notesInSlur) {
              if (note.articulations) {
                assert.ok(
                  !note.articulations.includes("staccato"),
                  `seed ${seed}, bar ${barIdx}: staccato articulation forbidden on slurred note`,
                );
              }
            }

            inSlur = false;
            notesInSlur = [];
          }
        } else {
          assert.ok(!ev.slurred, `seed ${seed}, bar ${barIdx}, ev ${evIdx}: slurred flag outside slur`);
          assert.ok(!ev.slurEnd, `seed ${seed}, bar ${barIdx}, ev ${evIdx}: slurEnd outside slur`);
        }
      }

      assert.equal(
        inSlur,
        false,
        `seed ${seed}, bar ${barIdx}: slur must be closed within the measure, cannot cross barlines`,
      );
    }
  }
});

test("when legato: false or instrument is mallets, no slurs are produced", () => {
  // 1. Trumpet with legato: false
  for (let seed = 1; seed <= 20; seed++) {
    const config = settings({
      ...levels[5],
      instrumentId: "trumpet",
      legato: false,
      measures: 6,
    });
    const score = load(seed).Generator.generate(config);
    for (const measure of score.measures) {
      for (const ev of measure.events) {
        assert.ok(!ev.slurStart, `trumpet with legato:false must not have slurStart (seed ${seed})`);
        assert.ok(!ev.slurred, `trumpet with legato:false must not have slurred (seed ${seed})`);
        assert.ok(!ev.slurEnd, `trumpet with legato:false must not have slurEnd (seed ${seed})`);
      }
    }
  }

  // 2. Mallet instruments (mar43, glock, xylo, vibes)
  const malletInstruments = ["mar43", "glock", "xylo", "vibes"];
  for (const inst of malletInstruments) {
    for (let seed = 1; seed <= 10; seed++) {
      const config = settings({
        ...levels[3],
        instrumentId: inst,
        legato: false,
        measures: 4,
      });
      const score = load(seed).Generator.generate(config);
      for (const measure of score.measures) {
        for (const ev of measure.events) {
          assert.ok(!ev.slurStart, `${inst} must not produce slurStart (seed ${seed})`);
          assert.ok(!ev.slurred, `${inst} must not produce slurred (seed ${seed})`);
          assert.ok(!ev.slurEnd, `${inst} must not produce slurEnd (seed ${seed})`);
        }
      }
    }
  }
});

test("level progressions and range bounds for trumpet vs mallets", () => {
  // Trumpet level range bounds progression:
  // L1-2: 60..67, L3-4: 60..72, L5-6: 58..74, L7-10: 55..79
  const expectedRanges = [
    { lvl: 1, low: 60, high: 67 },
    { lvl: 2, low: 60, high: 67 },
    { lvl: 3, low: 60, high: 72 },
    { lvl: 4, low: 60, high: 72 },
    { lvl: 5, low: 58, high: 74 },
    { lvl: 6, low: 58, high: 74 },
    { lvl: 7, low: 55, high: 79 },
    { lvl: 8, low: 55, high: 79 },
    { lvl: 9, low: 55, high: 79 },
    { lvl: 10, low: 55, high: 79 },
  ];

  for (const { lvl, low, high } of expectedRanges) {
    for (let seed = 1; seed <= 10; seed++) {
      const config = settings({
        ...levels[lvl - 1],
        instrumentId: "trumpet",
        rangeLow: low,
        rangeHigh: high,
        legato: lvl >= 3,
        measures: 4,
      });
      const score = load(seed).Generator.generate(config);

      for (const measure of score.measures) {
        for (const ev of measure.events) {
          if (!ev.rest && ev.pitches) {
            // Trumpet is strictly monophonic
            assert.equal(ev.pitches.length, 1, `trumpet at level ${lvl} must be monophonic`);
            const pitch = ev.pitches[0];
            assert.ok(
              pitch >= low && pitch <= high,
              `level ${lvl} seed ${seed}: pitch ${pitch} outside expected [${low}, ${high}]`,
            );
            // Must also be within physical trumpet range (54 to 84)
            assert.ok(pitch >= 54 && pitch <= 84, `pitch ${pitch} outside physical trumpet range [54, 84]`);
          }
        }
      }
    }
  }

  // Mallets bounds checks (mar43: 45..96, glock: 79..108, xylo: 65..108, vibes: 53..89)
  const malletBounds = [
    { inst: "mar43", min: 45, max: 96 },
    { inst: "glock", min: 79, max: 108 },
    { inst: "xylo", min: 65, max: 108 },
    { inst: "vibes", min: 53, max: 89 },
  ];

  for (const { inst, min, max } of malletBounds) {
    for (let seed = 1; seed <= 5; seed++) {
      const config = settings({
        ...levels[5],
        instrumentId: inst,
        rangeLow: min,
        rangeHigh: max,
        measures: 4,
      });
      const score = load(seed).Generator.generate(config);
      for (const measure of score.measures) {
        for (const ev of measure.events) {
          for (const pitch of ev.pitches || []) {
            assert.ok(
              pitch >= min && pitch <= max,
              `${inst} seed ${seed}: pitch ${pitch} outside physical range [${min}, ${max}]`,
            );
          }
        }
      }
    }
  }
});
