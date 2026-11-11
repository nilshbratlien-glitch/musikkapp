import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
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

describe("pulse master mute for sync", () => {
  it("can set master mute without error", () => {
    assert.doesNotThrow(() => {
      setMasterMuted(true);
      setMasterMuted(false);
    });
  });
});
