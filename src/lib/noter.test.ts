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
} from "./noter.ts";
import {
  ANNOTATION_COLORS,
  ANNOTATION_VIEWBOX_SIZE,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_OPACITY,
  HIGHLIGHTER_WIDTH,
  MAX_UNDO_HISTORY,
  PENCIL_WIDTH_THICK,
  PENCIL_WIDTH_THIN,
  STAMP_DEFINITIONS,
  clientPointToNormalizedPage,
  createAnnotationHistory,
  eraseAnnotationsAtPoint,
  getAnnotationSvgViewBox,
  hitTestAnnotation,
  pushAnnotationHistory,
  redoAnnotationHistory,
  undoAnnotationHistory,
  type AnnotationItem,
  type StampId,
} from "./noter-annotations.ts";
import {
  FULL_PAGE_RECT,
  clampNormalizedRect,
  detectCropRectFromPixels,
  getHalfPageRegions,
  isFullPageRect,
  normalizeCropRect,
} from "./noter-crop.ts";
import {
  detectSwipeDirection,
  isEditableTarget,
  mapKeyToViewerAction,
  normalizeHalfPagePosition,
  stepPageBackward,
  stepPageForward,
  type HalfPagePosition,
} from "./noter-input.ts";
import {
  NOTER_ANNOTATIONS_SHEET_INDEX,
  NOTER_ANNOTATIONS_STORE_NAME,
  NOTER_DB_VERSION,
  NOTER_STORE_NAME,
  deleteSheet,
  deleteSheetAnnotations,
  getPageAnnotations,
  getSheet,
  listSheets,
  makePageAnnotationsKey,
  savePageAnnotations,
  saveSheet,
  updateSheetMeta,
} from "./noter-db.ts";
import { buildRenderKey, computeSliceMetrics } from "./noter-pdf.ts";

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

function makeRgbaBuffer(
  width: number,
  height: number,
  fill: [number, number, number, number] = [255, 255, 255, 255],
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    buf[idx] = fill[0];
    buf[idx + 1] = fill[1];
    buf[idx + 2] = fill[2];
    buf[idx + 3] = fill[3];
  }
  return buf;
}

function paintRect(
  buf: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number, number] = [20, 20, 20, 255],
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = (y * width + x) * 4;
      buf[idx] = color[0];
      buf[idx + 1] = color[1];
      buf[idx + 2] = color[2];
      buf[idx + 3] = color[3];
    }
  }
}

type FakeIndexedDbHarness = {
  fakeIndexedDb: { open: () => Record<string, unknown> };
  stores: Map<string, Map<string, Record<string, unknown>>>;
  createdStores: Array<{ name: string; keyPath?: string }>;
  createdIndexes: Array<{ storeName: string; indexName: string; keyPath: string; unique: boolean }>;
  openedVersions: number[];
};

