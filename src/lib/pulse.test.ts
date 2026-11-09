import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { advance, audible, clicksBetween, contexts, started } from "./fake-audio.test-support.ts";

const pulse = await import("./pulse.ts");

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
});

afterEach(() => {
  pulse.stop();
  mock.timers.reset();
  started.length = 0;
});

describe("pulse core", () => {
  it("has one owner: a new start stops the previous one", () => {
    const stops: string[] = [];
    pulse.start({ owner: "metronom", bpm: 120, onStop: (why) => stops.push(`metronom:${why}`) });
    pulse.start({ owner: "snare", bpm: 100, onStop: (why) => stops.push(`snare:${why}`) });
    assert.deepEqual(stops, ["metronom:replaced"]);
    assert.equal(pulse.getState().owner, "snare");
    assert.equal(pulse.stop("metronom"), false, "another owner cannot stop the current one");
    assert.equal(pulse.getState().running, true);
    assert.equal(pulse.stop("snare"), true);
    assert.deepEqual(stops, ["metronom:replaced", "snare:stopped"]);
    assert.equal(pulse.getState().owner, null);
  });

  it("uses one AudioContext and cuts the old owner's sound when it is replaced", () => {
    pulse.start({ owner: "metronom", bpm: 60 });
    advance(500);
    const old = started.slice();
    assert.ok(old.length > 0 && old.every(audible));
    pulse.start({ owner: "bladlesing", bpm: 90 });
    advance(500);
    assert.equal(contexts.length, 1);
    assert.ok(old.every((osc) => !audible(osc)), "replaced clicks no longer reach the speakers");
    const now = started.filter((osc) => !old.includes(osc));
    assert.ok(now.length > 0 && now.every(audible));
    pulse.stop();
    assert.ok(started.every((osc) => !audible(osc)), "stop silences everything");
  });

  it("repeated starts never add a second scheduler", () => {
    for (let i = 0; i < 5; i++) pulse.start({ owner: "metronom", bpm: 60 });
    const from = contexts[0]!.currentTime + 0.2;
    advance(4000);
    assert.equal(clicksBetween(from, from + 3), 3, "exactly one click per second at 60 BPM");
  });

  it("accents bars, follows BPM changes and stops after `count` clicks", () => {
    const clicks: boolean[] = [];
    pulse.start({ owner: "snare", bpm: 120, beats: 3, onClick: (click) => clicks.push(click.accent) });
    advance(1600);
    assert.deepEqual(clicks.slice(0, 4), [true, false, false, true]);
    pulse.setBpm(60);
    const from = contexts[0]!.currentTime + 0.2;
    advance(3000);
    assert.equal(clicksBetween(from, from + 2), 2);
    pulse.start({ owner: "bladlesing", bpm: 240, count: 3 });
    advance(3000);
    assert.equal(pulse.getState().owner, "bladlesing");
    assert.equal(clicksBetween(contexts[0]!.currentTime - 3.2, contexts[0]!.currentTime + 1), 3);
  });
});
