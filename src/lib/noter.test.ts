import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_BPM,
  MAX_BPM,
  MAX_PDF_BYTES,
  MAX_ZOOM,
  MIN_BPM,
  MIN_ZOOM,
  clampBpm,
  clampPage,
  clampZoom,
  extractTitleFromFilename,
  formatFileSize,
  isValidPdfFile,
  sortSheets,
  type SheetMeta,
  type SheetRecord,
} from "./noter.ts";
import { detectSwipeDirection, isEditableTarget, mapKeyToViewerAction } from "./noter-input.ts";
import { deleteSheet, getSheet, listSheets, saveSheet, updateSheetMeta } from "./noter-db.ts";

function makeSheet(overrides: Partial<SheetMeta> = {}): SheetMeta {
  return {
    id: "id-1",
    title: "Marsj i Bb",
    fileName: "marsj-i-bb.pdf",
    fileSize: 2048,
    pageCount: 4,
    bpm: 100,
    lastPage: 1,
    nightMode: false,
    createdAt: 1000,
    updatedAt: 1000,
    lastOpenedAt: 1000,
    ...overrides,
  };
}

describe("noter domain helpers", () => {
  it("clamps BPM to valid integer bounds with DEFAULT_BPM fallback", () => {
    assert.equal(clampBpm(MIN_BPM - 10), MIN_BPM);
    assert.equal(clampBpm(MAX_BPM + 50), MAX_BPM);
    assert.equal(clampBpm(120.6), 121);
    assert.equal(clampBpm(Number.NaN), DEFAULT_BPM);
    assert.equal(clampBpm(Number.POSITIVE_INFINITY), DEFAULT_BPM);
  });

  it("clamps zoom between MIN_ZOOM and MAX_ZOOM", () => {
    assert.equal(clampZoom(0.1), MIN_ZOOM);
    assert.equal(clampZoom(5.0), MAX_ZOOM);
    assert.equal(clampZoom(1.75), 1.75);
    assert.equal(clampZoom(Number.NaN), 1.0);
  });

  it("clamps page numbers safely within pageCount", () => {
    assert.equal(clampPage(0, 5), 1);
    assert.equal(clampPage(9, 5), 5);
    assert.equal(clampPage(3.8, 5), 3);
    assert.equal(clampPage(4, 0), 1);
    assert.equal(clampPage(Number.NaN, 5), 1);
  });

  it("extracts clean titles from PDF filenames", () => {
    assert.equal(extractTitleFromFilename("Korps_marsj-2026.pdf"), "Korps marsj 2026");
    assert.equal(extractTitleFromFilename("  FANFARE_NR_1.PDF  "), "FANFARE NR 1");
    assert.equal(extractTitleFromFilename("___---.pdf"), "Uten tittel");
  });

  it("validates PDF files by mime, extension, and size", () => {
    assert.equal(isValidPdfFile("note.pdf", "application/pdf", 1024), true);
    assert.equal(isValidPdfFile("note.PDF", "", 1024), true);
    assert.equal(isValidPdfFile("note.pdf", "application/octet-stream", 1024), true);
    assert.equal(isValidPdfFile("note.pdf", "image/png", 1024), false);
    assert.equal(isValidPdfFile("image.png", "image/png", 1024), false);
    assert.equal(isValidPdfFile("note.pdf", "application/pdf", 0), false);
    assert.equal(isValidPdfFile("note.pdf", "application/pdf", -5), false);
    assert.equal(isValidPdfFile("note.pdf", "application/pdf", MAX_PDF_BYTES + 1), false);
    assert.equal(isValidPdfFile("note.pdf", "application/pdf", MAX_PDF_BYTES), true);
  });

  it("formats byte sizes cleanly", () => {
    assert.equal(formatFileSize(0), "0 B");
    assert.equal(formatFileSize(-10), "0 B");
    assert.equal(formatFileSize(512), "512 B");
    assert.equal(formatFileSize(1536), "1.5 KB");
    assert.equal(formatFileSize(2.5 * 1024 * 1024), "2.5 MB");
  });

  it("sorts sheets by recent, newest, and title without mutating input", () => {
    const a = makeSheet({ id: "a", title: "Boler", createdAt: 100, lastOpenedAt: 300 });
    const b = makeSheet({ id: "b", title: "Alpehorn", createdAt: 300, lastOpenedAt: 100 });
    const c = makeSheet({ id: "c", title: "Ceremoni", createdAt: 200, lastOpenedAt: 200 });
    const input = [a, b, c];

    assert.deepEqual(
      sortSheets(input, "recent").map((s) => s.id),
      ["a", "c", "b"],
    );
    assert.deepEqual(
      sortSheets(input, "newest").map((s) => s.id),
      ["b", "c", "a"],
    );
    assert.deepEqual(
      sortSheets(input, "title").map((s) => s.id),
      ["b", "a", "c"],
    );
    assert.deepEqual(
      input.map((s) => s.id),
      ["a", "b", "c"],
    );
  });
});

