import {
  DEFAULT_BPM,
  clampBpm,
  clampPage,
  extractTitleFromFilename,
  type SheetMeta,
  type SheetRecord,
} from "./noter.ts";

export const NOTER_DB_NAME = "musikkapp-noter-v1";
export const NOTER_STORE_NAME = "sheets";
const NOTER_DB_VERSION = 1;

export type SaveSheetInput = {
  id?: string;
  title?: string;
  fileName: string;
  fileSize: number;
  pageCount?: number;
  bpm?: number;
  lastPage?: number;
  nightMode?: boolean;
  pdfData: ArrayBuffer;
};

export type UpdateSheetMetaPatch = Partial<
  Pick<SheetMeta, "title" | "pageCount" | "bpm" | "lastPage" | "nightMode" | "lastOpenedAt">
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
  return meta;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTER_DB_NAME, NOTER_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTER_STORE_NAME)) {
        db.createObjectStore(NOTER_STORE_NAME, { keyPath: "id" });
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
          const tx = db.transaction(NOTER_STORE_NAME, mode);
          const store = tx.objectStore(NOTER_STORE_NAME);
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
  const record = await runTransaction<SheetRecord | undefined>("readonly", (store) => store.get(id));
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
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    pdfData: input.pdfData,
  };

  await runTransaction<IDBValidKey>("readwrite", (store) => store.put(record));
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

export async function deleteSheet(id: string): Promise<boolean> {
  if (!hasIndexedDb() || !id) return false;
  await runTransaction<undefined>("readwrite", (store) => store.delete(id));
  return true;
}
