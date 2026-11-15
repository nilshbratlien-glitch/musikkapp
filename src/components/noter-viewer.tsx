import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_BPM, MIN_BPM, clampBpm, clampPage, clampZoom, type SheetRecord } from "@/lib/noter";
import type { UpdateSheetMetaPatch } from "@/lib/noter-db";
import { detectSwipeDirection, isEditableTarget, mapKeyToViewerAction } from "@/lib/noter-input";
import { loadPdfDocument, type LoadedPdfDocument } from "@/lib/noter-pdf";
import { getState, setBpm as setPulseBpm, start, stop, subscribe } from "@/lib/pulse";

export type NoterViewerProps = {
  sheet: SheetRecord;
  onClose: () => void;
  onUpdateMeta: (patch: UpdateSheetMetaPatch) => Promise<void> | void;
};

const NIGHT_FILTER = "invert(0.92) hue-rotate(180deg) contrast(1.08)";

export function NoterViewer({ sheet, onClose, onUpdateMeta }: NoterViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<LoadedPdfDocument | null>(null);
  const renderSeqRef = useRef(0);
  const onUpdateMetaRef = useRef(onUpdateMeta);
  onUpdateMetaRef.current = onUpdateMeta;
  const initialSheetMetaRef = useRef({
    id: sheet.id,
    pageCount: sheet.pageCount,
    lastPage: sheet.lastPage,
  });
  if (initialSheetMetaRef.current.id !== sheet.id) {
    initialSheetMetaRef.current = {
      id: sheet.id,
      pageCount: sheet.pageCount,
      lastPage: sheet.lastPage,
    };
  }

  const [docReady, setDocReady] = useState(false);
  const [pageCount, setPageCount] = useState(() => Math.max(1, sheet.pageCount || 1));
  const [page, setPage] = useState(() => clampPage(sheet.lastPage || 1, Math.max(1, sheet.pageCount || 1)));
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [baseScale, setBaseScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [nightMode, setNightMode] = useState(Boolean(sheet.nightMode));
  const [hudVisible, setHudVisible] = useState(true);
  const [metronomeOpen, setMetronomeOpen] = useState(false);
  const [bpm, setBpm] = useState(() => clampBpm(sheet.bpm));
  const [pulseState, setPulseState] = useState(() => getState());
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);

  const bpmSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBpmRef = useRef<number | null>(null);
  const tapTimesRef = useRef<number[]>([]);
  const pointerStartRef = useRef<{
    x: number;
    y: number;
    t: number;
    panX: number;
    panY: number;
    pointerId: number;
    moved: boolean;
  } | null>(null);

  const metroRunning = pulseState.running && pulseState.owner === "noter";

  // Check native fullscreen support on client
  useEffect(() => {
    const el = containerRef.current;
    const supported = Boolean(
      el && typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false,
    );
    setFullscreenSupported(supported);

    const onFsChange = () => {
      setIsNativeFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  // Subscribe to shared pulse state
  useEffect(() => {
    return subscribe(() => {
      setPulseState(getState());
    });
  }, []);

  // Stop noter metronome and flush pending BPM save on unmount/close
  useEffect(() => {
    return () => {
      if (bpmSaveTimerRef.current !== null) {
        clearTimeout(bpmSaveTimerRef.current);
        bpmSaveTimerRef.current = null;
      }
      if (pendingBpmRef.current !== null) {
        void onUpdateMetaRef.current({ bpm: pendingBpmRef.current });
        pendingBpmRef.current = null;
      }
      stop("noter");
    };
  }, []);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDocReady(false);

    loadPdfDocument(sheet.pdfData)
      .then((loaded) => {
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        docRef.current = loaded;
        const initialMeta = initialSheetMetaRef.current;
        const total = Math.max(1, loaded.numPages);
        setPageCount(total);
        const clampedInitial = clampPage(initialMeta.lastPage || 1, total);
        setPage(clampedInitial);
        setDocReady(true);
        setLoading(false);
        if (total !== initialMeta.pageCount || clampedInitial !== initialMeta.lastPage) {
          void onUpdateMetaRef.current({ pageCount: total, lastPage: clampedInitial });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : "Kunne ikke åpne PDF-filen.");
      });

    return () => {
      cancelled = true;
      const current = docRef.current;
      docRef.current = null;
      if (current) void current.destroy();
    };
  }, [sheet.id, sheet.pdfData]);

  // Measure viewport width to compute responsive base scale (A4/Letter ~612pt)
  useEffect(() => {
    const updateScale = () => {
      const el = viewportRef.current;
      if (!el) return;
      const availableWidth = Math.max(240, el.clientWidth - 24);
      const nextBase = Math.min(1.6, Math.max(0.5, availableWidth / 612));
      setBaseScale(nextBase);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Render current page whenever doc, page, zoom, or baseScale changes
  useEffect(() => {
    if (!docReady || !docRef.current || !canvasRef.current) return;
    const seq = ++renderSeqRef.current;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    setRendering(true);
    setError(null);

    doc
      .renderPage(page, canvas, baseScale * zoom)
      .then(() => {
        if (renderSeqRef.current === seq) {
          setRendering(false);
        }
      })
      .catch((err) => {
        if (renderSeqRef.current === seq) {
          setRendering(false);
          setError(err instanceof Error ? err.message : "Kunne ikke tegne PDF-siden.");
        }
      });
  }, [docReady, page, zoom, baseScale]);

  const goToPage = useCallback(
    (nextPage: number) => {
      const clamped = clampPage(nextPage, pageCount);
      setPage((prev) => {
        if (prev !== clamped) {
          setPan({ x: 0, y: 0 });
          void onUpdateMetaRef.current({ lastPage: clamped });
        }
        return clamped;
      });
    },
    [pageCount],
  );

  const toggleNightMode = useCallback(() => {
    setNightMode((prev) => {
      const next = !prev;
      void onUpdateMetaRef.current({ nightMode: next });
      return next;
    });
  }, []);

  const updateZoom = useCallback((nextZoom: number) => {
    const clamped = clampZoom(Number(nextZoom.toFixed(2)));
    setZoom(clamped);
    if (clamped <= 1) {
      setPan({ x: 0, y: 0 });
    }
  }, []);

  const updateBpmValue = useCallback(
    (rawBpm: number) => {
      const next = clampBpm(rawBpm);
      setBpm(next);
      if (getState().running && getState().owner === "noter") {
        setPulseBpm(next);
      }
      pendingBpmRef.current = next;
      if (bpmSaveTimerRef.current !== null) {
        clearTimeout(bpmSaveTimerRef.current);
      }
      bpmSaveTimerRef.current = setTimeout(() => {
        bpmSaveTimerRef.current = null;
        if (pendingBpmRef.current !== null) {
          const toSave = pendingBpmRef.current;
          pendingBpmRef.current = null;
          void onUpdateMetaRef.current({ bpm: toSave });
        }
      }, 350);
    },
    [],
  );

  const toggleMetronomePlayback = useCallback(() => {
    const current = getState();
    if (current.running && current.owner === "noter") {
      stop("noter");
      return;
    }
    start({ owner: "noter", bpm, beats: 4, sub: 1 });
  }, [bpm]);

  const handleTapTempo = useCallback(() => {
    const now = Date.now();
    const recent = tapTimesRef.current.filter((t) => now - t < 2000);
    recent.push(now);
    tapTimesRef.current = recent.slice(-6);
    if (recent.length >= 2) {
      let total = 0;
      for (let i = 1; i < recent.length; i++) {
        total += recent[i] - recent[i - 1];
      }
      const avgMs = total / (recent.length - 1);
      if (avgMs > 0) {
        updateBpmValue(60000 / avgMs);
      }
    }
  }, [updateBpmValue]);

  const toggleNativeFullscreen = useCallback(async () => {
    if (!fullscreenSupported) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerRef.current) {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      /* ignore fullscreen rejection on restricted browsers */
    }
  }, [fullscreenSupported]);

  const handleClose = useCallback(() => {
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    stop("noter");
    onClose();
  }, [onClose]);

  // Global keyboard & Bluetooth pedal listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = mapKeyToViewerAction(e.key, isEditableTarget(e.target));
      if (!action) return;

      if (
        e.key === "PageDown" ||
        e.key === "PageUp" ||
        e.key === " " ||
        e.key === "ArrowRight" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Home" ||
        e.key === "End"
      ) {
        e.preventDefault();
      }

      switch (action) {
        case "next":
          goToPage(page + 1);
          break;
        case "prev":
          goToPage(page - 1);
          break;
        case "first":
          goToPage(1);
          break;
        case "last":
          goToPage(pageCount);
          break;
        case "close":
          handleClose();
          break;
        case "toggle-metronome":
          toggleMetronomePlayback();
          break;
        case "toggle-night":
          toggleNightMode();
          break;
        case "zoom-in":
          updateZoom(zoom + 0.25);
          break;
        case "zoom-out":
          updateZoom(zoom - 0.25);
          break;
        case "zoom-reset":
          updateZoom(1);
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToPage, handleClose, page, pageCount, toggleMetronomePlayback, toggleNightMode, updateZoom, zoom]);

  // Ctrl/Cmd + wheel zoom (native non-passive listener so preventDefault stops browser zoom)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        updateZoom(zoomRef.current + delta);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [updateZoom]);

  // Pointer swipe (when zoom <= 1.05) and pan (when zoom > 1.05) + tap to toggle HUD
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore if pointer capture is unsupported */
    }
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      panX: pan.x,
      panY: pan.y,
      pointerId: e.pointerId,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const startInfo = pointerStartRef.current;
    if (!startInfo || startInfo.pointerId !== e.pointerId) return;
    const dx = e.clientX - startInfo.x;
    const dy = e.clientY - startInfo.y;
    if (Math.hypot(dx, dy) > 6) {
      startInfo.moved = true;
    }
    if (zoom > 1.05) {
      setPan({ x: startInfo.panX + dx, y: startInfo.panY + dy });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    const startInfo = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!startInfo || startInfo.pointerId !== e.pointerId) return;

    const dx = e.clientX - startInfo.x;
    const dy = e.clientY - startInfo.y;
    const dtMs = Date.now() - startInfo.t;

    if (zoom <= 1.05) {
      const swipe = detectSwipeDirection(dx, dy, dtMs);
      if (swipe === "next") {
        goToPage(page + 1);
        return;
      }
      if (swipe === "prev") {
        goToPage(page - 1);
        return;
      }
    }

    if (!startInfo.moved && Math.hypot(dx, dy) < 10 && dtMs < 350) {
      setHudVisible((v) => !v);
    }
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Noteviser: ${sheet.title}`}
      className="fixed inset-0 z-50 flex flex-col bg-[#0f1217] text-fg select-none"
    >
      {/* Top HUD */}
      {hudVisible ? (
        <header
          style={{ backgroundColor: "rgba(22, 26, 34, 0.95)" }}
          className="z-20 flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5 backdrop-blur-xs"
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Lukk noteviser"
              className="metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-fg"
            >
              <X className="size-4" aria-hidden="true" />
              <span>Lukk</span>
            </button>
            <h2 className="min-w-0 truncate text-sm font-semibold text-fg sm:text-base">{sheet.title}</h2>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={toggleNightMode}
              aria-pressed={nightMode}
              aria-label={nightMode ? "Slå av nattmodus" : "Slå på nattmodus"}
              style={nightMode ? { backgroundColor: "rgba(224, 177, 90, 0.15)" } : undefined}
              className={
                nightMode
                  ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2.5 text-xs font-semibold text-accent"
                  : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-fg"
              }
            >
              {nightMode ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
              <span className="hidden sm:inline">Natt</span>
            </button>

            {fullscreenSupported ? (
              <button
                type="button"
                onClick={() => void toggleNativeFullscreen()}
                aria-pressed={isNativeFullscreen}
                aria-label={isNativeFullscreen ? "Avslutt fullskjerm" : "Ekte fullskjerm"}
                className="metro-press flex min-h-10 items-center justify-center rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-fg"
              >
                {isNativeFullscreen ? (
                  <Minimize2 className="size-4" aria-hidden="true" />
                ) : (
                  <Maximize2 className="size-4" aria-hidden="true" />
                )}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setMetronomeOpen((o) => !o)}
              aria-expanded={metronomeOpen}
              aria-label="Hurtig-metronom"
              style={metroRunning ? { backgroundColor: "rgba(224, 177, 90, 0.15)" } : undefined}
              className={
                metroRunning
                  ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2.5 text-xs font-semibold text-accent"
                  : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-fg"
              }
            >
              <span
                aria-hidden="true"
                className={
                  metroRunning
                    ? "size-2.5 rounded-full bg-accent transition-transform duration-75"
                    : "size-2.5 rounded-full"
                }
                style={
                  metroRunning
                    ? pulseState.beat >= 0
                      ? { transform: pulseState.beat === 0 ? "scale(1.4)" : "scale(1.1)" }
                      : undefined
                    : { backgroundColor: "rgba(154, 163, 176, 0.6)" }
                }
              />
              <span className="tabular-nums">{bpm} BPM</span>
            </button>
          </div>
        </header>
      ) : null}

      {/* Compact Metronome Popover Bar */}
      {hudVisible && metronomeOpen ? (
        <div
          aria-label="Hurtig-metronom kontroller"
          className="z-20 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2.5"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMetronomePlayback}
              style={metroRunning ? undefined : { backgroundColor: "rgba(224, 177, 90, 0.15)" }}
              className={
                metroRunning
                  ? "metro-press flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-bold text-[#1a1408]"
                  : "metro-press flex min-h-11 items-center gap-1.5 rounded-lg border border-accent px-3.5 text-sm font-semibold text-accent"
              }
            >
              {metroRunning ? (
                <>
                  <Pause className="size-4" aria-hidden="true" />
                  <span>Stopp</span>
                </>
              ) : (
                <>
                  <Play className="size-4" aria-hidden="true" />
                  <span>Start</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-1 rounded-lg border border-line bg-header px-1 py-0.5">
              <button
                type="button"
                onClick={() => updateBpmValue(bpm - 1)}
                aria-label="Reduser BPM"
                className="metro-press flex min-h-11 min-w-11 items-center justify-center rounded-md text-fg hover:bg-surface"
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <input
                type="number"
                min={MIN_BPM}
                max={MAX_BPM}
                value={bpm}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isNaN(val)) updateBpmValue(val);
                }}
                aria-label="BPM-verdi"
                className="w-14 bg-transparent text-center text-sm font-bold text-fg tabular-nums focus:outline-none"
              />
              <button
                type="button"
                onClick={() => updateBpmValue(bpm + 1)}
                aria-label="Øk BPM"
                className="metro-press flex min-h-11 min-w-11 items-center justify-center rounded-md text-fg hover:bg-surface"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center gap-2 sm:max-w-xs">
            <input
              type="range"
              min={MIN_BPM}
              max={MAX_BPM}
              value={bpm}
              onChange={(e) => updateBpmValue(Number(e.target.value))}
              aria-label="BPM-skyveknapp"
              className="h-2 w-full accent-[#e0b15a]"
            />
            <button
              type="button"
              onClick={handleTapTempo}
              className="metro-press min-h-11 min-w-11 shrink-0 rounded-lg border border-line bg-header px-3 text-xs font-semibold text-fg hover:border-accent"
            >
              Tap
            </button>
          </div>
        </div>
      ) : null}

      {/* Main PDF Canvas Viewport */}
      <div
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(e) => {
          if (pointerStartRef.current?.pointerId === e.pointerId) {
            pointerStartRef.current = null;
          }
        }}
        style={{ touchAction: "none" }}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#0f1217] p-2"
      >
        {loading ? (
          <div className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-muted">
            Laster noteark …
          </div>
        ) : null}

        {error ? (
          <div
            style={{ borderColor: "rgba(192, 72, 63, 0.5)" }}
            className="max-w-md rounded-xl border bg-surface px-5 py-4 text-center"
          >
            <p className="text-sm font-semibold text-no">{error}</p>
            <button
              type="button"
              onClick={handleClose}
              className="metro-press mt-3 min-h-11 rounded-lg border border-line bg-header px-4 text-sm font-semibold text-fg"
            >
              Tilbake til biblioteket
            </button>
          </div>
        ) : null}

        <div
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
            cursor: zoom > 1.05 ? "grab" : "default",
          }}
          className={loading || error ? "hidden" : "flex items-center justify-center"}
        >
          <canvas
            ref={canvasRef}
            style={{ filter: nightMode ? NIGHT_FILTER : undefined }}
            className="rounded-sm bg-white shadow-2xl"
          />
        </div>

        {rendering && !loading && !error ? (
          <div
            style={{ backgroundColor: "rgba(22, 26, 34, 0.9)" }}
            className="pointer-events-none absolute top-3 right-3 rounded-full border border-line px-3 py-1 text-xs text-muted"
          >
            Tegner side …
          </div>
        ) : null}
      </div>

      {/* Bottom HUD */}
      {hudVisible ? (
        <footer
          style={{ backgroundColor: "rgba(22, 26, 34, 0.95)" }}
          className="z-20 flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-xs"
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              aria-label="Forrige side"
              className="metro-press flex min-h-10 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-sm font-semibold text-fg disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Forrige</span>
            </button>
            <span className="min-w-20 text-center text-xs font-semibold text-muted tabular-nums sm:text-sm">
              Side {page} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={page >= pageCount}
              aria-label="Neste side"
              className="metro-press flex min-h-10 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-sm font-semibold text-fg disabled:opacity-40"
            >
              <span className="hidden sm:inline">Neste</span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => updateZoom(zoom - 0.25)}
              disabled={zoom <= 0.5}
              aria-label="Zoom ut"
              className="metro-press flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-fg disabled:opacity-40"
            >
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => updateZoom(1)}
              aria-label="Tilbakestill zoom"
              className="metro-press flex min-h-10 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-fg tabular-nums"
            >
              <RotateCcw className="size-3.5 text-muted" aria-hidden="true" />
              <span>{Math.round(zoom * 100)}%</span>
            </button>
            <button
              type="button"
              onClick={() => updateZoom(zoom + 0.25)}
              disabled={zoom >= 3}
              aria-label="Zoom inn"
              className="metro-press flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-fg disabled:opacity-40"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
