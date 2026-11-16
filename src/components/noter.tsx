import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  Download,
  FileUp,
  ListMusic,
  Pencil,
  Play,
  Plus,
  Scissors,
  Search,
  Settings2,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NoterPageTrimModal } from "@/components/noter-page-trim-modal";
import { NoterViewer, type ViewerSetlistContext } from "@/components/noter-viewer";
import {
  extractTitleFromFilename,
  formatFileSize,
  isValidPdfFile,
  sortSheets,
  type SetlistRecord,
  type SheetMeta,
  type SheetRecord,
  type SheetSortBy,
} from "@/lib/noter";
import { exportNoterBackup, parseNoterBackupJson, restoreNoterBackup } from "@/lib/noter-backup";
import {
  ALL_CATEGORIES_FILTER,
  UNCATEGORIZED_FILTER,
  collectAllCategories,
  countSheetsPerCategory,
  filterSheetsByCategory,
  normalizeCategoriesList,
  normalizeCategoryName,
  readActiveCategoryFilter,
  readSavedCategories,
  removeCategoryFromSheets,
  renameCategoryOnSheets,
  toggleSheetCategory,
  writeActiveCategoryFilter,
  writeSavedCategories,
} from "@/lib/noter-categories";
import {
  deleteSetlist,
  deleteSheet,
  getSheet,
  listSetlists,
  listSheets,
  replaceSheetWithTrimmedPdf,
  saveSetlist,
  saveSheet,
  saveTrimmedSheetAsCopy,
  updateSheetMeta,
  type UpdateSheetMetaPatch,
} from "@/lib/noter-db";
import { loadPdfDocument } from "@/lib/noter-pdf";
import { moveSetlistItem } from "@/lib/noter-setlists";

type LibraryTab = "sheets" | "setlists";

type ActiveSetlistSession = {
  setlistId: string;
  activeIndex: number;
  initialPage?: number;
};

