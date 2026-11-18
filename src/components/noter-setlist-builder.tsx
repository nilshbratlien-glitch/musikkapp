import { ArrowDown, ArrowUp, Check, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SetlistRecord, SheetMeta } from "@/lib/noter";
import {
  ALL_CATEGORIES_FILTER,
  UNCATEGORIZED_FILTER,
  filterSheetsByCategory,
  normalizeCategoriesList,
} from "@/lib/noter-categories";
import { countSheetOccurrencesInSetlist } from "@/lib/noter-setlists";

export type NoterSetlistBuilderModalProps = {
  open: boolean;
  setlist: SetlistRecord | null;
  sheets: readonly SheetMeta[];
  allCategories: readonly string[];
  onClose: () => void;
  onAddSheet: (setlist: SetlistRecord, sheetId: string) => Promise<void> | void;
  onAddManySheets: (setlist: SetlistRecord, sheetIds: readonly string[]) => Promise<void> | void;
  onMoveSheet: (setlist: SetlistRecord, fromIndex: number, toIndex: number) => Promise<void> | void;
  onRemoveSheet: (setlist: SetlistRecord, indexToRemove: number) => Promise<void> | void;
};

export function NoterSetlistBuilderModal({
  open,
  setlist,
  sheets,
  allCategories,
  onClose,
  onAddSheet,
  onAddManySheets,
  onMoveSheet,
  onRemoveSheet,
}: NoterSetlistBuilderModalProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES_FILTER);
  const [hideAdded, setHideAdded] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const sheetMap = useMemo(() => new Map(sheets.map((s) => [s.id, s])), [sheets]);

  const occurrences = useMemo(
    () => countSheetOccurrencesInSetlist(setlist?.sheetIds ?? []),
    [setlist?.sheetIds],
  );

  const filteredLibrary = useMemo(() => {
    const byCat = filterSheetsByCategory(sheets, categoryFilter);
    const q = search.trim().toLocaleLowerCase("nb");
    return byCat.filter((sheet) => {
      if (hideAdded && (occurrences[sheet.id] ?? 0) > 0) return false;
      if (!q) return true;
      return sheet.title.toLocaleLowerCase("nb").includes(q);
    });
  }, [sheets, categoryFilter, search, hideAdded, occurrences]);

  if (!open || !setlist) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Rediger stykker i ${setlist.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(92dvh,780px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-line bg-header px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-fg sm:text-lg">
              {setlist.name}
            </h2>
            <p className="text-xs text-muted tabular-nums">
              {setlist.sheetIds.length} {setlist.sheetIds.length === 1 ? "stykke" : "stykker"} i
              setlisten — trykk på et stykke til venstre for å legge til
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="metro-press flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-bold text-[#1a1408]"
          >
            <Check className="size-4" aria-hidden="true" />
            <span>Ferdig</span>
          </button>
        </div>

        {/* Two-pane body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
          {/* Left pane: Library picker */}
          <section
            aria-label="Legg til stykker fra biblioteket"
            className="flex min-h-0 flex-col bg-surface"
          >
            <div className="space-y-2 border-b border-line p-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Søk etter stykke …"
                  aria-label="Søk i notebiblioteket"
                  className="metro-field min-h-11 w-full rounded-xl border border-line bg-header pr-9 pl-9 text-sm text-fg placeholder:text-muted"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Tøm søk"
                    className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-fg"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              {/* Category chips + hide-added toggle */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <button
                  type="button"
                  aria-pressed={categoryFilter === ALL_CATEGORIES_FILTER}
                  onClick={() => setCategoryFilter(ALL_CATEGORIES_FILTER)}
                  style={
                    categoryFilter === ALL_CATEGORIES_FILTER
                      ? { backgroundColor: "rgba(224, 177, 90, 0.18)" }
                      : undefined
                  }
                  className={
                    categoryFilter === ALL_CATEGORIES_FILTER
                      ? "metro-press min-h-9 shrink-0 rounded-full border border-accent px-3 text-xs font-bold text-accent"
                      : "metro-press min-h-9 shrink-0 rounded-full border border-line bg-header px-3 text-xs font-medium text-muted hover:text-fg"
                  }
                >
                  Alle
                </button>
                <button
                  type="button"
                  aria-pressed={categoryFilter === UNCATEGORIZED_FILTER}
                  onClick={() => setCategoryFilter(UNCATEGORIZED_FILTER)}
                  style={
                    categoryFilter === UNCATEGORIZED_FILTER
                      ? { backgroundColor: "rgba(224, 177, 90, 0.18)" }
                      : undefined
                  }
                  className={
                    categoryFilter === UNCATEGORIZED_FILTER
                      ? "metro-press min-h-9 shrink-0 rounded-full border border-accent px-3 text-xs font-bold text-accent"
                      : "metro-press min-h-9 shrink-0 rounded-full border border-line bg-header px-3 text-xs font-medium text-muted hover:text-fg"
                  }
                >
                  Uten kategori
                </button>
                {allCategories.map((cat) => {
                  const selected =
                    categoryFilter.toLocaleLowerCase("nb") === cat.toLocaleLowerCase("nb");
                  return (
                    <button
                      key={cat}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setCategoryFilter(cat)}
                      style={
                        selected ? { backgroundColor: "rgba(224, 177, 90, 0.18)" } : undefined
                      }
                      className={
                        selected
                          ? "metro-press min-h-9 shrink-0 rounded-full border border-accent px-3 text-xs font-bold text-accent"
                          : "metro-press min-h-9 shrink-0 rounded-full border border-line bg-header px-3 text-xs font-medium text-muted hover:text-fg"
                      }
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-pressed={hideAdded}
                  onClick={() => setHideAdded((v) => !v)}
                  className={
                    hideAdded
                      ? "metro-press flex min-h-9 items-center gap-1.5 rounded-lg border border-accent bg-accent/15 px-2.5 text-xs font-semibold text-accent"
                      : "metro-press flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-header px-2.5 text-xs font-medium text-muted hover:text-fg"
                  }
                >
                  <Check className="size-3.5" aria-hidden="true" />
                  <span>Skjul allerede lagt til</span>
                </button>

                {filteredLibrary.length > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      void onAddManySheets(
                        setlist,
                        filteredLibrary.map((s) => s.id),
                      )
                    }
                    className="metro-press flex min-h-9 items-center gap-1 rounded-lg border border-accent px-2.5 text-xs font-bold text-accent"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    <span>Legg til alle ({filteredLibrary.length})</span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {filteredLibrary.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  {sheets.length === 0
                    ? "Ingen noter i biblioteket ennå."
                    : "Ingen stykker matcher filteret."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {filteredLibrary.map((sheet) => {
                    const count = occurrences[sheet.id] ?? 0;
                    const cats = normalizeCategoriesList(sheet.categories);
                    return (
                      <li key={sheet.id}>
                        <button
                          type="button"
                          onClick={() => void onAddSheet(setlist, sheet.id)}
                          style={
                            count > 0
                              ? { backgroundColor: "rgba(224, 177, 90, 0.08)" }
                              : undefined
                          }
                          className={
                            count > 0
                              ? "metro-press flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-accent/60 px-3 py-2 text-left transition"
                              : "metro-press flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-line bg-header px-3 py-2 text-left transition hover:border-accent"
                          }
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-fg">{sheet.title}</p>
                            <p className="truncate text-xs text-muted tabular-nums">
                              {sheet.pageCount} {sheet.pageCount === 1 ? "side" : "sider"}
                              {cats.length > 0 ? ` · ${cats.join(", ")}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {count > 0 ? (
                              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-bold text-accent tabular-nums">
                                ×{count}
                              </span>
                            ) : null}
                            <span className="flex size-8 items-center justify-center rounded-lg border border-accent/60 text-accent">
                              <Plus className="size-4" aria-hidden="true" />
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Right pane: Current setlist order */}
          <section
            aria-label="Rekkefølge i settlisten"
            className="flex min-h-0 flex-col bg-header/40"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                Rekkefølge ({setlist.sheetIds.length})
              </h3>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {setlist.sheetIds.length === 0 ? (
                <div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
                  Trykk på stykker til venstre for å bygge settlisten.
                </div>
              ) : (
                <ol className="space-y-2">
                  {setlist.sheetIds.map((sheetId, index) => {
                    const sheet = sheetMap.get(sheetId);
                    const title = sheet?.title ?? "Ukjent stykke";
                    return (
                      <li
                        key={`${sheetId}-${index}`}
                        className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">
                            <span className="mr-1.5 text-xs font-bold text-accent tabular-nums">
                              {index + 1}.
                            </span>
                            {title}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void onMoveSheet(setlist, index, index - 1)}
                            disabled={index === 0}
                            aria-label={`Flytt ${title} opp`}
                            className="metro-press flex size-10 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-fg disabled:opacity-35"
                          >
                            <ArrowUp className="size-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onMoveSheet(setlist, index, index + 1)}
                            disabled={index === setlist.sheetIds.length - 1}
                            aria-label={`Flytt ${title} ned`}
                            className="metro-press flex size-10 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-fg disabled:opacity-35"
                          >
                            <ArrowDown className="size-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onRemoveSheet(setlist, index)}
                            aria-label={`Fjern ${title}`}
                            className="metro-press flex size-10 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-no"
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
