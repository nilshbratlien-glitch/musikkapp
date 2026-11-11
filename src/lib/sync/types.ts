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
    }
  | {
      type: "PLAN_ARM";
      blockId: string;
      mins: number;
      bpm: number;
      beats: number;
      sub: number;
    }
  | { type: "PLAN_PAUSE"; remainMs: number }
  | { type: "PLAN_RESUME"; endsAt: number }
  | { type: "PLAN_STOP" }
  | { type: "PLAN_NAVIGATE"; to: string }
  // Metronome events
  | { type: "METRO_SET"; bpm: number; beats?: number; sub?: number }
  | { type: "METRO_START"; bpm: number; beats?: number; sub?: number }
  | { type: "METRO_STOP" }
  // Sight-Reading events
  | { type: "SIGHT_SET"; level?: number; seed?: number; instrument?: string };

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