describe("noter input mapping", () => {
  it("detects horizontal swipes and rejects short, vertical, or slow gestures", () => {
    assert.equal(detectSwipeDirection(-80, 10, 200), "next");
    assert.equal(detectSwipeDirection(80, -15, 200), "prev");
    assert.equal(detectSwipeDirection(-49, 0, 200), null);
    assert.equal(detectSwipeDirection(-70, 50, 200), null);
    assert.equal(detectSwipeDirection(-80, 10, 950), null);
    assert.equal(detectSwipeDirection(Number.NaN, 0), null);
  });

  it("maps Bluetooth pedal and keyboard shortcuts and ignores input targets", () => {
    assert.equal(mapKeyToViewerAction("PageDown", false), "next");
    assert.equal(mapKeyToViewerAction("ArrowRight", false), "next");
    assert.equal(mapKeyToViewerAction("ArrowDown", false), "next");
    assert.equal(mapKeyToViewerAction(" ", false), "next");

    assert.equal(mapKeyToViewerAction("PageUp", false), "prev");
    assert.equal(mapKeyToViewerAction("ArrowLeft", false), "prev");
    assert.equal(mapKeyToViewerAction("ArrowUp", false), "prev");

    assert.equal(mapKeyToViewerAction("Home", false), "first");
    assert.equal(mapKeyToViewerAction("End", false), "last");
    assert.equal(mapKeyToViewerAction("Escape", false), "close");
    assert.equal(mapKeyToViewerAction("m", false), "toggle-metronome");
    assert.equal(mapKeyToViewerAction("M", false), "toggle-metronome");
    assert.equal(mapKeyToViewerAction("n", false), "toggle-night");
    assert.equal(mapKeyToViewerAction("N", false), "toggle-night");
    assert.equal(mapKeyToViewerAction("+", false), "zoom-in");
    assert.equal(mapKeyToViewerAction("=", false), "zoom-in");
    assert.equal(mapKeyToViewerAction("-", false), "zoom-out");
    assert.equal(mapKeyToViewerAction("0", false), "zoom-reset");
    assert.equal(mapKeyToViewerAction("q", false), null);

    assert.equal(mapKeyToViewerAction("PageDown", true), null);
    assert.equal(mapKeyToViewerAction("Escape", true), null);
  });

  it("detects editable targets safely without DOM globals", () => {
    assert.equal(isEditableTarget(null), false);
    assert.equal(isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget), true);
    assert.equal(isEditableTarget({ tagName: "textarea" } as unknown as EventTarget), true);
    assert.equal(isEditableTarget({ tagName: "SELECT" } as unknown as EventTarget), true);
    assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
    assert.equal(isEditableTarget({ tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget), false);
  });
});