function createFakeIndexedDb(options?: { preExistingStores?: string[] }): FakeIndexedDbHarness {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const keyPaths = new Map<string, string>();
  const createdStores: Array<{ name: string; keyPath?: string }> = [];
  const createdIndexes: Array<{ storeName: string; indexName: string; keyPath: string; unique: boolean }> = [];
  const openedVersions: number[] = [];

  for (const pre of options?.preExistingStores ?? []) {
    stores.set(pre, new Map());
    keyPaths.set(pre, pre === NOTER_ANNOTATIONS_STORE_NAME ? "key" : "id");
  }

  const fakeIndexedDb = {
    open: (_name?: string, version?: number) => {
      if (typeof version === "number") {
        openedVersions.push(version);
      }
      const openReq: Record<string, unknown> = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };

      const db = {
        objectStoreNames: {
          contains: (name: string) => stores.has(name),
        },
        createObjectStore: (name: string, opts?: { keyPath?: string }) => {
          stores.set(name, new Map());
          if (opts?.keyPath) {
            keyPaths.set(name, opts.keyPath);
          }
          createdStores.push({ name, keyPath: opts?.keyPath });
          return {
            createIndex: (indexName: string, keyPath: string, idxOpts?: { unique?: boolean }) => {
              createdIndexes.push({
                storeName: name,
                indexName,
                keyPath,
                unique: Boolean(idxOpts?.unique),
              });
              return {};
            },
          };
        },
        close: () => {},
        onversionchange: null,
        transaction: (storeNames: string | string[], _mode: IDBTransactionMode = "readonly") => {
          const allowed = new Set(Array.isArray(storeNames) ? storeNames : [storeNames]);
          let pendingOps = 0;

          const tx: Record<string, unknown> = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            error: null,
            objectStore: (name: string) => {
              if (!allowed.has(name)) {
                throw new Error(`Object store ${name} not in transaction scope`);
              }
              const storeMap = stores.get(name);
              if (!storeMap) {
                throw new Error(`Object store ${name} does not exist`);
              }
              const keyPath = keyPaths.get(name) ?? "id";

              const finishOp = () => {
                pendingOps -= 1;
                if (pendingOps === 0) {
                  (tx.oncomplete as (() => void) | null)?.();
                }
              };

              const matchesQuery = (val: Record<string, unknown>, idxKeyPath: string, query?: unknown): boolean => {
                if (!query) return true;
                if (typeof query === "object" && query !== null && "lower" in query && "upper" in query) {
                  const q = query as { lower: unknown; upper: unknown };
                  return val[idxKeyPath] === q.lower && val[idxKeyPath] === q.upper;
                }
                return val[idxKeyPath] === query;
              };

              const buildCursorOp = (valuesProvider: () => Array<[string, Record<string, unknown>]>) => {
                pendingOps += 1;
                const entries = valuesProvider();
                let cursorIdx = 0;
                const req: Record<string, unknown> = { result: null, onsuccess: null, onerror: null };
                const advance = () => {
                  queueMicrotask(() => {
                    if (cursorIdx < entries.length) {
                      const [entryKey, value] = entries[cursorIdx++]!;
                      req.result = {
                        primaryKey: entryKey,
                        value,
                        delete: () => {
                          storeMap.delete(entryKey);
                        },
                        continue: advance,
                      };
                      (req.onsuccess as (() => void) | null)?.();
                    } else {
                      req.result = null;
                      (req.onsuccess as (() => void) | null)?.();
                      finishOp();
                    }
                  });
                };
                advance();
                return req;
              };

              return {
                getAll: () => {
                  throw new Error("listSheets should use openCursor instead of getAll");
                },
                openCursor: () => buildCursorOp(() => [...storeMap.entries()]),
                index: (indexName: string) => {
                  const idxMeta = createdIndexes.find(
                    (i) => i.storeName === name && i.indexName === indexName,
                  );
                  const idxKeyPath = idxMeta?.keyPath ?? (indexName === NOTER_ANNOTATIONS_SHEET_INDEX ? "sheetId" : "id");
                  return {
                    openCursor: (query?: unknown) =>
                      buildCursorOp(() =>
                        [...storeMap.entries()].filter(([, val]) => matchesQuery(val, idxKeyPath, query)),
                      ),
                    getAllKeys: (query?: unknown) => {
                      pendingOps += 1;
                      const keys = [...storeMap.entries()]
                        .filter(([, val]) => matchesQuery(val, idxKeyPath, query))
                        .map(([k]) => k);
                      const req: Record<string, unknown> = { result: keys, onsuccess: null, onerror: null };
                      queueMicrotask(() => {
                        (req.onsuccess as (() => void) | null)?.();
                        finishOp();
                      });
                      return req;
                    },
                  };
                },
                get: (id: string) => {
                  pendingOps += 1;
                  const req: Record<string, unknown> = { result: storeMap.get(id), onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    (req.onsuccess as (() => void) | null)?.();
                    finishOp();
                  });
                  return req;
                },
                put: (record: Record<string, unknown>) => {
                  pendingOps += 1;
                  const key = String(record[keyPath]);
                  storeMap.set(key, record);
                  const req: Record<string, unknown> = { result: key, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    (req.onsuccess as (() => void) | null)?.();
                    finishOp();
                  });
                  return req;
                },
                delete: (id: string) => {
                  pendingOps += 1;
                  storeMap.delete(id);
                  const req: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
                  queueMicrotask(() => {
                    (req.onsuccess as (() => void) | null)?.();
                    finishOp();
                  });
                  return req;
                },
              };
            },
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

  return { fakeIndexedDb, stores, createdStores, createdIndexes, openedVersions };
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

describe("noter-crop white-margin detection and half-page regions", () => {
  it("clamps and normalizes rects safely", () => {
    const clamped = clampNormalizedRect({ x: -0.2, y: 0.8, width: 0.5, height: 0.5 });
    assert.equal(clamped.x, 0);
    assert.equal(clamped.y, 0.8);
    assert.equal(clamped.width, 0.5);
    assert.ok(Math.abs(clamped.height - 0.2) < 1e-9);
    assert.deepEqual(
      clampNormalizedRect({ x: Number.NaN, y: Number.POSITIVE_INFINITY, width: -1, height: Number.NaN }),
      { x: 0, y: 0, width: 0, height: 0 },
    );
    assert.deepEqual(clampNormalizedRect({ x: 1.5, y: 1.5, width: 0.5, height: 0.5 }), {
      x: 1,
      y: 1,
      width: 0,
      height: 0,
    });
    assert.deepEqual(normalizeCropRect(null), FULL_PAGE_RECT);
    assert.deepEqual(normalizeCropRect({ x: 0.2, y: 0.2, width: 0, height: 0.5 }), FULL_PAGE_RECT);
    assert.equal(isFullPageRect(FULL_PAGE_RECT), true);
    assert.equal(isFullPageRect({ x: 0.1, y: 0, width: 0.9, height: 1 }), false);
  });

  it("detects content bounds with padding on a white-margined page", () => {
    const w = 100;
    const h = 100;
    const buf = makeRgbaBuffer(w, h, [255, 255, 255, 255]);
    paintRect(buf, w, 20, 15, 79, 84, [15, 15, 15, 255]);

    const rect = detectCropRectFromPixels(buf, w, h, { padding: 0.02 });
    assert.ok(Math.abs(rect.x - 0.18) < 1e-6);
    assert.ok(Math.abs(rect.y - 0.13) < 1e-6);
    assert.ok(Math.abs(rect.width - 0.64) < 1e-6);
    assert.ok(Math.abs(rect.height - 0.74) < 1e-6);
  });

  it("returns FULL_PAGE_RECT for blank, degenerate, or invalid buffers", () => {
    const blank = makeRgbaBuffer(50, 50, [255, 255, 255, 255]);
    assert.deepEqual(detectCropRectFromPixels(blank, 50, 50), FULL_PAGE_RECT);

    // Tiny 1x1 speck (< 0.05 fraction) should fall back to FULL_PAGE_RECT
    const tinyDot = makeRgbaBuffer(100, 100, [255, 255, 255, 255]);
    paintRect(tinyDot, 100, 50, 50, 51, 51, [0, 0, 0, 255]);
    assert.deepEqual(detectCropRectFromPixels(tinyDot, 100, 100), FULL_PAGE_RECT);

    // Invalid dimensions or short buffer
    assert.deepEqual(detectCropRectFromPixels(new Uint8ClampedArray(10), 10, 10), FULL_PAGE_RECT);
    assert.deepEqual(detectCropRectFromPixels(blank, 0, 50), FULL_PAGE_RECT);
    assert.deepEqual(detectCropRectFromPixels(blank, 50, -5), FULL_PAGE_RECT);
  });

  it("splits full or cropped regions into top and bottom halves", () => {
    const fullHalves = getHalfPageRegions();
    assert.deepEqual(fullHalves.top, { x: 0, y: 0, width: 1, height: 0.5 });
    assert.deepEqual(fullHalves.bottom, { x: 0, y: 0.5, width: 1, height: 0.5 });

    const cropped = { x: 0.1, y: 0.2, width: 0.8, height: 0.6 };
    const croppedHalves = getHalfPageRegions(cropped);
    assert.ok(Math.abs(croppedHalves.top.x - 0.1) < 1e-6);
    assert.ok(Math.abs(croppedHalves.top.y - 0.2) < 1e-6);
    assert.ok(Math.abs(croppedHalves.top.height - 0.3) < 1e-6);
    assert.ok(Math.abs(croppedHalves.bottom.y - 0.5) < 1e-6);
    assert.ok(Math.abs(croppedHalves.bottom.height - 0.3) < 1e-6);
  });
});

describe("noter-annotations math, eraser, and undo/redo", () => {
  it("exports expected palettes, widths, and all 17 musical stamps", () => {
    assert.ok(ANNOTATION_COLORS.length >= 6);
    assert.ok(HIGHLIGHTER_COLORS.length >= 4);
    assert.ok(PENCIL_WIDTH_THIN < PENCIL_WIDTH_THICK);
    assert.ok(HIGHLIGHTER_WIDTH > PENCIL_WIDTH_THICK);
    assert.equal(HIGHLIGHTER_OPACITY, 0.35);
    assert.equal(ANNOTATION_VIEWBOX_SIZE, 1000);
    assert.equal(MAX_UNDO_HISTORY, 50);

    const expectedStamps: StampId[] = [
      "fermata",
      "breath",
      "glasses",
      "pp",
      "p",
      "mp",
      "mf",
      "f",
      "ff",
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "L",
      "R",
    ];
    assert.deepEqual(
      STAMP_DEFINITIONS.map((s) => s.id),
      expectedStamps,
    );
  });

  it("projects client coordinates to normalized uncropped page coordinates and computes SVG viewBox", () => {
    const rect = { left: 100, top: 50, width: 400, height: 500 };

    // Uncropped
    assert.deepEqual(clientPointToNormalizedPage(300, 300, rect), { x: 0.5, y: 0.5 });
    assert.equal(getAnnotationSvgViewBox(), "0 0 1000 1000");

    // Cropped region
    const crop = { x: 0.1, y: 0.2, width: 0.8, height: 0.6 };
    const ptCrop = clientPointToNormalizedPage(300, 300, rect, crop);
    assert.ok(Math.abs(ptCrop.x - 0.5) < 1e-6);
    assert.ok(Math.abs(ptCrop.y - 0.5) < 1e-6);
    assert.equal(getAnnotationSvgViewBox(crop), "100 200 800 600");

    // Bottom half-page region
    const bottomHalf = { x: 0, y: 0.5, width: 1, height: 0.5 };
    const ptBottom = clientPointToNormalizedPage(100, 50, rect, bottomHalf);
    assert.deepEqual(ptBottom, { x: 0, y: 0.5 });
    assert.equal(getAnnotationSvgViewBox(bottomHalf), "0 500 1000 500");

    // Zero-width/height rect safety
    assert.deepEqual(clientPointToNormalizedPage(200, 200, { left: 0, top: 0, width: 0, height: 0 }, crop), {
      x: 0.1,
      y: 0.2,
    });
  });

  it("hit-tests and erases pencil, highlighter, stamp, and text annotations without removing misses", () => {
    const pencil: AnnotationItem = {
      id: "s1",
      kind: "pencil",
      color: "#111827",
      width: PENCIL_WIDTH_THIN,
      opacity: 1,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.1 },
      ],
    };
    const highlighter: AnnotationItem = {
      id: "h1",
      kind: "highlighter",
      color: "#facc15",
      width: HIGHLIGHTER_WIDTH,
      opacity: HIGHLIGHTER_OPACITY,
      points: [
        { x: 0.2, y: 0.4 },
        { x: 0.5, y: 0.4 },
      ],
    };
    const stamp: AnnotationItem = {
      id: "st1",
      kind: "stamp",
      stampId: "fermata",
      x: 0.7,
      y: 0.2,
      color: "#dc2626",
    };
    const text: AnnotationItem = {
      id: "t1",
      kind: "text",
      x: 0.6,
      y: 0.8,
      text: "Se dirigent",
      color: "#2563eb",
    };

    const all = [pencil, highlighter, stamp, text];

    assert.equal(hitTestAnnotation(pencil, { x: 0.2, y: 0.1 }), true);
    assert.equal(hitTestAnnotation(pencil, { x: 0.2, y: 0.5 }), false);
    assert.equal(hitTestAnnotation(highlighter, { x: 0.35, y: 0.4 }), true);
    assert.equal(hitTestAnnotation(stamp, { x: 0.71, y: 0.21 }), true);
    assert.equal(hitTestAnnotation(text, { x: 0.65, y: 0.8 }), true);

    // Miss erases nothing
    assert.equal(eraseAnnotationsAtPoint(all, { x: 0.95, y: 0.95 }).length, 4);
    // Hit removes only the matching item
    const afterStamp = eraseAnnotationsAtPoint(all, { x: 0.7, y: 0.2 });
    assert.deepEqual(
      afterStamp.map((i) => i.id),
      ["s1", "h1", "t1"],
    );
  });

  it("manages per-page undo/redo stacks with 50-step cap and clears redo on new push", () => {
    let history = createAnnotationHistory();
    let items: AnnotationItem[] = [];

    // Empty undo/redo returns changed: false
    const noopUndo = undoAnnotationHistory(history, items);
    assert.equal(noopUndo.changed, false);
    const noopRedo = redoAnnotationHistory(history, items);
    assert.equal(noopRedo.changed, false);

    // Push 55 states, verify capped at 50
    for (let i = 1; i <= 55; i++) {
      history = pushAnnotationHistory(history, items);
      items = [
        ...items,
        { id: `st-${i}`, kind: "stamp", stampId: "f", x: 0.1, y: 0.1, color: "#111827" },
      ];
    }
    assert.equal(history.undoStack.length, MAX_UNDO_HISTORY);

    // Undo once
    const u1 = undoAnnotationHistory(history, items);
    assert.equal(u1.changed, true);
    assert.equal(u1.items.length, 54);
    assert.equal(u1.history.redoStack.length, 1);

    // Redo restores 55
    const r1 = redoAnnotationHistory(u1.history, u1.items);
    assert.equal(r1.changed, true);
    assert.equal(r1.items.length, 55);

    // Undo then push new item clears redoStack
    const u2 = undoAnnotationHistory(r1.history, r1.items);
    const afterPush = pushAnnotationHistory(u2.history, u2.items);
    assert.equal(afterPush.redoStack.length, 0);
  });
});

