import type { AnnotationItem, StampId } from "./noter-annotations.ts";
import { ANNOTATION_VIEWBOX_SIZE } from "./noter-annotations.ts";
import { loadPdfLib } from "./noter-trim.ts";

type PdfRgbColor = unknown;

type PdfFont = {
  widthOfTextAtSize: (text: string, size: number) => number;
};

type PdfPageLike = {
  getSize: () => { width: number; height: number };
  drawLine: (opts: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    thickness: number;
    color: PdfRgbColor;
    opacity?: number;
  }) => void;
  drawCircle: (opts: {
    x: number;
    y: number;
    size: number;
    color?: PdfRgbColor;
    borderColor?: PdfRgbColor;
    borderWidth?: number;
    opacity?: number;
  }) => void;
  drawText: (
    text: string,
    opts: {
      x: number;
      y: number;
      size: number;
      font?: PdfFont;
      color: PdfRgbColor;
      opacity?: number;
    },
  ) => void;
};

type PdfLibExportGlobal = {
  PDFDocument: {
    load: (data: ArrayBuffer | Uint8Array) => Promise<{
      getPages: () => PdfPageLike[];
      embedFont: (font: string) => Promise<PdfFont>;
      save: () => Promise<Uint8Array>;
    }>;
  };
  rgb: (r: number, g: number, b: number) => PdfRgbColor;
  StandardFonts: {
    Helvetica: string;
    HelveticaBold: string;
    TimesRomanBoldItalic: string;
  };
};

export function parseHexColorToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return {
      r: Number.parseInt(cleaned.slice(0, 2), 16) / 255,
      g: Number.parseInt(cleaned.slice(2, 4), 16) / 255,
      b: Number.parseInt(cleaned.slice(4, 6), 16) / 255,
    };
  }
  return { r: 0.07, g: 0.09, b: 0.15 };
}

export function sanitizeWinAnsiText(text: string): string {
  // Standard PDF WinAnsi encoding supports U+0020..U+00FF (plus a few punctuation chars)
  return Array.from(text)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 32;
      if (code >= 0x20 && code <= 0xff) return ch;
      return "?";
    })
    .join("");
}

function drawVectorStamp(
  page: PdfPageLike,
  stampId: StampId,
  cx: number,
  cy: number,
  s: number,
  color: PdfRgbColor,
  italicFont: PdfFont,
  boldFont: PdfFont,
) {
  const line = (x1: number, y1: number, x2: number, y2: number, w = 2.4) => {
    page.drawLine({
      start: { x: cx + x1 * s, y: cy - y1 * s },
      end: { x: cx + x2 * s, y: cy - y2 * s },
      thickness: Math.max(0.8, w * s),
      color,
    });
  };

  switch (stampId) {
    case "arrow-up":
      line(0, 11, 0, -10, 2.6);
      line(-7, -3, 0, -11, 2.6);
      line(0, -11, 7, -3, 2.6);
      return;
    case "arrow-down":
      line(0, -11, 0, 10, 2.6);
      line(-7, 3, 0, 11, 2.6);
      line(0, 11, 7, 3, 2.6);
      return;
    case "arrow-left":
      line(11, 0, -10, 0, 2.6);
      line(-3, -7, -11, 0, 2.6);
      line(-11, 0, -3, 7, 2.6);
      return;
    case "arrow-right":
      line(-11, 0, 10, 0, 2.6);
      line(3, -7, 11, 0, 2.6);
      line(11, 0, 3, 7, 2.6);
      return;
    case "arrow-repeat":
      line(-9, -3, 8, -3, 2.4);
      line(8, -3, 8, 9, 2.4);
      line(8, 9, -6, 9, 2.4);
      line(-3, -9, -10, -3, 2.4);
      line(-10, -3, -3, 3, 2.4);
      return;
    case "accent":
      line(-9, -6, 9, 0, 2.6);
      line(9, 0, -9, 6, 2.6);
      return;
    case "marcato":
      line(-7, 7, 0, -9, 2.6);
      line(0, -9, 7, 7, 2.6);
      return;
    case "tenuto":
      line(-10, 0, 10, 0, 3);
      return;
    case "staccato":
      page.drawCircle({ x: cx, y: cy, size: 3.4 * s, color });
      return;
    case "check":
      line(-9, 1, -3, 7, 2.8);
      line(-3, 7, 10, -7, 2.8);
      return;
    case "caesura":
      line(-5, 10, 0, -10, 2.6);
      line(1, 10, 6, -10, 2.6);
      return;
    case "sharp":
      line(-4, -12, -4, 12, 2.2);
      line(4, -12, 4, 12, 2.2);
      line(-10, -3, 10, -6, 2.6);
      line(-10, 6, 10, 3, 2.6);
      return;
    case "coda":
      page.drawCircle({ x: cx, y: cy, size: 8.5 * s, borderColor: color, borderWidth: 2.2 * s });
      line(0, -13, 0, 13, 2.2);
      line(-12, 0, 12, 0, 2.2);
      return;
    case "fermata":
      line(-12, 4, -6, -4, 2.4);
      line(-6, -4, 6, -4, 2.4);
      line(6, -4, 12, 4, 2.4);
      page.drawCircle({ x: cx, y: cy - 2 * s, size: 2.2 * s, color });
      return;
    case "pp":
    case "p":
    case "mp":
    case "mf":
    case "f":
    case "ff":
    case "sfz":
    case "fp": {
      const size = (stampId.length >= 3 ? 16 : 20) * s;
      const w = italicFont.widthOfTextAtSize(stampId, size);
      page.drawText(stampId, {
        x: cx - w / 2,
        y: cy - size * 0.35,
        size,
        font: italicFont,
        color,
      });
      return;
    }
    default: {
      const label =
        stampId === "glasses"
          ? "SE!"
          : stampId === "breath"
            ? ","
            : stampId === "flat"
              ? "b"
              : stampId === "natural"
                ? "nat."
                : stampId === "segno"
                  ? "Segno"
                  : stampId === "star"
                    ? "*"
                    : stampId;
      const size = 18 * s;
      const safe = sanitizeWinAnsiText(label);
      const w = boldFont.widthOfTextAtSize(safe, size);
      page.drawText(safe, {
        x: cx - w / 2,
        y: cy - size * 0.35,
        size,
        font: boldFont,
        color,
      });
    }
  }
}

