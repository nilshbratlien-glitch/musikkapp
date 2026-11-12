export type InstrumentProfile = "mallets" | "trumpet";

export const PROFILE_STORAGE_KEY = "musikkapp.profile";

export const PROFILE_META: Record<
  InstrumentProfile,
  { id: InstrumentProfile; label: string; emoji: string; subtitle: string; description: string }
> = {
  mallets: {
    id: "mallets",
    label: "Køller",
    emoji: "🥁",
    subtitle: "Marimba, xylofon, vibrafon & klokkespill",
    description: "2–4 køller, grep, virvler og øveplan for slagverk.",
  },
  trumpet: {
    id: "trumpet",
    label: "Trompet",
    emoji: "🎺",
    subtitle: "B-trompet (korps & kulturskole)",
    description: "Ventilgrep (0, 1, 1-2…), B-transponert trompetlyd og egen korps-øveplan.",
  },
};

let memoryProfile: InstrumentProfile = "mallets";
let memoryChosen = false;
let version = 0;
const listeners = new Set<() => void>();
let broadcastHook: ((profile: InstrumentProfile) => void) | null = null;

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getProfile(): InstrumentProfile {
  const storage = browserStorage();
  if (storage) {
    try {
      const raw = storage.getItem(PROFILE_STORAGE_KEY);
      if (raw === "trumpet" || raw === "mallets") return raw;
    } catch {
      /* ignore */
    }
  }
  return memoryProfile;
}

export function hasChosenProfile(): boolean {
  if (typeof navigator !== "undefined" && navigator.webdriver) return true;
  const storage = browserStorage();
  if (storage) {
    try {
      const raw = storage.getItem(PROFILE_STORAGE_KEY);
      if (raw === "trumpet" || raw === "mallets") return true;
    } catch {
      /* ignore */
    }
  }
  return memoryChosen;
}

export function setProfileBroadcastHook(fn: ((profile: InstrumentProfile) => void) | null) {
  broadcastHook = fn;
}

export function setProfile(profile: InstrumentProfile, opts?: { broadcast?: boolean }) {
  const next: InstrumentProfile = profile === "trumpet" ? "trumpet" : "mallets";
  memoryProfile = next;
  memoryChosen = true;
  const storage = browserStorage();
  if (storage) {
    try {
      storage.setItem(PROFILE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }
  version += 1;
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") {
    window.MalletSight?.setProfile?.(next);
  }
  if (opts?.broadcast !== false) {
    broadcastHook?.(next);
  }
}

export function subscribeProfile(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProfileVersion() {
  return version;
}

export const MusikkProfile = {
  get: getProfile,
  set: (profile: InstrumentProfile) => setProfile(profile),
  hasChosen: hasChosenProfile,
  subscribe: subscribeProfile,
};

declare global {
  interface Window {
    MusikkProfile?: typeof MusikkProfile;
  }
}

if (typeof window !== "undefined") {
  window.MusikkProfile = MusikkProfile;
}
