import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  drawCard,
  fullName,
  INSTRUMENTS,
  ledgerSteps,
  letterName,
  loadNoteState,
  parseNoteState,
  poolOf,
  saveNoteState,
  selectionForInstrument,
  viewBoxFor,
  worstNotes,
  yFor,
} from "./notekort.ts";

describe("notekort", () => {
  const previous = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", { value: previous, configurable: true });
  });

  it("uses H in Norwegian and B in English", () => {
    assert.equal(letterName(6, "no"), "H");
    assert.equal(letterName(6, "en"), "B");
    assert.equal(fullName(28, "no"), "C4");
  });

  it("puts low instrument notes in bass and the rest in treble", () => {
    const sel = selectionForInstrument(14, 49);
    assert.ok(sel.bass.includes(14));
    assert.ok(sel.bass.includes(23));
    assert.equal(sel.bass.includes(24), false);
    assert.ok(sel.treble.includes(24));
    assert.ok(poolOf(sel).some((key) => key.startsWith("bass:")));
  });

  it("does not redraw the same card when the deck has more than one note", () => {
    let calls = 0;
    const card = drawCard(["treble:30", "treble:31"], "treble:30", () => (calls++ === 0 ? 0 : 0.9));
    assert.equal(card, "treble:31");
    assert.equal(drawCard(["treble:30"], "treble:30"), "treble:30");
    assert.equal(drawCard([], null), null);
  });

  it("places the treble bottom line and ledger lines", () => {
    assert.equal(yFor("treble", 30), 155);
    assert.deepEqual(ledgerSteps("treble", 30), []);
    assert.deepEqual(ledgerSteps("treble", 40), [10]);
    assert.equal(viewBoxFor([]), "0 58 220 140");
  });

  it("stores xylophone and glockenspiel in written pitch", () => {
    const range = (name: string) => INSTRUMENTS.find((item) => item[0] === name)?.slice(1);
    assert.deepEqual(range("Xylofon 3,5"), [24, 49]);
    assert.deepEqual(range("Xylofon 4"), [21, 49]);
    assert.deepEqual(range("Klokkespill"), [25, 42]);
    assert.equal(fullName(24, "no"), "F3");
    assert.equal(fullName(49, "no"), "C7");
  });

  it("sorts the weakest notes first", () => {
    const rows = worstNotes({
      "treble:30": { r: 1, w: 3 },
      "bass:18": { r: 4, w: 0 },
      "treble:31": { r: 0, w: 0 },
    });
    assert.equal(rows[0]?.key, "treble:30");
    assert.equal(rows[1]?.key, "bass:18");
    assert.equal(rows.length, 2);
  });

  it("round-trips the namespace and ignores junk", () => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
      },
    });
    assert.equal(saveNoteState({ sel: { treble: [30], bass: [] }, lang: "en", stats: { "treble:30": { r: 1, w: 0 } } }), true);
    assert.equal(data.has("musikkapp.notekort"), true);
    const loaded = loadNoteState();
    assert.deepEqual(loaded.sel.treble, [30]);
    assert.equal(loaded.lang, "en");
    assert.deepEqual(loaded.stats["treble:30"], { r: 1, w: 0 });
    assert.deepEqual(parseNoteState("nope").sel, { treble: [], bass: [] });
  });
});
