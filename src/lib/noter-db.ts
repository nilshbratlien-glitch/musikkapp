import {
  DEFAULT_BPM,
  clampBpm,
  clampPage,
  extractTitleFromFilename,
  type JumpLink,
  type SetlistRecord,
  type SheetBookmark,
  type SheetMeta,
  type SheetRecord,
} from "./noter.ts";
import { cloneAnnotationItems, type AnnotationItem } from "./noter-annotations.ts";

export const NOTER_DB_NAME = "musikkapp-noter-v1";
export const NOTER_STORE_NAME = "sheets";
export const NOTER_ANNOTATIONS_STORE_NAME = "annotations";
export const NOTER_ANNOTATIONS_SHEET_INDEX = "bySheetId";
export const NOTER_SETLISTS_STORE_NAME = "setlists";
export const NOTER_DB_VERSION = 3;

export type PageAnnotationsRecord = {
  key: string;
  sheetId: string;
  page: number;
  items: AnnotationItem[];
  updatedAt: number;
};

export type SaveSheetInput = {
  id?: string;
  title?: string;
  fileName: string;
  fileSize: number;
  pageCount?: number;
  bpm?: number;
  lastPage?: number;
  nightMode?: boolean;
  annotationsVisible?: boolean;
  autoCrop?: boolean;
  halfPageTurn?: boolean;
  bookmarks?: SheetBookmark[];
  jumpLinks?: JumpLink[];
  pdfData: ArrayBuffer;
};

export type UpdateSheetMetaPatch = Partial<
  Pick<
    SheetMeta,
    | "title"
    | "pageCount"
    | "bpm"
    | "lastPage"
    | "nightMode"
    | "annotationsVisible"
    | "autoCrop"
    | "halfPageTurn"
    | "bookmarks"
    | "jumpLinks"
    | "lastOpenedAt"
  >
>;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function generateSheetId(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `sheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function stripPdfData(record: SheetRecord): SheetMeta {
  const { pdfData: _pdfData, ...meta } = record;
  return {
    ...meta,
    annotationsVisible: meta.annotationsVisible ?? true,
    autoCrop: meta.autoCrop ?? false,
    halfPageTurn: meta.halfPageTurn ?? false,
    bookmarks: meta.bookmarks ?? [],
    jumpLinks: meta.jumpLinks ?? [],
  };
}

export function makePageAnnotationsKey(sheetId: string, page: number): string {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  return `${sheetId}:${safePage}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTER_DB_NAME, NOTER_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTER_STORE_NAME)) {
        db.createObjectStore(NOTER_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(NOTER_ANNOTATIONS_STORE_NAME)) {
        const annStore = db.createObjectStore(NOTER_ANNOTATIONS_STORE_NAME, { keyPath: "key" });
        annStore.createIndex(NOTER_ANNOTATIONS_SHEET_INDEX, "sheetId", { unique: false });
      }
      if (!db.objectStoreNames.contains(NOTER_SETLISTS_STORE_NAME)) {
        db.createObjectStore(NOTER_SETLISTS_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Kunne ikke åpne IndexedDB for noter."));
    };
  });
}

function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let settled = false;
        const fail = (err: unknown) => {
          if (settled) return;
          settled = true;
          try {
            db.close();
          } catch {
            /* ignore */
          }
          reject(err instanceof Error ? err : new Error("IndexedDB-operasjon feilet."));
        };

        try {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          let resultValue: T | undefined;
          let hasResult = false;

          const req = executor(store);
          req.onsuccess = () => {
            resultValue = req.result;
            hasResult = true;
          };
          req.onerror = () => {
            fail(req.error ?? new Error("IndexedDB-operasjon feilet."));
          };

          tx.oncomplete = () => {
            if (settled) return;
            settled = true;
            db.close();
            if (hasResult) {
              resolve(resultValue as T);
            } else {
              reject(new Error("IndexedDB-transaksjon ble fullført uten resultat."));
            }
          };
          tx.onerror = () => {
            fail(tx.error ?? new Error("IndexedDB-transaksjon feilet."));
          };
          tx.onabort = () => {
            fail(tx.error ?? new Error("IndexedDB-transaksjon avbrutt."));
          };
        } catch (err) {
          fail(err);
        }
      }),
  );
}

export async function listSheets(): Promise<SheetMeta[]> {
  if (!hasIndexedDb()) return [];
  const db = await openDb();
  return new Promise<SheetMeta[]>((resolve, reject) => {
    const items: SheetMeta[] = [];
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error("Kunne ikke lese noteliste fra IndexedDB."));
    };

    try {
      const tx = db.transaction(NOTER_STORE_NAME, "readonly");
      const store = tx.objectStore(NOTER_STORE_NAME);
      const req = store.openCursor();

      req.onsuccess = () => {
        try {
          const cursor = req.result;
          if (cursor) {
            items.push(stripPdfData(cursor.value as SheetRecord));
            cursor.continue();
          }
        } catch (err) {
          fail(err);
        }
      };
      req.onerror = () => {
        fail(req.error ?? new Error("Kunne ikke lese noteliste fra IndexedDB."));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(items);
      };
      tx.onerror = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon feilet."));
      };
      tx.onabort = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon avbrutt."));
      };
    } catch (err) {
      fail(err);
    }
  });
}

