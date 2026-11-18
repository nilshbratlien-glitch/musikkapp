import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "./client.ts";
import { loadSyncConfig, saveSyncConfig } from "./config.ts";
import type { DevicePresence, DeviceRole, SyncPayload, SyncState } from "./types.ts";

type PayloadListener = (payload: SyncPayload) => void;

let channel: RealtimeChannel | null = null;
let wakeLockSentinel: WakeLockSentinel | null = null;
const payloadListeners = new Set<PayloadListener>();
const stateListeners = new Set<() => void>();

const initialConfig = loadSyncConfig();

let state: SyncState = {
  connected: false,
  connecting: false,
  error: null,
  roomCode: initialConfig.roomCode,
  role: initialConfig.role,
  deviceName: initialConfig.deviceName,
  audioActive: initialConfig.audioActive,
  peers: [],
};

function emitState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const listener of stateListeners) listener();
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSyncState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function onSyncPayload(listener: PayloadListener): () => void {
  payloadListeners.add(listener);
  return () => {
    payloadListeners.delete(listener);
  };
}

async function updateWakeLock(role: DeviceRole, connected: boolean) {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
  try {
    if (connected && role === "display") {
      if (!wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request("screen");
      }
    } else if (wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  } catch {
    /* WakeLock can fail if window is minimized or not active */
  }
}

export async function joinRoom(roomCode: string, role?: DeviceRole, deviceName?: string) {
  const code = roomCode.trim().toUpperCase();
  if (!code) {
    emitState({ error: "Romkode må fylles ut" });
    return;
  }

  const client = getSupabaseClient();
  if (!client) {
    emitState({
      error: "Supabase-konfigurasjon mangler (URL eller Anon Key). Fyll inn i innstillinger.",
      connecting: false,
    });
    return;
  }

  // If already connected to this channel, leave first
  if (channel) {
    await leaveRoom();
  }

  const currentConfig = loadSyncConfig();
  const nextRole = role ?? currentConfig.role;
  const nextName = deviceName?.trim() || currentConfig.deviceName;

  saveSyncConfig({
    roomCode: code,
    role: nextRole,
    deviceName: nextName,
  });

  emitState({
    connecting: true,
    error: null,
    roomCode: code,
    role: nextRole,
    deviceName: nextName,
  });

  const channelName = `musikkapp:${code}`;
  try {
    channel = client.channel(channelName, {
      config: {
        broadcast: { self: false },
        presence: { key: currentConfig.deviceId },
      },
    });
  } catch {
    emitState({
      connecting: false,
      error: "Kunne ikke opprette synkroniseringskanal mot Supabase.",
    });
    return;
  }

  // Listen to remote broadcast events
  channel.on("broadcast", { event: "sync" }, ({ payload }) => {
    const data = payload as SyncPayload;
    for (const listener of payloadListeners) {
      try {
        listener(data);
      } catch (err) {
        console.error("[sync] Listener error:", err);
      }
    }
  });

  // Listen to presence events
  channel.on("presence", { event: "sync" }, () => {
    if (!channel) return;
    const presenceState = channel.presenceState<DevicePresence>();
    const peers: DevicePresence[] = [];
    for (const list of Object.values(presenceState)) {
      for (const item of list) {
        peers.push(item);
      }
    }
    emitState({ peers });
  });

  channel.on("presence", { event: "join" }, () => {
    if (state.role === "controller") {
      for (const listener of payloadListeners) {
        try {
          listener({ type: "SYNC_REQUEST" });
        } catch (err) {
          console.error("[sync] Listener error:", err);
        }
      }
    }
  });

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      emitState({ connected: true, connecting: false, error: null });
      await trackPresence(nextRole, nextName, state.audioActive);
      await updateWakeLock(nextRole, true);
      if (nextRole === "display") {
        broadcastSync({ type: "SYNC_REQUEST" });
      }
    } else if (status === "CLOSED" || status === "TIMED_OUT") {
      emitState({ connected: false, connecting: false });
      await updateWakeLock(nextRole, false);
    } else if (status === "CHANNEL_ERROR") {
      emitState({ connected: false, connecting: false, error: "Tilkoblingsfeil mot Supabase" });
      await updateWakeLock(nextRole, false);
    }
  });
}

export async function leaveRoom() {
  if (channel) {
    try {
      await channel.untrack();
      await channel.unsubscribe();
    } catch {
      /* ignore */
    }
    channel = null;
  }
  saveSyncConfig({ roomCode: "" });
  emitState({
    connected: false,
    connecting: false,
    roomCode: "",
    peers: [],
    error: null,
  });
  await updateWakeLock(state.role, false);
}

export async function trackPresence(role: DeviceRole, name: string, audioActive: boolean) {
  if (!channel) return;
  const config = loadSyncConfig();
  const presence: DevicePresence = {
    id: config.deviceId,
    name,
    role,
    audioActive,
    onlineAt: Date.now(),
  };
  try {
    await channel.track(presence);
  } catch (err) {
    console.error("[sync] Track presence failed:", err);
  }
}

export function broadcastSync(payload: SyncPayload) {
  if (!channel || !state.connected) return;
  channel.send({
    type: "broadcast",
    event: "sync",
    payload,
  }).catch((err) => {
    console.error("[sync] Send broadcast failed:", err);
  });
}

export async function setRole(role: DeviceRole) {
  saveSyncConfig({ role });
  emitState({ role });
  await trackPresence(role, state.deviceName, state.audioActive);
  await updateWakeLock(role, state.connected);
  if (state.connected && role === "display") {
    broadcastSync({ type: "SYNC_REQUEST" });
  } else if (state.connected && role === "controller") {
    for (const listener of payloadListeners) {
      try {
        listener({ type: "SYNC_REQUEST" });
      } catch (err) {
        console.error("[sync] Listener error:", err);
      }
    }
  }
}

export async function setAudioActive(active: boolean) {
  saveSyncConfig({ audioActive: active });
  emitState({ audioActive: active });
  await trackPresence(state.role, state.deviceName, active);
}

export async function setDeviceName(name: string) {
  const clean = name.trim() || state.deviceName;
  saveSyncConfig({ deviceName: clean });
  emitState({ deviceName: clean });
  await trackPresence(state.role, clean, state.audioActive);
}

// Auto-reconnect if roomCode is stored and Supabase is configured
export function autoReconnectIfConfigured() {
  const config = loadSyncConfig();
  if (config.roomCode && config.supabaseUrl && config.supabaseAnonKey && !state.connected && !state.connecting) {
    void joinRoom(config.roomCode, config.role, config.deviceName);
  }
}
