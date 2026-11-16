import { normalizeCropRect, type NormalizedRect } from "./noter-crop.ts";

export type StampId =
  | "fermata"
  | "breath"
  | "glasses"
  | "caesura"
  | "accent"
  | "marcato"
  | "tenuto"
  | "staccato"
  | "sharp"
  | "flat"
  | "natural"
  | "coda"
  | "segno"
  | "check"
  | "star"
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "arrow-repeat"
  | "pp"
  | "p"
  | "mp"
  | "mf"
  | "f"
  | "ff"
  | "sfz"
  | "fp"
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "L"
  | "R";

export type AnnotationPoint = {
  x: number;
  y: number;
  p?: number;
};

export type StrokeAnnotation = {
  id: string;
  kind: "pencil" | "highlighter";
  color: string;
  width: number;
  opacity: number;
  points: AnnotationPoint[];
};

export type StampAnnotation = {
  id: string;
  kind: "stamp";
  stampId: StampId;
  x: number;
  y: number;
  color: string;
  scale?: number;
};

export type TextAnnotation = {
  id: string;
  kind: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize?: number;
};

export type AnnotationItem = StrokeAnnotation | StampAnnotation | TextAnnotation;

export const ANNOTATION_VIEWBOX_SIZE = 1000;

export const ANNOTATION_COLORS = [
  "#111827",
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
] as const;

export const HIGHLIGHTER_COLORS = [
  "#facc15",
  "#4ade80",
  "#60a5fa",
  "#f472b6",
] as const;

export const PENCIL_WIDTH_THIN = 2.5;
export const PENCIL_WIDTH_THICK = 5.5;
export const HIGHLIGHTER_WIDTH = 22;
export const HIGHLIGHTER_OPACITY = 0.35;
export const MAX_UNDO_HISTORY = 50;

export type StampDefinition = {
  id: StampId;
  label: string;
  glyph: string;
  category: "symbol" | "arrow" | "dynamic" | "fingering";
};

export const STAMP_DEFINITIONS: readonly StampDefinition[] = [
  { id: "fermata", label: "Fermate", glyph: "𝄐", category: "symbol" },
  { id: "breath", label: "Pustetegn", glyph: ",", category: "symbol" },
  { id: "glasses", label: "Briller (se opp)", glyph: "👓", category: "symbol" },
  { id: "caesura", label: "Caesura (//)", glyph: "//", category: "symbol" },
  { id: "accent", label: "Aksent (>)", glyph: ">", category: "symbol" },
  { id: "marcato", label: "Marcato (^)", glyph: "^", category: "symbol" },
  { id: "tenuto", label: "Tenuto (—)", glyph: "—", category: "symbol" },
  { id: "staccato", label: "Staccato (·)", glyph: "•", category: "symbol" },
  { id: "sharp", label: "Kryss (♯)", glyph: "♯", category: "symbol" },
  { id: "flat", label: "B (♭)", glyph: "♭", category: "symbol" },
  { id: "natural", label: "Oppløsningstegn (♮)", glyph: "♮", category: "symbol" },
  { id: "coda", label: "Coda", glyph: "⌖", category: "symbol" },
  { id: "segno", label: "Segno", glyph: "𝄋", category: "symbol" },
  { id: "check", label: "Sjekk / OK", glyph: "✓", category: "symbol" },
  { id: "star", label: "Viktig", glyph: "★", category: "symbol" },
  { id: "arrow-up", label: "Pil opp", glyph: "↑", category: "arrow" },
  { id: "arrow-down", label: "Pil ned", glyph: "↓", category: "arrow" },
  { id: "arrow-left", label: "Pil venstre", glyph: "←", category: "arrow" },
  { id: "arrow-right", label: "Pil høyre", glyph: "→", category: "arrow" },
  { id: "arrow-repeat", label: "Tilbake / Gjenta", glyph: "↩", category: "arrow" },
  { id: "pp", label: "Pianissimo", glyph: "pp", category: "dynamic" },
  { id: "p", label: "Piano", glyph: "p", category: "dynamic" },
  { id: "mp", label: "Mezzopiano", glyph: "mp", category: "dynamic" },
  { id: "mf", label: "Mezzoforte", glyph: "mf", category: "dynamic" },
  { id: "f", label: "Forte", glyph: "f", category: "dynamic" },
  { id: "ff", label: "Fortissimo", glyph: "ff", category: "dynamic" },
  { id: "sfz", label: "Sforzando", glyph: "sfz", category: "dynamic" },
  { id: "fp", label: "Fortepiano", glyph: "fp", category: "dynamic" },
  { id: "0", label: "Fingersetting 0", glyph: "0", category: "fingering" },
  { id: "1", label: "Fingersetting 1", glyph: "1", category: "fingering" },
  { id: "2", label: "Fingersetting 2", glyph: "2", category: "fingering" },
  { id: "3", label: "Fingersetting 3", glyph: "3", category: "fingering" },
  { id: "4", label: "Fingersetting 4", glyph: "4", category: "fingering" },
  { id: "5", label: "Fingersetting 5", glyph: "5", category: "fingering" },
  { id: "L", label: "Venstre hånd / kølle (L)", glyph: "L", category: "fingering" },
  { id: "R", label: "Høyre hånd / kølle (R)", glyph: "R", category: "fingering" },
] as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clientPointToNormalizedPage(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  region?: NormalizedRect,
): { x: number; y: number } {
  const r = normalizeCropRect(region);
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return { x: clamp01(r.x), y: clamp01(r.y) };
  }

  const localX = clamp01((clientX - rect.left) / rect.width);
  const localY = clamp01((clientY - rect.top) / rect.height);
  return {
    x: clamp01(r.x + localX * r.width),
    y: clamp01(r.y + localY * r.height),
  };
}

