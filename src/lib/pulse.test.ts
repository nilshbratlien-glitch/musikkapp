import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { advance, audible, clicksBetween, contexts, setPageVisible, started } from "./fake-audio.test-support.ts";

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

  describe("hidden and shown again", () => {
    const ctx = () => contexts[0]! as unknown as { state: string; resumes: number };

    it("hiding the page (visibilitychange, pagehide) stops nothing", () => {
      pulse.start({ owner: "oveplan", bpm: 100 });
      setPageVisible(false);
      assert.equal(pulse.getState().owner, "oveplan");
      assert.equal(pulse.getState().running, true);
    });

    it("a suspended context resumes when the page is visible again and someone owns the pulse", () => {
      pulse.start({ owner: "metronom", bpm: 100 });
      setPageVisible(false);
      ctx().state = "suspended";
      const before = ctx().resumes;
      setPageVisible(true);
      assert.ok(ctx().resumes > before, "resume() was called");
      assert.equal(ctx().state, "running");
    });

    it("an interrupted context (iOS) resumes on pageshow", () => {
      pulse.start({ owner: "bladlesing", bpm: 100 });
      ctx().state = "interrupted";
      globalThis.dispatchEvent(new Event("pageshow"));
      assert.equal(ctx().state, "running");
    });

    it("without an owner a suspended context stays suspended", () => {
      pulse.start({ owner: "snare", bpm: 100 });
      pulse.stop();
      ctx().state = "suspended";
      setPageVisible(true);
      assert.equal(ctx().state, "suspended");
      ctx().state = "running";
    });
  });

  it("a clock jump skips the missed clicks and keeps the accent on the right beat", () => {
    const clicks: { time: number; accent: boolean; beatIndex: number }[] = [];
    pulse.start({ owner: "oveplan", bpm: 60, beats: 4, onClick: (click) => clicks.push(click) });
    advance(1500);
    const first = clicks[0]!.time;
    const before = clicks.length;
    contexts[0]!.currentTime += 60;
    const jumpedTo = contexts[0]!.currentTime;
    advance(1000);
    const after = clicks.slice(before);
    assert.ok(after.length >= 1 && after.length <= 2, `one or two clicks in the second after a 60 s jump, got ${after.length}`);
    for (const click of after) {
      const beat = Math.round(click.time - first) % 4;
      assert.equal(click.beatIndex, beat, "the bar phase follows the clock");
      assert.equal(click.accent, beat === 0);
      assert.ok(click.time >= jumpedTo - 0.05, "nothing scheduled in the past");
    }
    advance(4000);
    const later = clicks.slice(before + after.length);
    assert.ok(later.every((click) => click.beatIndex === Math.round(click.time - first) % 4), "and keeps counting from there");
  });

  describe("skipping after a clock jump", () => {
    type Click = { tick: number; time: number; accent: boolean; downbeat: boolean; beatIndex: number };
    /** Move the audio clock so the next scheduler pass runs at exactly `now`. */
    const runAt = (now: number) => {
      contexts[0]!.currentTime = now - 0.025;
      advance(25);
    };
    const record = (opts: { bpm: number; beats?: number; sub?: number; count?: number }) => {
      const clicks: Click[] = [];
      pulse.start({ owner: "oveplan", ...opts, onClick: (click) => clicks.push(click) });
      advance(1500);
      return clicks;
    };
    /** The tick each click should have, from its time: the grid starts at the first click. */
    const gridTick = (clicks: Click[], click: Click, period: number) => Math.round((click.time - clicks[0]!.time) / period);

    it("a click due just before the jump lands, within LATE_S, still plays", () => {
      const clicks = record({ bpm: 60, beats: 4 });
      const due = clicks.at(-1)!.time + 61;
      const before = clicks.length;
      runAt(due + 0.03);
      const after = clicks.slice(before);
      assert.ok(after.length >= 1, "a click is scheduled");
      assert.equal(after[0]!.time, due, "the beat 30 ms ago is not skipped");
      for (const click of after) {
        assert.equal(click.tick, gridTick(clicks, click, 1));
        assert.equal(click.beatIndex, click.tick % 4);
        assert.equal(click.accent, click.tick % 4 === 0);
      }
    });

    it("a late scheduler pass within LATE_S skips nothing", () => {
      const clicks = record({ bpm: 120, beats: 4 });
      const last = clicks.at(-1)!;
      runAt(last.time + 0.5 + 0.04);
      advance(1000);
      const ticks = clicks.map((click) => click.tick);
      assert.deepEqual(ticks, ticks.map((_, i) => i), "every tick, in order");
      assert.ok(clicks.every((click) => click.tick === gridTick(clicks, click, 0.5)), "on the grid");
    });

    it("with subdivisions, the skip keeps the beat and the sub-click phase", () => {
      const clicks = record({ bpm: 60, beats: 3, sub: 2 });
      const first = clicks[0]!.time;
      for (const [n, past, expected] of [
        [121, 0.3, 122], // 300 ms past sub-click 121: skip it, the next one plays
        [245, 0.02, 245], // 20 ms past sub-click 245: within LATE_S, it still plays
      ] as const) {
        const mark = clicks.length;
        runAt(first + n * 0.5 + past);
        advance(600);
        const after = clicks.slice(mark);
        assert.equal(after[0]?.tick, expected, `after landing ${past * 1000} ms past sub-click ${n}`);
        for (const click of after) {
          const tick = gridTick(clicks, click, 0.5);
          assert.equal(click.tick, tick, "the tick follows the clock");
          assert.equal(click.downbeat, tick % 2 === 0, "beats and sub-clicks keep their phase");
          assert.equal(click.beatIndex, Math.floor(tick / 2) % 3);
          assert.equal(click.accent, tick % 6 === 0);
        }
      }
    });

    it("a counted run counts the skipped clicks and still ends on its last tick", () => {
      const clicks = record({ bpm: 60, beats: 4, count: 8 });
      const before = clicks.length;
      const due = clicks[0]!.time + 5;
      runAt(due + 0.03);
      advance(5000);
      const after = clicks.slice(before);
      assert.deepEqual(
        after.map((click) => click.tick),
        [5, 6, 7],
        "tick 5 (30 ms ago) plays, the skipped ones count, and the run ends at tick 7",
      );
      assert.ok(after.every((click) => click.time === clicks[0]!.time + click.tick));
    });
  });

  it("a meter change keeps the beat position instead of restarting the bar", () => {
    const beats: number[] = [];
    pulse.start({ owner: "metronom", bpm: 120, beats: 4, onClick: (click) => beats.push(click.beatIndex) });
    advance(500);
    assert.deepEqual(beats, [0, 1], "two beats of a 4/4 bar scheduled");
    pulse.setMeter(3, 1);
    advance(2000);
    assert.deepEqual(beats.slice(2, 6), [2, 0, 1, 2], "carries on at beat 3, then bars of three");
  });
});