describe("noter-db persistence and SSR safety", () => {
  const originalIndexedDb = globalThis.indexedDB;

  afterEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      value: originalIndexedDb,
      configurable: true,
      writable: true,
    });
  });

  it("handles missing indexedDB gracefully during SSR", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    assert.deepEqual(await listSheets(), []);
    assert.equal(await getSheet("missing"), null);
    assert.equal(await updateSheetMeta("missing", { bpm: 120 }), null);
    assert.equal(await deleteSheet("missing"), false);
    await assert.rejects(
      saveSheet({
        fileName: "test.pdf",
        fileSize: 16,
        pdfData: new ArrayBuffer(16),
      }),
      /IndexedDB/,
    );
  });

  it("saves, lists without pdfData, reads, updates with clamping, and deletes", async () => {
    const storeMap = new Map<string, SheetRecord>();

    const fakeIndexedDb = {
      open: () => {
        const openReq: Record<string, unknown> = {
          result: null,
          error: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
        };

        const db = {
          objectStoreNames: {
            contains: () => true,
          },
          createObjectStore: () => ({}),
          close: () => {},
          onversionchange: null,
          transaction: (_storeName: string, mode: IDBTransactionMode = "readonly") => {
            const tx: Record<string, unknown> = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              error: null,
              objectStore: () => ({
                getAll: () => {
                  throw new Error("listSheets should use openCursor instead of getAll");
                },
                openCursor: () => {
                  const values = [...storeMap.values()];
                  let index = 0;
                  const req: Record<string, unknown> = { result: null, onsuccess: null, onerror: null };
                  const advance = () => {
                    queueMicrotask(() => {
                      if (index < values.length) {
                        const value = values[index++];
                        req.result = {
                          value,
                          continue: advance,
                        };
                        (req.onsuccess as (() => void) | null)?.();
                      } else {
                        req.result = null;
                        (req.onsuccess as (() => void) | null)?.();
                        (tx.oncomplete as (() => void) | null)?.();
                      }
                    });
                  };
                  advance();
                  return req;
                },
                get: (id: string) => {
                  const req: Record<string, unknown> = { result: storeMap.get(id), onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    (req.onsuccess as (() => void) | null)?.();
                    if (mode !== "readwrite") {
                      (tx.oncomplete as (() => void) | null)?.();
                    }
                  });
                  return req;
                },
                put: (record: SheetRecord) => {
                  storeMap.set(record.id, record);
                  const req: Record<string, unknown> = { result: record.id, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    (req.onsuccess as (() => void) | null)?.();
                    (tx.oncomplete as (() => void) | null)?.();
                  });
                  return req;
                },
                delete: (id: string) => {
                  storeMap.delete(id);
                  const req: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    (req.onsuccess as (() => void) | null)?.();
                    (tx.oncomplete as (() => void) | null)?.();
                  });
                  return req;
                },
              }),
            };
            return tx;
          },
        };

        openReq.result = db;
        queueMicrotask(() => {
          (openReq.onupgradeneeded as (() => void) | null)?.();
          (openReq.onsuccess as (() => void) | null)?.();
        });
        return openReq;
      },
    };

    Object.defineProperty(globalThis, "indexedDB", {
      value: fakeIndexedDb,
      configurable: true,
      writable: true,
    });

    const pdfBytes = new Uint8Array([37, 80, 68, 70]).buffer;
    const saved = await saveSheet({
      id: "tx-wait-sheet-1",
      fileName: "Gammel_Jeger.pdf",
      fileSize: 4,
      pageCount: 3,
      bpm: 999,
      pdfData: pdfBytes,
    });

    assert.equal(saved.id, "tx-wait-sheet-1");
    assert.equal(saved.title, "Gammel Jeger");
    assert.equal(saved.bpm, MAX_BPM);
    assert.equal(saved.pdfData.byteLength, 4);

    // Save a second sheet with NaN pageCount to verify cursor iteration over multiple sheets & finite guard
    const saved2 = await saveSheet({
      id: "tx-wait-sheet-2",
      fileName: "Fanfare.pdf",
      fileSize: 4,
      pageCount: Number.NaN,
      bpm: 110,
      pdfData: new Uint8Array([37, 80, 68, 70]).buffer,
    });
    assert.equal(saved2.pageCount, 0);

    const listed = await listSheets();
    assert.equal(listed.length, 2);
    assert.equal("pdfData" in listed[0]!, false);
    assert.equal("pdfData" in listed[1]!, false);

    const fetched = await getSheet("tx-wait-sheet-1");
    assert.equal(fetched?.pdfData.byteLength, 4);

    const updated = await updateSheetMeta("tx-wait-sheet-1", {
      bpm: 12,
      lastPage: 99,
      nightMode: true,
      pageCount: Number.POSITIVE_INFINITY,
    });
    assert.equal(updated?.bpm, MIN_BPM);
    assert.equal(updated?.pageCount, 3);
    assert.equal(updated?.lastPage, 3);
    assert.equal(updated?.nightMode, true);

    assert.equal(await deleteSheet("tx-wait-sheet-1"), true);
    assert.equal(await deleteSheet("tx-wait-sheet-2"), true);
    assert.deepEqual(await listSheets(), []);
  });
});
