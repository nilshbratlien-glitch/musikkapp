import {
  ChevronLeft,
  ChevronRight,
  Crop,
  LayoutGrid,
  ListMusic,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  PanelTop,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sun,
  Undo2,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NoterAnnotationLayer,
  type AnnotationTool,
  type PencilThickness,
  type WhiteoutSize,
} from "@/components/noter-annotation-layer";
import { NoterCropModal } from "@/components/noter-crop-modal";
import { NoterNavDrawer, type NavDrawerTab } from "@/components/noter-nav-drawer";
import { NoterPageTrimModal } from "@/components/noter-page-trim-modal";
import { NoterToolbar } from "@/components/noter-toolbar";
import {
  MAX_BPM,
  MIN_BPM,
  clampBpm,
  clampPage,
  clampZoom,
  type JumpLink,
  type SetlistRecord,
  type SheetBookmark,
  type SheetMeta,
  type SheetRecord,
} from "@/lib/noter";
import {
  ANNOTATION_COLORS,
  HIGHLIGHTER_COLORS,
  PENCIL_WIDTH_THICK,
  PENCIL_WIDTH_THIN,
  WHITEOUT_WIDTH_LARGE,
  WHITEOUT_WIDTH_MEDIUM,
  WHITEOUT_WIDTH_SMALL,
  cloneAnnotationItems,
  createAnnotationHistory,
  sampleCanvasBackgroundColor,
  pushAnnotationHistory,
  redoAnnotationHistory,
  undoAnnotationHistory,
  type AnnotationHistoryState,
  type AnnotationItem,
  type StampId,
} from "@/lib/noter-annotations";
import {
  FULL_PAGE_RECT,
  getHalfPageRegions,
  isFullPageRect,
  normalizeManualCropsMap,
  resolveEffectiveCropRect,
  type NormalizedRect,
} from "@/lib/noter-crop";
import {
  getPageAnnotations,
  replaceSheetWithTrimmedPdf,
  savePageAnnotations,
  saveTrimmedSheetAsCopy,
  type UpdateSheetMetaPatch,
} from "@/lib/noter-db";
import {
  detectSwipeDirection,
  isEditableTarget,
  mapKeyToViewerAction,
  normalizeHalfPagePosition,
  stepPageBackward,
  stepPageForward,
  type HalfPagePosition,
} from "@/lib/noter-input";
import {
  loadPdfDocument,
  type LoadedPdfDocument,
  type PageDimensions,
} from "@/lib/noter-pdf";
import {
  getSetlistBoundaryStep,
  popJumpHistory,
  pushJumpHistory,
} from "@/lib/noter-setlists";
import {
  REFERENCE_A4_OPTIONS,
  REFERENCE_NOTES,
  startReferenceTone,
  stopReferenceTone,
  type ReferenceNoteId,
} from "@/lib/noter-tuner";
import { getState, setBpm as setPulseBpm, start, stop, subscribe } from "@/lib/pulse";

export type ViewerSetlistContext = {
  setlist: SetlistRecord;
  sheets: SheetMeta[];
  activeIndex: number;
  onSelectSheetIndex: (index: number, initialPage?: number) => void;
};

export type NoterViewerProps = {
  sheet: SheetRecord;
  initialPage?: number;
  setlistContext?: ViewerSetlistContext | null;
  onClose: () => void;
  onUpdateMeta: (patch: UpdateSheetMetaPatch) => Promise<void> | void;
  onSheetReplaced?: (updated: SheetRecord) => void;
  onSheetCopied?: (created: SheetRecord) => void;
};

function createItemId(prefix: string): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const NIGHT_FILTER = "invert(0.92) hue-rotate(180deg) contrast(1.08)";
const DEFAULT_PAGE_DIMS: PageDimensions = { width: 612, height: 792 };

