import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import "./fake-audio.test-support.ts";

const pulse = await import("./pulse.ts");
const planClock = await import("./plan-clock.ts");
const { blockTool, playsMetronome } = await import("./oveplan.ts");

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
});

afterEach(() => {
  pulse.stop();
  planClock.resetPlan();
  mock.timers.reset();
});

describe("plan clock on the pulse core", () => {
  const item = (id: "twomallet" | "fourmallet" | "srf" | "rep") => planClock.getPlanClock().store.items.find((row) => row.id === id)!;

  it("counts down from the end timestamp, even when ticks are late", () => {
    planClock.ensurePlanClock();
    planClock.beginBlock(item("rep"));
    const left = planClock.getPlanClock().blockLeft;
    mock.timers.setTime(Date.now() + 61_000);
    planClock.syncLeft();
    assert.equal(planClock.getPlanClock().blockLeft, left - 61);
  });

  it("keeps one countdown interval through pause, resume and block switches", () => {
    planClock.ensurePlanClock();
    let ticks = 0;
    const off = planClock.subscribePlanClock(() => ticks++);
    planClock.beginBlock(item("rep"));
    planClock.beginBlock(item("srf"), true);
    planClock.pauseBlock();
    planClock.resumeBlock();
    planClock.resumeBlock();
    ticks = 0;
    mock.timers.tick(1000);
    off();
    assert.equal(ticks, 5, "one 200 ms interval");
  });

  it("runs the block metronome only while a 2- or 4-mallet block plays", () => {
    planClock.ensurePlanClock();
    planClock.beginBlock(item("twomallet"));
    assert.equal(pulse.getState().owner, "oveplan");
    planClock.pauseBlock();
    assert.equal(pulse.getState().running, false, "pause stops the sound");
    planClock.resumeBlock();
    assert.equal(pulse.getState().owner, "oveplan", "resume brings it back");
    planClock.beginBlock(item("srf"), true);
    assert.equal(pulse.getState().running, false, "switching to SRF stops the previous block's sound");
    planClock.beginBlock(item("fourmallet"), true);
    assert.equal(pulse.getState().owner, "oveplan");
    planClock.finishPlanBlock();
    assert.equal(pulse.getState().running, false, "Ferdig stops it");
    planClock.beginBlock(item("twomallet"));
    planClock.resetPlan();
    assert.equal(pulse.getState().running, false, "Nullstill stops it");
    assert.equal(planClock.getPlanClock().activeId, null);
  });

  it("another tool taking the sound stops the plan metronome cleanly", () => {
    planClock.ensurePlanClock();
    planClock.beginBlock(item("twomallet"));
    pulse.start({ owner: "metronom", bpm: 90 });
    assert.equal(planClock.getPlanClock().metroRunning, false);
  });

  it("opens the block's tool through the bound navigation", () => {
    planClock.ensurePlanClock();
    const went: string[] = [];
    planClock.bindPlanNavigate((to) => went.push(to));
    planClock.beginBlock(item("twomallet"));
    planClock.beginBlock(item("srf"), true);
    planClock.beginBlock(item("rep"), true);
    planClock.bindPlanNavigate(() => {});
    assert.deepEqual(went, ["/metronom", "/"]);
    assert.equal(blockTool("fourmallet"), "/metronom");
    assert.equal(playsMetronome("rep"), false);
  });
});