// Last in the file: these replace the context, and the helpers above read contexts[0].
describe("a context the screen lock stopped", () => {
  type Fake = { state: string; currentTime: number; resumes: number; resume: () => Promise<void> };
  const latest = () => contexts.at(-1)! as unknown as Fake;
  /** The clock stands still and resume() never settles, as on a locked iPad. */
  const freeze = (ctx: Fake) => {
    const frozen = ctx.currentTime;
    Object.defineProperty(ctx, "currentTime", { get: () => frozen, configurable: true });
    ctx.resume = () => {
      ctx.resumes++;
      return new Promise(() => {});
    };
  };
  const tick = (ms: number) => {
    for (let t = 0; t < ms; t += 25) mock.timers.tick(25);
  };

  it("unlock: a running context stays, a suspended one is resumed, an interrupted one is replaced in the tap", () => {
    pulse.start({ owner: "metronom", bpm: 100 });
    pulse.stop();
    const first = latest();
    assert.equal(pulse.unlock(), first as unknown, "running: the same context");
    first.state = "suspended";
    assert.equal(pulse.unlock(), first as unknown, "suspended: resume() first, no swap");
    assert.equal(first.state, "running");
    first.state = "interrupted";
    const next = pulse.unlock();
    assert.notEqual(next, first as unknown, "interrupted: a new context");
    assert.equal(first.state, "closed", "and the old one is closed");
    assert.equal(contexts.length, 2);
  });

  it("a frozen clock gets one resume(), then playback stops and the next Start replaces the context", () => {
    const stops: string[] = [];
    pulse.start({ owner: "metronom", bpm: 100, onStop: (why) => stops.push(why) });
    const stuck = latest();
    freeze(stuck);
    const count = contexts.length;
    tick(500);
    assert.equal(pulse.getState().running, true, "not stopped yet");
    tick(700);
    assert.ok(stuck.resumes >= 1, "resume() was tried");
    tick(700);
    assert.equal(pulse.getState().running, false, "the UI state says stopped");
    assert.deepEqual(stops, ["stalled"]);
    assert.equal(contexts.length, count, "no new context outside a tap");

    pulse.start({ owner: "metronom", bpm: 120 });
    const fresh = latest();
    assert.notEqual(fresh, stuck, "the tap made a new context");
    assert.equal(stuck.state, "closed");
    for (let t = 0; t < 1200; t += 25) {
      fresh.currentTime += 0.025;
      mock.timers.tick(25);
    }
    assert.ok(pulse.getState().beat >= 1, "and the beat moves past the first one");
    assert.equal(pulse.getState().running, true);
  });

  it("in followerMode (Skjerm), a suspended AudioContext never stalls and ticks on wall-clock time", () => {
    const clicks: number[] = [];
    const stops: string[] = [];
    pulse.setFollowerMode(true);
    try {
      pulse.start({
        owner: "bladlesing",
        bpm: 120,
        beats: 4,
        onClick: (c) => clicks.push(c.tick),
        onStop: (why) => stops.push(why),
      });
      const ctx = latest();
      ctx.state = "suspended";
      freeze(ctx);
      tick(2000);
      assert.equal(pulse.getState().running, true, "follower never stalls even when AudioContext is suspended");
      assert.deepEqual(stops, [], "no stalled stop");
      assert.ok(clicks.length >= 4, `expected at least 4 clicks on wall-clock fallback, got ${clicks.length}`);
      assert.ok(pulse.getState().beat >= 0, "beat advances in follower mode");
    } finally {
      pulse.setFollowerMode(false);
    }
  });
});
