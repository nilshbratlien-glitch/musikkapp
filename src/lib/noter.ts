export type SheetMeta = {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  bpm: number;
  lastPage: number;
  nightMode: boolean;
  annotationsVisible?: boolean;
  autoCrop?: boolean;
  halfPageTurn?: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
};

export type SheetRecord = SheetMeta & {
  pdfData: ArrayBuffer;
};

export type SheetSortBy = "recent" | "title" | "newest";

export const DEFAULT_BPM = 100;
export const MIN_BPM = 30;
export const MAX_BPM = 280;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3.0;
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return DEFAULT_BPM;
  const rounded = Math.round(bpm);
  return Math.min(MAX_BPM, Math.max(MIN_BPM, rounded));
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1.0;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount < 1) return 1;
  const maxPage = Math.max(1, Math.floor(pageCount));
  if (!Number.isFinite(page)) return 1;
  const rounded = Math.floor(page);
  return Math.min(maxPage, Math.max(1, rounded));
}

export function extractTitleFromFilename(fileName: string): string {
  const base = fileName.trim().replace(/\.pdf$/i, "");
  const cleaned = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Uten tittel";
}

export function isValidPdfFile(fileName: string, mimeType: string, sizeBytes: number): boolean {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PDF_BYTES) {
    return false;
  }
  const normalizedMime = mimeType.trim().toLowerCase();
  const isPdfMime = normalizedMime === "application/pdf" || normalizedMime === "application/x-pdf";
  if (isPdfMime) return true;

  const hasPdfExtension = fileName.trim().toLowerCase().endsWith(".pdf");
  if (hasPdfExtension && (normalizedMime === "" || normalizedMime === "application/octet-stream")) {
    return true;
  }
  return false;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sortSheets<T extends SheetMeta>(sheets: readonly T[], by: SheetSortBy): T[] {
  const copy = [...sheets];
  switch (by) {
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "nb", { sensitivity: "base" }));
    case "newest":
      return copy.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
    case "recent":
    default:
      return copy.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || b.updatedAt - a.updatedAt);
  }
}
