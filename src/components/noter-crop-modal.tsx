import { Crop, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  FULL_PAGE_RECT,
  isFullPageRect,
  normalizeCropRect,
  resizeCropRect,
  type CropDragHandle,
  type NormalizedRect,
} from "@/lib/noter-crop";
import type { LoadedPdfDocument } from "@/lib/noter-pdf";

export type NoterCropModalProps = {
  open: boolean;
  onClose: () => void;
  doc: LoadedPdfDocument | null;
  pageNumber: number;
  pageCount: number;
  initialRect: NormalizedRect;
  onSave: (rect: NormalizedRect, applyToAllPages: boolean) => Promise<void> | void;
};

export function NoterCropModal({
  open,
  onClose,
  doc,
  pageNumber,
  pageCount,
  initialRect,
  onSave,
}: NoterCropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<NormalizedRect>(() => normalizeCropRect(initialRect));
  const [applyAll, setApplyAll] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);

  const dragRef = useRef<{
    handle: CropDragHandle;
    startClientX: number;
    startClientY: number;
    startRect: NormalizedRect;
    boxWidth: number;
    boxHeight: number;
    pointerId: number;
  } | null>(null);

  // Render the full uncropped page to the preview canvas
  useEffect(() => {
    if (!open || !doc || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;

    const renderPreview = async () => {
      try {
        const dims = await doc.getPageDimensions(pageNumber, 1);
        if (cancelled) return;
        const maxW = Math.min(540, Math.max(260, window.innerWidth - 48));
        const maxH = Math.min(560, Math.max(240, window.innerHeight - 250));
        const scale = Math.min(maxW / Math.max(1, dims.width), maxH / Math.max(1, dims.height));
        await doc.renderPage(pageNumber, canvas, Math.max(0.25, scale), {
          region: FULL_PAGE_RECT,
        });
        if (!cancelled) {
          setCanvasReady(true);
        }
      } catch {
        /* ignore render cancellation */
      }
    };

    void renderPreview();
    return () => {
      cancelled = true;
    };
  }, [open, doc, pageNumber]);

  if (!open) return null;

  const startDrag = (handle: CropDragHandle, e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;

    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: rect,
      boxWidth: box.width,
      boxHeight: box.height,
      pointerId: e.pointerId,
    };
  };

  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = (e.clientX - drag.startClientX) / drag.boxWidth;
    const dy = (e.clientY - drag.startClientY) / drag.boxHeight;
    setRect(resizeCropRect(drag.startRect, drag.handle, dx, dy));
  };

  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
  };

  const handleAutoDetect = async () => {
    if (!doc) return;
    setDetecting(true);
    try {
      const detected = await doc.detectPageCropRect(pageNumber);
      setRect(normalizeCropRect(detected));
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(rect, applyAll);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const leftPct = `${(rect.x * 100).toFixed(2)}%`;
  const topPct = `${(rect.y * 100).toFixed(2)}%`;
  const widthPct = `${(rect.width * 100).toFixed(2)}%`;
  const heightPct = `${(rect.height * 100).toFixed(2)}%`;
  const rightPct = `${((1 - (rect.x + rect.width)) * 100).toFixed(2)}%`;
  const bottomPct = `${((1 - (rect.y + rect.height)) * 100).toFixed(2)}%`;

  const isFull = isFullPageRect(rect);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Manuell beskjæring av side ${pageNumber}`}
      style={{ backgroundColor: "rgba(10, 13, 18, 0.85)" }}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      onClick={saving ? undefined : onClose}
    >
      <div
        style={{ backgroundColor: "rgba(22, 26, 34, 0.98)" }}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl border border-line shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Crop className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <h2 className="truncate text-sm font-bold text-fg sm:text-base">
                Manuell beskjæring · Side {pageNumber}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              Dra i hjørnene eller kantene for å fjerne støy og tomme marger.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Lukk manuell beskjæring"
            className="metro-press flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-fg disabled:opacity-40"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Quick presets */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!doc || detecting || saving}
              onClick={() => void handleAutoDetect()}
              className="metro-press flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-fg hover:border-accent disabled:opacity-40"
            >
              <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
              <span>{detecting ? "Analyserer…" : "Auto-forslag"}</span>
            </button>
            <button
              type="button"
              disabled={isFull || saving}
              onClick={() => setRect(FULL_PAGE_RECT)}
              className="metro-press flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-fg disabled:opacity-40"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              <span>Tilbakestill</span>
            </button>
          </div>

          <span className="text-xs font-medium tabular-nums text-muted">
            {Math.round(rect.width * 100)}% × {Math.round(rect.height * 100)}%
          </span>
        </div>

        {/* Interactive crop stage */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          <div
            ref={stageRef}
            data-testid="manual-crop-stage"
            className="relative inline-block select-none overflow-hidden rounded-md bg-white shadow-xl"
            style={{ touchAction: "none" }}
          >
            <canvas
              ref={canvasRef}
              className={canvasReady ? "block bg-white" : "block min-h-60 min-w-48 bg-white"}
            />

            {/* Darkened outside masks */}
            <div
              aria-hidden="true"
              style={{
                backgroundColor: "rgba(10, 13, 18, 0.62)",
                left: 0,
                top: 0,
                right: 0,
                height: topPct,
              }}
              className="pointer-events-none absolute"
            />
            <div
              aria-hidden="true"
              style={{
                backgroundColor: "rgba(10, 13, 18, 0.62)",
                left: 0,
                bottom: 0,
                right: 0,
                height: bottomPct,
              }}
              className="pointer-events-none absolute"
            />
            <div
              aria-hidden="true"
              style={{
                backgroundColor: "rgba(10, 13, 18, 0.62)",
                left: 0,
                top: topPct,
                width: leftPct,
                height: heightPct,
              }}
              className="pointer-events-none absolute"
            />
            <div
              aria-hidden="true"
              style={{
                backgroundColor: "rgba(10, 13, 18, 0.62)",
                right: 0,
                top: topPct,
                width: rightPct,
                height: heightPct,
              }}
              className="pointer-events-none absolute"
            />

            {/* Draggable crop frame */}
            <div
              style={{
                left: leftPct,
                top: topPct,
                width: widthPct,
                height: heightPct,
                touchAction: "none",
              }}
              className="absolute border-2 border-accent"
            >
              {/* Move interior */}
              <div
                role="presentation"
                onPointerDown={(e) => startDrag("move", e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ touchAction: "none" }}
                className="h-full w-full cursor-move"
              />

              {/* Edge handles */}
              <button
                type="button"
                aria-label="Juster toppkant"
                onPointerDown={(e) => startDrag("n", e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ touchAction: "none" }}
                className="absolute -top-3 left-1/2 flex h-6 w-12 -translate-x-1/2 cursor-ns-resize items-center justify-center"
              >
                <span className="h-1.5 w-8 rounded-full bg-accent shadow" />
              </button>
              <button
                type="button"
                aria-label="Juster bunnkant"
                onPointerDown={(e) => startDrag("s", e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ touchAction: "none" }}
                className="absolute -bottom-3 left-1/2 flex h-6 w-12 -translate-x-1/2 cursor-ns-resize items-center justify-center"
              >
                <span className="h-1.5 w-8 rounded-full bg-accent shadow" />
              </button>
              <button
                type="button"
                aria-label="Juster venstrekant"
                onPointerDown={(e) => startDrag("w", e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ touchAction: "none" }}
                className="absolute top-1/2 -left-3 flex h-12 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center"
              >
                <span className="h-8 w-1.5 rounded-full bg-accent shadow" />
              </button>
              <button
                type="button"
                aria-label="Juster høyrekant"
                onPointerDown={(e) => startDrag("e", e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ touchAction: "none" }}
                className="absolute top-1/2 -right-3 flex h-12 w-6 -translate-y-1/2 cursor-ew-resize items-center justify-center"
              >
                <span className="h-8 w-1.5 rounded-full bg-accent shadow" />
              </button>

              {/* Corner handles (large touch targets) */}
              <button
                type="button"
                aria-label="Juster øvre venstre hjørne"
                onPointerDown={(e) => startDrag("nw", e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ touchAction: "none" }}
                className="absolute -top-4 -left-4 flex size-8 cursor-nwse-resize items-center justify-center"
              >
                <span className="size-4 rounded-full border-2 border-[#1a1408] bg-accent shadow" />
              </button>
              <button
                type="button"
                aria-label="Juster øvre høyre hjørne"
                onPointerDown={(e) => startDrag("ne", e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ touchAction: "none" }}
                className="absolute -top-4 -right-4 flex size-8 cursor-nesw-resize items-center justify-center"
              >
                <span className="size-4 rounded-full border-2 border-[#1a1408] bg-accent shadow" />
              </button>
              <button
                type="button"
                aria-label="Juster nedre venstre hjørne"
                onPointerDown={(e) => startDrag("sw", e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ touchAction: "none" }}
                className="absolute -bottom-4 -left-4 flex size-8 cursor-nesw-resize items-center justify-center"
              >
                <span className="size-4 rounded-full border-2 border-[#1a1408] bg-accent shadow" />
              </button>
              <button
                type="button"
                aria-label="Juster nedre høyre hjørne"
                onPointerDown={(e) => startDrag("se", e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ touchAction: "none" }}
                className="absolute -right-4 -bottom-4 flex size-8 cursor-nwse-resize items-center justify-center"
              >
                <span className="size-4 rounded-full border-2 border-[#1a1408] bg-accent shadow" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          {pageCount > 1 ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-fg">
              <input
                type="checkbox"
                checked={applyAll}
                onChange={(e) => setApplyAll(e.target.checked)}
                className="size-4 accent-[#e0b15a]"
              />
              <span>Bruk på alle {pageCount} sider</span>
            </label>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="metro-press min-h-11 rounded-xl border border-line bg-surface px-3.5 text-xs font-semibold text-muted hover:text-fg disabled:opacity-40"
            >
              Avbryt
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="metro-press flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-bold text-[#1a1408] disabled:opacity-40"
            >
              <Crop className="size-4" aria-hidden="true" />
              <span>{saving ? "Lagrer…" : "Lagre beskjæring"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
