import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  DEFAULTS,
  LEVELS,
  MALLET_RECIPES,
  TRUMPET_DEFAULTS,
  TRUMPET_RECIPES,
  applyLevelPreset,
  applyPracticeRecipe,
  bladlesingStorageKey,
  clampZoom,
  compactSyncSettings,
  detectLevelIndex,
  incrementDailyEtudeCount,
  loadBladlesingSettings,
  loadDailyEtudeCount,
  matchActiveRecipeId,
  saveBladlesingSettings,
} from "./bladlesing-config.ts";

function installMemoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return storage;
}

describe("bladlesing config, levels & recipes", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it("loads and persists profile-scoped settings separately for mallets and trumpet", () => {
    const mallets = loadBladlesingSettings("mallets");
    assert.equal(mallets.instrumentId, "mar50");
    assert.equal(mallets.flowCountIn, true);
    assert.equal(mallets.flowAutoNext, false);
    assert.equal(mallets.flowTempoRamp, false);

    saveBladlesingSettings("mallets", { ...mallets, tempo: 108, flowDisappearing: true, flowTempoRamp: true });
    const reloaded = loadBladlesingSettings("mallets");
    assert.equal(reloaded.tempo, 108);
    assert.equal(reloaded.flowDisappearing, true);
    assert.equal(reloaded.flowTempoRamp, true);

    const trumpet = loadBladlesingSettings("trumpet");
    assert.equal(trumpet.instrumentId, "trumpet");
    assert.equal(trumpet.tempo, TRUMPET_DEFAULTS.tempo);
    assert.equal(bladlesingStorageKey("trumpet"), "musikkapp.trumpet.bladlesing");
  });

  it("applies and detects all 10 difficulty levels accurately", () => {
    assert.equal(LEVELS.length, 10);
    for (let n = 1; n <= 10; n++) {
      const m = applyLevelPreset(DEFAULTS, n);
      assert.equal(detectLevelIndex(m), n - 1, `mallets level ${n}`);

      const t = applyLevelPreset(TRUMPET_DEFAULTS, n);
      assert.equal(detectLevelIndex(t), n - 1, `trumpet level ${n}`);
      assert.equal(t.legato, n >= 3);
    }
  });

  it("applies and matches Quick Practice Recipes for mallets and trumpet", () => {
    for (const recipe of MALLET_RECIPES) {
      const next = applyPracticeRecipe(DEFAULTS, recipe);
      assert.equal(matchActiveRecipeId(next, "mallets"), recipe.id);
    }
    for (const recipe of TRUMPET_RECIPES) {
      const next = applyPracticeRecipe(TRUMPET_DEFAULTS, recipe);
      assert.equal(matchActiveRecipeId(next, "trumpet"), recipe.id);
    }
  });

  it("omits local-only fields (zoom, flow, duet mute/view) from compactSyncSettings", () => {
    const sync = compactSyncSettings({
      ...DEFAULTS,
      zoom: 1.4,
      flowAutoNext: true,
      flowTempoRamp: true,
      duetViewPart: "trumpet",
    });
    assert.equal("zoom" in sync, false);
    assert.equal("flowAutoNext" in sync, false);
    assert.equal("flowTempoRamp" in sync, false);
    assert.equal("duetViewPart" in sync, false);
    assert.equal(sync.instrumentId, "mar50");
  });

  it("clamps zoom within [0.7, 1.6]", () => {
    assert.equal(clampZoom(0.2), 0.7);
    assert.equal(clampZoom(2.5), 1.6);
    assert.equal(clampZoom(1.156), 1.16);
  });

  it("tracks completed etude count per calendar day and resets on a new day", () => {
    assert.equal(loadDailyEtudeCount("2026-11-19"), 0);
    assert.equal(incrementDailyEtudeCount("2026-11-19"), 1);
    assert.equal(incrementDailyEtudeCount("2026-11-19"), 2);
    assert.equal(loadDailyEtudeCount("2026-11-19"), 2);
    assert.equal(loadDailyEtudeCount("2026-11-20"), 0);
  });
});
