import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  _resetThemeForTests,
  cycleThemePreference,
  getThemePreference,
  getThemeVersion,
  nextThemePreference,
  normalizeThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeTheme,
} from "./theme.ts";

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

describe("theme store", () => {
  beforeEach(() => {
    installMemoryStorage();
    _resetThemeForTests();
  });

  it("defaults to system preference and resolves from prefersLight", () => {
    assert.equal(getThemePreference(), "system");
    assert.equal(resolveTheme("system", true), "light");
    assert.equal(resolveTheme("system", false), "dark");
    assert.equal(resolveTheme("light", false), "light");
    assert.equal(resolveTheme("dark", true), "dark");
  });

  it("persists preference to localStorage and notifies subscribers", () => {
    let calls = 0;
    const unsub = subscribeTheme(() => {
      calls += 1;
    });
    const before = getThemeVersion();

    setThemePreference("light");
    assert.equal(getThemePreference(), "light");
    assert.equal(globalThis.localStorage.getItem(THEME_STORAGE_KEY), "light");
    assert.equal(calls, 1);
    assert.equal(getThemeVersion(), before + 1);

    setThemePreference("dark");
    assert.equal(getThemePreference(), "dark");
    assert.equal(globalThis.localStorage.getItem(THEME_STORAGE_KEY), "dark");
    assert.equal(calls, 2);

    unsub();
  });

  it("cycles system -> light -> dark -> system", () => {
    assert.equal(nextThemePreference("system"), "light");
    assert.equal(nextThemePreference("light"), "dark");
    assert.equal(nextThemePreference("dark"), "system");

    assert.equal(cycleThemePreference(), "light");
    assert.equal(cycleThemePreference(), "dark");
    assert.equal(cycleThemePreference(), "system");
  });

  it("normalizes unknown values to system", () => {
    assert.equal(normalizeThemePreference("sepia"), "system");
    assert.equal(normalizeThemePreference(null), "system");
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "invalid");
    assert.equal(getThemePreference(), "system");
  });

  it("exports a valid inline init script referencing the storage key", () => {
    assert.ok(THEME_INIT_SCRIPT.includes(THEME_STORAGE_KEY));
    assert.ok(THEME_INIT_SCRIPT.includes("prefers-color-scheme: light"));
    assert.ok(THEME_INIT_SCRIPT.includes("dataset.theme"));
  });
});
