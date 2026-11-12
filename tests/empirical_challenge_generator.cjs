const assert = require("node:assert/strict");
const { load, settings, levels } = require("../public/malletsight/tests/helpers.cjs");

console.log("=== EMPIRICAL CHALLENGE 1: GENERATOR.JS STRESS HARNESS ===");

const instrumentsToTest = [
  { id: "trumpet", low: 54, high: 84, monophonic: true },
  { id: "glock", low: 67, high: 96, monophonic: false },
  { id: "xylo", low: 53, high: 89, monophonic: false },
  { id: "vibes", low: 53, high: 89, monophonic: false },
  { id: "mar43", low: 45, high: 84, monophonic: false },
  { id: "mar50", low: 33, high: 84, monophonic: false },
];

let totalScoresGenerated = 0;
let totalMeasuresChecked = 0;
let totalSlursChecked = 0;

for (let lvlIdx = 0; lvlIdx < levels.length; lvlIdx++) {
  const levelNum = lvlIdx + 1;
  const levelDef = levels[lvlIdx];

  for (const legato of [true, false]) {
    for (const inst of instrumentsToTest) {
      for (let seed = 1; seed <= 20; seed++) {
        const env = load(seed * 1000 + lvlIdx * 10 + (legato ? 1 : 0));
        const cfg = settings({
          ...levelDef,
          instrumentId: inst.id,
          rangeLow: inst.low,
          rangeHigh: inst.high,
          legato,
          measures: 6,
        });

        let score;
        try {
          score = env.Generator.generate(cfg);
          totalScoresGenerated++;
        } catch (err) {
          assert.fail(`CRASH on level ${levelNum}, legato=${legato}, inst=${inst.id}, seed=${seed}: ${err.message}`);
        }

        assert.equal(score.settingsSnapshot.legato, legato);
        assert.equal(score.measures.length, 6);

        // Verify monophonic property for trumpet
        if (inst.monophonic) {
          assert.equal(score.settingsSnapshot.mallets, 1);
          assert.equal(score.settingsSnapshot.texture, "melody");
        }

        let abc;
        try {
          abc = env.ScoreRenderer.scoreToAbc(score, { showSticking: true });
        } catch (err) {
          assert.fail(`ScoreRenderer CRASH on level ${levelNum}, legato=${legato}, inst=${inst.id}, seed=${seed}: ${err.message}`);
        }

        // Validate ABC slur syntax in music body (ignoring !...! dynamics and (3 tuplets)
        const musicBody = abc.split(/^K:.*$/m)[1] || "";
        const musicWithoutDynamics = musicBody.replace(/![^!]*!/g, "");
        const openParenCount = (musicWithoutDynamics.match(/\((?!\d)/g) || []).length;
        const closeParenCount = (musicWithoutDynamics.match(/\)/g) || []).length;
        assert.equal(
          openParenCount,
          closeParenCount,
          `Mismatched ABC slur parentheses (${openParenCount} vs ${closeParenCount}) in level ${levelNum}, seed ${seed}`
        );

        if (!legato) {
          if (openParenCount !== 0) {
            console.error(`FAILURE at level ${levelNum}, inst=${inst.id}, seed=${seed}, legato=${legato}`);
            console.error(`Music body:\n${musicBody}`);
          }
          assert.equal(
            openParenCount,
            0,
            `Expected 0 ABC slur parentheses when legato is false, found ${openParenCount}`
          );
        }

        for (const [mIdx, measure] of score.measures.entries()) {
          totalMeasuresChecked++;

          // Bar duration exact check
          const barTicks = measure.events.reduce((sum, e) => sum + e.dur.ticks, 0);
          assert.equal(barTicks, score.time.ticks, `Bar duration mismatch in bar ${mIdx}`);

          let inSlur = false;
          let currentSlurLength = 0;
          let prevPitchInSlur = null;

          for (const [eIdx, ev] of measure.events.entries()) {
            // Pitch range check
            if (!ev.rest && ev.pitches) {
              if (inst.monophonic) {
                assert.equal(
                  ev.pitches.length,
                  1,
                  `Trumpet note must be monophonic at level ${levelNum}, bar ${mIdx}, ev ${eIdx}`
                );
              }
              for (const p of ev.pitches) {
                assert.ok(
                  p >= inst.low && p <= inst.high,
                  `Pitch ${p} out of instrument bounds [${inst.low}, ${inst.high}] in level ${levelNum}, inst ${inst.id}`
                );
              }
            }

            if (!legato) {
              assert.ok(!ev.slurStart, `slurStart present when legato is false at level ${levelNum}`);
              assert.ok(!ev.slurred, `slurred present when legato is false at level ${levelNum}`);
              assert.ok(!ev.slurEnd, `slurEnd present when legato is false at level ${levelNum}`);
              continue;
            }

            // Legato assertions
            if (ev.slurStart) {
              assert.equal(inSlur, false, `Nested slur detected at level ${levelNum}, bar ${mIdx}, ev ${eIdx}`);
              inSlur = true;
              currentSlurLength = 1;
              totalSlursChecked++;

              assert.ok(!ev.rest, "slur cannot start on a rest");
              assert.ok(!ev.tie, "slur cannot start on a tie");
              assert.ok(!ev.tuplet, "slur cannot start on a tuplet");
              assert.ok(ev.pitches && ev.pitches.length > 0, "slur start note must sound");
              assert.ok(
                !ev.articulations || !ev.articulations.includes("staccato"),
                "slurred note must not have staccato articulation"
              );
              prevPitchInSlur = ev.pitches[0];
            } else if (inSlur) {
              currentSlurLength++;
              assert.equal(ev.slurred, true, `Expected ev.slurred=true inside slur at ev ${eIdx}`);
              assert.ok(!ev.rest, "rest found inside a slur");
              assert.ok(!ev.tie, "tie found inside a slur");
              assert.ok(!ev.tuplet, "tuplet found inside a slur");
              assert.ok(ev.pitches && ev.pitches.length > 0, "slurred note must sound");
              assert.ok(
                !ev.articulations || !ev.articulations.includes("staccato"),
                "slurred note must not have staccato articulation"
              );

              // Check interval <= 7 semitones and not equal
              const currPitch = ev.pitches[0];
              const interval = Math.abs(currPitch - prevPitchInSlur);
              assert.ok(
                interval <= 7 && interval > 0,
                `Slurred interval ${interval} must be between 1 and 7 semitones (p1=${prevPitchInSlur}, p2=${currPitch})`
              );
              prevPitchInSlur = currPitch;

              if (ev.slurEnd) {
                assert.ok(
                  currentSlurLength >= 2 && currentSlurLength <= 4,
                  `Slur length ${currentSlurLength} outside 2-4 bounds at level ${levelNum}, bar ${mIdx}`
                );
                inSlur = false;
                currentSlurLength = 0;
                prevPitchInSlur = null;
              }
            } else {
              assert.ok(!ev.slurEnd, `Unexpected slurEnd outside slur at bar ${mIdx}, ev ${eIdx}`);
            }
          }

          assert.equal(
            inSlur,
            false,
            `Unclosed slur at end of measure ${mIdx} in level ${levelNum}, seed ${seed}`
          );
        }
      }
    }
  }
}

console.log(`[PASS] Generator stress test verified:`);
console.log(`  - Total scores generated: ${totalScoresGenerated}`);
console.log(`  - Total measures checked: ${totalMeasuresChecked}`);
console.log(`  - Total slurs checked: ${totalSlursChecked}`);

// Determinism stress assertion
console.log("=== EMPIRICAL CHALLENGE 1B: DETERMINISM ASSERTION ===");
for (let lvl = 0; lvl < levels.length; lvl++) {
  const seed = 98765 + lvl;
  const cfg = settings({
    ...levels[lvl],
    instrumentId: "trumpet",
    legato: true,
  });

  const run1 = JSON.stringify(load(seed).Generator.generate(cfg));
  const run2 = JSON.stringify(load(seed).Generator.generate(cfg));
  assert.equal(run1, run2, `Generator must be 100% deterministic on level ${lvl + 1} with seed ${seed}`);

  const diffSeedRun = JSON.stringify(load(seed + 1).Generator.generate(cfg));
  assert.notEqual(run1, diffSeedRun, `Different seeds must produce different output on level ${lvl + 1}`);
}
console.log("[PASS] Determinism verified across all 10 levels with legato enabled.");
