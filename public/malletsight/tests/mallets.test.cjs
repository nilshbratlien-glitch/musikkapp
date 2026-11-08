const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, settings, levels } = require("./helpers.cjs");

for (const mallets of [2, 3, 4]) for (const texture of ["melody", "mixed", "doublestops", "block"]) {
  test(`${mallets} mallets / ${texture}: chord limit and range across 20 seeds and 10 levels`, () => {
    for (let seed = 1; seed <= 20; seed++) for (const [index, level] of levels.entries()) {
      const config = settings({ ...level, mallets, texture, rangeLow: seed % 2 ? 60 : 36, rangeHigh: 96 });
      const score = load(seed).Generator.generate(config);
      for (const measure of score.measures) for (const e of measure.events) {
        const label = `level ${index + 1}, seed ${seed}: ${e.pitches.length} pitches with ${mallets} mallets`;
        assert.ok(e.pitches.length <= mallets, label);
        assert.ok(e.pitches.every(p => p >= config.rangeLow && p <= config.rangeHigh), label);
        assert.equal(measure.events.reduce((sum, event) => sum + event.dur.ticks, 0), score.time.ticks, label);
      }
    }
  });
}