describe("noter input mapping and half-page turn", () => {
  it("detects horizontal swipes and rejects short, vertical, or slow gestures", () => {
    assert.equal(detectSwipeDirection(-80, 10, 200), "next");
    assert.equal(detectSwipeDirection(80, -15, 200), "prev");
    assert.equal(detectSwipeDirection(-49, 0, 200), null);
    assert.equal(detectSwipeDirection(-70, 50, 200), null);
    assert.equal(detectSwipeDirection(-80, 10, 950), null);
    assert.equal(detectSwipeDirection(Number.NaN, 0), null);
  });

  it("maps Bluetooth pedal, keyboard, and Ctrl/Cmd undo-redo shortcuts while ignoring input targets", () => {
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

    // Undo / Redo modifier shortcuts
    assert.equal(mapKeyToViewerAction("z", false, { ctrlKey: true }), "undo");
    assert.equal(mapKeyToViewerAction("Z", false, { metaKey: true }), "undo");
    assert.equal(mapKeyToViewerAction("z", false, { ctrlKey: true, shiftKey: true }), "redo");
    assert.equal(mapKeyToViewerAction("Z", false, { metaKey: true, shiftKey: true }), "redo");
    assert.equal(mapKeyToViewerAction("y", false, { ctrlKey: true }), "redo");
    assert.equal(mapKeyToViewerAction("r", false, { metaKey: true }), null);

    // Input target guard
    assert.equal(mapKeyToViewerAction("PageDown", true), null);
    assert.equal(mapKeyToViewerAction("Escape", true), null);
    assert.equal(mapKeyToViewerAction("z", true, { ctrlKey: true }), null);
  });

  it("detects editable targets safely without DOM globals", () => {
    assert.equal(isEditableTarget(null), false);
    assert.equal(isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget), true);
    assert.equal(isEditableTarget({ tagName: "textarea" } as unknown as EventTarget), true);
    assert.equal(isEditableTarget({ tagName: "SELECT" } as unknown as EventTarget), true);
    assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
    assert.equal(isEditableTarget({ tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget), false);
  });

  it("steps forward and backward cleanly with half-page turn ON and OFF", () => {
    // Half-page OFF
    assert.deepEqual(stepPageForward({ page: 1, halfOffset: 0 }, 3, false), { page: 2, halfOffset: 0 });
    assert.deepEqual(stepPageForward({ page: 3, halfOffset: 0 }, 3, false), { page: 3, halfOffset: 0 });
    assert.deepEqual(stepPageBackward({ page: 2, halfOffset: 0 }, 3, false), { page: 1, halfOffset: 0 });
    assert.deepEqual(stepPageBackward({ page: 1, halfOffset: 0 }, 3, false), { page: 1, halfOffset: 0 });

    // Half-page ON across 3 pages
    let pos: HalfPagePosition = { page: 1, halfOffset: 0 };
    pos = stepPageForward(pos, 3, true);
    assert.deepEqual(pos, { page: 1, halfOffset: 1 });
    pos = stepPageForward(pos, 3, true);
    assert.deepEqual(pos, { page: 2, halfOffset: 0 });
    pos = stepPageForward(pos, 3, true);
    assert.deepEqual(pos, { page: 2, halfOffset: 1 });
    pos = stepPageForward(pos, 3, true);
    assert.deepEqual(pos, { page: 3, halfOffset: 0 });
    // Cannot advance past last page
    assert.deepEqual(stepPageForward(pos, 3, true), { page: 3, halfOffset: 0 });

    // Step all the way back
    pos = stepPageBackward(pos, 3, true);
    assert.deepEqual(pos, { page: 2, halfOffset: 1 });
    pos = stepPageBackward(pos, 3, true);
    assert.deepEqual(pos, { page: 2, halfOffset: 0 });
    pos = stepPageBackward(pos, 3, true);
    assert.deepEqual(pos, { page: 1, halfOffset: 1 });
    pos = stepPageBackward(pos, 3, true);
    assert.deepEqual(pos, { page: 1, halfOffset: 0 });
    assert.deepEqual(stepPageBackward(pos, 3, true), { page: 1, halfOffset: 0 });

    // Normalization resets invalid halfOffset on last page or when disabled
    assert.deepEqual(normalizeHalfPagePosition({ page: 3, halfOffset: 1 }, 3, true), {
      page: 3,
      halfOffset: 0,
    });
    assert.deepEqual(normalizeHalfPagePosition({ page: 2, halfOffset: 1 }, 3, false), {
      page: 2,
      halfOffset: 0,
    });
  });
});