export async function getSheet(id: string): Promise<SheetRecord | null> {
  if (!hasIndexedDb() || !id) return null;
  const record = await runTransaction<SheetRecord | undefined>(NOTER_STORE_NAME, "readonly", (store) =>
    store.get(id),
  );
  return record ?? null;
}

export async function saveSheet(input: SaveSheetInput): Promise<SheetRecord> {
  if (!hasIndexedDb()) {
    throw new Error("IndexedDB er ikke tilgjengelig i dette miljøet.");
  }
  const now = Date.now();
  const rawPageCount = input.pageCount ?? 0;
  const pageCount = Number.isFinite(rawPageCount) ? Math.max(0, Math.floor(rawPageCount)) : 0;
  const rawTitle = input.title?.trim();
  const record: SheetRecord = {
    id: input.id?.trim() || generateSheetId(),
    title: rawTitle || extractTitleFromFilename(input.fileName),
    fileName: input.fileName,
    fileSize: input.fileSize,
    pageCount,
    bpm: clampBpm(input.bpm ?? DEFAULT_BPM),
    lastPage: clampPage(input.lastPage ?? 1, Math.max(1, pageCount)),
    nightMode: Boolean(input.nightMode),
    annotationsVisible: input.annotationsVisible ?? true,
    autoCrop: Boolean(input.autoCrop),
    halfPageTurn: Boolean(input.halfPageTurn),
    bookmarks: input.bookmarks ?? [],
    jumpLinks: input.jumpLinks ?? [],
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    pdfData: input.pdfData,
  };

  await runTransaction<IDBValidKey>(NOTER_STORE_NAME, "readwrite", (store) => store.put(record));
  return record;
}

export async function updateSheetMeta(id: string, patch: UpdateSheetMetaPatch): Promise<SheetMeta | null> {
  if (!hasIndexedDb() || !id) return null;

  const db = await openDb();
  return new Promise<SheetMeta | null>((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error("Kunne ikke oppdatere notemetadata."));
    };

    try {
      const tx = db.transaction(NOTER_STORE_NAME, "readwrite");
      const store = tx.objectStore(NOTER_STORE_NAME);
      const getReq = store.get(id);
      let updatedMeta: SheetMeta | null = null;

      getReq.onsuccess = () => {
        try {
          const existing = getReq.result as SheetRecord | undefined;
          if (!existing) {
            updatedMeta = null;
            return;
          }

          const nextPageCount =
            patch.pageCount !== undefined
              ? Number.isFinite(patch.pageCount)
                ? Math.max(0, Math.floor(patch.pageCount))
                : existing.pageCount
              : existing.pageCount;
          const nextTitle = patch.title !== undefined ? patch.title.trim() || existing.title : existing.title;
          const nextBpm = patch.bpm !== undefined ? clampBpm(patch.bpm) : existing.bpm;
          const nextLastPage =
            patch.lastPage !== undefined
              ? clampPage(patch.lastPage, Math.max(1, nextPageCount))
              : clampPage(existing.lastPage, Math.max(1, nextPageCount));

          const nextRecord: SheetRecord = {
            ...existing,
            title: nextTitle,
            pageCount: nextPageCount,
            bpm: nextBpm,
            lastPage: nextLastPage,
            nightMode: patch.nightMode !== undefined ? Boolean(patch.nightMode) : existing.nightMode,
            annotationsVisible:
              patch.annotationsVisible !== undefined
                ? Boolean(patch.annotationsVisible)
                : (existing.annotationsVisible ?? true),
            autoCrop:
              patch.autoCrop !== undefined ? Boolean(patch.autoCrop) : (existing.autoCrop ?? false),
            halfPageTurn:
              patch.halfPageTurn !== undefined
                ? Boolean(patch.halfPageTurn)
                : (existing.halfPageTurn ?? false),
            bookmarks: patch.bookmarks !== undefined ? patch.bookmarks : (existing.bookmarks ?? []),
            jumpLinks: patch.jumpLinks !== undefined ? patch.jumpLinks : (existing.jumpLinks ?? []),
            lastOpenedAt: patch.lastOpenedAt !== undefined ? patch.lastOpenedAt : existing.lastOpenedAt,
            updatedAt: Date.now(),
          };

          updatedMeta = stripPdfData(nextRecord);
          const putReq = store.put(nextRecord);
          putReq.onerror = () => {
            fail(putReq.error ?? new Error("Kunne ikke oppdatere notemetadata."));
          };
        } catch (err) {
          fail(err);
        }
      };

      getReq.onerror = () => {
        fail(getReq.error ?? new Error("Kunne ikke lese note fra IndexedDB."));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(updatedMeta);
      };
      tx.onerror = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon feilet."));
      };
      tx.onabort = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon avbrutt."));
      };
    } catch (err) {
      fail(err);
    }
  });
}

