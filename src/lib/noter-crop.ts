export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const FULL_PAGE_RECT: NormalizedRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function clampNormalizedRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const rawWidth = Number.isFinite(rect.width) ? Math.max(0, rect.width) : 0;
  const rawHeight = Number.isFinite(rect.height) ? Math.max(0, rect.height) : 0;
  const width = Math.min(1 - x, rawWidth);
  const height = Math.min(1 - y, rawHeight);
  return { x, y, width, height };
}

export function normalizeCropRect(rect?: NormalizedRect | null): NormalizedRect {
  if (!rect) return FULL_PAGE_RECT;
  const clamped = clampNormalizedRect(rect);
  if (clamped.width <= 0 || clamped.height <= 0) {
    return FULL_PAGE_RECT;
  }
  return clamped;
}

export function isFullPageRect(rect: NormalizedRect, epsilon = 1e-4): boolean {
  return (
    Math.abs(rect.x) <= epsilon &&
    Math.abs(rect.y) <= epsilon &&
    Math.abs(rect.width - 1) <= epsilon &&
    Math.abs(rect.height - 1) <= epsilon
  );
}

export type CropDetectionOptions = {
  whiteThreshold?: number;
  padding?: number;
  minContentFraction?: number;
};

export function detectCropRectFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: CropDetectionOptions,
): NormalizedRect {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return FULL_PAGE_RECT;
  }

  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0 || data.length < w * h * 4) {
    return FULL_PAGE_RECT;
  }

  const whiteThreshold = options?.whiteThreshold ?? 245;
  const padding = Math.max(0, options?.padding ?? 0.015);
  const minContentFraction = Math.max(0, options?.minContentFraction ?? 0.05);

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w * 4;
    for (let x = 0; x < w; x++) {
      const idx = rowOffset + x * 4;
      const a = data[idx + 3]!;
      if (a <= 10) continue;
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      if (r < whiteThreshold || g < whiteThreshold || b < whiteThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return FULL_PAGE_RECT;
  }

  const rawX = minX / w;
  const rawY = minY / h;
  const rawW = (maxX + 1 - minX) / w;
  const rawH = (maxY + 1 - minY) / h;

  if (rawW < minContentFraction || rawH < minContentFraction || rawW <= 0 || rawH <= 0) {
    return FULL_PAGE_RECT;
  }

  const x = Math.max(0, rawX - padding);
  const y = Math.max(0, rawY - padding);
  const right = Math.min(1, rawX + rawW + padding);
  const bottom = Math.min(1, rawY + rawH + padding);

  return clampNormalizedRect({
    x,
    y,
    width: right - x,
    height: bottom - y,
  });
}

export function getHalfPageRegions(region?: NormalizedRect): {
  top: NormalizedRect;
  bottom: NormalizedRect;
} {
  const r = normalizeCropRect(region);
  const halfHeight = r.height * 0.5;
  return {
    top: clampNormalizedRect({
      x: r.x,
      y: r.y,
      width: r.width,
      height: halfHeight,
    }),
    bottom: clampNormalizedRect({
      x: r.x,
      y: r.y + halfHeight,
      width: r.width,
      height: halfHeight,
    }),
  };
}

export const MIN_CROP_FRACTION = 0.1;

export type CropDragHandle = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e";

export function resizeCropRect(
  rect: NormalizedRect,
  handle: CropDragHandle,
  dx: number,
  dy: number,
  minFraction = MIN_CROP_FRACTION,
): NormalizedRect {
  const safeMin = Math.max(0.02, Math.min(0.5, minFraction));
  const base = normalizeCropRect(rect);
  const safeDx = Number.isFinite(dx) ? dx : 0;
  const safeDy = Number.isFinite(dy) ? dy : 0;

  if (handle === "move") {
    const nextX = Math.min(1 - base.width, Math.max(0, base.x + safeDx));
    const nextY = Math.min(1 - base.height, Math.max(0, base.y + safeDy));
    return clampNormalizedRect({
      x: nextX,
      y: nextY,
      width: base.width,
      height: base.height,
    });
  }

  let left = base.x;
  let top = base.y;
  let right = base.x + base.width;
  let bottom = base.y + base.height;

  if (handle.includes("w")) {
    left = Math.min(right - safeMin, Math.max(0, left + safeDx));
  }
  if (handle.includes("e")) {
    right = Math.max(left + safeMin, Math.min(1, right + safeDx));
  }
  if (handle.includes("n")) {
    top = Math.min(bottom - safeMin, Math.max(0, top + safeDy));
  }
  if (handle.includes("s")) {
    bottom = Math.max(top + safeMin, Math.min(1, bottom + safeDy));
  }

  return clampNormalizedRect({
    x: left,
    y: top,
    width: Math.max(safeMin, right - left),
    height: Math.max(safeMin, bottom - top),
  });
}

export function normalizeManualCropsMap(
  raw?: Record<number, NormalizedRect> | null,
): Record<number, NormalizedRect> {
  if (!raw || typeof raw !== "object") return {};
  const next: Record<number, NormalizedRect> = {};
  for (const [key, rect] of Object.entries(raw)) {
    const pageNum = Number.parseInt(key, 10);
    if (!Number.isFinite(pageNum) || pageNum < 1 || !rect) continue;
    const norm = normalizeCropRect(rect);
    if (!isFullPageRect(norm)) {
      next[pageNum] = norm;
    }
  }
  return next;
}

export function resolveEffectiveCropRect(
  page: number,
  autoCrop: boolean,
  manualCrops?: Record<number, NormalizedRect> | null,
  autoCropRects?: Record<number, NormalizedRect> | null,
): NormalizedRect {
  const manual = manualCrops?.[page];
  if (manual) {
    const norm = normalizeCropRect(manual);
    if (!isFullPageRect(norm)) {
      return norm;
    }
  }
  if (!autoCrop) return FULL_PAGE_RECT;
  return autoCropRects?.[page] ?? FULL_PAGE_RECT;
}

