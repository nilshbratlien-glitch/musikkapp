import { clampPage } from "./noter.ts";

export type ViewerAction =
  | "next"
  | "prev"
  | "first"
  | "last"
  | "close"
  | "toggle-metronome"
  | "toggle-night"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "undo"
  | "redo";

export type KeyModifiers = {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
};

export type HalfPagePosition = {
  page: number;
  halfOffset: 0 | 1;
};

const SWIPE_MIN_DX = 50;
const SWIPE_RATIO = 1.4;
const SWIPE_MAX_DT_MS = 900;

export function detectSwipeDirection(dx: number, dy: number, dtMs?: number): "next" | "prev" | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (dtMs !== undefined && (!Number.isFinite(dtMs) || dtMs < 0 || dtMs > SWIPE_MAX_DT_MS)) {
    return null;
  }
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < SWIPE_MIN_DX) return null;
  if (absX <= absY * SWIPE_RATIO) return null;
  return dx < 0 ? "next" : "prev";
}

export function mapKeyToViewerAction(
  key: string,
  isInputTarget: boolean,
  modifiers?: KeyModifiers,
): ViewerAction | null {
  if (isInputTarget) return null;

  if ((modifiers?.ctrlKey || modifiers?.metaKey) && !modifiers?.altKey) {
    const lower = key.toLowerCase();
    if (lower === "z") {
      return modifiers.shiftKey ? "redo" : "undo";
    }
    if (lower === "y" && !modifiers.shiftKey) {
      return "redo";
    }
    if (key === "+" || key === "=") {
      return "zoom-in";
    }
    if (key === "-") {
      return "zoom-out";
    }
    if (key === "0") {
      return "zoom-reset";
    }
    return null;
  }

  switch (key) {
    case "PageDown":
    case "ArrowRight":
    case "ArrowDown":
    case " ":
      return "next";
    case "PageUp":
    case "ArrowLeft":
    case "ArrowUp":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Escape":
      return "close";
    case "m":
    case "M":
      return "toggle-metronome";
    case "n":
    case "N":
      return "toggle-night";
    case "+":
    case "=":
      return "zoom-in";
    case "-":
      return "zoom-out";
    case "0":
      return "zoom-reset";
    default:
      return null;
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown };
  if (candidate.isContentEditable === true) return true;
  if (typeof candidate.tagName !== "string") return false;
  const tag = candidate.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function normalizeHalfPagePosition(
  pos: HalfPagePosition,
  pageCount: number,
  halfPageTurn: boolean,
): HalfPagePosition {
  const maxPage = Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : 1;
  const page = clampPage(pos.page, maxPage);
  if (!halfPageTurn || page >= maxPage) {
    return { page, halfOffset: 0 };
  }
  return {
    page,
    halfOffset: pos.halfOffset === 1 ? 1 : 0,
  };
}

export function stepPageForward(
  pos: HalfPagePosition,
  pageCount: number,
  halfPageTurn: boolean,
): HalfPagePosition {
  const maxPage = Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : 1;
  const current = normalizeHalfPagePosition(pos, maxPage, halfPageTurn);

  if (!halfPageTurn) {
    return { page: Math.min(maxPage, current.page + 1), halfOffset: 0 };
  }

  if (current.page >= maxPage) {
    return { page: maxPage, halfOffset: 0 };
  }

  if (current.halfOffset === 0) {
    return { page: current.page, halfOffset: 1 };
  }

  return { page: current.page + 1, halfOffset: 0 };
}

export function stepPageBackward(
  pos: HalfPagePosition,
  pageCount: number,
  halfPageTurn: boolean,
): HalfPagePosition {
  const maxPage = Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : 1;
  const current = normalizeHalfPagePosition(pos, maxPage, halfPageTurn);

  if (!halfPageTurn) {
    return { page: Math.max(1, current.page - 1), halfOffset: 0 };
  }

  if (current.halfOffset === 1) {
    return { page: current.page, halfOffset: 0 };
  }

  if (current.page <= 1) {
    return { page: 1, halfOffset: 0 };
  }

  return { page: current.page - 1, halfOffset: 1 };
}

export type StageTapZone = "prev" | "next" | "toggle-hud";

const EDGE_TAP_FRACTION = 0.25;

export function classifyStageTapZone(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
): StageTapZone {
  if (!Number.isFinite(clientX) || !Number.isFinite(rectLeft) || !Number.isFinite(rectWidth) || rectWidth <= 0) {
    return "toggle-hud";
  }
  const rel = (clientX - rectLeft) / rectWidth;
  if (rel < EDGE_TAP_FRACTION) return "prev";
  if (rel > 1 - EDGE_TAP_FRACTION) return "next";
  return "toggle-hud";
}

export function stepSpreadForward(page: number, pageCount: number): number {
  const maxPage = Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : 1;
  const current = clampPage(page, maxPage);
  return Math.min(maxPage, current + 2);
}

export function stepSpreadBackward(page: number): number {
  const current = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  return Math.max(1, current - 2);
}