describe("noter-db persistence, v2 annotations store, and SSR safety", () => {
  const originalIndexedDb = globalThis.indexedDB;
  const originalKeyRange = globalThis.IDBKeyRange;

  afterEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      value: originalIndexedDb,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "IDBKeyRange", {
      value: originalKeyRange,
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
    assert.deepEqual(await getPageAnnotations("missing", 1), []);
    assert.equal(await deleteSheetAnnotations("missing"), 0);
    await assert.rejects(
      saveSheet({
        fileName: "test.pdf",
        fileSize: 16,
        pdfData: new ArrayBuffer(16),
      }),
      /IndexedDB/,
    );
    await assert.rejects(savePageAnnotations("missing", 1, []), /IndexedDB/);
  });

  it("upgrades to v2, persists sheet flags, isolates per-page annotations without touching pdfData, and cascade-deletes", async () => {
    const harness = createFakeIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      value: harness.fakeIndexedDb,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "IDBKeyRange", {
      value: {
        only: (v: unknown) => ({ lower: v, upper: v }),
      },
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

    assert.equal(harness.openedVersions[0], NOTER_DB_VERSION);
    assert.ok(harness.createdStores.some((s) => s.name === NOTER_STORE_NAME && s.keyPath === "id"));
    assert.ok(
      harness.createdStores.some((s) => s.name === NOTER_ANNOTATIONS_STORE_NAME && s.keyPath === "key"),
    );
    assert.ok(
      harness.createdIndexes.some(
        (i) =>
          i.storeName === NOTER_ANNOTATIONS_STORE_NAME &&
          i.indexName === NOTER_ANNOTATIONS_SHEET_INDEX &&
          i.keyPath === "sheetId",
      ),
    );

    assert.equal(saved.id, "tx-wait-sheet-1");
    assert.equal(saved.title, "Gammel Jeger");
    assert.equal(saved.bpm, MAX_BPM);
    assert.equal(saved.annotationsVisible, true);
    assert.equal(saved.autoCrop, false);
    assert.equal(saved.halfPageTurn, false);
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
      annotationsVisible: false,
      autoCrop: true,
      halfPageTurn: true,
      pageCount: Number.POSITIVE_INFINITY,
    });
    assert.equal(updated?.bpm, MIN_BPM);
    assert.equal(updated?.pageCount, 3);
    assert.equal(updated?.lastPage, 3);
    assert.equal(updated?.nightMode, true);
    assert.equal(updated?.annotationsVisible, false);
    assert.equal(updated?.autoCrop, true);
    assert.equal(updated?.halfPageTurn, true);

    // Per-page annotations CRUD
    const page1Items: AnnotationItem[] = [
      {
        id: "p1-stroke",
        kind: "pencil",
        color: "#dc2626",
        width: PENCIL_WIDTH_THIN,
        opacity: 1,
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.4, y: 0.25 },
        ],
      },
    ];
    const page2Items: AnnotationItem[] = [
      {
        id: "p2-stamp",
        kind: "stamp",
        stampId: "fermata",
        x: 0.5,
        y: 0.3,
        color: "#111827",
      },
    ];
    const sheet2Items: AnnotationItem[] = [
      {
        id: "s2-text",
        kind: "text",
        x: 0.2,
        y: 0.5,
        text: "FF!",
        color: "#2563eb",
      },
    ];

    const savedAnn1 = await savePageAnnotations("tx-wait-sheet-1", 1, page1Items);
    assert.equal(savedAnn1.key, makePageAnnotationsKey("tx-wait-sheet-1", 1));
    await savePageAnnotations("tx-wait-sheet-1", 2, page2Items);
    await savePageAnnotations("tx-wait-sheet-2", 1, sheet2Items);

    assert.equal((await getPageAnnotations("tx-wait-sheet-1", 1))[0]?.id, "p1-stroke");
    assert.equal((await getPageAnnotations("tx-wait-sheet-1", 2))[0]?.id, "p2-stamp");
    assert.deepEqual(await getPageAnnotations("tx-wait-sheet-1", 3), []);

    // Original PDF buffer in sheets store remains untouched
    const sheetAfterAnnotations = await getSheet("tx-wait-sheet-1");
    assert.equal(sheetAfterAnnotations?.pdfData, pdfBytes);
    assert.equal(sheetAfterAnnotations?.pdfData.byteLength, 4);

    // Cascade delete on sheet 1 removes its annotations but preserves sheet 2's annotations
    assert.equal(await deleteSheet("tx-wait-sheet-1"), true);
    assert.deepEqual(await getPageAnnotations("tx-wait-sheet-1", 1), []);
    assert.deepEqual(await getPageAnnotations("tx-wait-sheet-1", 2), []);
    assert.equal((await getPageAnnotations("tx-wait-sheet-2", 1))[0]?.id, "s2-text");

    // deleteSheetAnnotations removes remaining annotations for sheet 2
    assert.equal(await deleteSheetAnnotations("tx-wait-sheet-2"), 1);
    assert.deepEqual(await getPageAnnotations("tx-wait-sheet-2", 1), []);

    assert.equal(await deleteSheet("tx-wait-sheet-2"), true);
    assert.deepEqual(await listSheets(), []);
  });
});

