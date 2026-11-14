export type DeviceRole = "controller" | "display";

export interface DevicePresence {
  id: string;
  name: string;
  role: DeviceRole;
  audioActive: boolean;
  onlineAt: number;
}

export type SyncPayload =
  // Øveplan events
  | {
      type: "PLAN_START";
      blockId: string;
      mins: number;
      bpm: number;
      beats: number;
      sub: number;
      durationSec: number;
      endsAt: number;
      remainMs?: number;
    }
  | {
      type: "PLAN_ARM";
      blockId: string;
      mins: number;
      bpm: number;
      beats: number;
      sub: number;
      remainMs?: number;
      chime?: boolean;
    }
  | { type: "PLAN_PAUSE"; remainMs: number }
  | { type: "PLAN_RESUME"; endsAt: number; remainMs?: number }
  | { type: "PLAN_STOP"; chime?: boolean }
  | { type: "PLAN_NAVIGATE"; to: string }
  // Metronome events
  | { type: "METRO_SET"; bpm: number; beats?: number; sub?: number }
  | { type: "METRO_START"; bpm: number; beats?: number; sub?: number }
  | { type: "METRO_STOP" }
  // Sight-Reading events
  | { type: "SIGHT_SET"; level?: number; seed?: number; instrument?: string; score?: unknown; tempo?: number }
  | {
      type: "SIGHT_ACTION";
      action: "generate" | "togglePlay" | "toggleMetro" | "startPlay" | "stopPlay" | "startMetro" | "stopMetro" | "again";
    }
  // Instrument profile switch
  | { type: "PROFILE_SET"; profile: "mallets" | "trumpet" }
  // State synchronization request from a newly connected display
  | { type: "SYNC_REQUEST" };

export interface SyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  roomCode: string;
  deviceId: string;
  deviceName: string;
  role: DeviceRole;
  audioActive: boolean;
}

export interface SyncState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  roomCode: string;
  role: DeviceRole;
  deviceName: string;
  audioActive: boolean;
  peers: DevicePresence[];
}
