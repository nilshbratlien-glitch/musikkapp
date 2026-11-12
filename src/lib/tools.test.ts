import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setProfile } from "./profile.ts";
import { TOOLS, readToolStore, toolForPath, toolNamespace, writeToolStore } from "./tools.ts";

type MemoryStorage = Storage & { failNext: boolean };

function memoryStorage(): MemoryStorage {
  const data = new Map<string, string>();
  const storage = {
    failNext: false,
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      if (storage.failNext) {
        storage.failNext = false;
        throw new Error("quota");
      }
      data.set(key, value);
    },
  };
  return storage;
}

describe("tool namespaces and routes", () => {
  const previous = globalThis.localStorage;
  let storage: MemoryStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: previous, configurable: true });
  });

  it("gives each tool its own key and separates mallets vs trumpet profile namespaces", () => {
    for (const tool of TOOLS) {
      assert.equal(toolNamespace(tool.id, "mallets"), `musikkapp.${tool.id}`);
      assert.equal(toolNamespace(tool.id, "trumpet"), `musikkapp.trumpet.${tool.id}`);
    }
  });

  it("maps each route to the right tool", () => {
    assert.equal(toolForPath("/").id, "bladlesing");
    assert.equal(toolForPath("/metronom").id, "metronom");
    assert.equal(toolForPath("/oveplan").id, "oveplan");
    assert.equal(toolForPath("/notekort").id, "notekort");
    assert.equal(toolForPath("/ukjent").id, "bladlesing");
  });

  it("writes inside the namespace and survives a storage failure", () => {
    storage = memoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    assert.equal(writeToolStore("metronom", { bests: { singles: 100 } }), true);
    assert.deepEqual(readToolStore("metronom"), { bests: { singles: 100 } });
    assert.equal(storage.getItem("musikkapp.metronom"), JSON.stringify({ bests: { singles: 100 } }));
    storage.failNext = true;
    assert.equal(writeToolStore("metronom", { bests: { singles: 140 } }), false);
    assert.deepEqual(readToolStore("metronom"), { bests: { singles: 100 } });
  });

  it("keeps mallets and trumpet tool data isolated when switching profiles", () => {
    storage = memoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    setProfile("mallets");
    writeToolStore("oveplan", { bpm: 92 });
    setProfile("trumpet");
    writeToolStore("oveplan", { bpm: 76 });
    assert.deepEqual(readToolStore("oveplan", "mallets"), { bpm: 92 });
    assert.deepEqual(readToolStore("oveplan", "trumpet"), { bpm: 76 });
    setProfile("mallets");
  });
});
