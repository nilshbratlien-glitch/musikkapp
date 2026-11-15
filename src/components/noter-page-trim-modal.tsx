import {
  Check,
  CopyPlus,
  Scissors,
  X,
  ZoomIn,
} from "lucide-react";
import { useEffect, useState } from "react";
import { loadPdfDocument, type LoadedPdfDocument } from "@/lib/noter-pdf";
import {
  formatPageSelectionSummary,
  parsePageRangeInput,
  trimPdfBytes,
} from "@/lib/noter-trim";

export type NoterPageTrimModalProps = {
  open: boolean;
  onClose: () => void;
  sheetTitle: string;
  pdfData: ArrayBuffer;
  pageCount: number;
  existingDoc?: LoadedPdfDocument | null;
  subtitle?: string;
  onReplacePages: (keptPages: number[], trimmedPdfData: ArrayBuffer) => Promise<void> | void;
  onSaveAsCopy?: (
    keptPages: number[],
    trimmedPdfData: ArrayBuffer,
    copyTitle: string,
  ) => Promise<void> | void;
};

export function NoterPageTrimModal({
  open,
  onClose,
  sheetTitle,
  pdfData,
  pageCount: initialPageCount,
  existingDoc = null,
  subtitle,
  onReplacePages,
  onSaveAsCopy,
}: NoterPageTrimModalProps) {
  const [ownedDoc, setOwnedDoc] = useState<LoadedPdfDocument | null>(null);
  const activeDoc = existingDoc ?? ownedDoc;
  const effectivePageCount = Math.max(1, activeDoc?.numPages ?? (initialPageCount || 1));

  const [selectedPages, setSelectedPages] = useState<number[]>(() =>
    Array.from({ length: Math.max(1, initialPageCount || 1) }, (_, i) => i + 1),
  );
  const [rangeInput, setRangeInput] = useState(() =>
    initialPageCount > 1 ? `1-${initialPageCount}` : "1",
  );
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);

  const [thumbsState, setThumbsState] = useState<{
    doc: LoadedPdfDocument | null;
    urls: Record<number, string>;
  }>({ doc: null, urls: {} });

  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [copyMode, setCopyMode] = useState(false);
  const [copyTitle, setCopyTitle] = useState(`${sheetTitle} (utdrag)`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load PDF document if existingDoc was not supplied (e.g. from library upload)
  useEffect(() => {
    if (!open || existingDoc) return;
    let cancelled = false;
    let created: LoadedPdfDocument | null = null;

    void loadPdfDocument(pdfData)
      .then((doc) => {
        if (cancelled) {
          void doc.destroy();
          return;
        }
        created = doc;
        setOwnedDoc(doc);
        if (initialPageCount <= 0 || initialPageCount !== doc.numPages) {
          const all = Array.from({ length: doc.numPages }, (_, i) => i + 1);
          setSelectedPages(all);
          setRangeInput(doc.numPages > 1 ? `1-${doc.numPages}` : "1");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Kunne ikke lese PDF-en.");
        }
      });

    return () => {
      cancelled = true;
      if (created) {
        void created.destroy();
      }
      setOwnedDoc(null);
    };
  }, [open, existingDoc, pdfData, initialPageCount]);

  // Progressive thumbnail loading
  useEffect(() => {
    if (!open || !activeDoc) return;
    let cancelled = false;

    const loadThumbs = async () => {
      for (let p = 1; p <= effectivePageCount; p += 1) {
        if (cancelled) return;
        const url = await activeDoc.renderThumbnail(p, 160);
        if (!cancelled && url) {
          setThumbsState((prev) => {
            const base = prev.doc === activeDoc ? prev.urls : {};
            if (base[p]) return prev;
            return { doc: activeDoc, urls: { ...base, [p]: url } };
          });
        }
      }
    };

    void loadThumbs();
    return () => {
      cancelled = true;
    };
  }, [open, activeDoc, effectivePageCount]);

  // High-res page preview ("Titt på side")
  useEffect(() => {
    if (!open || !activeDoc || previewPage === null) return;
    let cancelled = false;

    void activeDoc.renderThumbnail(previewPage, 640).then((url) => {
      if (!cancelled) {
        setPreviewUrl(url || null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, activeDoc, previewPage]);

  if (!open) return null;

  const thumbs = thumbsState.doc === activeDoc ? thumbsState.urls : {};
  const selectedSet = new Set(selectedPages);

  const updateSelection = (nextPages: number[]) => {
    const uniqueSorted = Array.from(new Set(nextPages)).sort((a, b) => a - b);
    setSelectedPages(uniqueSorted);
    setRangeInput(formatPageSelectionSummary(uniqueSorted));
  };

  const handleTogglePage = (pageNum: number, shiftKey = false) => {
    if ((rangeMode || shiftKey) && rangeAnchor !== null) {
      const start = Math.min(rangeAnchor, pageNum);
      const end = Math.max(rangeAnchor, pageNum);
      const next = new Set(selectedPages);
      for (let p = start; p <= end; p += 1) {
        next.add(p);
      }
      updateSelection(Array.from(next));
      setRangeAnchor(null);
      setRangeMode(false);
      return;
    }

    if (rangeMode) {
      setRangeAnchor(pageNum);
      if (!selectedSet.has(pageNum)) {
        updateSelection([...selectedPages, pageNum]);
      }
      return;
    }

    setRangeAnchor(pageNum);
    if (selectedSet.has(pageNum)) {
      updateSelection(selectedPages.filter((p) => p !== pageNum));
    } else {
      updateSelection([...selectedPages, pageNum]);
    }
  };

  const handleApplyRangeText = () => {
    const parsed = parsePageRangeInput(rangeInput, effectivePageCount);
    if (parsed.length === 0) {
      setError(`Skriv inn gyldige sidetall mellom 1 og ${effectivePageCount} (f.eks. 14-16).`);
      return;
    }
    setError(null);
    updateSelection(parsed);
  };

  const handleTrimReplace = async () => {
    if (selectedPages.length === 0) {
      setError("Velg minst én side som skal beholdes.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { pdfData: trimmedBytes, keptPages } = await trimPdfBytes(pdfData, selectedPages);
      await onReplacePages(keptPages, trimmedBytes);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke redigere PDF-filen.");
    } finally {
      setBusy(false);
    }
  };

  const handleTrimCopy = async () => {
    if (!onSaveAsCopy) return;
    if (selectedPages.length === 0) {
      setError("Velg minst én side som skal beholdes.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { pdfData: trimmedBytes, keptPages } = await trimPdfBytes(pdfData, selectedPages);
      await onSaveAsCopy(
        keptPages,
        trimmedBytes,
        copyTitle.trim() || `${sheetTitle} (utdrag)`,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lagre utdrag som nytt stykke.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Velg sider å beholde"
      style={{ backgroundColor: "rgba(10, 13, 18, 0.82)" }}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        style={{ backgroundColor: "rgba(22, 26, 34, 0.98)" }}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-2xl border border-line shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Scissors className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <h2 className="truncate text-sm font-bold text-fg sm:text-base">
                Velg sider å beholde
              </h2>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted">
              {subtitle ?? `${sheetTitle} · ${selectedPages.length} av ${effectivePageCount} sider valgt`}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Lukk sidevelger"
            className="metro-press flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-fg disabled:opacity-40"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Range & quick controls */}
        <div className="space-y-2 border-b border-line px-4 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleApplyRangeText();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              placeholder="F.eks. 14-16 eller 3, 14-16"
              aria-label="Sideområde"
              className="metro-field min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              className="metro-press min-h-10 shrink-0 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-fg hover:border-accent"
            >
              Bruk
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  updateSelection(Array.from({ length: effectivePageCount }, (_, i) => i + 1))
                }
                className="metro-press min-h-9 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-fg hover:border-accent"
              >
                Velg alle
              </button>
              <button
                type="button"
                onClick={() => {
                  setRangeAnchor(null);
                  updateSelection([]);
                }}
                className="metro-press min-h-9 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-fg"
              >
                Fjern alle
              </button>
              <button
                type="button"
                aria-pressed={rangeMode}
                onClick={() => {
                  setRangeMode((prev) => !prev);
                  setRangeAnchor(null);
                }}
                style={
                  rangeMode ? { backgroundColor: "rgba(224, 177, 90, 0.16)" } : undefined
                }
                className={
                  rangeMode
                    ? "metro-press min-h-9 rounded-lg border border-accent px-2.5 text-xs font-semibold text-accent"
                    : "metro-press min-h-9 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-fg"
                }
              >
                {rangeMode
                  ? rangeAnchor !== null
                    ? `Velg sluttside (fra ${rangeAnchor})`
                    : "Trykk startside…"
                  : "Velg fra–til"}
              </button>
            </div>

            <span className="text-xs font-semibold tabular-nums text-accent">
              {selectedPages.length} / {effectivePageCount} valgt
            </span>
          </div>

          {error ? (
            <div
              role="alert"
              style={{ backgroundColor: "rgba(239, 68, 68, 0.12)", borderColor: "rgba(239, 68, 68, 0.4)" }}
              className="rounded-xl border px-3 py-2 text-xs text-red-200"
            >
              {error}
            </div>
          ) : null}
        </div>

        {/* Thumbnail Grid */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {Array.from({ length: effectivePageCount }, (_, i) => i + 1).map((p) => {
              const isSelected = selectedSet.has(p);
              const isAnchor = rangeMode && rangeAnchor === p;
              const thumbUrl = thumbs[p];
              return (
                <div
                  key={p}
                  style={
                    isSelected
                      ? { backgroundColor: "rgba(224, 177, 90, 0.14)" }
                      : undefined
                  }
                  className={
                    isSelected
                      ? "relative flex flex-col items-center gap-1.5 rounded-xl border-2 border-accent p-2 text-accent"
                      : "relative flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface p-2 text-fg"
                  }
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Side ${p}`}
                    onClick={(e) => handleTogglePage(p, e.shiftKey)}
                    className="metro-press flex w-full flex-col items-center gap-1.5 focus:outline-none"
                  >
                    <div className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-md bg-white">
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt={`Side ${p}`}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-xs font-semibold text-muted">{p}</span>
                      )}
                      {isSelected ? (
                        <span
                          aria-hidden="true"
                          className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-accent text-[#1a1408] shadow"
                        >
                          <Check className="size-3.5 stroke-[3]" />
                        </span>
                      ) : null}
                      {isAnchor ? (
                        <span
                          aria-hidden="true"
                          style={{ backgroundColor: "rgba(17, 21, 28, 0.85)" }}
                          className="absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-accent"
                        >
                          Fra
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs font-semibold tabular-nums">Side {p}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPreviewUrl(null);
                      setPreviewPage(p);
                    }}
                    aria-label={`Forhåndsvis side ${p}`}
                    title="Titt på side"
                    style={{ backgroundColor: "rgba(17, 21, 28, 0.8)" }}
                    className="metro-press absolute top-3 right-3 flex size-7 items-center justify-center rounded-full border border-line text-fg hover:border-accent hover:text-accent"
                  >
                    <ZoomIn className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer actions */}
        <div className="space-y-2.5 border-t border-line px-4 py-3">
          {copyMode && onSaveAsCopy ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={copyTitle}
                onChange={(e) => setCopyTitle(e.target.value)}
                placeholder="Navn på nytt stykke…"
                aria-label="Navn på nytt stykke"
                className="metro-field min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm text-fg focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || selectedPages.length === 0}
                onClick={() => void handleTrimCopy()}
                className="metro-press min-h-10 shrink-0 rounded-xl bg-accent px-4 text-xs font-bold text-[#1a1408] disabled:opacity-40"
              >
                {busy ? "Lagrer…" : "Opprett utdrag"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCopyMode(false)}
                className="metro-press min-h-10 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-muted hover:text-fg"
              >
                Avbryt
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {onSaveAsCopy ? (
                <button
                  type="button"
                  disabled={busy || selectedPages.length === 0}
                  onClick={() => setCopyMode(true)}
                  className="metro-press flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-fg hover:border-accent disabled:opacity-40"
                >
                  <CopyPlus className="size-4" aria-hidden="true" />
                  <span>Lagre som nytt stykke</span>
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onClose}
                  className="metro-press min-h-11 rounded-xl border border-line bg-surface px-3.5 text-xs font-semibold text-muted hover:text-fg disabled:opacity-40"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  disabled={busy || selectedPages.length === 0}
                  onClick={() => void handleTrimReplace()}
                  className="metro-press flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-bold text-[#1a1408] disabled:opacity-40"
                >
                  <Scissors className="size-4" aria-hidden="true" />
                  <span>
                    {busy
                      ? "Behandler PDF…"
                      : `Behold ${selectedPages.length} ${selectedPages.length === 1 ? "side" : "sider"}`}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* High-res single page preview overlay */}
      {previewPage !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Forhåndsvisning av side ${previewPage}`}
          style={{ backgroundColor: "rgba(6, 8, 12, 0.9)" }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            setPreviewPage(null);
            setPreviewUrl(null);
          }}
        >
          <div className="mb-3 flex w-full max-w-xl items-center justify-between text-fg">
            <span className="text-sm font-semibold">Side {previewPage}</span>
            <button
              type="button"
              onClick={() => {
                setPreviewPage(null);
                setPreviewUrl(null);
              }}
              aria-label="Lukk forhåndsvisning"
              className="metro-press flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-fg"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div
            className="flex max-h-[80vh] max-w-xl items-center justify-center overflow-auto rounded-xl bg-white p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={`Forhåndsvisning av side ${previewPage}`}
                className="max-h-[75vh] w-auto object-contain"
              />
            ) : (
              <div className="flex h-64 w-48 items-center justify-center text-sm text-muted">
                Laster side {previewPage}…
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
