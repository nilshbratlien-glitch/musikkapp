import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  applyPreset,
  blockName,
  blockTool,
  bpmFromTaps,
  bumpItem,
  ensureItems,
  fmtClock,
  countdownSeconds,
  liveItems,
  loadPlanStore,
  nextUndone,
  playingSum,
  rollSession,
  savePlanStore,
  todayStamp,
  TRUMPET_EXERCISES,
  type PlanItem,
} from "./oveplan.ts";

const base = (): PlanItem[] => ensureItems([]);

describe("oveplan", () => {
  const previous = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: previous, configurable: true });
  });

  it("starts from the default blocks and sums only live ones", () => {
    const items = base();
    assert.equal(items.length, 4);
    assert.equal(playingSum(items), 12 + 8 + 12 + 15);
    const off = items.map((item) => (item.id === "rep" ? { ...item, on: false } : item));
    assert.equal(liveItems(off).some((item) => item.id === "rep"), false);
  });

  it("provides child-friendly Trumpet block names, durations (16 min total), and presets", () => {
    assert.equal(blockName("twomallet", "trumpet"), "Oppvarming");
    assert.equal(blockName("fourmallet", "trumpet"), "Teknikk & skala");
    assert.equal(blockName("srf", "trumpet"), "Bladlesing");
    assert.equal(blockName("rep", "trumpet"), "Korpslekse");
    assert.equal(blockTool("rep", "trumpet"), "/metronom");
    assert.equal(blockTool("rep", "mallets"), null);
    assert.equal(TRUMPET_EXERCISES.twomallet.title, "Oppvarming");
    assert.ok(TRUMPET_EXERCISES.twomallet.items.some((i) => i.includes("munnstykke")));
    assert.ok(TRUMPET_EXERCISES.twomallet.items.some((i) => i.includes("åtte slag")));
    assert.equal(TRUMPET_EXERCISES.fourmallet.title, "Teknikk og skalaer");
    assert.ok(TRUMPET_EXERCISES.fourmallet.items.some((i) => i.includes("Lip slurs")));
    assert.ok(TRUMPET_EXERCISES.fourmallet.items.some((i) => i.includes("Femtoneskala")));
    assert.ok(TRUMPET_EXERCISES.fourmallet.items.some((i) => i.includes("legato og staccato")));
    assert.equal(TRUMPET_EXERCISES.rep.title, "Korpslekse");
    assert.ok(TRUMPET_EXERCISES.rep.items.some((i) => i.includes("små biter")));
    const trumpetItems = ensureItems([], "trumpet");
    assert.equal(playingSum(trumpetItems), 3 + 4 + 4 + 5);
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
      },
    });
    const store = loadPlanStore(new Date(), "trumpet");
    assert.equal(store.presets.length, 3);
    assert.equal(store.presets[0]?.name, "Kjapp 10 min");
  });

  it("bumps minutes inside 1–90 and finds the next undone block", () => {
    const items = base();
    const first = items[0]!;
    assert.equal(bumpItem(first, -1)?.mins, 11);
    assert.equal(bumpItem({ ...first, mins: 1 }, -1), null);
    assert.equal(bumpItem({ ...first, mins: 90 }, 1), null);
    assert.equal(nextUndone(items, ["twomallet"], "fourmallet")?.id, "srf");
    assert.equal(fmtClock(65), "1:05");
    assert.equal(bpmFromTaps([0, 500, 1000]), 120);
  });

  it("applies a preset and rolls the day", () => {
    const next = applyPreset({
      id: "p",
      name: "Kort",
      blocks: [{ id: "srf", mins: 5 }],
    });
    assert.equal(next.find((item) => item.id === "srf")?.on, true);
    assert.equal(next.find((item) => item.id === "rep")?.on, false);
    const rolled = rollSession(
      { items: next.map((item) => ({ ...item, skipped: true })), done: ["srf"], log: [], presets: [], sessionDate: "2020-01-01", bpmMap: {}, bpm: 80, beats: 4, sub: 1 },
      "2026-11-08",
    );
    assert.equal(rolled.rolled, true);
    assert.deepEqual(rolled.done, []);
    assert.equal(rolled.items.every((item) => !item.skipped), true);
  });

  it("round-trips the oveplan namespace", () => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
      },
    });
    const items = base();
    assert.equal(
      savePlanStore({
        items,
        done: ["rep"],
        log: [],
        presets: [],
        sessionDate: todayStamp(),
        bpmMap: { srf: 96 },
        bpm: 96,
        beats: 4,
        sub: 1,
      }),
      true,
    );
    assert.equal(data.has("musikkapp.oveplan"), true);
    const loaded = loadPlanStore();
    assert.equal(loaded.bpm, 96);
    assert.equal(loaded.done[0], "rep");
    assert.equal(loaded.bpmMap.srf, 96);
  });
});

describe("plan clock", () => {
  it("counts down from the deadline and freezes while paused", () => {
    assert.equal(countdownSeconds(1_000, 11_000, 0, false), 10);
    assert.equal(countdownSeconds(11_000, 11_000, 4_000, false), 0);
    assert.equal(countdownSeconds(20_000, 11_000, 4_000, true), 4);
  });
});