describe("noter-pdf render key and slice metrics", () => {
  it("formats deterministic render cache keys and guards non-finite or non-positive inputs", () => {
    assert.equal(buildRenderKey(1, 1.5, 2), "1@1.5000@2.00");
    assert.equal(buildRenderKey(3, 0.75, 1.25), "3@0.7500@1.25");
    assert.equal(buildRenderKey(2.9, 1, 1), "2@1.0000@1.00");
    assert.equal(buildRenderKey(0, -1, Number.NaN), "1@1.0000@1.00");
    assert.equal(buildRenderKey(Number.POSITIVE_INFINITY, Number.NaN, 0), "1@1.0000@1.00");
  });

  it("computes slice metrics for full page, half-page regions, cropped sub-rects, fractional sizes, and clamped edges", () => {
    // Full page at 2x DPR
    assert.deepEqual(computeSliceMetrics(800, 1000, 1600, 2000, FULL_PAGE_RECT), {
      sx: 0,
      sy: 0,
      sw: 1600,
      sh: 2000,
      destWidth: 1600,
      destHeight: 2000,
      cssWidth: 800,
      cssHeight: 1000,
    });

    // Half-page top and bottom on 2x DPR
    const halves = getHalfPageRegions();
    assert.deepEqual(computeSliceMetrics(800, 1000, 1600, 2000, halves.top), {
      sx: 0,
      sy: 0,
      sw: 1600,
      sh: 1000,
      destWidth: 1600,
      destHeight: 1000,
      cssWidth: 800,
      cssHeight: 500,
    });
    assert.deepEqual(computeSliceMetrics(800, 1000, 1600, 2000, halves.bottom), {
      sx: 0,
      sy: 1000,
      sw: 1600,
      sh: 1000,
      destWidth: 1600,
      destHeight: 1000,
      cssWidth: 800,
      cssHeight: 500,
    });

    // Cropped sub-rect with fractional CSS/pixel dimensions
    const sub = computeSliceMetrics(601.9, 801.7, 903.8, 1203.9, {
      x: 0.1,
      y: 0.25,
      width: 0.8,
      height: 0.5,
    });
    assert.equal(sub.cssWidth, 480); // floor(601 * 0.8)
    assert.equal(sub.cssHeight, 400); // floor(801 * 0.5)
    assert.equal(sub.sx, 90); // floor(0.1 * 903)
    assert.equal(sub.sy, 300); // floor(0.25 * 1203)
    assert.equal(sub.sw, 722); // floor(0.8 * 903)
    assert.equal(sub.sh, 601); // floor(0.5 * 1203)
    assert.equal(sub.destWidth, 722);
    assert.equal(sub.destHeight, 601);

    // Out-of-bounds clamping never exceeds backing store bounds
    const clamped = computeSliceMetrics(500, 700, 500, 700, {
      x: 0.999,
      y: -0.2,
      width: 0.5,
      height: 1.5,
    });
    assert.ok(clamped.sx >= 0 && clamped.sx < 500);
    assert.ok(clamped.sy === 0);
    assert.ok(clamped.sx + clamped.sw <= 500);
    assert.ok(clamped.sy + clamped.sh <= 700);
    assert.ok(clamped.destWidth >= 1 && clamped.destHeight >= 1);
    assert.ok(clamped.cssWidth >= 1 && clamped.cssHeight >= 1);

    // Degenerate zero/NaN dimensions fall back to 1x1 safely
    assert.deepEqual(computeSliceMetrics(0, Number.NaN, -10, 0, halves.bottom), {
      sx: 0,
      sy: 0,
      sw: 1,
      sh: 1,
      destWidth: 1,
      destHeight: 1,
      cssWidth: 1,
      cssHeight: 1,
    });
  });
});