export async function exportAnnotatedPdf(
  pdfData: ArrayBuffer,
  annotationsByPage: Record<number, readonly AnnotationItem[]>,
): Promise<Uint8Array> {
  await loadPdfLib();
  const pdfLib = (globalThis as unknown as { PDFLib?: PdfLibExportGlobal }).PDFLib;
  if (!pdfLib) {
    throw new Error("PDF-eksport er ikke tilgjengelig.");
  }

  const doc = await pdfLib.PDFDocument.load(pdfData);
  const pages = doc.getPages();
  const helveticaBold = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
  const timesItalic = await doc.embedFont(pdfLib.StandardFonts.TimesRomanBoldItalic);

  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const items = annotationsByPage[pageNumber];
    if (!items || items.length === 0) continue;

    const pdfPage = pages[i]!;
    const { width, height } = pdfPage.getSize();
    const scaleFactor = Math.min(width, height) / ANNOTATION_VIEWBOX_SIZE;

    for (const item of items) {
      const { r, g, b } = parseHexColorToRgb(item.color);
      const color = pdfLib.rgb(r, g, b);

      if (item.kind === "pencil" || item.kind === "highlighter" || item.kind === "whiteout") {
        if (item.points.length === 0) continue;
        const thickness = Math.max(0.8, item.width * scaleFactor);
        if (item.points.length === 1) {
          const p0 = item.points[0]!;
          pdfPage.drawCircle({
            x: p0.x * width,
            y: (1 - p0.y) * height,
            size: thickness / 2,
            color,
            opacity: item.opacity,
          });
          continue;
        }
        for (let j = 1; j < item.points.length; j++) {
          const prev = item.points[j - 1]!;
          const curr = item.points[j]!;
          pdfPage.drawLine({
            start: { x: prev.x * width, y: (1 - prev.y) * height },
            end: { x: curr.x * width, y: (1 - curr.y) * height },
            thickness,
            color,
            opacity: item.opacity,
          });
        }
      } else if (item.kind === "stamp") {
        const cx = item.x * width;
        const cy = (1 - item.y) * height;
        const stampScale = (item.scale ?? 1) * scaleFactor;
        drawVectorStamp(pdfPage, item.stampId, cx, cy, stampScale, color, timesItalic, helveticaBold);
      } else if (item.kind === "text") {
        const size = Math.max(8, (item.fontSize ?? 18) * scaleFactor);
        const safeText = sanitizeWinAnsiText(item.text);
        if (!safeText) continue;
        pdfPage.drawText(safeText, {
          x: item.x * width,
          y: (1 - item.y) * height - size * 0.35,
          size,
          font: helveticaBold,
          color,
        });
      }
    }
  }

  return doc.save();
}
