const PDFJS_VERSION = "3.11.174";
const PDFJS_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;

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

export type LoadedPdfDocument = {
  numPages: number;
  renderPage: (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => Promise<void>;
  destroy: () => Promise<void>;
};

let pdfjsPromise: Promise<PdfJsLib> | null = null;
let workerBlobUrl: string | null = null;
let workerSrcPromise: Promise<string> | null = null;

function getPdfJsGlobal(): PdfJsLib | undefined {
  return (globalThis as unknown as { pdfjsLib?: PdfJsLib }).pdfjsLib;
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

export async function loadPdfDocument(data: ArrayBuffer): Promise<LoadedPdfDocument> {
  const pdfjs = await loadPdfJs();
  // Pass a copy so PDF.js worker transfer does not detach the caller's ArrayBuffer.
  const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
  let activeRender: PdfRenderTask | null = null;
  let renderEpoch = 0;
  let destroyed = false;

  return {
    numPages: doc.numPages,
    async renderPage(pageNumber: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
      if (destroyed) return;
      const epoch = ++renderEpoch;

      if (activeRender?.cancel) {
        try {
          activeRender.cancel();
        } catch {
          /* ignore cancellation errors */
        }
      }

      const page = await doc.getPage(pageNumber);
      if (destroyed || epoch !== renderEpoch) return;

      const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      const cssViewport = page.getViewport({ scale });
      const renderViewport = page.getViewport({ scale: scale * dpr });

      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      canvas.style.width = `${Math.max(1, Math.floor(cssViewport.width))}px`;
      canvas.style.height = `${Math.max(1, Math.floor(cssViewport.height))}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Kunne ikke opprette 2D-kontekst for PDF-visning.");
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const task = page.render({ canvasContext: ctx, viewport: renderViewport });
      activeRender = task;
      try {
        await task.promise;
      } catch (err) {
        if (err instanceof Error && err.name === "RenderingCancelledException") {
          return;
        }
        throw err;
      } finally {
        if (activeRender === task) {
          activeRender = null;
        }
      }
    },
    async destroy(): Promise<void> {
      destroyed = true;
      renderEpoch += 1;
      if (activeRender?.cancel) {
        try {
          activeRender.cancel();
        } catch {
          /* ignore */
        }
        activeRender = null;
      }
      await doc.destroy();
    },
  };
}