export function getAnnotationSvgViewBox(region?: NormalizedRect): string {
  const r = normalizeCropRect(region);
  const x = roundCoord(r.x * ANNOTATION_VIEWBOX_SIZE);
  const y = roundCoord(r.y * ANNOTATION_VIEWBOX_SIZE);
  const w = roundCoord(r.width * ANNOTATION_VIEWBOX_SIZE);
  const h = roundCoord(r.height * ANNOTATION_VIEWBOX_SIZE);
  return `${x} ${y} ${w} ${h}`;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

export function hitTestAnnotation(
  item: AnnotationItem,
  point: { x: number; y: number },
  radius = 0.025,
): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return false;
  }
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0.025;

  switch (item.kind) {
    case "pencil":
    case "highlighter": {
      const pts = item.points;
      if (pts.length === 0) return false;
      const strokeHalfWidth = (Math.max(1, item.width) / ANNOTATION_VIEWBOX_SIZE) * 0.5;
      const threshold = safeRadius + strokeHalfWidth;

      if (pts.length === 1) {
        const p0 = pts[0]!;
        return Math.hypot(point.x - p0.x, point.y - p0.y) <= threshold;
      }

      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (distanceToSegment(point.x, point.y, a.x, a.y, b.x, b.y) <= threshold) {
          return true;
        }
      }
      return false;
    }

    case "stamp": {
      const scale = Number.isFinite(item.scale) && (item.scale ?? 1) > 0 ? (item.scale ?? 1) : 1;
      const halfSize = 0.022 * scale + safeRadius;
      return Math.abs(point.x - item.x) <= halfSize && Math.abs(point.y - item.y) <= halfSize;
    }

    case "text": {
      const fontSize =
        Number.isFinite(item.fontSize) && (item.fontSize ?? 18) > 0 ? (item.fontSize ?? 18) : 18;
      const fontNorm = fontSize / ANNOTATION_VIEWBOX_SIZE;
      const textWidth = Math.max(0.04, item.text.length * fontNorm * 0.6);
      const halfH = Math.max(0.018, fontNorm * 0.75);
      return (
        point.x >= item.x - safeRadius &&
        point.x <= item.x + textWidth + safeRadius &&
        Math.abs(point.y - item.y) <= halfH + safeRadius
      );
    }
  }
}

export function eraseAnnotationsAtPoint(
  items: readonly AnnotationItem[],
  point: { x: number; y: number },
  radius?: number,
): AnnotationItem[] {
  return items.filter((item) => !hitTestAnnotation(item, point, radius));
}

export type AnnotationHistoryState = {
  undoStack: AnnotationItem[][];
  redoStack: AnnotationItem[][];
};

function cloneItem(item: AnnotationItem): AnnotationItem {
  if (item.kind === "pencil" || item.kind === "highlighter") {
    return {
      ...item,
      points: item.points.map((pt) => ({ ...pt })),
    };
  }
  return { ...item };
}

export function cloneAnnotationItems(items: readonly AnnotationItem[]): AnnotationItem[] {
  return items.map(cloneItem);
}

export function createAnnotationHistory(): AnnotationHistoryState {
  return {
    undoStack: [],
    redoStack: [],
  };
}

export function pushAnnotationHistory(
  history: AnnotationHistoryState,
  currentItems: readonly AnnotationItem[],
  maxSteps = MAX_UNDO_HISTORY,
): AnnotationHistoryState {
  const limit = Number.isFinite(maxSteps) && maxSteps >= 1 ? Math.floor(maxSteps) : MAX_UNDO_HISTORY;
  const nextUndo = [...history.undoStack, cloneAnnotationItems(currentItems)];
  if (nextUndo.length > limit) {
    nextUndo.splice(0, nextUndo.length - limit);
  }
  return {
    undoStack: nextUndo,
    redoStack: [],
  };
}

export function undoAnnotationHistory(
  history: AnnotationHistoryState,
  currentItems: readonly AnnotationItem[],
): { history: AnnotationHistoryState; items: AnnotationItem[]; changed: boolean } {
  if (history.undoStack.length === 0) {
    return {
      history,
      items: cloneAnnotationItems(currentItems),
      changed: false,
    };
  }
  const nextUndo = history.undoStack.slice(0, -1);
  const previous = history.undoStack[history.undoStack.length - 1]!;
  const nextRedo = [...history.redoStack, cloneAnnotationItems(currentItems)];
  return {
    history: {
      undoStack: nextUndo,
      redoStack: nextRedo,
    },
    items: cloneAnnotationItems(previous),
    changed: true,
  };
}

export function redoAnnotationHistory(
  history: AnnotationHistoryState,
  currentItems: readonly AnnotationItem[],
): { history: AnnotationHistoryState; items: AnnotationItem[]; changed: boolean } {
  if (history.redoStack.length === 0) {
    return {
      history,
      items: cloneAnnotationItems(currentItems),
      changed: false,
    };
  }
  const nextRedo = history.redoStack.slice(0, -1);
  const restored = history.redoStack[history.redoStack.length - 1]!;
  const nextUndo = [...history.undoStack, cloneAnnotationItems(currentItems)];
  return {
    history: {
      undoStack: nextUndo,
      redoStack: nextRedo,
    },
    items: cloneAnnotationItems(restored),
    changed: true,
  };
}
