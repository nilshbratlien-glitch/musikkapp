import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import "./fake-audio.test-support.ts";

const pulse = await import("./pulse.ts");
const planClock = await import("./plan-clock.ts");
const { blockTool, playsMetronome } = await import("./oveplan.ts");
const { meterForBeats } = await import("./metronome.ts");

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

  describe("Metronom tab during a block", () => {
    const local = { owner: "metronom" as const, bpm: 80, beats: 4, sub: 1 };
    const owners: (string | null)[] = [];
    let off = () => {};

    beforeEach(() => {
      planClock.ensurePlanClock();
      const store = planClock.getPlanClock().store;
      store.bpmMap.twomallet = 100;
      store.beats = 3;
      store.sub = 2;
      owners.length = 0;
      off = pulse.subscribe(() => {
        const owner = pulse.getState().owner;
        if (owners.at(-1) !== owner) owners.push(owner);
      });
    });

    afterEach(() => off());

    it("Stopp pauses a running 2-mallet block like the header, without an owner change", () => {
      planClock.beginBlock(item("twomallet"));
      planClock.stopFromMetronom();
      const clock = planClock.getPlanClock();
      assert.equal(clock.blockPaused, true, "the block timer is paused");
      assert.equal(clock.timer, null);
      assert.equal(clock.metroHeld, true, "resume brings the metronome back");
      const left = clock.blockLeft;
      mock.timers.tick(3000);
      assert.equal(planClock.getPlanClock().blockLeft, left, "the countdown stands still");
      assert.deepEqual(owners, ["oveplan", null], "the pulse goes from the plan to silence, never to Metronom");
    });

    it("Start resumes the paused block at the block's tempo, meter and subdivision", () => {
      planClock.beginBlock(item("twomallet"));
      planClock.stopFromMetronom();
      planClock.startFromMetronom(local);
      const state = pulse.getState();
      assert.equal(state.owner, "oveplan", "the plan keeps the pulse");
      assert.equal(state.bpm, 100, "the block's BPM, not Metronom's 80");
      assert.equal(state.beats, 3);
      assert.equal(state.sub, 2);
      assert.equal(meterForBeats(state.beats), "3/4", "the meter chip matches the beat count");
      assert.equal(meterForBeats(5), null, "no chip for five beats");
      assert.equal(planClock.getPlanClock().blockPaused, false);
      assert.ok(!owners.includes("metronom"));
    });

    it("outside a 2-/4-mallet block Stopp and Start only touch Metronom's own clicks", () => {
      planClock.startFromMetronom(local);
      assert.equal(pulse.getState().owner, "metronom");
      assert.equal(pulse.getState().bpm, 80);
      planClock.stopFromMetronom();
      assert.equal(pulse.getState().owner, null);
      planClock.beginBlock(item("rep"));
      planClock.togglePlanMetro();
      planClock.stopFromMetronom();
      assert.equal(pulse.getState().owner, "oveplan", "Metronom never stops the plan's metronome");
      assert.equal(planClock.getPlanClock().blockPaused, false, "and a Repertoar block keeps running");
    });
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
