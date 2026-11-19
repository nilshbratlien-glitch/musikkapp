export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "musikkapp.theme";

export const THEME_COLOR_META: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#0f1218",
};

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Lys",
  dark: "Mørk",
};

/**
 * Inline script executed synchronously in <head> before first paint to prevent
 * a flash of the wrong theme during SSR hydration.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");if(p!=="light"&&p!=="dark")p="system";var t=p==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="light"?"${THEME_COLOR_META.light}":"${THEME_COLOR_META.dark}");}catch(e){}})();`;

let memoryPreference: ThemePreference = "system";
let version = 0;
let initialized = false;
const listeners = new Set<() => void>();

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizeThemePreference(raw: unknown): ThemePreference {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function getThemePreference(): ThemePreference {
  const storage = browserStorage();
  if (storage) {
    try {
      const raw = storage.getItem(THEME_STORAGE_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") return raw;
    } catch {
      /* ignore */
    }
  }
  return memoryPreference;
}

export function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch {
    return false;
  }
}

export function resolveTheme(
  preference: ThemePreference = getThemePreference(),
  prefersLight: boolean = systemPrefersLight(),
): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return prefersLight ? "light" : "dark";
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(getThemePreference(), systemPrefersLight());
}

export function applyThemeToDocument(resolved: ResolvedTheme = getResolvedTheme()): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root) {
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", THEME_COLOR_META[resolved]);
  }
}

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

export function setThemePreference(preference: ThemePreference): void {
  const next = normalizeThemePreference(preference);
  memoryPreference = next;
  const storage = browserStorage();
  if (storage) {
    try {
      storage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }
  applyThemeToDocument(resolveTheme(next));
  notify();
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

export function cycleThemePreference(): ThemePreference {
  const next = nextThemePreference(getThemePreference());
  setThemePreference(next);
  return next;
}

export function initTheme(): void {
  applyThemeToDocument(getResolvedTheme());
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (getThemePreference() === "system") {
      applyThemeToDocument(getResolvedTheme());
      notify();
    }
  };
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
  } else if (typeof media.addListener === "function") {
    media.addListener(onChange);
  }
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getThemeVersion() {
  return version;
}

export function _resetThemeForTests() {
  memoryPreference = "system";
  initialized = false;
}
