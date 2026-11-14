import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import "../fake-audio.test-support.ts";
import { generateRoomCode, loadSyncConfig, saveSyncConfig } from "./config.ts";
import { setMasterMuted } from "../pulse.ts";

describe("sync config & room code", () => {
  const previous = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: previous, configurable: true });
  });

  it("generates a formatted room code with word and 3 digits", () => {
    const code = generateRoomCode();
    assert.match(code, /^[A-Z]+-\d{3}$/);
  });

  it("loads and persists sync configuration", () => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
      },
    });

    saveSyncConfig({
      roomCode: "TAKT-123",
      role: "display",
      deviceName: "Test iPad",
      audioActive: true,
    });

    const loaded = loadSyncConfig();
    assert.equal(loaded.roomCode, "TAKT-123");
    assert.equal(loaded.role, "display");
    assert.equal(loaded.deviceName, "Test iPad");
    assert.equal(loaded.audioActive, true);
  });
});

import {
  armBlockRemote,
  beginBlock,
  beginBlockRemote,
  bindPlanNavigate,
  finishPlanBlock,
  getPlanClock,
  resetPlan,
  setPlanBroadcastHook,
  setPlanMetroRemote,
  startPlanMetroRemote,
  stopPlanMetroRemote,
  stopPlanRemote,
  togglePlanMetro,
} from "../plan-clock.ts";
import { getState as getPulseState } from "../pulse.ts";

describe("pulse master mute for sync", () => {
  it("can set master mute without error", () => {
    assert.doesNotThrow(() => {
      setMasterMuted(true);
      setMasterMuted(false);
    });
  });
});

describe("plan-clock sync transitions", () => {
  afterEach(() => {
    bindPlanNavigate(() => {});
    setPlanBroadcastHook({});
    resetPlan();
  });

  it("fires onArm when finishPlanBlock advances to the next task", () => {
    resetPlan();
    const events: string[] = [];
    setPlanBroadcastHook({
      onStart: (item) => events.push(`start:${item.id}`),
      onArm: (item) => events.push(`arm:${item.id}`),
      onStop: () => events.push("stop"),
    });

    const clock = getPlanClock();
    beginBlock(clock.store.items[0]!, true);
    assert.equal(clock.activeId, "twomallet");
    assert.deepEqual(events, ["start:twomallet"]);

    finishPlanBlock();
    assert.equal(clock.activeId, "fourmallet");
    assert.equal(clock.blockPaused, true);
    assert.deepEqual(events, ["start:twomallet", "arm:fourmallet"]);
  });

  it("keeps the controller on Øveplan when shouldNavigateLocally returns false", () => {
    resetPlan();
    const navigated: string[] = [];
    const events: string[] = [];
    bindPlanNavigate((to) => navigated.push(to));
    setPlanBroadcastHook({
      shouldNavigateLocally: () => false,
      onStart: (item) => events.push(`start:${item.id}`),
      onArm: (item) => events.push(`arm:${item.id}`),
    });

    const clock = getPlanClock();
    beginBlock(clock.store.items[0]!, true);
    finishPlanBlock();
    assert.deepEqual(navigated, [], "controller never navigates away from Øveplan");
    assert.deepEqual(events, ["start:twomallet", "arm:fourmallet"]);
  });

  it("broadcasts manual metronome toggle and applies remote metronome state", () => {
    resetPlan();
    const metroEvents: string[] = [];
    setPlanBroadcastHook({
      onMetroStart: (bpm, beats, sub) => metroEvents.push(`start:${bpm}:${beats}:${sub}`),
      onMetroStop: () => metroEvents.push("stop"),
    });

    togglePlanMetro();
    assert.equal(getPlanClock().metroRunning, true);
    assert.deepEqual(metroEvents, ["start:80:4:1"]);

    togglePlanMetro();
    assert.equal(getPlanClock().metroRunning, false);
    assert.deepEqual(metroEvents, ["start:80:4:1", "stop"]);

    // Remote display metronome commands do not echo back into metroEvents
    startPlanMetroRemote(116, 3, 2);
    assert.equal(getPlanClock().metroRunning, true);
    assert.equal(getPulseState().owner, "oveplan");
    assert.equal(getPulseState().bpm, 116);
    assert.equal(getPulseState().beats, 3);
    assert.equal(getPulseState().sub, 2);

    setPlanMetroRemote(128, 5, 1);
    assert.equal(getPulseState().bpm, 128);
    assert.equal(getPulseState().beats, 5);

    stopPlanMetroRemote();
    assert.equal(getPlanClock().metroRunning, false);
    assert.equal(getPulseState().running, false);
    assert.deepEqual(metroEvents, ["start:80:4:1", "stop"]);
  });

  it("updates remote display header when armBlockRemote and stopPlanRemote are called", () => {
    const clock = getPlanClock();
    beginBlockRemote("twomallet", 5, 100, 4, 1, Date.now() + 300_000);
    assert.equal(clock.activeId, "twomallet");
    assert.equal(clock.blockPaused, false);

    armBlockRemote("fourmallet", 5, 80, 4, 1, 180_000);
    assert.equal(clock.activeId, "fourmallet");
    assert.equal(clock.blockPaused, true);
    assert.equal(clock.blockLeft, 180);
    assert.equal(clock.startLabel, "Fortsett");

    stopPlanRemote();
    assert.equal(clock.activeId, null);
    assert.equal(clock.blockLeft, 0);
  });

  it("ignores wall-clock skew on remote start and resume when remainMs is provided", async () => {
    const {
      beginBlockRemote,
      pauseBlockRemote,
      resumeBlockRemote,
      stopPlanRemote,
      getPlanClock,
    } = await import("../plan-clock.ts");
    const clock = getPlanClock();
    const skewedOffsetMs = 12_000;

    beginBlockRemote("twomallet", 5, 100, 4, 1, Date.now() + 300_000 + skewedOffsetMs, 300_000);
    assert.equal(clock.blockLeft, 300);

    pauseBlockRemote(295_000);
    assert.equal(clock.blockPaused, true);
    assert.equal(clock.blockLeft, 295);

    resumeBlockRemote(Date.now() + 295_000 + skewedOffsetMs, 295_000);
    assert.equal(clock.blockPaused, false);
    assert.equal(clock.blockLeft, 295);

    stopPlanRemote();
  });
});