export function NoterViewer({
  sheet,
  initialPage,
  setlistContext = null,
  onClose,
  onUpdateMeta,
  onSheetReplaced,
  onSheetCopied,
}: NoterViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const topCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bottomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<LoadedPdfDocument | null>(null);
  const renderSeqRef = useRef(0);
  const onUpdateMetaRef = useRef(onUpdateMeta);
  onUpdateMetaRef.current = onUpdateMeta;
  const startPage = initialPage ?? (sheet.lastPage || 1);
  const initialSheetMetaRef = useRef({
    id: sheet.id,
    pageCount: sheet.pageCount,
    lastPage: startPage,
  });
  if (initialSheetMetaRef.current.id !== sheet.id) {
    initialSheetMetaRef.current = {
      id: sheet.id,
      pageCount: sheet.pageCount,
      lastPage: startPage,
    };
  }

  const [docReady, setDocReady] = useState(false);
  const [loadedDoc, setLoadedDoc] = useState<LoadedPdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(() => Math.max(1, sheet.pageCount || 1));
  const [halfPageTurn, setHalfPageTurn] = useState(() => Boolean(sheet.halfPageTurn));
  const [autoCrop, setAutoCrop] = useState(() => Boolean(sheet.autoCrop));
  const [annotationsVisible, setAnnotationsVisible] = useState(
    () => sheet.annotationsVisible ?? true,
  );
  const [position, setPosition] = useState<HalfPagePosition>(() =>
    normalizeHalfPagePosition(
      {
        page: clampPage(startPage, Math.max(1, sheet.pageCount || 1)),
        halfOffset: 0,
      },
      Math.max(1, sheet.pageCount || 1),
      Boolean(sheet.halfPageTurn),
    ),
  );
  const positionRef = useRef(position);
  positionRef.current = position;

  const page = position.page;
  const halfOffset = position.halfOffset;
  const isSplitView = halfPageTurn && halfOffset === 1 && page < pageCount;

  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 800,
    height: 900,
  });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [nightMode, setNightMode] = useState(() => Boolean(sheet.nightMode));
  const [hudVisible, setHudVisible] = useState(true);
  const [metronomeOpen, setMetronomeOpen] = useState(false);
  const [bpm, setBpm] = useState(() => clampBpm(sheet.bpm));
  const [pulseState, setPulseState] = useState(() => getState());
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);

  // Fase 3 navigation drawer, jump history, and reference tone state
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [navDrawerTab, setNavDrawerTab] = useState<NavDrawerTab>("pages");
  const [trimModalOpen, setTrimModalOpen] = useState(false);
  const [jumpHistory, setJumpHistory] = useState<number[]>([]);
  const [tunerNote, setTunerNote] = useState<ReferenceNoteId | null>(null);
  const [tunerA4, setTunerA4] = useState<440 | 442>(440);

  // Fase 2 annotation & crop state
  const [tool, setTool] = useState<AnnotationTool>("view");
  const [pencilColor, setPencilColor] = useState<string>(ANNOTATION_COLORS[1]);
  const [pencilThickness, setPencilThickness] = useState<PencilThickness>("thin");
  const [highlighterColor, setHighlighterColor] = useState<string>(HIGHLIGHTER_COLORS[0]);
  const [whiteoutSize, setWhiteoutSize] = useState<WhiteoutSize>("medium");
  const [pageBackgroundColor, setPageBackgroundColor] = useState<string>("#ffffff");
  const [activeStampId, setActiveStampId] = useState<StampId>("fermata");
  const [stylusOnly, setStylusOnly] = useState(false);

  const [annotationsByPage, setAnnotationsByPage] = useState<Record<number, AnnotationItem[]>>({});
  const annotationsRef = useRef(annotationsByPage);
  annotationsRef.current = annotationsByPage;

  const [historyByPage, setHistoryByPage] = useState<Record<number, AnnotationHistoryState>>({});
  const historyByPageRef = useRef(historyByPage);
  historyByPageRef.current = historyByPage;

  const loadedPagesRef = useRef<Set<number>>(new Set());
  const [lastEditedPage, setLastEditedPage] = useState<number>(() =>
    clampPage(startPage, Math.max(1, sheet.pageCount || 1)),
  );

  const [cropRects, setCropRects] = useState<Record<number, NormalizedRect>>({});
  const [manualCrops, setManualCrops] = useState<Record<number, NormalizedRect>>(() =>
    normalizeManualCropsMap(sheet.manualCrops),
  );
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [pageDims, setPageDims] = useState<Record<number, PageDimensions>>({});
  const [singleCanvasSize, setSingleCanvasSize] = useState<PageDimensions>({ width: 0, height: 0 });
  const [topCanvasSize, setTopCanvasSize] = useState<PageDimensions>({ width: 0, height: 0 });
  const [bottomCanvasSize, setBottomCanvasSize] = useState<PageDimensions>({ width: 0, height: 0 });

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

  const latestSheetRef = useRef(sheet);
  latestSheetRef.current = sheet;
  const activeSheetIdRef = useRef(sheet.id);
  activeSheetIdRef.current = sheet.id;
  const unmountedRef = useRef(false);
  const prevSheetIdRef = useRef(sheet.id);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      stopReferenceTone();
    };
  }, []);

  // Reset per-sheet caches if sheet.id changes while mounted
  useEffect(() => {
    if (prevSheetIdRef.current === sheet.id) return;
    prevSheetIdRef.current = sheet.id;
    const s = latestSheetRef.current;
    loadedPagesRef.current.clear();
    setAnnotationsByPage({});
    setHistoryByPage({});
    setCropRects({});
    setManualCrops(normalizeManualCropsMap(s.manualCrops));
    setCropModalOpen(false);
    setPageDims({});
    setSingleCanvasSize({ width: 0, height: 0 });
    setTopCanvasSize({ width: 0, height: 0 });
    setBottomCanvasSize({ width: 0, height: 0 });
    setAutoCrop(Boolean(s.autoCrop));
    setHalfPageTurn(Boolean(s.halfPageTurn));
    setAnnotationsVisible(s.annotationsVisible ?? true);
    setNightMode(Boolean(s.nightMode));
    setBpm(clampBpm(s.bpm));
    setTool("view");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setJumpHistory([]);
    setNavDrawerOpen(false);
    const total = Math.max(1, s.pageCount || 1);
    setPageCount(total);
    const targetStartPage = initialPage ?? (s.lastPage || 1);
    const initialPos = normalizeHalfPagePosition(
      { page: clampPage(targetStartPage, total), halfOffset: 0 },
      total,
      Boolean(s.halfPageTurn),
    );
    setPosition(initialPos);
    setLastEditedPage(initialPos.page);
  }, [sheet.id, initialPage]);

  // Clear in-progress viewport swipe/pan tracking whenever switching to an annotation tool
  useEffect(() => {
    if (tool !== "view") {
      pointerStartRef.current = null;
    }
  }, [tool]);

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
        setPosition((prev) => ({
          page: clampedInitial,
          halfOffset: clampedInitial >= total ? 0 : prev.halfOffset,
        }));
        setLoadedDoc(loaded);
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
      setLoadedDoc(null);
      if (current) void current.destroy();
    };
  }, [sheet.id, sheet.pdfData]);

  // Load per-page annotations from IndexedDB
  useEffect(() => {
    const targetSheetId = sheet.id;
    const pagesToLoad = [page];
    if (halfPageTurn && page < pageCount) {
      pagesToLoad.push(page + 1);
    }

    for (const p of pagesToLoad) {
      if (loadedPagesRef.current.has(p)) continue;
      loadedPagesRef.current.add(p);
      void getPageAnnotations(targetSheetId, p)
        .then((items) => {
          if (unmountedRef.current || activeSheetIdRef.current !== targetSheetId) return;
          setAnnotationsByPage((prev) => (prev[p] !== undefined ? prev : { ...prev, [p]: items }));
        })
        .catch(() => {
          if (!unmountedRef.current && activeSheetIdRef.current === targetSheetId) {
            loadedPagesRef.current.delete(p);
          }
        });
    }
  }, [sheet.id, page, pageCount, halfPageTurn]);

  // Measure viewport dimensions for responsive fit-to-viewport scaling
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateSize = () => {
      const nextW = el.clientWidth;
      const nextH = el.clientHeight;
      if (nextW > 0 && nextH > 0) {
        setViewportSize((prev) =>
          prev.width === nextW && prev.height === nextH
            ? prev
            : { width: nextW, height: nextH },
        );
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(updateSize);
      observer.observe(el);
    }
    return () => {
      window.removeEventListener("resize", updateSize);
      observer?.disconnect();
    };
  }, []);

  // Load page dimensions & auto-crop bounds for active/preloaded pages
  useEffect(() => {
    if (!docReady || !docRef.current) return;
    let cancelled = false;
    const doc = docRef.current;

    const pagesToInspect = new Set<number>([page]);
    if ((isSplitView || halfPageTurn) && page < pageCount) {
      pagesToInspect.add(page + 1);
    }

    for (const p of pagesToInspect) {
      if (!pageDims[p]) {
        void doc
          .getPageDimensions(p, 1)
          .then((dims) => {
            if (!cancelled && dims.width > 0 && dims.height > 0) {
              setPageDims((prev) => (prev[p] ? prev : { ...prev, [p]: dims }));
            }
          })
          .catch(() => {
            /* ignore dimension probe error */
          });
      }
      if (autoCrop && !cropRects[p]) {
        void doc
          .detectPageCropRect(p)
          .then((rect) => {
            if (!cancelled) {
              setCropRects((prev) => (prev[p] ? prev : { ...prev, [p]: rect }));
            }
          })
          .catch(() => {
            /* fallback to FULL_PAGE_RECT */
          });
      }
    }

    return () => {
      cancelled = true;
    };
  }, [docReady, page, pageCount, autoCrop, halfPageTurn, isSplitView, pageDims, cropRects]);

  const singleRegion = useMemo<NormalizedRect>(() => {
    return resolveEffectiveCropRect(page, autoCrop, manualCrops, cropRects);
  }, [autoCrop, manualCrops, cropRects, page]);

  const topRegion = useMemo<NormalizedRect>(() => {
    if (!isSplitView) return FULL_PAGE_RECT;
    const base = resolveEffectiveCropRect(page + 1, autoCrop, manualCrops, cropRects);
    return getHalfPageRegions(base).top;
  }, [isSplitView, autoCrop, manualCrops, cropRects, page]);

  const bottomRegion = useMemo<NormalizedRect>(() => {
    if (!isSplitView) return FULL_PAGE_RECT;
    const base = resolveEffectiveCropRect(page, autoCrop, manualCrops, cropRects);
    return getHalfPageRegions(base).bottom;
  }, [isSplitView, autoCrop, manualCrops, cropRects, page]);

  const baseScale = useMemo(() => {
    const availableWidth = Math.max(240, viewportSize.width - 24);
    const availableHeight = Math.max(200, viewportSize.height - 24);

    if (!isSplitView) {
      const dims = pageDims[page] ?? DEFAULT_PAGE_DIMS;
      const effW = Math.max(1, dims.width * singleRegion.width);
      const effH = Math.max(1, dims.height * singleRegion.height);
      const widthScale = availableWidth / effW;
      const heightScale = availableHeight / effH;
      return Math.min(2.4, Math.max(0.5, Math.min(widthScale, heightScale)));
    }

    const topDims = pageDims[page + 1] ?? DEFAULT_PAGE_DIMS;
    const bottomDims = pageDims[page] ?? DEFAULT_PAGE_DIMS;
    const paneAvailableHeight = Math.max(120, (availableHeight - 36) * 0.5);

    const widthScaleTop = availableWidth / Math.max(1, topDims.width * topRegion.width);
    const heightScaleTop = paneAvailableHeight / Math.max(1, topDims.height * topRegion.height);
    const widthScaleBottom = availableWidth / Math.max(1, bottomDims.width * bottomRegion.width);
    const heightScaleBottom =
      paneAvailableHeight / Math.max(1, bottomDims.height * bottomRegion.height);

    return Math.min(
      2.4,
      Math.max(0.5, Math.min(widthScaleTop, heightScaleTop, widthScaleBottom, heightScaleBottom)),
    );
  }, [viewportSize, isSplitView, pageDims, page, singleRegion, topRegion, bottomRegion]);

  // Render active page(s) whenever doc, position, regions, zoom, or baseScale changes
  useEffect(() => {
    if (!docReady || !docRef.current) return;
    const doc = docRef.current;
    const scale = baseScale * zoom;
    const controller = new AbortController();
    const seq = ++renderSeqRef.current;

    if (isSplitView) {
      const topCanvas = topCanvasRef.current;
      const bottomCanvas = bottomCanvasRef.current;
      if (!topCanvas || !bottomCanvas) return;

      setRendering(true);
      setError(null);

      Promise.all([
        doc.renderPage(page + 1, topCanvas, scale, {
          region: topRegion,
          signal: controller.signal,
        }),
        doc.renderPage(page, bottomCanvas, scale, {
          region: bottomRegion,
          signal: controller.signal,
        }),
      ])
        .then(([topSize, bottomSize]) => {
          if (controller.signal.aborted || renderSeqRef.current !== seq) return;
          if (topSize.width > 0 && topSize.height > 0) setTopCanvasSize(topSize);
          if (bottomSize.width > 0 && bottomSize.height > 0) setBottomCanvasSize(bottomSize);
          setPageBackgroundColor(sampleCanvasBackgroundColor(bottomCanvas));
          setRendering(false);
        })
        .catch((err) => {
          if (controller.signal.aborted || renderSeqRef.current !== seq) return;
          setRendering(false);
          setError(err instanceof Error ? err.message : "Kunne ikke tegne PDF-siden.");
        });
    } else {
      const canvas = canvasRef.current;
      if (!canvas) return;

      setRendering(true);
      setError(null);

      doc
        .renderPage(page, canvas, scale, {
          region: singleRegion,
          signal: controller.signal,
        })
        .then((size) => {
          if (controller.signal.aborted || renderSeqRef.current !== seq) return;
          if (size.width > 0 && size.height > 0) setSingleCanvasSize(size);
          setPageBackgroundColor(sampleCanvasBackgroundColor(canvas));
          setRendering(false);
        })
        .catch((err) => {
          if (controller.signal.aborted || renderSeqRef.current !== seq) return;
          setRendering(false);
          setError(err instanceof Error ? err.message : "Kunne ikke tegne PDF-siden.");
        });
    }

    return () => {
      controller.abort();
    };
  }, [docReady, isSplitView, page, zoom, baseScale, singleRegion, topRegion, bottomRegion]);

  const goToPage = useCallback(
    (nextPage: number) => {
      const prev = positionRef.current;
      const clamped = clampPage(nextPage, pageCount);
      const next: HalfPagePosition = { page: clamped, halfOffset: 0 };
      if (next.page !== prev.page || next.halfOffset !== prev.halfOffset) {
        setPosition(next);
        setPan({ x: 0, y: 0 });
        if (next.page !== prev.page) {
          void onUpdateMetaRef.current({ lastPage: next.page });
        }
      }
    },
    [pageCount],
  );

  const stepForward = useCallback(() => {
    const prev = positionRef.current;
    const next = stepPageForward(prev, pageCount, halfPageTurn);
    if (next.page !== prev.page || next.halfOffset !== prev.halfOffset) {
      setPosition(next);
      setPan({ x: 0, y: 0 });
      if (next.page !== prev.page) {
        void onUpdateMetaRef.current({ lastPage: next.page });
      }
      return;
    }
    if (setlistContext) {
      const step = getSetlistBoundaryStep(
        setlistContext.sheets.map((s) => s.pageCount || 1),
        setlistContext.activeIndex,
        "next",
      );
      if (step) {
        setlistContext.onSelectSheetIndex(step.sheetIndex, step.page);
      }
    }
  }, [pageCount, halfPageTurn, setlistContext]);

  const stepBackward = useCallback(() => {
    const prev = positionRef.current;
    const next = stepPageBackward(prev, pageCount, halfPageTurn);
    if (next.page !== prev.page || next.halfOffset !== prev.halfOffset) {
      setPosition(next);
      setPan({ x: 0, y: 0 });
      if (next.page !== prev.page) {
        void onUpdateMetaRef.current({ lastPage: next.page });
      }
      return;
    }
    if (setlistContext) {
      const step = getSetlistBoundaryStep(
        setlistContext.sheets.map((s) => s.pageCount || 1),
        setlistContext.activeIndex,
        "prev",
      );
      if (step) {
        setlistContext.onSelectSheetIndex(step.sheetIndex, step.page);
      }
    }
  }, [pageCount, halfPageTurn, setlistContext]);

  const toggleNightMode = useCallback(() => {
    setNightMode((prev) => {
      const next = !prev;
      void onUpdateMetaRef.current({ nightMode: next });
      return next;
    });
  }, []);

  const toggleAutoCrop = useCallback(() => {
    setAutoCrop((prev) => {
      const next = !prev;
      void onUpdateMetaRef.current({ autoCrop: next });
      return next;
    });
  }, []);

  const toggleHalfPageTurn = useCallback(() => {
    setHalfPageTurn((prev) => {
      const next = !prev;
      void onUpdateMetaRef.current({ halfPageTurn: next });
      if (!next) {
        setPosition((current) => normalizeHalfPagePosition(current, pageCount, false));
      }
      return next;
    });
  }, [pageCount]);

  const toggleAnnotationsVisible = useCallback(() => {
    setAnnotationsVisible((prev) => {
      const next = !prev;
      void onUpdateMetaRef.current({ annotationsVisible: next });
      return next;
    });
  }, []);

  const handleSelectTool = useCallback(
    (nextTool: AnnotationTool) => {
      setTool(nextTool);
      if (nextTool !== "view" && !annotationsVisible) {
        setAnnotationsVisible(true);
        void onUpdateMetaRef.current({ annotationsVisible: true });
      }
    },
    [annotationsVisible],
  );

  const handleCommitItems = useCallback(
    (targetPage: number, nextItems: AnnotationItem[]) => {
      const currentItems = annotationsRef.current[targetPage] ?? [];
      const currentHistory = historyByPageRef.current[targetPage] ?? createAnnotationHistory();
      const nextHistory = pushAnnotationHistory(currentHistory, currentItems);
      const cloned = cloneAnnotationItems(nextItems);

      setHistoryByPage((prev) => ({ ...prev, [targetPage]: nextHistory }));
      setAnnotationsByPage((prev) => ({ ...prev, [targetPage]: cloned }));
      setLastEditedPage(targetPage);
      void savePageAnnotations(sheet.id, targetPage, cloned).catch(() => {});
    },
    [sheet.id],
  );

  const primaryPanePage = isSplitView && lastEditedPage === page + 1 ? page + 1 : page;
  const secondaryPanePage = isSplitView ? (primaryPanePage === page ? page + 1 : page) : null;

  const undoTargetPage =
    (historyByPage[primaryPanePage]?.undoStack.length ?? 0) > 0
      ? primaryPanePage
      : secondaryPanePage !== null &&
          (historyByPage[secondaryPanePage]?.undoStack.length ?? 0) > 0
        ? secondaryPanePage
        : primaryPanePage;

  const redoTargetPage =
    (historyByPage[primaryPanePage]?.redoStack.length ?? 0) > 0
      ? primaryPanePage
      : secondaryPanePage !== null &&
          (historyByPage[secondaryPanePage]?.redoStack.length ?? 0) > 0
        ? secondaryPanePage
        : primaryPanePage;

  const canUndo = (historyByPage[undoTargetPage]?.undoStack.length ?? 0) > 0;
  const canRedo = (historyByPage[redoTargetPage]?.redoStack.length ?? 0) > 0;

  const handleUndo = useCallback(() => {
    const targetPage = undoTargetPage;
    const currentHistory = historyByPageRef.current[targetPage] ?? createAnnotationHistory();
    const currentItems = annotationsRef.current[targetPage] ?? [];
    const res = undoAnnotationHistory(currentHistory, currentItems);
    if (!res.changed) return;

    setHistoryByPage((prev) => ({ ...prev, [targetPage]: res.history }));
    setAnnotationsByPage((prev) => ({ ...prev, [targetPage]: res.items }));
    setLastEditedPage(targetPage);
    void savePageAnnotations(sheet.id, targetPage, res.items).catch(() => {});
  }, [undoTargetPage, sheet.id]);

  const handleRedo = useCallback(() => {
    const targetPage = redoTargetPage;
    const currentHistory = historyByPageRef.current[targetPage] ?? createAnnotationHistory();
    const currentItems = annotationsRef.current[targetPage] ?? [];
    const res = redoAnnotationHistory(currentHistory, currentItems);
    if (!res.changed) return;

    setHistoryByPage((prev) => ({ ...prev, [targetPage]: res.history }));
    setAnnotationsByPage((prev) => ({ ...prev, [targetPage]: res.items }));
    setLastEditedPage(targetPage);
    void savePageAnnotations(sheet.id, targetPage, res.items).catch(() => {});
  }, [redoTargetPage, sheet.id]);

  const updateZoom = useCallback((nextZoom: number) => {
    const clamped = clampZoom(Number(nextZoom.toFixed(2)));
    setZoom(clamped);
    if (clamped <= 1) {
      setPan({ x: 0, y: 0 });
    }
  }, []);

  const updateBpmValue = useCallback((rawBpm: number) => {
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
  }, []);

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
        total += recent[i]! - recent[i - 1]!;
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
    stopReferenceTone();
    setTunerNote(null);
    onClose();
  }, [onClose]);

  const openNavDrawer = useCallback((tab: NavDrawerTab) => {
    setNavDrawerTab(tab);
    setNavDrawerOpen(true);
  }, []);

  const handleAddBookmark = useCallback((targetPage: number, label: string) => {
    const existing = latestSheetRef.current.bookmarks ?? [];
    const nextBookmark: SheetBookmark = {
      id: createItemId("bm"),
      page: clampPage(targetPage, pageCount),
      label: label.trim() || `Side ${targetPage}`,
      createdAt: Date.now(),
    };
    void onUpdateMetaRef.current({ bookmarks: [...existing, nextBookmark] });
  }, [pageCount]);

  const handleDeleteBookmark = useCallback((id: string) => {
    const existing = latestSheetRef.current.bookmarks ?? [];
    void onUpdateMetaRef.current({ bookmarks: existing.filter((b) => b.id !== id) });
  }, []);

  const handleAddJumpLink = useCallback(
    (link: Omit<JumpLink, "id">) => {
      const existing = latestSheetRef.current.jumpLinks ?? [];
      const nextLink: JumpLink = {
        ...link,
        id: createItemId("jump"),
        targetPage: clampPage(link.targetPage, pageCount),
      };
      void onUpdateMetaRef.current({ jumpLinks: [...existing, nextLink] });
    },
    [pageCount],
  );

  const handleDeleteJumpLink = useCallback((id: string) => {
    const existing = latestSheetRef.current.jumpLinks ?? [];
    void onUpdateMetaRef.current({ jumpLinks: existing.filter((l) => l.id !== id) });
  }, []);

  const handleUpdateJumpLink = useCallback((id: string, patch: { x: number; y: number }) => {
    const existing = latestSheetRef.current.jumpLinks ?? [];
    void onUpdateMetaRef.current({
      jumpLinks: existing.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  }, []);

  const handleViewDragActiveChange = useCallback((active: boolean) => {
    if (active) {
      pointerStartRef.current = null;
    }
  }, []);

  const handleActivateJumpLink = useCallback(
    (link: JumpLink) => {
      const fromPage = positionRef.current.page;
      setJumpHistory((prev) => pushJumpHistory(prev, fromPage));
      goToPage(link.targetPage);
    },
    [goToPage],
  );

  const handleJumpBack = useCallback(() => {
    const res = popJumpHistory(jumpHistory);
    setJumpHistory(res.history);
    if (res.targetPage !== null) {
      goToPage(res.targetPage);
    }
  }, [jumpHistory, goToPage]);

  const toggleTunerNote = useCallback(
    (note: ReferenceNoteId) => {
      if (tunerNote === note) {
        stopReferenceTone();
        setTunerNote(null);
        return;
      }
      if (startReferenceTone(note, tunerA4)) {
        setTunerNote(note);
      }
    },
    [tunerNote, tunerA4],
  );

  const changeTunerA4 = useCallback(
    (nextA4: 440 | 442) => {
      setTunerA4(nextA4);
      if (tunerNote) {
        startReferenceTone(tunerNote, nextA4);
      }
    },
    [tunerNote],
  );

  const handleStopTuner = useCallback(() => {
    stopReferenceTone();
    setTunerNote(null);
  }, []);

  // Global keyboard & Bluetooth pedal listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = mapKeyToViewerAction(e.key, isEditableTarget(e.target), {
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
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
          stepForward();
          break;
        case "prev":
          stepBackward();
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
        case "undo":
          e.preventDefault();
          handleUndo();
          break;
        case "redo":
          e.preventDefault();
          handleRedo();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    goToPage,
    handleClose,
    handleRedo,
    handleUndo,
    pageCount,
    stepBackward,
    stepForward,
    toggleMetronomePlayback,
    toggleNightMode,
    updateZoom,
    zoom,
  ]);

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
    if (tool !== "view") return;
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
    if (tool !== "view") return;
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
    if (tool !== "view") return;
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
        stepForward();
        return;
      }
      if (swipe === "prev") {
        stepBackward();
        return;
      }
    }

    if (!startInfo.moved && Math.hypot(dx, dy) < 10 && dtMs < 350) {
      setHudVisible((v) => !v);
    }
  };

  const activePencilWidth =
    pencilThickness === "thick" ? PENCIL_WIDTH_THICK : PENCIL_WIDTH_THIN;
  const activeWhiteoutWidth =
    whiteoutSize === "small"
      ? WHITEOUT_WIDTH_SMALL
      : whiteoutSize === "large"
        ? WHITEOUT_WIDTH_LARGE
        : WHITEOUT_WIDTH_MEDIUM;
  const hasPrevInSetlist = Boolean(setlistContext && setlistContext.activeIndex > 0);
  const hasNextInSetlist = Boolean(
    setlistContext && setlistContext.activeIndex < setlistContext.sheets.length - 1,
  );
  const previousJumpPage = jumpHistory.length > 0 ? jumpHistory[jumpHistory.length - 1]! : null;

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
          className="z-20 flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b border-line px-3 py-2.5 backdrop-blur-xs"
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Lukk noteviser"
              className="metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-sm font-semibold text-fg sm:px-3"
            >
              <X className="size-4" aria-hidden="true" />
              <span>Lukk</span>
            </button>
            <h2 className="min-w-0 truncate text-sm font-semibold text-fg sm:text-base">
              {sheet.title}
            </h2>
            {setlistContext ? (
              <span
                style={{ backgroundColor: "rgba(224, 177, 90, 0.14)" }}
                className="shrink-0 rounded-full border border-accent px-2 py-0.5 text-[11px] font-bold text-accent tabular-nums"
              >
                {setlistContext.activeIndex + 1}/{setlistContext.sheets.length}
              </span>
            ) : null}
            {previousJumpPage !== null ? (
              <button
                type="button"
                onClick={handleJumpBack}
                aria-label={`Tilbake til side ${previousJumpPage}`}
                style={{ backgroundColor: "rgba(224, 177, 90, 0.15)" }}
                className="metro-press flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-accent px-2 text-xs font-bold text-accent"
              >
                <Undo2 className="size-3.5" aria-hidden="true" />
                <span>Tilbake (s. {previousJumpPage})</span>
              </button>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={() => openNavDrawer("pages")}
              aria-label="Sideoversikt og bokmerker"
              title="Sideoversikt og bokmerker"
              className="metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-muted hover:text-fg sm:px-2.5"
            >
              <LayoutGrid className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden md:inline">Sider</span>
            </button>

            {setlistContext ? (
              <button
                type="button"
                onClick={() => openNavDrawer("setlist")}
                aria-label="Åpne settliste"
                title="Åpne settliste"
                style={{ backgroundColor: "rgba(224, 177, 90, 0.12)" }}
                className="metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2 text-xs font-semibold text-accent sm:px-2.5"
              >
                <ListMusic className="size-4 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">Settliste</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={toggleAutoCrop}
              aria-pressed={autoCrop}
              aria-label={autoCrop ? "Slå av auto-beskjæring" : "Slå på auto-beskjæring"}
              title={autoCrop ? "Slå av auto-beskjæring" : "Slå på auto-beskjæring"}
              style={autoCrop ? { backgroundColor: "rgba(224, 177, 90, 0.15)" } : undefined}
              className={
                autoCrop
                  ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2 text-xs font-semibold text-accent sm:px-2.5"
                  : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-muted hover:text-fg sm:px-2.5"
              }
            >
              <Crop className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Beskjær</span>
            </button>

            <button
              type="button"
              onClick={() => setCropModalOpen(true)}
              aria-label="Manuell beskjæring"
              title="Manuell beskjæring av denne siden"
              style={
                manualCrops[page] ? { backgroundColor: "rgba(224, 177, 90, 0.15)" } : undefined
              }
              className={
                manualCrops[page]
                  ? "metro-press flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg border border-accent px-2 text-xs font-semibold text-accent"
                  : "metro-press flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-muted hover:text-fg"
              }
            >
              <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={toggleHalfPageTurn}
              aria-pressed={halfPageTurn}
              aria-label={halfPageTurn ? "Slå av halvside-vending" : "Slå på halvside-vending"}
              title={halfPageTurn ? "Slå av halvside-vending" : "Slå på halvside-vending"}
              style={halfPageTurn ? { backgroundColor: "rgba(224, 177, 90, 0.15)" } : undefined}
              className={
                halfPageTurn
                  ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2 text-xs font-semibold text-accent sm:px-2.5"
                  : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-muted hover:text-fg sm:px-2.5"
              }
            >
              <PanelTop className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Halvside</span>
            </button>

            <button
              type="button"
              onClick={toggleNightMode}
              aria-pressed={nightMode}
              aria-label={nightMode ? "Slå av nattmodus" : "Slå på nattmodus"}
              style={nightMode ? { backgroundColor: "rgba(224, 177, 90, 0.15)" } : undefined}
              className={
                nightMode
                  ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2 text-xs font-semibold text-accent sm:px-2.5"
                  : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-muted hover:text-fg sm:px-2.5"
              }
            >
              {nightMode ? (
                <Sun className="size-4" aria-hidden="true" />
              ) : (
                <Moon className="size-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Natt</span>
            </button>

            {fullscreenSupported ? (
              <button
                type="button"
                onClick={() => void toggleNativeFullscreen()}
                aria-pressed={isNativeFullscreen}
                aria-label={isNativeFullscreen ? "Avslutt fullskjerm" : "Ekte fullskjerm"}
                className="metro-press flex min-h-10 items-center justify-center rounded-lg border border-line bg-surface px-2 text-xs font-medium text-muted hover:text-fg sm:px-2.5"
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
              aria-label="Hurtig-metronom og stemmegaffel"
              style={
                metroRunning || tunerNote !== null
                  ? { backgroundColor: "rgba(224, 177, 90, 0.15)" }
                  : undefined
              }
              className={
                metroRunning || tunerNote !== null
                  ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-2 text-xs font-semibold text-accent sm:px-2.5"
                  : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-xs font-semibold text-fg sm:px-2.5"
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

      {/* Annotation & Stage Toolbar */}
      {hudVisible ? (
        <NoterToolbar
          tool={tool}
          onSelectTool={handleSelectTool}
          pencilColor={pencilColor}
          onSelectPencilColor={setPencilColor}
          pencilThickness={pencilThickness}
          onSelectPencilThickness={setPencilThickness}
          highlighterColor={highlighterColor}
          onSelectHighlighterColor={setHighlighterColor}
          whiteoutSize={whiteoutSize}
          onSelectWhiteoutSize={setWhiteoutSize}
          whiteoutColor={pageBackgroundColor}
          activeStampId={activeStampId}
          onSelectStampId={setActiveStampId}
          stylusOnly={stylusOnly}
          onToggleStylusOnly={() => setStylusOnly((s) => !s)}
          annotationsVisible={annotationsVisible}
          onToggleAnnotationsVisible={toggleAnnotationsVisible}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
      ) : null}

      {/* Compact Metronome & Reference Tone Popover Bar */}
      {hudVisible && metronomeOpen ? (
        <div
          aria-label="Hurtig-metronom kontroller"
          className="z-20 flex shrink-0 flex-col gap-2 border-b border-line bg-surface px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
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

          {/* Referansetone (stemmegaffel) */}
          <div
            aria-label="Referansetone"
            className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2"
          >
            <div className="flex items-center gap-1.5">
              <Volume2 className="size-4 text-accent" aria-hidden="true" />
              <span className="text-xs font-semibold text-muted">Referansetone</span>
              <div className="flex items-center rounded-lg border border-line bg-header p-0.5">
                {REFERENCE_A4_OPTIONS.map((hz) => (
                  <button
                    key={hz}
                    type="button"
                    onClick={() => changeTunerA4(hz)}
                    aria-pressed={tunerA4 === hz}
                    style={
                      tunerA4 === hz
                        ? { backgroundColor: "rgba(224, 177, 90, 0.18)" }
                        : undefined
                    }
                    className={
                      tunerA4 === hz
                        ? "metro-press min-h-8 rounded-md px-2 text-xs font-bold text-accent tabular-nums"
                        : "metro-press min-h-8 rounded-md px-2 text-xs font-medium text-muted hover:text-fg tabular-nums"
                    }
                  >
                    {hz} Hz
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {REFERENCE_NOTES.map((note) => {
                const active = tunerNote === note.id;
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => toggleTunerNote(note.id)}
                    aria-pressed={active}
                    aria-label={`Referansetone ${note.label}`}
                    style={
                      active ? { backgroundColor: "rgba(224, 177, 90, 0.2)" } : undefined
                    }
                    className={
                      active
                        ? "metro-press min-h-10 min-w-10 rounded-lg border border-accent px-3 text-sm font-bold text-accent"
                        : "metro-press min-h-10 min-w-10 rounded-lg border border-line bg-header px-3 text-sm font-semibold text-fg hover:border-accent"
                    }
                  >
                    {note.label}
                  </button>
                );
              })}

              {tunerNote ? (
                <button
                  type="button"
                  onClick={handleStopTuner}
                  className="metro-press min-h-10 rounded-lg border border-line bg-header px-2.5 text-xs font-semibold text-muted hover:text-fg"
                >
                  Stopp tone
                </button>
              ) : null}
            </div>
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
            cursor: tool !== "view" ? "crosshair" : zoom > 1.05 ? "grab" : "default",
          }}
          className={loading || error ? "hidden" : "flex items-center justify-center"}
        >
          {isSplitView ? (
            <div className="flex flex-col items-center">
              <div className="relative inline-block">
                <canvas
                  ref={topCanvasRef}
                  style={{ filter: nightMode ? NIGHT_FILTER : undefined }}
                  className="block rounded-t-sm bg-white shadow-2xl"
                />
                <NoterAnnotationLayer
                  pageNumber={page + 1}
                  pageCount={pageCount}
                  items={annotationsByPage[page + 1] ?? []}
                  visible={annotationsVisible}
                  region={topRegion}
                  width={topCanvasSize.width}
                  height={topCanvasSize.height}
                  tool={tool}
                  pencilColor={pencilColor}
                  pencilWidth={activePencilWidth}
                  highlighterColor={highlighterColor}
                  whiteoutColor={pageBackgroundColor}
                  whiteoutWidth={activeWhiteoutWidth}
                  nightFilter={nightMode ? NIGHT_FILTER : undefined}
                  activeStampId={activeStampId}
                  stylusOnly={stylusOnly}
                  onCommitItems={handleCommitItems}
                  jumpLinks={sheet.jumpLinks ?? []}
                  onAddJumpLink={handleAddJumpLink}
                  onUpdateJumpLink={handleUpdateJumpLink}
                  onDeleteJumpLink={handleDeleteJumpLink}
                  onActivateJumpLink={handleActivateJumpLink}
                  onViewDragActiveChange={handleViewDragActiveChange}
                />
              </div>

              <div
                style={{ backgroundColor: "rgba(22, 26, 34, 0.92)" }}
                className="pointer-events-none flex w-full items-center justify-between border-y-2 border-accent px-2.5 py-1 text-[11px] font-semibold text-accent"
              >
                <span>Side {page + 1} (øverst)</span>
                <span>Side {page} (nederst)</span>
              </div>

              <div className="relative inline-block">
                <canvas
                  ref={bottomCanvasRef}
                  style={{ filter: nightMode ? NIGHT_FILTER : undefined }}
                  className="block rounded-b-sm bg-white shadow-2xl"
                />
                <NoterAnnotationLayer
                  pageNumber={page}
                  pageCount={pageCount}
                  items={annotationsByPage[page] ?? []}
                  visible={annotationsVisible}
                  region={bottomRegion}
                  width={bottomCanvasSize.width}
                  height={bottomCanvasSize.height}
                  tool={tool}
                  pencilColor={pencilColor}
                  pencilWidth={activePencilWidth}
                  highlighterColor={highlighterColor}
                  whiteoutColor={pageBackgroundColor}
                  whiteoutWidth={activeWhiteoutWidth}
                  nightFilter={nightMode ? NIGHT_FILTER : undefined}
                  activeStampId={activeStampId}
                  stylusOnly={stylusOnly}
                  onCommitItems={handleCommitItems}
                  jumpLinks={sheet.jumpLinks ?? []}
                  onAddJumpLink={handleAddJumpLink}
                  onUpdateJumpLink={handleUpdateJumpLink}
                  onDeleteJumpLink={handleDeleteJumpLink}
                  onActivateJumpLink={handleActivateJumpLink}
                  onViewDragActiveChange={handleViewDragActiveChange}
                />
              </div>
            </div>
          ) : (
            <div className="relative inline-block">
              <canvas
                ref={canvasRef}
                style={{ filter: nightMode ? NIGHT_FILTER : undefined }}
                className="block rounded-sm bg-white shadow-2xl"
              />
              <NoterAnnotationLayer
                pageNumber={page}
                pageCount={pageCount}
                items={annotationsByPage[page] ?? []}
                visible={annotationsVisible}
                region={singleRegion}
                width={singleCanvasSize.width}
                height={singleCanvasSize.height}
                tool={tool}
                pencilColor={pencilColor}
                pencilWidth={activePencilWidth}
                highlighterColor={highlighterColor}
                whiteoutColor={pageBackgroundColor}
                whiteoutWidth={activeWhiteoutWidth}
                nightFilter={nightMode ? NIGHT_FILTER : undefined}
                activeStampId={activeStampId}
                stylusOnly={stylusOnly}
                onCommitItems={handleCommitItems}
                jumpLinks={sheet.jumpLinks ?? []}
                onAddJumpLink={handleAddJumpLink}
                onUpdateJumpLink={handleUpdateJumpLink}
                onDeleteJumpLink={handleDeleteJumpLink}
                onActivateJumpLink={handleActivateJumpLink}
                onViewDragActiveChange={handleViewDragActiveChange}
              />
            </div>
          )}
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
              onClick={stepBackward}
              disabled={page <= 1 && halfOffset === 0 && !hasPrevInSetlist}
              aria-label="Forrige side"
              className="metro-press flex min-h-10 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-sm font-semibold text-fg disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Forrige</span>
            </button>
            <button
              type="button"
              onClick={() => openNavDrawer("pages")}
              aria-label="Åpne sideoversikt"
              className="metro-press min-h-10 min-w-20 rounded-lg border border-line bg-surface px-2.5 text-center text-xs font-semibold text-fg hover:border-accent tabular-nums sm:text-sm"
            >
              {isSplitView ? `Side ${page}–${page + 1} / ${pageCount}` : `Side ${page} / ${pageCount}`}
            </button>
            <button
              type="button"
              onClick={stepForward}
              disabled={page >= pageCount && halfOffset === 0 && !hasNextInSetlist}
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

      {navDrawerOpen ? (
        <NoterNavDrawer
          open={navDrawerOpen}
          initialTab={navDrawerTab}
          onClose={() => setNavDrawerOpen(false)}
          doc={loadedDoc}
          pageCount={pageCount}
          currentPage={page}
          onSelectPage={goToPage}
          onOpenTrimModal={() => setTrimModalOpen(true)}
          bookmarks={sheet.bookmarks ?? []}
          onAddBookmark={handleAddBookmark}
          onDeleteBookmark={handleDeleteBookmark}
          setlistContext={
            setlistContext
              ? {
                  setlist: setlistContext.setlist,
                  sheets: setlistContext.sheets,
                  activeIndex: setlistContext.activeIndex,
                  onSelectSheetIndex: (idx) => setlistContext.onSelectSheetIndex(idx, 1),
                }
              : null
          }
        />
      ) : null}

      {trimModalOpen ? (
        <NoterPageTrimModal
          open={trimModalOpen}
          onClose={() => setTrimModalOpen(false)}
          sheetTitle={sheet.title}
          pdfData={sheet.pdfData}
          pageCount={pageCount}
          existingDoc={loadedDoc}
          onReplacePages={async (keptPages, trimmedPdfData) => {
            const updated = await replaceSheetWithTrimmedPdf({
              sheetId: sheet.id,
              pdfData: trimmedPdfData,
              keptPages,
            });
            if (!updated) return;
            loadedPagesRef.current.clear();
            setAnnotationsByPage({});
            setHistoryByPage({});
            setCropRects({});
            setManualCrops(normalizeManualCropsMap(updated.manualCrops));
            setPageDims({});
            setJumpHistory([]);
            setPageCount(updated.pageCount);
            const nextPos = normalizeHalfPagePosition(
              { page: clampPage(updated.lastPage, updated.pageCount), halfOffset: 0 },
              updated.pageCount,
              halfPageTurn,
            );
            setPosition(nextPos);
            setLastEditedPage(nextPos.page);
            onSheetReplaced?.(updated);
          }}
          onSaveAsCopy={async (keptPages, trimmedPdfData, copyTitle) => {
            const created = await saveTrimmedSheetAsCopy({
              sourceSheetId: sheet.id,
              title: copyTitle,
              pdfData: trimmedPdfData,
              keptPages,
            });
            onSheetCopied?.(created);
          }}
        />
      ) : null}

      {cropModalOpen ? (
        <NoterCropModal
          open={cropModalOpen}
          onClose={() => setCropModalOpen(false)}
          doc={loadedDoc}
          pageNumber={page}
          pageCount={pageCount}
          initialRect={resolveEffectiveCropRect(page, autoCrop, manualCrops, cropRects)}
          onSave={async (nextRect, applyToAllPages) => {
            const nextMap = { ...manualCrops };
            if (applyToAllPages) {
              for (let p = 1; p <= pageCount; p += 1) {
                if (isFullPageRect(nextRect)) {
                  delete nextMap[p];
                } else {
                  nextMap[p] = nextRect;
                }
              }
            } else if (isFullPageRect(nextRect)) {
              delete nextMap[page];
            } else {
              nextMap[page] = nextRect;
            }
            const normalized = normalizeManualCropsMap(nextMap);
            setManualCrops(normalized);
            await onUpdateMetaRef.current({ manualCrops: normalized });
          }}
        />
      ) : null}
    </div>
  );
}
