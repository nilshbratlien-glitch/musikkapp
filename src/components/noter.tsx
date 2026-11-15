import { BookOpen, Check, FileUp, Pencil, Search, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NoterViewer } from "@/components/noter-viewer";
import {
  extractTitleFromFilename,
  formatFileSize,
  isValidPdfFile,
  sortSheets,
  type SheetMeta,
  type SheetRecord,
  type SheetSortBy,
} from "@/lib/noter";
import {
  deleteSheet,
  getSheet,
  listSheets,
  saveSheet,
  updateSheetMeta,
  type UpdateSheetMetaPatch,
} from "@/lib/noter-db";

export function Noter() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SheetSortBy>("recent");
  const [error, setError] = useState<string | null>(null);

  const [activeSheet, setActiveSheet] = useState<SheetRecord | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refreshSheets = useCallback(async () => {
    try {
      const list = await listSheets();
      setSheets(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lese notebiblioteket.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSheets();
  }, [refreshSheets]);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setUploading(true);
      setError(null);

      const rejected: string[] = [];
      let addedCount = 0;

      try {
        for (const file of files) {
          if (!isValidPdfFile(file.name, file.type, file.size)) {
            rejected.push(file.name);
            continue;
          }
          const pdfData = await file.arrayBuffer();
          await saveSheet({
            title: extractTitleFromFilename(file.name),
            fileName: file.name,
            fileSize: file.size,
            pdfData,
          });
          addedCount += 1;
        }

        if (addedCount > 0) {
          await refreshSheets();
        }
        if (rejected.length > 0) {
          setError(
            `Kunne ikke laste opp: ${rejected.join(", ")}. Velg gyldige PDF-filer under 100 MB.`,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Opplasting av PDF feilet.");
      } finally {
        setUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [refreshSheets],
  );

  const handleOpenSheet = useCallback(async (id: string) => {
    setError(null);
    try {
      const record = await getSheet(id);
      if (!record) {
        setError("Fant ikke PDF-filen i lokal lagring.");
        return;
      }
      const now = Date.now();
      const updated = await updateSheetMeta(id, { lastOpenedAt: now });
      if (updated) {
        setSheets((prev) => prev.map((s) => (s.id === id ? updated : s)));
      }
      setActiveSheet({ ...record, lastOpenedAt: now });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke åpne notearket.");
    }
  }, []);

  const handleUpdateActiveMeta = useCallback(
    async (patch: UpdateSheetMetaPatch) => {
      if (!activeSheet) return;
      const targetId = activeSheet.id;
      try {
        const updated = await updateSheetMeta(targetId, patch);
        if (updated) {
          setSheets((prev) => prev.map((s) => (s.id === targetId ? updated : s)));
          setActiveSheet((prev) => (prev && prev.id === targetId ? { ...prev, ...updated } : prev));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kunne ikke lagre endringer for notearket.");
      }
    },
    [activeSheet],
  );

  const startRename = (sheet: SheetMeta) => {
    setConfirmDeleteId(null);
    setEditingId(sheet.id);
    setEditingTitle(sheet.title);
  };

  const commitRename = async (id: string) => {
    const trimmed = editingTitle.trim();
    setEditingId(null);
    if (!trimmed) return;
    try {
      const updated = await updateSheetMeta(id, { title: trimmed });
      if (updated) {
        setSheets((prev) => prev.map((s) => (s.id === id ? updated : s)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gi nytt navn.");
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    try {
      await deleteSheet(id);
      setSheets((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke slette notearket.");
    }
  };

  const filteredSheets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("nb");
    const matching = query
      ? sheets.filter(
          (s) =>
            s.title.toLocaleLowerCase("nb").includes(query) ||
            s.fileName.toLocaleLowerCase("nb").includes(query),
        )
      : sheets;
    return sortSheets(matching, sortBy);
  }, [sheets, search, sortBy]);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-fg">Noter</h1>
            <p className="text-xs text-muted">
              Lagres lokalt i nettleseren — klar til øving og scene.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="metro-press flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-accent px-3.5 text-sm font-bold text-[#1a1408] disabled:opacity-60"
          >
            <Upload className="size-4" aria-hidden="true" />
            <span>{uploading ? "Laster opp …" : "Last opp PDF"}</span>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              void handleFiles(e.target.files);
            }
          }}
        />

        {/* Drag-and-drop upload zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files) {
              void handleFiles(e.dataTransfer.files);
            }
          }}
          style={{
            backgroundColor: dragActive ? "rgba(224, 177, 90, 0.1)" : "rgba(28, 34, 44, 0.6)",
          }}
          className={
            dragActive
              ? "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent px-4 py-5 text-center transition"
              : "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-4 py-5 text-center transition"
          }
        >
          <FileUp className={dragActive ? "size-6 text-accent" : "size-6 text-muted"} aria-hidden="true" />
          <p className="text-sm font-medium text-fg">
            Slipp PDF-filer her, eller{" "}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="font-semibold text-accent underline underline-offset-2"
            >
              velg fra enheten
            </button>
          </p>
          <p className="text-xs text-muted">Støtter flere PDF-er samtidig (maks 100 MB per fil)</p>
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              borderColor: "rgba(192, 72, 63, 0.5)",
              backgroundColor: "rgba(192, 72, 63, 0.15)",
            }}
            className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-sm text-fg"
          >
            <p className="min-w-0 flex-1">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Lukk feilmelding"
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted hover:text-fg"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {/* Search & sort */}
        {sheets.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Søk i noter</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Søk etter stykke …"
                className="metro-field min-h-10 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-sm text-fg placeholder:text-muted"
              />
            </label>

            <label className="flex shrink-0 items-center gap-2">
              <span className="sr-only">Sorter noter</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SheetSortBy)}
                className="metro-field min-h-10 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-fg"
              >
                <option value="recent">Sist åpnet</option>
                <option value="title">Tittel (A–Å)</option>
                <option value="newest">Nyest lagt til</option>
              </select>
            </label>
          </div>
        ) : null}

        {/* Library list */}
        {loading ? (
          <div className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-muted">
            Laster notebibliotek …
          </div>
        ) : sheets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-5 py-8 text-center">
            <BookOpen className="size-8 text-accent" aria-hidden="true" />
            <h2 className="text-base font-semibold text-fg">Ingen noter lastet opp ennå</h2>
            <p className="max-w-xs text-sm text-muted">
              Last opp din første PDF for å åpne i fullskjerm med sveip, Bluetooth-pedal, nattmodus og
              hurtig-metronom.
            </p>
          </div>
        ) : filteredSheets.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-muted">
            Ingen noter matcher «{search}».
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filteredSheets.map((sheet) => {
              const isEditing = editingId === sheet.id;
              const isConfirmingDelete = confirmDeleteId === sheet.id;

              return (
                <li
                  key={sheet.id}
                  className="rounded-2xl border border-line bg-surface p-3.5 transition hover:border-accent"
                >
                  {isEditing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void commitRename(sheet.id);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        autoFocus
                        aria-label="Nytt navn på stykke"
                        className="metro-field min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-header px-3 text-sm font-semibold text-fg"
                      />
                      <button
                        type="submit"
                        aria-label="Lagre navn"
                        className="metro-press flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-[#1a1408]"
                      >
                        <Check className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        aria-label="Avbryt navneendring"
                        className="metro-press flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-fg"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => void handleOpenSheet(sheet.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-base font-semibold text-fg">{sheet.title}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span className="rounded-md bg-header px-2 py-0.5 font-semibold text-accent tabular-nums">
                            {sheet.bpm} BPM
                          </span>
                          <span>
                            {sheet.pageCount > 0 ? `${sheet.pageCount} sider` : "Ukjent sidetall"}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatFileSize(sheet.fileSize)}</span>
                          {sheet.lastPage > 1 ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Side {sheet.lastPage}</span>
                            </>
                          ) : null}
                        </div>
                      </button>

                      <div className="flex shrink-0 items-center gap-1">
                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleDelete(sheet.id)}
                              className="metro-press min-h-11 min-w-11 rounded-lg bg-no px-3 text-xs font-semibold text-white"
                            >
                              Slett
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="metro-press min-h-11 min-w-11 rounded-lg border border-line bg-header px-3 text-xs font-medium text-muted hover:text-fg"
                            >
                              Avbryt
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startRename(sheet)}
                              aria-label={`Gi nytt navn til ${sheet.title}`}
                              className="metro-press flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-fg"
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(sheet.id)}
                              aria-label={`Slett ${sheet.title}`}
                              className="metro-press flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-no"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {activeSheet ? (
        <NoterViewer
          sheet={activeSheet}
          onClose={() => setActiveSheet(null)}
          onUpdateMeta={handleUpdateActiveMeta}
        />
      ) : null}
    </div>
  );
}
