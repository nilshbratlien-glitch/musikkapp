import type { JumpLink, SheetBookmark } from "./noter.ts";
import type { PageAnnotationsRecord } from "./noter-db.ts";

const PDF_LIB_VERSION = "1.17.1";
const PDF_LIB_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/pdf-lib@${PDF_LIB_VERSION}/dist/pdf-lib.min.js`;

type PdfLibDocument = {
  getPageCount: () => number;
  copyPages: (srcDoc: PdfLibDocument, indices: number[]) => Promise<unknown[]>;
  addPage: (page: unknown) => void;
  save: () => Promise<Uint8Array>;
};

export type PdfLibGlobal = {
  PDFDocument: {
    load: (data: ArrayBuffer | Uint8Array) => Promise<PdfLibDocument>;
    create: () => Promise<PdfLibDocument>;
  };
};

let pdfLibPromise: Promise<PdfLibGlobal> | null = null;

function getPdfLibGlobal(): PdfLibGlobal | undefined {
  return (globalThis as unknown as { PDFLib?: PdfLibGlobal }).PDFLib;
}

export function loadPdfLib(): Promise<PdfLibGlobal> {
  const existing = getPdfLibGlobal();
  if (existing) {
    return Promise.resolve(existing);
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("PDF-redigering er bare tilgjengelig i nettleseren."));
  }

  if (pdfLibPromise) return pdfLibPromise;

  pdfLibPromise = new Promise<PdfLibGlobal>((resolve, reject) => {
    const finish = () => {
      const lib = getPdfLibGlobal();
      if (!lib) {
        pdfLibPromise = null;
        reject(new Error("PDF-redigeringsverktøyet ble lastet, men PDFLib mangler."));
        return;
      }
      resolve(lib);
    };

    const fail = (targetScript?: HTMLScriptElement) => {
      targetScript?.remove();
      pdfLibPromise = null;
      reject(
        new Error(
          "Kunne ikke laste PDF-redigeringsverktøyet. Sjekk internettforbindelsen og prøv igjen.",
        ),
      );
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[data-pdflib="${PDF_LIB_VERSION}"]`,
    );
    if (existingScript) {
      if (getPdfLibGlobal()) {
        finish();
      } else {
        existingScript.addEventListener("load", finish, { once: true });
        existingScript.addEventListener("error", () => fail(existingScript), { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = PDF_LIB_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.pdflib = PDF_LIB_VERSION;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => fail(script), { once: true });
    document.head.appendChild(script);
  });

  return pdfLibPromise;
}

/**
 * Parses human-friendly page ranges like "14-16", "3, 14–16, 42" into
 * sorted, unique 1-based page numbers within [1, maxPage].
 */
export function parsePageRangeInput(input: string, maxPage: number): number[] {
  const safeMax = Number.isFinite(maxPage) ? Math.max(1, Math.floor(maxPage)) : 1;
  const normalized = input.replace(/[–—]/g, "-").trim();
  if (!normalized) return [];

  const selected = new Set<number>();
  const tokens = normalized.split(/[,;\s]+/).filter(Boolean);

  for (const token of tokens) {
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    if (rangeMatch) {
      const rawStart = Number.parseInt(rangeMatch[1], 10);
      const rawEnd = Number.parseInt(rangeMatch[2], 10);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
      const start = Math.max(1, Math.min(safeMax, Math.min(rawStart, rawEnd)));
      const end = Math.max(1, Math.min(safeMax, Math.max(rawStart, rawEnd)));
      for (let p = start; p <= end; p += 1) {
        selected.add(p);
      }
      continue;
    }

    if (/^\d+$/.test(token)) {
      const page = Number.parseInt(token, 10);
      if (page >= 1 && page <= safeMax) {
        selected.add(page);
      }
    }
  }

  return Array.from(selected).sort((a, b) => a - b);
}

/**
 * Formats a list of 1-based page numbers into a compact range string,
 * e.g. [3, 14, 15, 16, 42] -> "3, 14-16, 42".
 */