export function Noter({
  deepLinkSheetId,
  deepLinkSetlistId,
}: {
  deepLinkSheetId?: string;
  deepLinkSetlistId?: string;
} = {}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [setlists, setSetlists] = useState<SetlistRecord[]>([]);
  const [activeTab, setActiveTab] = useState<LibraryTab>("sheets");
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [newSetlistName, setNewSetlistName] = useState("");
  const [addSheetSelection, setAddSheetSelection] = useState<Record<string, string>>({});
  const [confirmDeleteSetlistId, setConfirmDeleteSetlistId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SheetSortBy>("recent");
  const [error, setError] = useState<string | null>(null);

  const [activeSheet, setActiveSheet] = useState<SheetRecord | null>(null);
  const [activeSetlistSession, setActiveSetlistSession] = useState<ActiveSetlistSession | null>(null);
  const [trimTarget, setTrimTarget] = useState<{ sheet: SheetRecord; subtitle?: string } | null>(
    null,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [savedCategories, setSavedCategories] = useState<string[]>(() => readSavedCategories());
  const [activeCategory, setActiveCategoryState] = useState<string>(() => readActiveCategoryFilter());
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renamingCategoryValue, setRenamingCategoryValue] = useState("");
  const [categoryPickerSheetId, setCategoryPickerSheetId] = useState<string | null>(null);
  const [pickerNewCategoryName, setPickerNewCategoryName] = useState("");

  const setActiveCategory = useCallback((next: string) => {
    setActiveCategoryState(next);
    writeActiveCategoryFilter(next);
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      const [sheetList, setlistList] = await Promise.all([listSheets(), listSetlists()]);
      setSheets(sheetList);
      setSetlists(setlistList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke lese notebiblioteket.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setUploading(true);
      setError(null);

      const rejected: string[] = [];
      let addedCount = 0;
      let lastSaved: SheetRecord | null = null;
      const autoCategories =
        activeCategory !== ALL_CATEGORIES_FILTER && activeCategory !== UNCATEGORIZED_FILTER
          ? [activeCategory]
          : [];

      try {
        for (const file of files) {
          if (!isValidPdfFile(file.name, file.type, file.size)) {
            rejected.push(file.name);
            continue;
          }
          const pdfData = await file.arrayBuffer();
          let probedPageCount = 0;
          if (files.length === 1) {
            try {
              const doc = await loadPdfDocument(pdfData);
              probedPageCount = doc.numPages;
              await doc.destroy();
            } catch {
              /* fall back to 0 if PDF.js is unavailable */
            }
          }
          const saved = await saveSheet({
            title: extractTitleFromFilename(file.name),
            fileName: file.name,
            fileSize: file.size,
            pageCount: probedPageCount,
            categories: autoCategories,
            pdfData,
          });
          lastSaved = saved;
          addedCount += 1;
        }

        if (addedCount > 0) {
          await refreshLibrary();
        }
        if (files.length === 1 && lastSaved && lastSaved.pageCount > 10) {
          setTrimTarget({
            sheet: lastSaved,
            subtitle: `Stor PDF (${lastSaved.pageCount} sider) – velg sidene du vil beholde, eller trykk Avbryt for å beholde alle.`,
          });
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
    [refreshLibrary, activeCategory],
  );

  const handleOpenTrimForSheet = useCallback(async (id: string) => {
    setError(null);
    try {
      const record = await getSheet(id);
      if (!record) {
        setError("Fant ikke PDF-filen i lokal lagring.");
        return;
      }
      setTrimTarget({ sheet: record });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke åpne sidevelgeren.");
    }
  }, []);

  const handleOpenSheet = useCallback(async (id: string, setlistSession?: ActiveSetlistSession | null) => {
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
      setActiveSetlistSession(setlistSession ?? null);
      setActiveSheet({ ...record, lastOpenedAt: now });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke åpne notearket.");
    }
  }, []);

  const handledDeepLinkRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    const fallbackParams =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const targetSheetId = deepLinkSheetId ?? fallbackParams?.get("sheet") ?? undefined;
    const targetSetlistId = deepLinkSetlistId ?? fallbackParams?.get("setlist") ?? undefined;
    if (!targetSheetId && !targetSetlistId) return;

    const key = targetSheetId ? `sheet:${targetSheetId}` : `setlist:${targetSetlistId}`;
    if (handledDeepLinkRef.current === key) return;

    if (targetSheetId) {
      if (!sheets.some((s) => s.id === targetSheetId)) return;
      handledDeepLinkRef.current = key;
      void handleOpenSheet(targetSheetId);
      return;
    }

    if (targetSetlistId) {
      const setlist = setlists.find((sl) => sl.id === targetSetlistId);
      if (!setlist) return;
      const firstSheetId = setlist.sheetIds.find((id) => sheets.some((s) => s.id === id));
      if (!firstSheetId) return;
      handledDeepLinkRef.current = key;
      void handleOpenSheet(firstSheetId, {
        setlistId: setlist.id,
        activeIndex: 0,
        initialPage: 1,
      });
    }
  }, [loading, deepLinkSheetId, deepLinkSetlistId, sheets, setlists, handleOpenSheet]);

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
      const updatedSetlists = await listSetlists();
      setSetlists(updatedSetlists);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke slette notearket.");
    }
  };

  const handleCreateSetlist = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = newSetlistName.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const created = await saveSetlist({ name: trimmed, sheetIds: [] });
      setSetlists((prev) => [created, ...prev]);
      setNewSetlistName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke opprette settliste.");
    }
  };

  const handleAddSheetToSetlist = async (setlist: SetlistRecord) => {
    const selectedId = addSheetSelection[setlist.id] ?? sheets[0]?.id;
    if (!selectedId) return;
    try {
      const updated = await saveSetlist({
        id: setlist.id,
        name: setlist.name,
        sheetIds: [...setlist.sheetIds, selectedId],
      });
      setSetlists((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke legge til stykke i settlisten.");
    }
  };

  const handleMoveSetlistSheet = async (
    setlist: SetlistRecord,
    fromIndex: number,
    toIndex: number,
  ) => {
    const nextIds = moveSetlistItem(setlist.sheetIds, fromIndex, toIndex);
    try {
      const updated = await saveSetlist({
        id: setlist.id,
        name: setlist.name,
        sheetIds: nextIds,
      });
      setSetlists((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke endre rekkefølgen i settlisten.");
    }
  };

  const handleRemoveSetlistSheet = async (setlist: SetlistRecord, indexToRemove: number) => {
    const nextIds = setlist.sheetIds.filter((_, idx) => idx !== indexToRemove);
    try {
      const updated = await saveSetlist({
        id: setlist.id,
        name: setlist.name,
        sheetIds: nextIds,
      });
      setSetlists((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke fjerne stykke fra settlisten.");
    }
  };

  const handleDeleteSetlist = async (id: string) => {
    setConfirmDeleteSetlistId(null);
    try {
      await deleteSetlist(id);
      setSetlists((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke slette settlisten.");
    }
  };

  const handleStartConcertMode = (setlist: SetlistRecord, startIndex = 0) => {
    const targetId = setlist.sheetIds[startIndex];
    if (!targetId) return;
    void handleOpenSheet(targetId, {
      setlistId: setlist.id,
      activeIndex: startIndex,
      initialPage: 1,
    });
  };

  const handleExportBackup = async () => {
    setError(null);
    setBackupNotice(null);
    try {
      const payload = await exportNoterBackup();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date(payload.exportedAt).toISOString().slice(0, 10);
      a.href = url;
      a.download = `noter-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupNotice(
        `Eksporterte backup med ${payload.sheets.length} noter og ${payload.setlists.length} settlister.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke eksportere backup.");
    }
  };

  const handleImportBackup = async (file: File) => {
    setError(null);
    setBackupNotice(null);
    try {
      const text = await file.text();
      const payload = parseNoterBackupJson(text);
      const summary = await restoreNoterBackup(payload);
      await refreshLibrary();
      setBackupNotice(
        `Gjenopprettet ${summary.matchedSheets} stykker, ${summary.restoredAnnotationPages} annoteringssider og ${summary.restoredSetlists} settlister.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gjenopprette backup.");
    } finally {
      if (backupInputRef.current) {
        backupInputRef.current.value = "";
      }
    }
  };

  const viewerSetlistContext = useMemo<ViewerSetlistContext | null>(() => {
    if (!activeSetlistSession) return null;
    const setlist = setlists.find((s) => s.id === activeSetlistSession.setlistId);
    if (!setlist) return null;
    const sheetMap = new Map(sheets.map((s) => [s.id, s]));
    const resolvedSheets = setlist.sheetIds
      .map((id) => sheetMap.get(id))
      .filter((s): s is SheetMeta => Boolean(s));
    if (resolvedSheets.length === 0) return null;

    return {
      setlist,
      sheets: resolvedSheets,
      activeIndex: Math.min(resolvedSheets.length - 1, Math.max(0, activeSetlistSession.activeIndex)),
      onSelectSheetIndex: (nextIndex, nextInitialPage = 1) => {
        const target = resolvedSheets[nextIndex];
        if (!target) return;
        void handleOpenSheet(target.id, {
          setlistId: setlist.id,
          activeIndex: nextIndex,
          initialPage: nextInitialPage,
        });
      },
    };
  }, [activeSetlistSession, setlists, sheets, handleOpenSheet]);

  const allCategories = useMemo(
    () => collectAllCategories(sheets, savedCategories),
    [sheets, savedCategories],
  );

  const categoryCounts = useMemo(
    () => countSheetsPerCategory(sheets, allCategories),
    [sheets, allCategories],
  );

  useEffect(() => {
    if (
      activeCategory !== ALL_CATEGORIES_FILTER &&
      activeCategory !== UNCATEGORIZED_FILTER &&
      !allCategories.some((c) => c.toLocaleLowerCase("nb") === activeCategory.toLocaleLowerCase("nb"))
    ) {
      setActiveCategory(ALL_CATEGORIES_FILTER);
    }
  }, [activeCategory, allCategories, setActiveCategory]);

  const registerCategoryName = useCallback((rawName: string): string | null => {
    const clean = normalizeCategoryName(rawName);
    if (!clean) return null;
    setSavedCategories((prev) => {
      const next = normalizeCategoriesList([...prev, clean]);
      writeSavedCategories(next);
      return next;
    });
    return clean;
  }, []);

  const handleCreateCategory = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = registerCategoryName(newCategoryName);
    if (!clean) return;
    setNewCategoryName("");
  };

  const handleToggleSheetCategory = async (sheet: SheetMeta, categoryName: string) => {
    const clean = registerCategoryName(categoryName);
    if (!clean) return;
    const nextCategories = toggleSheetCategory(sheet.categories, clean);
    try {
      const updated = await updateSheetMeta(sheet.id, { categories: nextCategories });
      if (updated) {
        setSheets((prev) => prev.map((s) => (s.id === sheet.id ? updated : s)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oppdatere kategorier.");
    }
  };

  const handleRenameCategory = async (oldName: string, nextRawName: string) => {
    const cleanNew = normalizeCategoryName(nextRawName);
    setRenamingCategory(null);
    if (!cleanNew || cleanNew.toLocaleLowerCase("nb") === oldName.toLocaleLowerCase("nb")) {
      return;
    }
    const updates = renameCategoryOnSheets(sheets, oldName, cleanNew);
    try {
      await Promise.all(
        updates.map((u) => updateSheetMeta(u.id, { categories: u.categories })),
      );
      setSheets((prev) =>
        prev.map((s) => {
          const hit = updates.find((u) => u.id === s.id);
          return hit ? { ...s, categories: hit.categories } : s;
        }),
      );
      setSavedCategories((prev) => {
        const next = normalizeCategoriesList(
          prev.map((c) => (c.toLocaleLowerCase("nb") === oldName.toLocaleLowerCase("nb") ? cleanNew : c)),
        );
        writeSavedCategories(next);
        return next;
      });
      if (activeCategory.toLocaleLowerCase("nb") === oldName.toLocaleLowerCase("nb")) {
        setActiveCategory(cleanNew);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gi nytt navn til kategori.");
    }
  };

  const handleDeleteCategory = async (categoryName: string) => {
    const updates = removeCategoryFromSheets(sheets, categoryName);
    try {
      await Promise.all(
        updates.map((u) => updateSheetMeta(u.id, { categories: u.categories })),
      );
      setSheets((prev) =>
        prev.map((s) => {
          const hit = updates.find((u) => u.id === s.id);
          return hit ? { ...s, categories: hit.categories } : s;
        }),
      );
      setSavedCategories((prev) => {
        const next = prev.filter(
          (c) => c.toLocaleLowerCase("nb") !== categoryName.toLocaleLowerCase("nb"),
        );
        writeSavedCategories(next);
        return next;
      });
      if (activeCategory.toLocaleLowerCase("nb") === categoryName.toLocaleLowerCase("nb")) {
        setActiveCategory(ALL_CATEGORIES_FILTER);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke slette kategori.");
    }
  };

  const filteredSheets = useMemo(() => {
    const byCategory = filterSheetsByCategory(sheets, activeCategory);
    const query = search.trim().toLocaleLowerCase("nb");
    const matching = query
      ? byCategory.filter(
          (s) =>
            s.title.toLocaleLowerCase("nb").includes(query) ||
            s.fileName.toLocaleLowerCase("nb").includes(query) ||
            (s.categories ?? []).some((c) => c.toLocaleLowerCase("nb").includes(query)),
        )
      : byCategory;
    return sortSheets(matching, sortBy);
  }, [sheets, activeCategory, search, sortBy]);

  const categoryPickerSheet = useMemo(
    () => (categoryPickerSheetId ? sheets.find((s) => s.id === categoryPickerSheetId) ?? null : null),
    [sheets, categoryPickerSheetId],
  );

  const sheetTitleMap = useMemo(() => new Map(sheets.map((s) => [s.id, s.title])), [sheets]);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-fg">Noter</h1>
            <p className="text-xs text-muted">
              Lagres lokalt i nettleseren — klar til øving og scene.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setBackupOpen((o) => !o)}
              aria-expanded={backupOpen}
              style={backupOpen ? { backgroundColor: "rgba(224, 177, 90, 0.14)" } : undefined}
              className={
                backupOpen
                  ? "metro-press flex min-h-10 items-center gap-1.5 rounded-xl border border-accent px-3 text-sm font-semibold text-accent"
                  : "metro-press flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-fg hover:border-accent"
              }
            >
              <Download className="size-4" aria-hidden="true" />
              <span>Backup</span>
            </button>
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

        <input
          ref={backupInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleImportBackup(file);
            }
          }}
        />

        {/* Backup & restore panel */}
        {backupOpen ? (
          <section
            aria-label="Backup og gjenoppretting"
            className="space-y-3 rounded-2xl border border-line bg-surface p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-fg">JSON-backup og gjenoppretting</h2>
                <p className="text-xs text-muted">
                  Eksporterer eller gjenoppretter annoteringer, bokmerker, hoppepunkter og settlister.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBackupOpen(false)}
                aria-label="Lukk backup-panel"
                className="metro-press flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-fg"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleExportBackup()}
                className="metro-press flex min-h-10 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-bold text-[#1a1408]"
              >
                <Download className="size-4" aria-hidden="true" />
                <span>Eksporter backup (JSON)</span>
              </button>
              <button
                type="button"
                onClick={() => backupInputRef.current?.click()}
                className="metro-press flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-header px-3.5 text-xs font-semibold text-fg hover:border-accent"
              >
                <Upload className="size-4" aria-hidden="true" />
                <span>Gjenopprett fra JSON</span>
              </button>
            </div>

            {backupNotice ? (
              <p
                role="status"
                style={{ backgroundColor: "rgba(224, 177, 90, 0.12)" }}
                className="rounded-xl border border-accent px-3 py-2 text-xs font-medium text-fg"
              >
                {backupNotice}
              </p>
            ) : null}
          </section>
        ) : null}

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

        {/* Library tabs: Alle noter / Settlister */}
        <div role="tablist" aria-label="Notebibliotek visning" className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "sheets"}
            onClick={() => setActiveTab("sheets")}
            style={
              activeTab === "sheets" ? { backgroundColor: "rgba(224, 177, 90, 0.16)" } : undefined
            }
            className={
              activeTab === "sheets"
                ? "metro-press flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-accent text-sm font-bold text-accent"
                : "metro-press flex min-h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-fg"
            }
          >
            <BookOpen className="size-4" aria-hidden="true" />
            <span>Alle noter ({sheets.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "setlists"}
            onClick={() => setActiveTab("setlists")}
            style={
              activeTab === "setlists" ? { backgroundColor: "rgba(224, 177, 90, 0.16)" } : undefined
            }
            className={
              activeTab === "setlists"
                ? "metro-press flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-accent text-sm font-bold text-accent"
                : "metro-press flex min-h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-muted hover:text-fg"
            }
          >
            <ListMusic className="size-4" aria-hidden="true" />
            <span>Settlister ({setlists.length})</span>
          </button>
        </div>

        {activeTab === "sheets" ? (
          <>
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

            {/* Category filter chips */}
            {sheets.length > 0 || allCategories.length > 0 ? (
              <div className="space-y-2">
                <div
                  role="region"
                  aria-label="Filtrer etter kategori"
                  className="flex items-center gap-1.5 overflow-x-auto pb-1"
                >
                  <button
                    type="button"
                    aria-pressed={activeCategory === ALL_CATEGORIES_FILTER}
                    onClick={() => setActiveCategory(ALL_CATEGORIES_FILTER)}
                    style={
                      activeCategory === ALL_CATEGORIES_FILTER
                        ? { backgroundColor: "rgba(224, 177, 90, 0.18)" }
                        : undefined
                    }
                    className={
                      activeCategory === ALL_CATEGORIES_FILTER
                        ? "metro-press min-h-10 shrink-0 rounded-full border border-accent px-3 text-xs font-bold text-accent"
                        : "metro-press min-h-10 shrink-0 rounded-full border border-line bg-surface px-3 text-xs font-medium text-muted hover:text-fg"
                    }
                  >
                    Alle ({categoryCounts.all})
                  </button>

                  {categoryCounts.uncategorized > 0 || activeCategory === UNCATEGORIZED_FILTER ? (
                    <button
                      type="button"
                      aria-pressed={activeCategory === UNCATEGORIZED_FILTER}
                      onClick={() => setActiveCategory(UNCATEGORIZED_FILTER)}
                      style={
                        activeCategory === UNCATEGORIZED_FILTER
                          ? { backgroundColor: "rgba(224, 177, 90, 0.18)" }
                          : undefined
                      }
                      className={
                        activeCategory === UNCATEGORIZED_FILTER
                          ? "metro-press min-h-10 shrink-0 rounded-full border border-accent px-3 text-xs font-bold text-accent"
                          : "metro-press min-h-10 shrink-0 rounded-full border border-line bg-surface px-3 text-xs font-medium text-muted hover:text-fg"
                      }
                    >
                      Uten kategori ({categoryCounts.uncategorized})
                    </button>
                  ) : null}

                  {allCategories.map((cat) => {
                    const selected =
                      activeCategory.toLocaleLowerCase("nb") === cat.toLocaleLowerCase("nb");
                    const count = categoryCounts.byCategory[cat] ?? 0;
                    return (
                      <button
                        key={cat}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setActiveCategory(cat)}
                        style={
                          selected
                            ? { backgroundColor: "rgba(224, 177, 90, 0.18)" }
                            : undefined
                        }
                        className={
                          selected
                            ? "metro-press min-h-10 shrink-0 rounded-full border border-accent px-3 text-xs font-bold text-accent"
                            : "metro-press min-h-10 shrink-0 rounded-full border border-line bg-surface px-3 text-xs font-medium text-muted hover:text-fg"
                        }
                      >
                        {cat} ({count})
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    aria-expanded={manageCategoriesOpen}
                    onClick={() => setManageCategoriesOpen((v) => !v)}
                    className="metro-press flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-dashed border-line bg-surface px-3 text-xs font-semibold text-muted hover:border-accent hover:text-accent"
                  >
                    {allCategories.length > 0 ? (
                      <>
                        <Settings2 className="size-3.5" aria-hidden="true" />
                        <span>Kategorier</span>
                      </>
                    ) : (
                      <>
                        <Plus className="size-3.5" aria-hidden="true" />
                        <span>Ny kategori</span>
                      </>
                    )}
                  </button>
                </div>

                {manageCategoriesOpen ? (
                  <section
                    aria-label="Administrer kategorier"
                    className="space-y-3 rounded-2xl border border-line bg-surface p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-fg">Administrer kategorier</h2>
                      <button
                        type="button"
                        onClick={() => setManageCategoriesOpen(false)}
                        aria-label="Lukk kategoribehandling"
                        className="metro-press flex size-9 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-fg"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </div>

                    <form onSubmit={handleCreateCategory} className="flex gap-2">
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="Ny kategori (f.eks. Korps, Marimba, Jul) …"
                        aria-label="Navn på ny kategori"
                        className="metro-field min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-header px-3 text-sm text-fg placeholder:text-muted"
                      />
                      <button
                        type="submit"
                        disabled={!newCategoryName.trim()}
                        className="metro-press flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-semibold text-[#1a1408] disabled:opacity-40"
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        <span>Legg til</span>
                      </button>
                    </form>

                    {allCategories.length > 0 ? (
                      <ul className="space-y-1.5">
                        {allCategories.map((cat) => {
                          const isRenaming = renamingCategory === cat;
                          return (
                            <li
                              key={cat}
                              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-header px-3 py-1.5"
                            >
                              {isRenaming ? (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    void handleRenameCategory(cat, renamingCategoryValue);
                                  }}
                                  className="flex min-w-0 flex-1 items-center gap-1.5"
                                >
                                  <input
                                    type="text"
                                    value={renamingCategoryValue}
                                    onChange={(e) => setRenamingCategoryValue(e.target.value)}
                                    autoFocus
                                    aria-label={`Nytt navn for ${cat}`}
                                    className="metro-field min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-sm text-fg"
                                  />
                                  <button
                                    type="submit"
                                    aria-label="Lagre kategorinavn"
                                    className="metro-press flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-[#1a1408]"
                                  >
                                    <Check className="size-4" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRenamingCategory(null)}
                                    aria-label="Avbryt"
                                    className="metro-press flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-fg"
                                  >
                                    <X className="size-4" aria-hidden="true" />
                                  </button>
                                </form>
                              ) : (
                                <>
                                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                                    {cat}{" "}
                                    <span className="text-xs text-muted">
                                      ({categoryCounts.byCategory[cat] ?? 0})
                                    </span>
                                  </span>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRenamingCategory(cat);
                                        setRenamingCategoryValue(cat);
                                      }}
                                      aria-label={`Gi nytt navn til kategori ${cat}`}
                                      className="metro-press flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-fg"
                                    >
                                      <Pencil className="size-3.5" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteCategory(cat)}
                                      aria-label={`Slett kategori ${cat}`}
                                      className="metro-press flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-no"
                                    >
                                      <Trash2 className="size-3.5" aria-hidden="true" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted">
                        Ingen kategorier ennå. Opprett en kategori over og fest den på notearkene.
                      </p>
                    )}
                  </section>
                ) : null}
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
                  Last opp din første PDF for å åpne i fullskjerm med sveip, Bluetooth-pedal,
                  nattmodus og hurtig-metronom.
                </p>
              </div>
            ) : filteredSheets.length === 0 ? (
              <div className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-muted">
                {search.trim()
                  ? `Ingen noter matcher «${search}».`
                  : "Ingen noter i denne kategorien ennå."}
              </div>
            ) : (
              <ul className="space-y-2.5">
                {filteredSheets.map((sheet) => {
                  const isEditing = editingId === sheet.id;
                  const isConfirmingDelete = confirmDeleteId === sheet.id;
                  const sheetCategories = normalizeCategoriesList(sheet.categories);

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
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => void handleOpenSheet(sheet.id)}
                              className="w-full text-left"
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

                            {sheetCategories.length > 0 ? (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {sheetCategories.map((cat) => (
                                  <button
                                    key={cat}
                                    type="button"
                                    onClick={() => setActiveCategory(cat)}
                                    style={{ backgroundColor: "rgba(224, 177, 90, 0.12)" }}
                                    className="metro-press rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-accent hover:border-accent"
                                  >
                                    {cat}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>

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
                                  onClick={() => {
                                    setPickerNewCategoryName("");
                                    setCategoryPickerSheetId(sheet.id);
                                  }}
                                  aria-label={`Kategorier for ${sheet.title}`}
                                  title="Velg kategorier"
                                  className={
                                    sheetCategories.length > 0
                                      ? "metro-press flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-header text-accent"
                                      : "metro-press flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-accent"
                                  }
                                >
                                  <Tag className="size-4" aria-hidden="true" />
                                </button>
                                {sheet.pageCount !== 1 ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleOpenTrimForSheet(sheet.id)}
                                    aria-label={`Velg sider for ${sheet.title}`}
                                    title="Velg sider å beholde"
                                    className="metro-press flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-accent"
                                  >
                                    <Scissors className="size-4" aria-hidden="true" />
                                  </button>
                                ) : null}
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
          </>
        ) : (
          /* Settlister tab */
          <div className="space-y-4">
            <form onSubmit={(e) => void handleCreateSetlist(e)} className="flex gap-2">
              <input
                type="text"
                value={newSetlistName}
                onChange={(e) => setNewSetlistName(e.target.value)}
                placeholder="Navn på ny settliste (f.eks. Konsert 17. mai) …"
                aria-label="Navn på ny settliste"
                className="metro-field min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted"
              />
              <button
                type="submit"
                disabled={!newSetlistName.trim()}
                className="metro-press flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-bold text-[#1a1408] disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span>Opprett</span>
              </button>
            </form>

            {setlists.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-5 py-8 text-center">
                <ListMusic className="size-8 text-accent" aria-hidden="true" />
                <h2 className="text-base font-semibold text-fg">Ingen settlister ennå</h2>
                <p className="max-w-xs text-sm text-muted">
                  Samle flere stykker i en rekkefølge for sømløs konsertmodus på scenen.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {setlists.map((setlist) => {
                  const selectedSheetId = addSheetSelection[setlist.id] ?? sheets[0]?.id ?? "";
                  const isConfirming = confirmDeleteSetlistId === setlist.id;

                  return (
                    <li
                      key={setlist.id}
                      className="space-y-3 rounded-2xl border border-line bg-surface p-3.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="truncate text-base font-bold text-fg">{setlist.name}</h2>
                          <p className="text-xs text-muted">
                            {setlist.sheetIds.length}{" "}
                            {setlist.sheetIds.length === 1 ? "stykke" : "stykker"}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleStartConcertMode(setlist, 0)}
                            disabled={setlist.sheetIds.length === 0}
                            className="metro-press flex min-h-10 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-bold text-[#1a1408] disabled:opacity-40"
                          >
                            <Play className="size-3.5" aria-hidden="true" />
                            <span>Start konsertmodus</span>
                          </button>

                          {isConfirming ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void handleDeleteSetlist(setlist.id)}
                                className="metro-press min-h-10 rounded-lg bg-no px-2.5 text-xs font-semibold text-white"
                              >
                                Slett
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteSetlistId(null)}
                                className="metro-press min-h-10 rounded-lg border border-line bg-header px-2.5 text-xs font-medium text-muted hover:text-fg"
                              >
                                Avbryt
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteSetlistId(setlist.id)}
                              aria-label={`Slett settliste ${setlist.name}`}
                              className="metro-press flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-no"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>

                      {setlist.sheetIds.length > 0 ? (
                        <ol className="space-y-1.5">
                          {setlist.sheetIds.map((sheetId, index) => {
                            const title = sheetTitleMap.get(sheetId) ?? "Ukjent stykke";
                            return (
                              <li
                                key={`${sheetId}-${index}`}
                                className="flex items-center justify-between gap-2 rounded-xl border border-line bg-header px-2.5 py-1.5"
                              >
                                <button
                                  type="button"
                                  onClick={() => handleStartConcertMode(setlist, index)}
                                  className="min-w-0 flex-1 text-left text-sm font-medium text-fg hover:text-accent"
                                >
                                  <span className="mr-1.5 text-xs font-bold text-accent tabular-nums">
                                    {index + 1}.
                                  </span>
                                  <span className="truncate">{title}</span>
                                </button>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleMoveSetlistSheet(setlist, index, index - 1)
                                    }
                                    disabled={index === 0}
                                    aria-label={`Flytt ${title} opp`}
                                    className="metro-press flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-fg disabled:opacity-35"
                                  >
                                    <ArrowUp className="size-3.5" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleMoveSetlistSheet(setlist, index, index + 1)
                                    }
                                    disabled={index === setlist.sheetIds.length - 1}
                                    aria-label={`Flytt ${title} ned`}
                                    className="metro-press flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-fg disabled:opacity-35"
                                  >
                                    <ArrowDown className="size-3.5" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveSetlistSheet(setlist, index)}
                                    aria-label={`Fjern ${title} fra settlisten`}
                                    className="metro-press flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-no"
                                  >
                                    <X className="size-3.5" aria-hidden="true" />
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <p className="text-xs text-muted">
                          Ingen stykker lagt til ennå. Velg et stykke nedenfor.
                        </p>
                      )}

                      {sheets.length > 0 ? (
                        <div className="flex gap-2">
                          <select
                            value={selectedSheetId}
                            onChange={(e) =>
                              setAddSheetSelection((prev) => ({
                                ...prev,
                                [setlist.id]: e.target.value,
                              }))
                            }
                            aria-label={`Velg stykke til ${setlist.name}`}
                            className="metro-field min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-header px-3 text-sm text-fg"
                          >
                            {sheets.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.title}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleAddSheetToSetlist(setlist)}
                            className="metro-press flex min-h-10 shrink-0 items-center gap-1 rounded-xl border border-accent px-3 text-xs font-bold text-accent"
                          >
                            <Plus className="size-3.5" aria-hidden="true" />
                            <span>Legg til</span>
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {activeSheet ? (
        <NoterViewer
          sheet={activeSheet}
          initialPage={activeSetlistSession?.initialPage}
          setlistContext={viewerSetlistContext}
          onClose={() => {
            setActiveSheet(null);
            setActiveSetlistSession(null);
          }}
          onUpdateMeta={handleUpdateActiveMeta}
          onSheetReplaced={(updated) => {
            setActiveSheet(updated);
            setSheets((prev) =>
              prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
            );
          }}
          onSheetCopied={(created) => {
            setSheets((prev) => [created, ...prev]);
          }}
        />
      ) : null}

      {trimTarget ? (
        <NoterPageTrimModal
          open={true}
          onClose={() => setTrimTarget(null)}
          sheetTitle={trimTarget.sheet.title}
          pdfData={trimTarget.sheet.pdfData}
          pageCount={trimTarget.sheet.pageCount}
          subtitle={trimTarget.subtitle}
          onReplacePages={async (keptPages, trimmedPdfData) => {
            const updated = await replaceSheetWithTrimmedPdf({
              sheetId: trimTarget.sheet.id,
              pdfData: trimmedPdfData,
              keptPages,
            });
            if (updated) {
              setSheets((prev) =>
                prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
              );
            }
          }}
          onSaveAsCopy={async (keptPages, trimmedPdfData, copyTitle) => {
            const created = await saveTrimmedSheetAsCopy({
              sourceSheetId: trimTarget.sheet.id,
              title: copyTitle,
              pdfData: trimmedPdfData,
              keptPages,
            });
            setSheets((prev) => [created, ...prev]);
          }}
        />
      ) : null}

      {categoryPickerSheet ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-picker-title"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.72)" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setCategoryPickerSheetId(null)}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wider text-accent uppercase">
                  Kategorier
                </p>
                <h2 id="category-picker-title" className="truncate text-base font-bold text-fg">
                  {categoryPickerSheet.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCategoryPickerSheetId(null)}
                aria-label="Lukk kategorivelger"
                className="metro-press flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-header text-muted hover:text-fg"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {allCategories.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {allCategories.map((cat) => {
                  const active = normalizeCategoriesList(categoryPickerSheet.categories).some(
                    (c) => c.toLocaleLowerCase("nb") === cat.toLocaleLowerCase("nb"),
                  );
                  return (
                    <button
                      key={cat}
                      type="button"
                      aria-pressed={active}
                      onClick={() => void handleToggleSheetCategory(categoryPickerSheet, cat)}
                      style={
                        active ? { backgroundColor: "rgba(224, 177, 90, 0.18)" } : undefined
                      }
                      className={
                        active
                          ? "metro-press flex min-h-10 items-center gap-1.5 rounded-full border border-accent px-3 text-sm font-semibold text-accent"
                          : "metro-press flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-header px-3 text-sm font-medium text-muted hover:text-fg"
                      }
                    >
                      {active ? <Check className="size-3.5" aria-hidden="true" /> : null}
                      <span>{cat}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted">
                Ingen kategorier opprettet ennå. Skriv inn en kategori under for å legge til.
              </p>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const raw = pickerNewCategoryName;
                if (!normalizeCategoryName(raw)) return;
                setPickerNewCategoryName("");
                void handleToggleSheetCategory(categoryPickerSheet, raw);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={pickerNewCategoryName}
                onChange={(e) => setPickerNewCategoryName(e.target.value)}
                placeholder="Ny kategori …"
                aria-label="Ny kategori for dette stykket"
                className="metro-field min-h-10 min-w-0 flex-1 rounded-xl border border-line bg-header px-3 text-sm text-fg placeholder:text-muted"
              />
              <button
                type="submit"
                disabled={!pickerNewCategoryName.trim()}
                className="metro-press flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-semibold text-[#1a1408] disabled:opacity-40"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span>Legg til</span>
              </button>
            </form>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setCategoryPickerSheetId(null)}
                className="metro-press min-h-10 rounded-xl border border-line bg-header px-4 text-sm font-semibold text-fg hover:border-accent"
              >
                Ferdig
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
