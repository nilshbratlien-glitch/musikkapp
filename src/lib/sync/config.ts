import type { DeviceRole, SyncConfig } from "./types.ts";

const STORAGE_KEY = "musikkapp.sync";

function defaultDeviceName(): string {
  if (typeof navigator === "undefined") return "Enhet";
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android-enhet";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "PC";
  return "Nettleser";
}

function randomId(prefix = "dev"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function safeGetEnv(key: string): string {
  try {
    const meta = import.meta as { env?: Record<string, string> };
    if (meta?.env?.[key]) return meta.env[key] || "";
  } catch {
    /* ignore */
  }
  try {
    if (typeof process !== "undefined" && process.env?.[key]) {
      return process.env[key] || "";
    }
  } catch {
    /* ignore */
  }
  return "";
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function generateRoomCode(): string {
  const words = ["BEAT", "TAKT", "PULS", "RITM", "NOTE", "KLAV", "XYLO", "DRUM"];
  const word = words[Math.floor(Math.random() * words.length)] ?? "NOTE";
  const num = Math.floor(100 + Math.random() * 900);
  return `${word}-${num}`;
}

export function loadSyncConfig(): SyncConfig {
  const envUrl = safeGetEnv("VITE_SUPABASE_URL");
  const envKey = safeGetEnv("VITE_SUPABASE_ANON_KEY");

  let saved: Partial<SyncConfig> = {};
  const storage = getStorage();
  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) as Partial<SyncConfig>;
    } catch {
      /* fallback to defaults */
    }
  }

  const deviceId = saved.deviceId || randomId();
  const deviceName = saved.deviceName || defaultDeviceName();
  const role: DeviceRole = saved.role === "display" ? "display" : "controller";
  const audioActive = typeof saved.audioActive === "boolean" ? saved.audioActive : role === "display";
  const roomCode = saved.roomCode || "";
  const supabaseUrl = saved.supabaseUrl || envUrl;
  const supabaseAnonKey = saved.supabaseAnonKey || envKey;

  const config: SyncConfig = {
    supabaseUrl,
    supabaseAnonKey,
    roomCode,
    deviceId,
    deviceName,
    role,
    audioActive,
  };

  saveSyncConfig(config);
  return config;
}

export function saveSyncConfig(config: Partial<SyncConfig>) {
  const storage = getStorage();
  if (!storage) return;
  try {
    const current = loadSyncConfigSnapshot();
    const merged = { ...current, ...config };
    storage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* localStorage blocked */
  }
}

function loadSyncConfigSnapshot(): Partial<SyncConfig> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<SyncConfig>) : {};
  } catch {
    return {};
  }
}