export function formatPageSelectionSummary(pages: readonly number[]): string {
  const uniqueSorted = Array.from(
    new Set(pages.filter((p) => Number.isFinite(p) && p >= 1).map((p) => Math.floor(p))),
  ).sort((a, b) => a - b);

  if (uniqueSorted.length === 0) return "";

  const parts: string[] = [];
  let rangeStart = uniqueSorted[0];
  let rangeEnd = uniqueSorted[0];

  for (let i = 1; i < uniqueSorted.length; i += 1) {
    const current = uniqueSorted[i];
    if (current === rangeEnd + 1) {
      rangeEnd = current;
    } else {
      parts.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);
      rangeStart = current;
      rangeEnd = current;
    }
  }
  parts.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`);

  return parts.join(", ");
}

export function normalizeKeptPages(keptPages: readonly number[], maxPage: number): number[] {
  const safeMax = Number.isFinite(maxPage) ? Math.max(1, Math.floor(maxPage)) : 1;
  return Array.from(
    new Set(
      keptPages
        .filter((p) => Number.isFinite(p))
        .map((p) => Math.floor(p))
        .filter((p) => p >= 1 && p <= safeMax),
    ),
  ).sort((a, b) => a - b);
}

export function buildPageRemapMap(keptPages: readonly number[]): Map<number, number> {
  const map = new Map<number, number>();
  const uniqueSorted = Array.from(
    new Set(keptPages.filter((p) => Number.isFinite(p) && p >= 1).map((p) => Math.floor(p))),
  ).sort((a, b) => a - b);

  uniqueSorted.forEach((oldPage, idx) => {
    map.set(oldPage, idx + 1);
  });
  return map;
}

export function remapBookmarks(
  bookmarks: readonly SheetBookmark[],
  pageMap: ReadonlyMap<number, number>,
): SheetBookmark[] {
  const next: SheetBookmark[] = [];
  for (const bm of bookmarks) {
    const newPage = pageMap.get(bm.page);
    if (newPage !== undefined) {
      next.push({ ...bm, page: newPage });
    }
  }
  return next;
}

export function remapJumpLinks(
  jumpLinks: readonly JumpLink[],
  pageMap: ReadonlyMap<number, number>,
): JumpLink[] {
  const next: JumpLink[] = [];
  for (const link of jumpLinks) {
    const newSource = pageMap.get(link.sourcePage);
    const newTarget = pageMap.get(link.targetPage);
    if (newSource !== undefined && newTarget !== undefined) {
      next.push({ ...link, sourcePage: newSource, targetPage: newTarget });
    }
  }
  return next;
}

export function remapSheetPageAnnotations(
  records: readonly PageAnnotationsRecord[],
  targetSheetId: string,
  pageMap: ReadonlyMap<number, number>,
): PageAnnotationsRecord[] {
  const next: PageAnnotationsRecord[] = [];
  for (const rec of records) {
    const newPage = pageMap.get(rec.page);
    if (newPage !== undefined) {
      next.push({
        ...rec,
        sheetId: targetSheetId,
        page: newPage,
        key: `${targetSheetId}:${newPage}`,
      });
    }
  }
  return next.sort((a, b) => a.page - b.page);
}

export function remapManualCrops(
  manualCrops: Record<number, import("./noter-crop.ts").NormalizedRect> | undefined,
  pageMap: ReadonlyMap<number, number>,
): Record<number, import("./noter-crop.ts").NormalizedRect> {
  if (!manualCrops) return {};
  const next: Record<number, import("./noter-crop.ts").NormalizedRect> = {};
  for (const [key, rect] of Object.entries(manualCrops)) {
    const oldPage = Number.parseInt(key, 10);
    const newPage = pageMap.get(oldPage);
    if (newPage !== undefined && rect) {
      next[newPage] = { ...rect };
    }
  }
  return next;
}

export async function trimPdfBytes(
  pdfData: ArrayBuffer,
  keptPages: readonly number[],
): Promise<{ pdfData: ArrayBuffer; keptPages: number[] }> {
  const pdfLib = await loadPdfLib();
  const srcDoc = await pdfLib.PDFDocument.load(pdfData.slice(0));
  const totalPages = srcDoc.getPageCount();
  const normalizedPages = normalizeKeptPages(keptPages, totalPages);

  if (normalizedPages.length === 0) {
    throw new Error("Velg minst én side som skal beholdes.");
  }

  const outDoc = await pdfLib.PDFDocument.create();
  const zeroBasedIndices = normalizedPages.map((p) => p - 1);
  const copiedPages = await outDoc.copyPages(srcDoc, zeroBasedIndices);
  for (const page of copiedPages) {
    outDoc.addPage(page);
  }

  const savedBytes = await outDoc.save();
  const copy = new Uint8Array(savedBytes.byteLength);
  copy.set(savedBytes);
  return {
    pdfData: copy.buffer,
    keptPages: normalizedPages,
  };
}
