import type { JumpLink, SetlistRecord, SheetBookmark } from "./noter.ts";

export function moveSetlistItem(
  sheetIds: readonly string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  const list = [...sheetIds];
  if (
    fromIndex < 0 ||
    fromIndex >= list.length ||
    toIndex < 0 ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return list;
  }
  const [moved] = list.splice(fromIndex, 1);
  if (moved !== undefined) {
    list.splice(toIndex, 0, moved);
  }
  return list;
}

export function removeDeletedSheetFromSetlist(
  setlist: SetlistRecord,
  deletedSheetId: string,
): SetlistRecord {
  if (!setlist.sheetIds.includes(deletedSheetId)) {
    return setlist;
  }
  return {
    ...setlist,
    sheetIds: setlist.sheetIds.filter((id) => id !== deletedSheetId),
    updatedAt: Date.now(),
  };
}

export type SetlistStepResult = {
  sheetIndex: number;
  page: number;
};

export function getSetlistBoundaryStep(
  sheetPageCounts: readonly number[],
  activeIndex: number,
  direction: "next" | "prev",
): SetlistStepResult | null {
  if (sheetPageCounts.length === 0) return null;
  if (activeIndex < 0 || activeIndex >= sheetPageCounts.length) return null;

  if (direction === "next") {
    const nextIndex = activeIndex + 1;
    if (nextIndex >= sheetPageCounts.length) return null;
    return { sheetIndex: nextIndex, page: 1 };
  }

  const prevIndex = activeIndex - 1;
  if (prevIndex < 0) return null;
  const prevPages = Math.max(1, Math.floor(sheetPageCounts[prevIndex] || 1));
  return { sheetIndex: prevIndex, page: prevPages };
}

export function sortBookmarks(bookmarks: readonly SheetBookmark[]): SheetBookmark[] {
  return [...bookmarks].sort(
    (a, b) => a.page - b.page || a.createdAt - b.createdAt || a.label.localeCompare(b.label, "nb"),
  );
}

export function getJumpLinksForPage(
  jumpLinks: readonly JumpLink[] | undefined,
  pageNumber: number,
): JumpLink[] {
  if (!jumpLinks || jumpLinks.length === 0) return [];
  return jumpLinks.filter((link) => link.sourcePage === pageNumber);
}

const MAX_JUMP_HISTORY = 12;

export function pushJumpHistory(history: readonly number[], fromPage: number): number[] {
  const safePage = Number.isFinite(fromPage) ? Math.max(1, Math.floor(fromPage)) : 1;
  const next = [...history, safePage];
  return next.length > MAX_JUMP_HISTORY ? next.slice(next.length - MAX_JUMP_HISTORY) : next;
}

export function popJumpHistory(history: readonly number[]): {
  targetPage: number | null;
  history: number[];
} {
  if (history.length === 0) {
    return { targetPage: null, history: [] };
  }
  const next = [...history];
  const targetPage = next.pop() ?? null;
  return { targetPage, history: next };
}
