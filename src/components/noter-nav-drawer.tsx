import { Bookmark, BookOpen, ListMusic, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SetlistRecord, SheetBookmark, SheetMeta } from "@/lib/noter";
import { sortBookmarks } from "@/lib/noter-setlists";
import type { LoadedPdfDocument } from "@/lib/noter-pdf";

export type NavDrawerTab = "pages" | "bookmarks" | "setlist";

export type NoterNavDrawerProps = {
  open: boolean;
  initialTab?: NavDrawerTab;
  onClose: () => void;
  doc: LoadedPdfDocument | null;
  pageCount: number;
  currentPage: number;
  onSelectPage: (page: number) => void;
  bookmarks: readonly SheetBookmark[];
  onAddBookmark: (page: number, label: string) => void;
  onDeleteBookmark: (id: string) => void;
  setlistContext?: {
    setlist: SetlistRecord;
    sheets: SheetMeta[];
    activeIndex: number;
    onSelectSheetIndex: (index: number) => void;
  } | null;
};

export function NoterNavDrawer({
  open,
  initialTab = "pages",
  onClose,
  doc,
  pageCount,
  currentPage,
  onSelectPage,
  bookmarks,
  onAddBookmark,
  onDeleteBookmark,
  setlistContext,
}: NoterNavDrawerProps) {
  const [tab, setTab] = useState<NavDrawerTab>(initialTab);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [bookmarkLabel, setBookmarkLabel] = useState("");

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setBookmarkLabel("");
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (!open || tab !== "pages" || !doc) return;
    let cancelled = false;

    const loadPages = async () => {
      for (let p = 1; p <= pageCount; p++) {
        if (cancelled) return;
        if (thumbs[p]) continue;
        const url = await doc.renderThumbnail(p, 160);
        if (!cancelled && url) {
          setThumbs((prev) => (prev[p] ? prev : { ...prev, [p]: url }));
        }
      }
    };

    void loadPages();
    return () => {
      cancelled = true;
    };
  }, [open, tab, doc, pageCount, thumbs]);

  useEffect(() => {
    setThumbs({});
  }, [doc]);

  if (!open) return null;

  const sortedBookmarks = sortBookmarks(bookmarks);
  const bookmarkedPages = new Set(bookmarks.map((b) => b.page));

  const handleBookmarkSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const label = bookmarkLabel.trim() || `Side ${currentPage}`;
    onAddBookmark(currentPage, label);
    setBookmarkLabel("");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sider og bokmerker"
      style={{ backgroundColor: "rgba(10, 13, 18, 0.78)" }}
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: "rgba(22, 26, 34, 0.98)" }}
        className="flex max-h-[82vh] w-full max-w-lg flex-col rounded-t-2xl border border-line shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "pages"}
              onClick={() => setTab("pages")}
              style={tab === "pages" ? { backgroundColor: "rgba(224, 177, 90, 0.16)" } : undefined}
              className={
                tab === "pages"
                  ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-3 text-xs font-semibold text-accent"
                  : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-muted hover:text-fg"
              }
            >
              <BookOpen className="size-4" aria-hidden="true" />
              <span>Sider ({pageCount})</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={tab === "bookmarks"}
              onClick={() => setTab("bookmarks")}
              style={
                tab === "bookmarks" ? { backgroundColor: "rgba(224, 177, 90, 0.16)" } : undefined
              }
              className={
                tab === "bookmarks"
                  ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-3 text-xs font-semibold text-accent"
                  : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-muted hover:text-fg"
              }
            >
              <Bookmark className="size-4" aria-hidden="true" />
              <span>Bokmerker ({bookmarks.length})</span>
            </button>

            {setlistContext ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "setlist"}
                onClick={() => setTab("setlist")}
                style={
                  tab === "setlist" ? { backgroundColor: "rgba(224, 177, 90, 0.16)" } : undefined
                }
                className={
                  tab === "setlist"
                    ? "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-accent px-3 text-xs font-semibold text-accent"
                    : "metro-press flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-medium text-muted hover:text-fg"
                }
              >
                <ListMusic className="size-4" aria-hidden="true" />
                <span>Settliste ({setlistContext.sheets.length})</span>
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Lukk sideoversikt"
            className="metro-press flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-fg"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "pages" ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => {
                const isCurrent = p === currentPage;
                const hasBookmark = bookmarkedPages.has(p);
                const thumbUrl = thumbs[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      onSelectPage(p);
                      onClose();
                    }}
                    style={
                      isCurrent
                        ? { backgroundColor: "rgba(224, 177, 90, 0.12)" }
                        : undefined
                    }
                    className={
                      isCurrent
                        ? "metro-press relative flex flex-col items-center gap-1.5 rounded-xl border-2 border-accent p-2 text-accent"
                        : "metro-press relative flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface p-2 text-fg hover:border-accent"
                    }
                  >
                    <div className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-md bg-white">
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt={`Side ${p}`}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-xs font-semibold text-muted">{p}</span>
                      )}
                    </div>
                    <span className="text-xs font-semibold tabular-nums">Side {p}</span>
                    {hasBookmark ? (
                      <Bookmark
                        className="absolute top-3 right-3 size-3.5 fill-current text-accent"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : tab === "bookmarks" ? (
            <div className="space-y-4">
              <form onSubmit={handleBookmarkSubmit} className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={40}
                  value={bookmarkLabel}
                  onChange={(e) => setBookmarkLabel(e.target.value)}
                  placeholder={`Navn på bokmerke (side ${currentPage}) …`}
                  aria-label="Navn på bokmerke"
                  className="metro-field min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  className="metro-press flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-bold text-[#1a1408]"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  <span>Side {currentPage}</span>
                </button>
              </form>

              {sortedBookmarks.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
                  Ingen bokmerker ennå. Legg til et bokmerke for å hoppe raskt til viktige steder.
                </p>
              ) : (
                <ul className="space-y-2">
                  {sortedBookmarks.map((bm) => (
                    <li
                      key={bm.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface p-2"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectPage(bm.page);
                          onClose();
                        }}
                        className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left hover:text-accent"
                      >
                        <Bookmark className="size-4 shrink-0 text-accent" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                          {bm.label}
                        </span>
                        <span className="shrink-0 rounded-md bg-header px-2 py-0.5 text-xs font-semibold text-muted tabular-nums">
                          Side {bm.page}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteBookmark(bm.id)}
                        aria-label={`Slett bokmerke ${bm.label}`}
                        className="metro-press flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-no"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : setlistContext ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {setlistContext.setlist.name}
              </p>
              <ul className="space-y-2">
                {setlistContext.sheets.map((item, idx) => {
                  const isCurrent = idx === setlistContext.activeIndex;
                  return (
                    <li key={`${item.id}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setlistContext.onSelectSheetIndex(idx);
                          onClose();
                        }}
                        style={
                          isCurrent
                            ? { backgroundColor: "rgba(224, 177, 90, 0.14)" }
                            : undefined
                        }
                        className={
                          isCurrent
                            ? "metro-press flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-accent px-3.5 py-2 text-left"
                            : "metro-press flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2 text-left hover:border-accent"
                        }
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="w-6 shrink-0 text-xs font-bold text-accent tabular-nums">
                            {idx + 1}.
                          </span>
                          <span className="min-w-0 truncate text-sm font-semibold text-fg">
                            {item.title}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs text-muted tabular-nums">
                          {item.bpm} BPM
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
