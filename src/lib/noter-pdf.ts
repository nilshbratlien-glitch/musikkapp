import {
  FULL_PAGE_RECT,
  detectCropRectFromPixels,
  isFullPageRect,
  normalizeCropRect,
  type NormalizedRect,
} from "./noter-crop.ts";

const PDFJS_VERSION = "3.11.174";
const PDFJS_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
const MAX_OFFSCREEN_CACHE = 4;
const CROP_SCAN_SCALE = 0.75;

type PdfViewport = {
  width: number;
  height: number;
};

type PdfRenderTask = {
  promise: Promise<void>;
  cancel?: () => void;
};

type PdfPageProxy = {
  getViewport: (params: { scale: number }) => PdfViewport;
  render: (params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => PdfRenderTask;
};

type PdfDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  destroy: () => Promise<void>;
};

type PdfJsLib = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (src: { data: ArrayBuffer }) => {
    promise: Promise<PdfDocumentProxy>;
  };
};

export type RenderPageOptions = {
  region?: NormalizedRect;
  signal?: AbortSignal;
};

export type PageDimensions = {
  width: number;
  height: number;
};

export type SliceMetrics = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  destWidth: number;
  destHeight: number;
  cssWidth: number;
  cssHeight: number;
};

export type LoadedPdfDocument = {
  numPages: number;
  renderPage: (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number,
    options?: RenderPageOptions,
  ) => Promise<PageDimensions>;
  detectPageCropRect: (pageNumber: number) => Promise<NormalizedRect>;
  getPageDimensions: (pageNumber: number, scale: number) => Promise<PageDimensions>;
  renderThumbnail: (pageNumber: number, maxWidth?: number) => Promise<string>;
  destroy: () => Promise<void>;
};

export function buildRenderKey(pageNumber: number, scale: number, dpr: number): string {
  const safePage = Number.isFinite(pageNumber) ? Math.max(1, Math.floor(pageNumber)) : 1;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return `${safePage}@${safeScale.toFixed(4)}@${safeDpr.toFixed(2)}`;
}

export function computeSliceMetrics(
  fullCssWidth: number,
  fullCssHeight: number,
  fullPixelWidth: number,
  fullPixelHeight: number,
  region: NormalizedRect,
): SliceMetrics {
  const norm = normalizeCropRect(region);
  const safeFullCssW = Number.isFinite(fullCssWidth) && fullCssWidth > 0 ? Math.floor(fullCssWidth) : 1;
  const safeFullCssH = Number.isFinite(fullCssHeight) && fullCssHeight > 0 ? Math.floor(fullCssHeight) : 1;
  const safeFullPxW = Number.isFinite(fullPixelWidth) && fullPixelWidth > 0 ? Math.floor(fullPixelWidth) : 1;
  const safeFullPxH = Number.isFinite(fullPixelHeight) && fullPixelHeight > 0 ? Math.floor(fullPixelHeight) : 1;

  const cssWidth = Math.max(1, Math.floor(safeFullCssW * norm.width));
  const cssHeight = Math.max(1, Math.floor(safeFullCssH * norm.height));

  const sx = Math.min(safeFullPxW - 1, Math.max(0, Math.floor(norm.x * safeFullPxW)));
  const sy = Math.min(safeFullPxH - 1, Math.max(0, Math.floor(norm.y * safeFullPxH)));
  const sw = Math.min(Math.max(1, safeFullPxW - sx), Math.max(1, Math.floor(norm.width * safeFullPxW)));
  const sh = Math.min(Math.max(1, safeFullPxH - sy), Math.max(1, Math.floor(norm.height * safeFullPxH)));

  return {
    sx,
    sy,
    sw,
    sh,
    destWidth: sw,
    destHeight: sh,
    cssWidth,
    cssHeight,
  };
}

