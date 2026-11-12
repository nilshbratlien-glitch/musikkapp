import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  PROFILE_META,
  PROFILE_STORAGE_KEY,
  getProfile,
  hasChosenProfile,
  setProfile,
  subscribeProfile,
  getProfileVersion,
  MusikkProfile,
  _resetProfileForTesting,
  type InstrumentProfile,
} from "./profile.ts";
import { TOOLS, toolNamespace, type ToolId } from "./tools.ts";

type MemoryStorage = Storage & { failNext: boolean };

function createMemoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    failNext: false,
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
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("QuotaExceededError: storage full");
      }
      map.set(key, String(value));
    },
  };
}

describe("Instrument profile management (src/lib/profile.ts)", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
  let mockStorage: MemoryStorage;

  beforeEach(() => {
    mockStorage = createMemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      configurable: true,
      writable: true,
    });
    // Ensure navigator.webdriver does not force hasChosenProfile to true during unit tests
    Object.defineProperty(globalThis, "navigator", {
      value: { webdriver: false },
      configurable: true,
      writable: true,
    });
    _resetProfileForTesting();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    _resetProfileForTesting();
  });

  describe("getProfile()", () => {
    it("defaults to 'mallets' when storage is empty", () => {
      const profile = getProfile();
      assert.equal(profile, "mallets");
    });

    it("returns 'trumpet' when stored in localStorage", () => {
      mockStorage.setItem(PROFILE_STORAGE_KEY, "trumpet");
      assert.equal(getProfile(), "trumpet");
    });

    it("returns 'mallets' when explicitly stored in localStorage", () => {
      mockStorage.setItem(PROFILE_STORAGE_KEY, "mallets");
      assert.equal(getProfile(), "mallets");
    });

    it("returns valid InstrumentProfile type ('mallets' | 'trumpet')", () => {
      const validProfiles: InstrumentProfile[] = ["mallets", "trumpet"];
      assert.ok(validProfiles.includes(getProfile()));

      setProfile("trumpet");
      assert.ok(validProfiles.includes(getProfile()));
    });
  });

  describe("setProfile()", () => {
    it("updates active profile and persists to localStorage", () => {
      setProfile("trumpet");
      assert.equal(getProfile(), "trumpet");
      assert.equal(mockStorage.getItem(PROFILE_STORAGE_KEY), "trumpet");

      setProfile("mallets");
      assert.equal(getProfile(), "mallets");
      assert.equal(mockStorage.getItem(PROFILE_STORAGE_KEY), "mallets");
    });

    it("increments profile version on each setProfile call", () => {
      const v0 = getProfileVersion();
      setProfile("trumpet");
      assert.equal(getProfileVersion(), v0 + 1);
      setProfile("mallets");
      assert.equal(getProfileVersion(), v0 + 2);
    });

    it("normalizes unknown profile inputs to 'mallets'", () => {
      // @ts-expect-error test runtime resilience for arbitrary inputs
      setProfile("saxophone");
      assert.equal(getProfile(), "mallets");
      assert.equal(mockStorage.getItem(PROFILE_STORAGE_KEY), "mallets");
    });
  });

  describe("hasChosenProfile()", () => {
    it("returns false initially when no profile has been chosen and storage is empty", () => {
      assert.equal(hasChosenProfile(), false);
    });

    it("returns true once setProfile() is called", () => {
      setProfile("trumpet");
      assert.equal(hasChosenProfile(), true);
    });

    it("returns true if valid profile exists in localStorage even before setProfile() call", () => {
      mockStorage.setItem(PROFILE_STORAGE_KEY, "trumpet");
      assert.equal(hasChosenProfile(), true);

      mockStorage.setItem(PROFILE_STORAGE_KEY, "mallets");
      assert.equal(hasChosenProfile(), true);
    });

    it("returns false if localStorage contains unknown or invalid value", () => {
      mockStorage.setItem(PROFILE_STORAGE_KEY, "corrupted_profile_name");
      assert.equal(hasChosenProfile(), false);
    });
  });

  describe("Fallback and error handling", () => {
    it("safely handles unknown profile values in localStorage and falls back to memoryProfile", () => {
      mockStorage.setItem(PROFILE_STORAGE_KEY, "invalid-instrument");
      assert.equal(getProfile(), "mallets");

      setProfile("trumpet");
      mockStorage.setItem(PROFILE_STORAGE_KEY, "random_garbage_data");
      // Memory profile is trumpet, garbage is ignored
      assert.equal(getProfile(), "trumpet");
    });

    it("safely handles corrupted or throwing localStorage.getItem", () => {
      Object.defineProperty(globalThis, "localStorage", {
        value: {
          getItem() {
            throw new Error("SecurityError: access denied");
          },
          setItem() {
            throw new Error("SecurityError: access denied");
          },
        },
        configurable: true,
      });

      assert.doesNotThrow(() => {
        const profile = getProfile();
        assert.equal(profile, "mallets");
      });

      assert.doesNotThrow(() => {
        const chosen = hasChosenProfile();
        assert.equal(chosen, false);
      });
    });

    it("safely survives missing localStorage (null or undefined)", () => {
      Object.defineProperty(globalThis, "localStorage", {
        value: null,
        configurable: true,
      });

      assert.doesNotThrow(() => {
        assert.equal(getProfile(), "mallets");
        setProfile("trumpet");
        assert.equal(getProfile(), "trumpet");
        assert.equal(hasChosenProfile(), true);
      });
    });

    it("safely survives localStorage.setItem quota errors when setProfile is called", () => {
      mockStorage.failNext = true;
      assert.doesNotThrow(() => {
        setProfile("trumpet");
      });
      // In-memory state is still updated
      assert.equal(getProfile(), "trumpet");
      assert.equal(hasChosenProfile(), true);
    });
  });

  describe("subscribeProfile()", () => {
    it("calls subscriber callbacks on setProfile()", () => {
      let callCount = 0;
      const unsubscribe = subscribeProfile(() => {
        callCount += 1;
      });

      setProfile("trumpet");
      assert.equal(callCount, 1);

      setProfile("mallets");
      assert.equal(callCount, 2);

      unsubscribe();
    });

    it("notifies multiple subscribers independently", () => {
      let sub1 = 0;
      let sub2 = 0;

      const unsub1 = subscribeProfile(() => {
        sub1 += 1;
      });
      const unsub2 = subscribeProfile(() => {
        sub2 += 1;
      });

      setProfile("trumpet");
      assert.equal(sub1, 1);
      assert.equal(sub2, 1);

      unsub1();
      setProfile("mallets");
      assert.equal(sub1, 1);
      assert.equal(sub2, 2);

      unsub2();
      setProfile("trumpet");
      assert.equal(sub1, 1);
      assert.equal(sub2, 2);
    });

    it("properly removes listener on unsubscribe so no more calls occur", () => {
      let called = false;
      const unsub = subscribeProfile(() => {
        called = true;
      });

      unsub();
      setProfile("trumpet");
      assert.equal(called, false);
    });
  });

  describe("toolNamespace(id, profile)", () => {
    it("produces 'musikkapp.${id}' for mallets profile", () => {
      for (const tool of TOOLS) {
        assert.equal(toolNamespace(tool.id, "mallets"), `musikkapp.${tool.id}`);
      }
    });

    it("produces 'musikkapp.trumpet.${id}' for trumpet profile", () => {
      for (const tool of TOOLS) {
        assert.equal(toolNamespace(tool.id, "trumpet"), `musikkapp.trumpet.${tool.id}`);
      }
    });

    it("defaults to active profile when second argument is omitted", () => {
      setProfile("mallets");
      assert.equal(toolNamespace("metronom"), "musikkapp.metronom");
      assert.equal(toolNamespace("oveplan"), "musikkapp.oveplan");

      setProfile("trumpet");
      assert.equal(toolNamespace("metronom"), "musikkapp.trumpet.metronom");
      assert.equal(toolNamespace("oveplan"), "musikkapp.trumpet.oveplan");
    });
  });

  describe("Dispatches PROFILE_SET CustomEvent on window", () => {
    it("dispatches PROFILE_SET CustomEvent on window with detail { profile }", () => {
      const dispatchedEvents: Array<{ type: string; detail: unknown }> = [];

      const mockWindow = {
        dispatchEvent(event: { type: string; detail?: unknown }) {
          dispatchedEvents.push({ type: event.type, detail: event.detail });
          return true;
        },
      };

      Object.defineProperty(globalThis, "window", {
        value: mockWindow,
        configurable: true,
        writable: true,
      });

      setProfile("trumpet");
      assert.equal(dispatchedEvents.length, 1);
      assert.equal(dispatchedEvents[0]?.type, "PROFILE_SET");
      assert.deepEqual(dispatchedEvents[0]?.detail, { profile: "trumpet" });

      setProfile("mallets");
      assert.equal(dispatchedEvents.length, 2);
      assert.equal(dispatchedEvents[1]?.type, "PROFILE_SET");
      assert.deepEqual(dispatchedEvents[1]?.detail, { profile: "mallets" });
    });

    it("notifies window.MalletSight.setProfile if present", () => {
      let notifiedProfile: string | null = null;
      const mockWindow = {
        MalletSight: {
          setProfile(p: string) {
            notifiedProfile = p;
          },
        },
        dispatchEvent() {
          return true;
        },
      };

      Object.defineProperty(globalThis, "window", {
        value: mockWindow,
        configurable: true,
        writable: true,
      });

      setProfile("trumpet");
      assert.equal(notifiedProfile, "trumpet");
    });
  });

  describe("PROFILE_META metadata", () => {
    it("contains complete metadata for mallets and trumpet", () => {
      assert.equal(PROFILE_META.mallets.id, "mallets");
      assert.equal(PROFILE_META.mallets.label, "Køller");
      assert.ok(PROFILE_META.mallets.emoji.length > 0);
      assert.ok(PROFILE_META.mallets.subtitle.length > 0);
      assert.ok(PROFILE_META.mallets.description.length > 0);

      assert.equal(PROFILE_META.trumpet.id, "trumpet");
      assert.equal(PROFILE_META.trumpet.label, "Trompet");
      assert.ok(PROFILE_META.trumpet.emoji.length > 0);
      assert.ok(PROFILE_META.trumpet.subtitle.length > 0);
      assert.ok(PROFILE_META.trumpet.description.length > 0);
    });
  });

  describe("MusikkProfile facade object", () => {
    it("exposes get, set, hasChosen, and subscribe matching free functions", () => {
      assert.equal(MusikkProfile.get(), "mallets");
      assert.equal(MusikkProfile.hasChosen(), false);

      let notified = false;
      const unsub = MusikkProfile.subscribe(() => {
        notified = true;
      });

      MusikkProfile.set("trumpet");
      assert.equal(MusikkProfile.get(), "trumpet");
      assert.equal(MusikkProfile.hasChosen(), true);
      assert.equal(notified, true);

      unsub();
    });
  });
});
