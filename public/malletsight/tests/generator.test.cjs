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