export async function getPageAnnotations(sheetId: string, page: number): Promise<AnnotationItem[]> {
  if (!hasIndexedDb() || !sheetId) return [];
  const key = makePageAnnotationsKey(sheetId, page);
  const record = await runTransaction<PageAnnotationsRecord | undefined>(
    NOTER_ANNOTATIONS_STORE_NAME,
    "readonly",
    (store) => store.get(key),
  );
  return record?.items ? cloneAnnotationItems(record.items) : [];
}

export async function savePageAnnotations(
  sheetId: string,
  page: number,
  items: AnnotationItem[],
): Promise<PageAnnotationsRecord> {
  if (!hasIndexedDb()) {
    throw new Error("IndexedDB er ikke tilgjengelig i dette miljøet.");
  }
  if (!sheetId) {
    throw new Error("Mangler note-ID for å lagre annotasjoner.");
  }
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const record: PageAnnotationsRecord = {
    key: makePageAnnotationsKey(sheetId, safePage),
    sheetId,
    page: safePage,
    items: cloneAnnotationItems(items),
    updatedAt: Date.now(),
  };

  await runTransaction<IDBValidKey>(NOTER_ANNOTATIONS_STORE_NAME, "readwrite", (store) =>
    store.put(record),
  );
  return record;
}

export async function deleteSheetAnnotations(sheetId: string): Promise<number> {
  if (!hasIndexedDb() || !sheetId) return 0;
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let deletedCount = 0;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error("Kunne ikke slette annotasjoner fra IndexedDB."));
    };

    try {
      const tx = db.transaction(NOTER_ANNOTATIONS_STORE_NAME, "readwrite");
      const store = tx.objectStore(NOTER_ANNOTATIONS_STORE_NAME);
      const index = store.index(NOTER_ANNOTATIONS_SHEET_INDEX);
      const query = typeof IDBKeyRange !== "undefined" ? IDBKeyRange.only(sheetId) : undefined;
      const req = index.openCursor(query);

      req.onsuccess = () => {
        try {
          const cursor = req.result;
          if (cursor) {
            const value = cursor.value as PageAnnotationsRecord;
            if (value.sheetId === sheetId) {
              deletedCount += 1;
              cursor.delete();
            }
            cursor.continue();
          }
        } catch (err) {
          fail(err);
        }
      };
      req.onerror = () => {
        fail(req.error ?? new Error("Kunne ikke slette annotasjoner fra IndexedDB."));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(deletedCount);
      };
      tx.onerror = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon feilet."));
      };
      tx.onabort = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon avbrutt."));
      };
    } catch (err) {
      fail(err);
    }
  });
}

export async function deleteSheet(id: string): Promise<boolean> {
  if (!hasIndexedDb() || !id) return false;
  const db = await openDb();
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error("Kunne ikke slette note fra IndexedDB."));
    };

    try {
      const tx = db.transaction(
        [NOTER_STORE_NAME, NOTER_ANNOTATIONS_STORE_NAME, NOTER_SETLISTS_STORE_NAME],
        "readwrite",
      );
      const sheetStore = tx.objectStore(NOTER_STORE_NAME);
      const annStore = tx.objectStore(NOTER_ANNOTATIONS_STORE_NAME);
      const setlistStore = tx.objectStore(NOTER_SETLISTS_STORE_NAME);

      const delSheetReq = sheetStore.delete(id);
      delSheetReq.onerror = () => {
        fail(delSheetReq.error ?? new Error("Kunne ikke slette note fra IndexedDB."));
      };

      const index = annStore.index(NOTER_ANNOTATIONS_SHEET_INDEX);
      const query = typeof IDBKeyRange !== "undefined" ? IDBKeyRange.only(id) : undefined;
      const cursorReq = index.openCursor(query);

      cursorReq.onsuccess = () => {
        try {
          const cursor = cursorReq.result;
          if (cursor) {
            const value = cursor.value as PageAnnotationsRecord;
            if (value.sheetId === id) {
              cursor.delete();
            }
            cursor.continue();
          }
        } catch (err) {
          fail(err);
        }
      };
      cursorReq.onerror = () => {
        fail(cursorReq.error ?? new Error("Kunne ikke slette noteannotasjoner fra IndexedDB."));
      };

      const setlistCursorReq = setlistStore.openCursor();
      setlistCursorReq.onsuccess = () => {
        try {
          const cursor = setlistCursorReq.result;
          if (cursor) {
            const sl = cursor.value as SetlistRecord;
            if (Array.isArray(sl.sheetIds) && sl.sheetIds.includes(id)) {
              cursor.update({
                ...sl,
                sheetIds: sl.sheetIds.filter((sid) => sid !== id),
                updatedAt: Date.now(),
              });
            }
            cursor.continue();
          }
        } catch (err) {
          fail(err);
        }
      };
      setlistCursorReq.onerror = () => {
        fail(setlistCursorReq.error ?? new Error("Kunne ikke oppdatere settlister ved sletting."));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon feilet."));
      };
      tx.onabort = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon avbrutt."));
      };
    } catch (err) {
      fail(err);
    }
  });
}

