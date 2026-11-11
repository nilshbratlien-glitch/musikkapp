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
      meter: string;
      sub: number;
      durationSec: number;
      endsAt: number;
    }
  | { type: "PLAN_PAUSE"; remainMs: number }
  | { type: "PLAN_RESUME"; endsAt: number }
  | { type: "PLAN_SKIP"; nextBlockId: string }
  | { type: "PLAN_FINISH"; blockId: string }
  | { type: "PLAN_NAVIGATE"; to: string }
  // Metronome events
  | { type: "METRO_SET"; bpm: number; meter?: string; sub?: number }
  | { type: "METRO_START"; bpm: number; meter?: string; sub?: number }
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
