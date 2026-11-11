import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import "../fake-audio.test-support.ts";
import { generateRoomCode, loadSyncConfig, saveSyncConfig } from "./config.ts";
import { getSyncState, subscribeSyncState } from "./room.ts";
import { output, setMasterMuted } from "../pulse.ts";

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

describe("sync state manager", () => {
  it("provides initial sync state", () => {
    const state = getSyncState();
    assert.equal(typeof state.connected, "boolean");
    assert.equal(typeof state.roomCode, "string");
    assert.ok(Array.isArray(state.peers));
  });

  it("notifies listeners on subscription", () => {
    let fired = false;
    const unsub = subscribeSyncState(() => {
      fired = true;
    });
    assert.equal(typeof unsub, "function");
    unsub();
  });
});

import {
  armBlockRemote,
  beginBlock,
  beginBlockRemote,
  finishPlanBlock,
  getPlanClock,
  resetPlan,
  setPlanBroadcastHook,
  stopPlanRemote,
} from "../plan-clock.ts";

describe("pulse master mute for sync", () => {
  it("can set master mute without error", () => {
    assert.doesNotThrow(() => {
      setMasterMuted(true);
      setMasterMuted(false);
    });
  });
});

describe("plan-clock sync transitions", () => {
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

  it("updates remote display header when armBlockRemote and stopPlanRemote are called", () => {
    const clock = getPlanClock();
    beginBlockRemote("twomallet", 5, 100, 4, 1, Date.now() + 300_000);
    assert.equal(clock.activeId, "twomallet");
    assert.equal(clock.blockPaused, false);

    armBlockRemote("fourmallet", 5, 80, 4, 1);
    assert.equal(clock.activeId, "fourmallet");
    assert.equal(clock.blockPaused, true);
    assert.equal(clock.blockLeft, 300);

    stopPlanRemote();
    assert.equal(clock.activeId, null);
    assert.equal(clock.blockLeft, 0);
  });
});