let pdfjsPromise: Promise<PdfJsLib> | null = null;
let workerBlobUrl: string | null = null;
let workerSrcPromise: Promise<string> | null = null;
let activeDocCount = 0;

function revokeWorkerBlobUrlIfIdle(): void {
  if (activeDocCount === 0 && workerBlobUrl) {
    URL.revokeObjectURL(workerBlobUrl);
    workerBlobUrl = null;
  }
}

function getPdfJsGlobal(): PdfJsLib | undefined {
  return (globalThis as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib;
}

function isCancelledError(err: unknown): boolean {
  return err instanceof Error && err.name === "RenderingCancelledException";
}

async function resolveWorkerSrc(): Promise<string> {
  if (workerBlobUrl) return workerBlobUrl;
  if (workerSrcPromise) return workerSrcPromise;

  workerSrcPromise = (async () => {
    try {
      const response = await fetch(PDFJS_WORKER_URL, { mode: "cors" });
      if (!response.ok) return PDFJS_WORKER_URL;
      const text = await response.text();
      const blob = new Blob([text], { type: "application/javascript" });
      workerBlobUrl = URL.createObjectURL(blob);
      return workerBlobUrl;
    } catch {
      return PDFJS_WORKER_URL;
    } finally {
      workerSrcPromise = null;
    }
  })();

  return workerSrcPromise;
}

function loadPdfJs(): Promise<PdfJsLib> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("PDF-rendering er bare tilgjengelig i nettleseren."));
  }

  const existing = getPdfJsGlobal();
  if (existing) {
    return resolveWorkerSrc().then((workerSrc) => {
      existing.GlobalWorkerOptions.workerSrc = workerSrc;
      return existing;
    });
  }

  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = new Promise<PdfJsLib>((resolve, reject) => {
    const finish = () => {
      const lib = getPdfJsGlobal();
      if (!lib) {
        pdfjsPromise = null;
        reject(new Error("PDF-motoren ble lastet, men pdfjsLib mangler."));
        return;
      }
      void resolveWorkerSrc().then((workerSrc) => {
        lib.GlobalWorkerOptions.workerSrc = workerSrc;
        resolve(lib);
      });
    };

    const fail = (targetScript?: HTMLScriptElement) => {
      targetScript?.remove();
      pdfjsPromise = null;
      reject(new Error("Kunne ikke laste PDF-motoren. Sjekk internettforbindelsen og prøv igjen."));
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[data-pdfjs="${PDFJS_VERSION}"]`,
    );
    if (existingScript) {
      if (getPdfJsGlobal()) {
        finish();
      } else {
        existingScript.addEventListener("load", finish, { once: true });
        existingScript.addEventListener("error", () => fail(existingScript), { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = PDFJS_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.pdfjs = PDFJS_VERSION;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => fail(script), { once: true });
    document.head.appendChild(script);
  });

  return pdfjsPromise;
}

type CanvasRenderState = {
  epoch: number;
  activeTask: PdfRenderTask | null;
  abortCleanup: (() => void) | null;
};

type OffscreenEntry = {
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
};

export async function loadPdfDocument(data: ArrayBuffer): Promise<LoadedPdfDocument> {
  activeDocCount += 1;
  let doc: PdfDocumentProxy;
  try {
    const pdfjs = await loadPdfJs();
    // Pass a copy so PDF.js worker transfer does not detach the caller's ArrayBuffer.
    doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  } catch (err) {
    activeDocCount = Math.max(0, activeDocCount - 1);
    revokeWorkerBlobUrlIfIdle();
    throw err;
  }

  let destroyed = false;
  const canvasStates = new WeakMap<HTMLCanvasElement, CanvasRenderState>();
  const activeTasks = new Set<PdfRenderTask>();
  const offscreenCache = new Map<string, OffscreenEntry>();
  const offscreenInFlight = new Map<string, Promise<OffscreenEntry | null>>();
  const cropCache = new Map<number, NormalizedRect>();
  const cropInFlight = new Map<number, Promise<NormalizedRect>>();
  const thumbCache = new Map<number, string>();
  const thumbInFlight = new Map<number, Promise<string>>();

  function cancelTask(task: PdfRenderTask | null | undefined): void {
    if (!task) return;
    activeTasks.delete(task);
    if (task.cancel) {
      try {
        task.cancel();
      } catch {
        /* ignore cancellation errors */
      }
    }
  }

  function getCanvasState(canvas: HTMLCanvasElement): CanvasRenderState {
    let state = canvasStates.get(canvas);
    if (!state) {
      state = { epoch: 0, activeTask: null, abortCleanup: null };
      canvasStates.set(canvas, state);
    }
    return state;
  }

  function setOffscreenCache(key: string, entry: OffscreenEntry): void {
    if (offscreenCache.has(key)) {
      const prev = offscreenCache.get(key);
      if (prev && prev !== entry) {
        prev.canvas.width = 0;
        prev.canvas.height = 0;
      }
      offscreenCache.delete(key);
    } else if (offscreenCache.size >= MAX_OFFSCREEN_CACHE) {
      const oldestKey = offscreenCache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldest = offscreenCache.get(oldestKey);
        offscreenCache.delete(oldestKey);
        if (oldest) {
          oldest.canvas.width = 0;
          oldest.canvas.height = 0;
        }
      }
    }
    offscreenCache.set(key, entry);
  }

  function clearOffscreenCache(): void {
    for (const entry of offscreenCache.values()) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    offscreenCache.clear();
    offscreenInFlight.clear();
  }

  async function getOrRenderOffscreenPage(
    pageNumber: number,
    scale: number,
    dpr: number,
  ): Promise<OffscreenEntry | null> {
    if (destroyed) return null;
    const key = buildRenderKey(pageNumber, scale, dpr);

    const cached = offscreenCache.get(key);
    if (cached) {
      offscreenCache.delete(key);
      offscreenCache.set(key, cached);
      return cached;
    }

    const existingInFlight = offscreenInFlight.get(key);
    if (existingInFlight) {
      return existingInFlight;
    }

    const promise = (async (): Promise<OffscreenEntry | null> => {
      const offscreen = document.createElement("canvas");
      let task: PdfRenderTask | null = null;
      try {
        const page = await doc.getPage(pageNumber);
        if (destroyed) {
          offscreen.width = 0;
          offscreen.height = 0;
          return null;
        }

        const cssViewport = page.getViewport({ scale });
        const renderViewport = page.getViewport({ scale: scale * dpr });
        const cssWidth = Math.max(1, Math.floor(cssViewport.width));
        const cssHeight = Math.max(1, Math.floor(cssViewport.height));

        offscreen.width = Math.max(1, Math.floor(renderViewport.width));
        offscreen.height = Math.max(1, Math.floor(renderViewport.height));

        const ctx = offscreen.getContext("2d");
        if (!ctx) {
          throw new Error("Kunne ikke opprette 2D-kontekst for PDF-visning.");
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, offscreen.width, offscreen.height);

        task = page.render({ canvasContext: ctx, viewport: renderViewport });
        activeTasks.add(task);
        await task.promise;

        if (destroyed) {
          offscreen.width = 0;
          offscreen.height = 0;
          return null;
        }

        const entry: OffscreenEntry = { canvas: offscreen, cssWidth, cssHeight };
        setOffscreenCache(key, entry);
        return entry;
      } catch (err) {
        offscreen.width = 0;
        offscreen.height = 0;
        if (isCancelledError(err) || destroyed) {
          return null;
        }
        throw err;
      } finally {
        if (task) {
          activeTasks.delete(task);
        }
        offscreenInFlight.delete(key);
      }
    })();

    offscreenInFlight.set(key, promise);
    return promise;
  }

  return {
    numPages: doc.numPages,
    async renderPage(
      pageNumber: number,
      canvas: HTMLCanvasElement,
      scale: number,
      options?: RenderPageOptions,
    ): Promise<PageDimensions> {
      if (destroyed || options?.signal?.aborted) {
        return { width: 0, height: 0 };
      }

      const state = getCanvasState(canvas);
      state.epoch += 1;
      const epoch = state.epoch;

      cancelTask(state.activeTask);
      state.activeTask = null;

      if (state.abortCleanup) {
        state.abortCleanup();
        state.abortCleanup = null;
      }

      let localAbortCleanup: (() => void) | null = null;
      if (options?.signal) {
        const signal = options.signal;
        const onAbort = () => {
          state.epoch += 1;
          cancelTask(state.activeTask);
          state.activeTask = null;
        };
        signal.addEventListener("abort", onAbort, { once: true });
        localAbortCleanup = () => {
          signal.removeEventListener("abort", onAbort);
        };
        state.abortCleanup = localAbortCleanup;
      }

      try {
        const region = options?.region ? normalizeCropRect(options.region) : FULL_PAGE_RECT;
        const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

        if (isFullPageRect(region)) {
          const page = await doc.getPage(pageNumber);
          if (destroyed || epoch !== state.epoch || options?.signal?.aborted) {
            return { width: 0, height: 0 };
          }

          const cssViewport = page.getViewport({ scale });
          const renderViewport = page.getViewport({ scale: scale * dpr });
          const cssWidth = Math.max(1, Math.floor(cssViewport.width));
          const cssHeight = Math.max(1, Math.floor(cssViewport.height));

          canvas.width = Math.max(1, Math.floor(renderViewport.width));
          canvas.height = Math.max(1, Math.floor(renderViewport.height));
          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${cssHeight}px`;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            throw new Error("Kunne ikke opprette 2D-kontekst for PDF-visning.");
          }

          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const task = page.render({ canvasContext: ctx, viewport: renderViewport });
          state.activeTask = task;
          activeTasks.add(task);
          try {
            await task.promise;
          } catch (err) {
            if (isCancelledError(err)) {
              return { width: cssWidth, height: cssHeight };
            }
            throw err;
          } finally {
            activeTasks.delete(task);
            if (state.activeTask === task) {
              state.activeTask = null;
            }
          }

          return { width: cssWidth, height: cssHeight };
        }

        const entry = await getOrRenderOffscreenPage(pageNumber, scale, dpr);
        if (!entry || destroyed || epoch !== state.epoch || options?.signal?.aborted) {
          return { width: 0, height: 0 };
        }

        const metrics = computeSliceMetrics(
          entry.cssWidth,
          entry.cssHeight,
          entry.canvas.width,
          entry.canvas.height,
          region,
        );

        canvas.width = metrics.destWidth;
        canvas.height = metrics.destHeight;
        canvas.style.width = `${metrics.cssWidth}px`;
        canvas.style.height = `${metrics.cssHeight}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Kunne ikke opprette 2D-kontekst for PDF-visning.");
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          entry.canvas,
          metrics.sx,
          metrics.sy,
          metrics.sw,
          metrics.sh,
          0,
          0,
          metrics.destWidth,
          metrics.destHeight,
        );

        return { width: metrics.cssWidth, height: metrics.cssHeight };
      } finally {
        if (localAbortCleanup) {
          localAbortCleanup();
          if (state.abortCleanup === localAbortCleanup) {
            state.abortCleanup = null;
          }
        }
      }
    },
    async detectPageCropRect(pageNumber: number): Promise<NormalizedRect> {
      if (destroyed) return FULL_PAGE_RECT;

      const cached = cropCache.get(pageNumber);
      if (cached) return cached;

      const existingInFlight = cropInFlight.get(pageNumber);
      if (existingInFlight) return existingInFlight;

      const promise = (async (): Promise<NormalizedRect> => {
        const offscreen = document.createElement("canvas");
        let task: PdfRenderTask | null = null;
        try {
          const page = await doc.getPage(pageNumber);
          if (destroyed) return FULL_PAGE_RECT;

          const viewport = page.getViewport({ scale: CROP_SCAN_SCALE });
          offscreen.width = Math.max(1, Math.floor(viewport.width));
          offscreen.height = Math.max(1, Math.floor(viewport.height));

          const ctx = offscreen.getContext("2d");
          if (!ctx) return FULL_PAGE_RECT;

          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, offscreen.width, offscreen.height);

          task = page.render({ canvasContext: ctx, viewport });
          activeTasks.add(task);
          await task.promise;

          if (destroyed) return FULL_PAGE_RECT;

          const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
          const rect = detectCropRectFromPixels(imageData.data, offscreen.width, offscreen.height);
          cropCache.set(pageNumber, rect);
          return rect;
        } catch (err) {
          if (isCancelledError(err) || destroyed) {
            return FULL_PAGE_RECT;
          }
          throw err;
        } finally {
          if (task) {
            activeTasks.delete(task);
          }
          offscreen.width = 0;
          offscreen.height = 0;
          cropInFlight.delete(pageNumber);
        }
      })();

      cropInFlight.set(pageNumber, promise);
      return promise;
    },
    async getPageDimensions(pageNumber: number, scale: number): Promise<PageDimensions> {
      if (destroyed) return { width: 0, height: 0 };
      const page = await doc.getPage(pageNumber);
      if (destroyed) return { width: 0, height: 0 };
      const viewport = page.getViewport({ scale });
      return {
        width: Math.max(1, Math.floor(viewport.width)),
        height: Math.max(1, Math.floor(viewport.height)),
      };
    },
    async renderThumbnail(pageNumber: number, maxWidth = 180): Promise<string> {
      if (destroyed) return "";
      const cached = thumbCache.get(pageNumber);
      if (cached) return cached;
      const inFlight = thumbInFlight.get(pageNumber);
      if (inFlight) return inFlight;

      const promise = (async (): Promise<string> => {
        const offscreen = document.createElement("canvas");
        let task: PdfRenderTask | null = null;
        try {
          const page = await doc.getPage(pageNumber);
          if (destroyed) return "";
          const baseVp = page.getViewport({ scale: 1 });
          const scale = baseVp.width > 0 ? Math.min(0.6, Math.max(0.15, maxWidth / baseVp.width)) : 0.25;
          const viewport = page.getViewport({ scale });
          offscreen.width = Math.max(1, Math.floor(viewport.width));
          offscreen.height = Math.max(1, Math.floor(viewport.height));
          const ctx = offscreen.getContext("2d");
          if (!ctx) return "";
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, offscreen.width, offscreen.height);

          task = page.render({ canvasContext: ctx, viewport });
          activeTasks.add(task);
          await task.promise;
          if (destroyed) return "";
          const dataUrl = offscreen.toDataURL("image/jpeg", 0.78);
          thumbCache.set(pageNumber, dataUrl);
          return dataUrl;
        } catch (err) {
          if (isCancelledError(err) || destroyed) return "";
          return "";
        } finally {
          if (task) activeTasks.delete(task);
          offscreen.width = 0;
          offscreen.height = 0;
          thumbInFlight.delete(pageNumber);
        }
      })();

      thumbInFlight.set(pageNumber, promise);
      return promise;
    },
    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;

      for (const task of [...activeTasks]) {
        cancelTask(task);
      }
      activeTasks.clear();
      clearOffscreenCache();
      cropCache.clear();
      cropInFlight.clear();
      thumbCache.clear();
      thumbInFlight.clear();

      try {
        await doc.destroy();
      } finally {
        activeDocCount = Math.max(0, activeDocCount - 1);
        revokeWorkerBlobUrlIfIdle();
      }
    },
  };
}
