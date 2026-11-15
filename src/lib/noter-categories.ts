import type { SheetMeta } from "./noter.ts";

export const ALL_CATEGORIES_FILTER = "__all__";
export const UNCATEGORIZED_FILTER = "__uncategorized__";

const SAVED_CATEGORIES_KEY = "musikkapp.noter.categories";
const ACTIVE_CATEGORY_KEY = "musikkapp.noter.activeCategory";

export function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function normalizeCategoriesList(categories?: readonly string[] | null): string[] {
  if (!categories || categories.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of categories) {
    if (typeof raw !== "string") continue;
    const normalized = normalizeCategoryName(raw);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("nb");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function toggleSheetCategory(
  current: readonly string[] | undefined,
  category: string,
): string[] {
  const normalizedTarget = normalizeCategoryName(category);
  if (!normalizedTarget) return normalizeCategoriesList(current);
  const list = normalizeCategoriesList(current);
  const targetKey = normalizedTarget.toLocaleLowerCase("nb");
  const exists = list.some((c) => c.toLocaleLowerCase("nb") === targetKey);
  if (exists) {
    return list.filter((c) => c.toLocaleLowerCase("nb") !== targetKey);
  }
  return [...list, normalizedTarget];
}

export function collectAllCategories(
  sheets: readonly Pick<SheetMeta, "categories">[],
  savedCategories: readonly string[] = [],
): string[] {
  const merged = new Map<string, string>();
  for (const sheet of sheets) {
    for (const raw of sheet.categories ?? []) {
      const clean = normalizeCategoryName(raw);
      if (!clean) continue;
      const key = clean.toLocaleLowerCase("nb");
      if (!merged.has(key)) merged.set(key, clean);
    }
  }
  for (const raw of savedCategories) {
    const clean = normalizeCategoryName(raw);
    if (!clean) continue;
    const key = clean.toLocaleLowerCase("nb");
    if (!merged.has(key)) merged.set(key, clean);
  }
  return [...merged.values()].sort((a, b) => a.localeCompare(b, "nb", { sensitivity: "base" }));
}

export function filterSheetsByCategory<T extends Pick<SheetMeta, "categories">>(
  sheets: readonly T[],
  filter: string,
): T[] {
  if (!filter || filter === ALL_CATEGORIES_FILTER) {
    return [...sheets];
  }
  if (filter === UNCATEGORIZED_FILTER) {
    return sheets.filter((s) => normalizeCategoriesList(s.categories).length === 0);
  }
  const targetKey = normalizeCategoryName(filter).toLocaleLowerCase("nb");
  if (!targetKey) return [...sheets];
  return sheets.filter((s) =>
    normalizeCategoriesList(s.categories).some((c) => c.toLocaleLowerCase("nb") === targetKey),
  );
}

export function countSheetsPerCategory(
  sheets: readonly Pick<SheetMeta, "categories">[],
  categories: readonly string[],
): {
  all: number;
  uncategorized: number;
  byCategory: Record<string, number>;
} {
  let uncategorized = 0;
  const countsByKey = new Map<string, number>();

  for (const sheet of sheets) {
    const list = normalizeCategoriesList(sheet.categories);
    if (list.length === 0) {
      uncategorized += 1;
      continue;
    }
    for (const cat of list) {
      const key = cat.toLocaleLowerCase("nb");
      countsByKey.set(key, (countsByKey.get(key) ?? 0) + 1);
    }
  }

  const byCategory: Record<string, number> = {};
  for (const cat of categories) {
    const clean = normalizeCategoryName(cat);
    if (!clean) continue;
    byCategory[clean] = countsByKey.get(clean.toLocaleLowerCase("nb")) ?? 0;
  }

  return {
    all: sheets.length,
    uncategorized,
    byCategory,
  };
}

export function renameCategoryOnSheets(
  sheets: readonly Pick<SheetMeta, "id" | "categories">[],
  oldName: string,
  newName: string,
): Array<{ id: string; categories: string[] }> {
  const oldKey = normalizeCategoryName(oldName).toLocaleLowerCase("nb");
  const cleanNew = normalizeCategoryName(newName);
  if (!oldKey || !cleanNew) return [];

  const updates: Array<{ id: string; categories: string[] }> = [];
  for (const sheet of sheets) {
    const current = normalizeCategoriesList(sheet.categories);
    if (!current.some((c) => c.toLocaleLowerCase("nb") === oldKey)) continue;
    const replaced = normalizeCategoriesList(
      current.map((c) => (c.toLocaleLowerCase("nb") === oldKey ? cleanNew : c)),
    );
    updates.push({ id: sheet.id, categories: replaced });
  }
  return updates;
}

export function removeCategoryFromSheets(
  sheets: readonly Pick<SheetMeta, "id" | "categories">[],
  categoryName: string,
): Array<{ id: string; categories: string[] }> {
  const targetKey = normalizeCategoryName(categoryName).toLocaleLowerCase("nb");
  if (!targetKey) return [];

  const updates: Array<{ id: string; categories: string[] }> = [];
  for (const sheet of sheets) {
    const current = normalizeCategoriesList(sheet.categories);
    if (!current.some((c) => c.toLocaleLowerCase("nb") === targetKey)) continue;
    updates.push({
      id: sheet.id,
      categories: current.filter((c) => c.toLocaleLowerCase("nb") !== targetKey),
    });
  }
  return updates;
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readSavedCategories(): string[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(SAVED_CATEGORIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeCategoriesList(parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function writeSavedCategories(categories: readonly string[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(SAVED_CATEGORIES_KEY, JSON.stringify(normalizeCategoriesList(categories)));
  } catch {
    /* ignore storage quota errors */
  }
}

export function readActiveCategoryFilter(): string {
  const storage = getStorage();
  if (!storage) return ALL_CATEGORIES_FILTER;
  try {
    return storage.getItem(ACTIVE_CATEGORY_KEY) || ALL_CATEGORIES_FILTER;
  } catch {
    return ALL_CATEGORIES_FILTER;
  }
}

export function writeActiveCategoryFilter(filter: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(ACTIVE_CATEGORY_KEY, filter || ALL_CATEGORIES_FILTER);
  } catch {
    /* ignore storage quota errors */
  }
}
