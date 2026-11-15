import type { JumpLink, SetlistRecord, SheetBookmark, SheetMeta } from "./noter.ts";
import { cloneAnnotationItems, type AnnotationItem } from "./noter-annotations.ts";
import {
  listAllAnnotations,
  listSetlists,
  listSheets,
  savePageAnnotations,
  saveSetlist,
  updateSheetMeta,
  type PageAnnotationsRecord,
} from "./noter-db.ts";

export const NOTER_BACKUP_VERSION = 1;

export type SheetMetadataBackup = {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  bpm: number;
  lastPage: number;
  nightMode: boolean;
  annotationsVisible: boolean;
  autoCrop: boolean;
  halfPageTurn: boolean;
  bookmarks: SheetBookmark[];
  jumpLinks: JumpLink[];
};

export type NoterBackupPayload = {
  version: number;
  exportedAt: number;
  sheets: SheetMetadataBackup[];
  annotations: Array<{
    sheetId: string;
    page: number;
    items: AnnotationItem[];
  }>;
  setlists: SetlistRecord[];
};

export function buildNoterBackupPayload(
  sheets: readonly SheetMeta[],
  annotations: readonly PageAnnotationsRecord[],
  setlists: readonly SetlistRecord[],
  exportedAt = Date.now(),
): NoterBackupPayload {
  return {
    version: NOTER_BACKUP_VERSION,
    exportedAt,
    sheets: sheets.map((s) => ({
      id: s.id,
      title: s.title,
      fileName: s.fileName,
      fileSize: s.fileSize,
      bpm: s.bpm,
      lastPage: s.lastPage,
      nightMode: s.nightMode,
      annotationsVisible: s.annotationsVisible ?? true,
      autoCrop: s.autoCrop ?? false,
      halfPageTurn: s.halfPageTurn ?? false,
      bookmarks: (s.bookmarks ?? []).map((b) => ({ ...b })),
      jumpLinks: (s.jumpLinks ?? []).map((l) => ({ ...l })),
    })),
    annotations: annotations
      .filter((a) => Array.isArray(a.items) && a.items.length > 0)
      .map((a) => ({
        sheetId: a.sheetId,
        page: a.page,
        items: cloneAnnotationItems(a.items),
      })),
    setlists: setlists.map((sl) => ({
      ...sl,
      sheetIds: [...sl.sheetIds],
    })),
  };
}

export function parseNoterBackupJson(rawText: string): NoterBackupPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Ugyldig JSON-fil.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ugyldig backup-format.");
  }

  const obj = parsed as Partial<NoterBackupPayload>;
  if (typeof obj.version !== "number" || obj.version < 1) {
    throw new Error("Backup-filen mangler gyldig versjonsnummer.");
  }

  return {
    version: obj.version,
    exportedAt: typeof obj.exportedAt === "number" ? obj.exportedAt : Date.now(),
    sheets: Array.isArray(obj.sheets) ? obj.sheets : [],
    annotations: Array.isArray(obj.annotations) ? obj.annotations : [],
    setlists: Array.isArray(obj.setlists) ? obj.setlists : [],
  };
}

export async function exportNoterBackup(): Promise<NoterBackupPayload> {
  const [sheets, annotations, setlists] = await Promise.all([
    listSheets(),
    listAllAnnotations(),
    listSetlists(),
  ]);
  return buildNoterBackupPayload(sheets, annotations, setlists);
}

export type RestoreBackupSummary = {
  matchedSheets: number;
  restoredAnnotationPages: number;
  restoredSetlists: number;
};

export async function restoreNoterBackup(
  payload: NoterBackupPayload,
): Promise<RestoreBackupSummary> {
  const existingSheets = await listSheets();
  const byId = new Map(existingSheets.map((s) => [s.id, s]));
  const byFileKey = new Map(
    existingSheets.map((s) => [`${s.fileName}::${s.fileSize}`, s]),
  );

  const idMap = new Map<string, string>();
  let matchedSheets = 0;

  for (const bSheet of payload.sheets) {
    const target =
      byId.get(bSheet.id) ?? byFileKey.get(`${bSheet.fileName}::${bSheet.fileSize}`);
    if (!target) continue;

    idMap.set(bSheet.id, target.id);
    matchedSheets += 1;

    await updateSheetMeta(target.id, {
      title: bSheet.title,
      bpm: bSheet.bpm,
      nightMode: bSheet.nightMode,
      annotationsVisible: bSheet.annotationsVisible,
      autoCrop: bSheet.autoCrop,
      halfPageTurn: bSheet.halfPageTurn,
      bookmarks: Array.isArray(bSheet.bookmarks) ? bSheet.bookmarks : [],
      jumpLinks: Array.isArray(bSheet.jumpLinks) ? bSheet.jumpLinks : [],
    });
  }

  let restoredAnnotationPages = 0;
  for (const ann of payload.annotations) {
    const mappedSheetId = idMap.get(ann.sheetId) ?? (byId.has(ann.sheetId) ? ann.sheetId : null);
    if (!mappedSheetId) continue;
    await savePageAnnotations(mappedSheetId, ann.page, cloneAnnotationItems(ann.items));
    restoredAnnotationPages += 1;
  }

  let restoredSetlists = 0;
  for (const sl of payload.setlists) {
    const mappedSheetIds = (sl.sheetIds ?? [])
      .map((sid) => idMap.get(sid) ?? (byId.has(sid) ? sid : null))
      .filter((sid): sid is string => Boolean(sid));
    await saveSetlist({
      id: sl.id,
      name: sl.name,
      sheetIds: mappedSheetIds,
    });
    restoredSetlists += 1;
  }

  return {
    matchedSheets,
    restoredAnnotationPages,
    restoredSetlists,
  };
}