export async function listSetlists(): Promise<SetlistRecord[]> {
  if (!hasIndexedDb()) return [];
  const db = await openDb();
  return new Promise<SetlistRecord[]>((resolve, reject) => {
    const items: SetlistRecord[] = [];
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error("Kunne ikke lese settlister fra IndexedDB."));
    };

    try {
      const tx = db.transaction(NOTER_SETLISTS_STORE_NAME, "readonly");
      const store = tx.objectStore(NOTER_SETLISTS_STORE_NAME);
      const req = store.openCursor();

      req.onsuccess = () => {
        try {
          const cursor = req.result;
          if (cursor) {
            items.push(cursor.value as SetlistRecord);
            cursor.continue();
          }
        } catch (err) {
          fail(err);
        }
      };
      req.onerror = () => {
        fail(req.error ?? new Error("Kunne ikke lese settlister fra IndexedDB."));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(items.sort((a, b) => b.updatedAt - a.updatedAt));
      };
      tx.onerror = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon feilet."));
      };
      tx.onabort = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon avbrutt."));
      };
    } catch (err) {
      fail(err);
    }
  });
}

export async function getSetlist(id: string): Promise<SetlistRecord | null> {
  if (!hasIndexedDb() || !id) return null;
  const record = await runTransaction<SetlistRecord | undefined>(
    NOTER_SETLISTS_STORE_NAME,
    "readonly",
    (store) => store.get(id),
  );
  return record ?? null;
}

export type SaveSetlistInput = {
  id?: string;
  name: string;
  sheetIds: string[];
};

export async function saveSetlist(input: SaveSetlistInput): Promise<SetlistRecord> {
  if (!hasIndexedDb()) {
    throw new Error("IndexedDB er ikke tilgjengelig i dette miljøet.");
  }
  const existing = input.id ? await getSetlist(input.id) : null;
  const now = Date.now();
  const record: SetlistRecord = {
    id: existing?.id ?? input.id?.trim() ?? generateSheetId(),
    name: input.name.trim() || "Uten navn",
    sheetIds: [...input.sheetIds],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await runTransaction<IDBValidKey>(NOTER_SETLISTS_STORE_NAME, "readwrite", (store) =>
    store.put(record),
  );
  return record;
}

export async function deleteSetlist(id: string): Promise<boolean> {
  if (!hasIndexedDb() || !id) return false;
  await runTransaction<undefined>(NOTER_SETLISTS_STORE_NAME, "readwrite", (store) =>
    store.delete(id),
  );
  return true;
}

export async function listAllAnnotations(): Promise<PageAnnotationsRecord[]> {
  if (!hasIndexedDb()) return [];
  const db = await openDb();
  return new Promise<PageAnnotationsRecord[]>((resolve, reject) => {
    const items: PageAnnotationsRecord[] = [];
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      try {
        db.close();
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error("Kunne ikke lese annotasjoner fra IndexedDB."));
    };

    try {
      const tx = db.transaction(NOTER_ANNOTATIONS_STORE_NAME, "readonly");
      const store = tx.objectStore(NOTER_ANNOTATIONS_STORE_NAME);
      const req = store.openCursor();

      req.onsuccess = () => {
        try {
          const cursor = req.result;
          if (cursor) {
            const rec = cursor.value as PageAnnotationsRecord;
            items.push({
              ...rec,
              items: cloneAnnotationItems(rec.items ?? []),
            });
            cursor.continue();
          }
        } catch (err) {
          fail(err);
        }
      };
      req.onerror = () => {
        fail(req.error ?? new Error("Kunne ikke lese annotasjoner fra IndexedDB."));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(items);
      };
      tx.onerror = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon feilet."));
      };
      tx.onabort = () => {
        fail(tx.error ?? new Error("IndexedDB-transaksjon avbrutt."));
      };
    } catch (err) {
      fail(err);
    }
  });
}
