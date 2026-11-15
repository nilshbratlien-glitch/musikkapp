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
  | "zoom-reset";

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

export function mapKeyToViewerAction(key: string, isInputTarget: boolean): ViewerAction | null {
  if (isInputTarget) return null;

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
