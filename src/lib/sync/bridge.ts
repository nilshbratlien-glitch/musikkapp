import { blockTool, playsMetronome, type BlockId } from "@/lib/oveplan";
import {
  beginBlockRemote,
  getPlanClock,
  pauseBlockRemote,
  resumeBlockRemote,
  setPlanBpm,
  setPlanBroadcastHook,
  setPlanMeter,
  stopPlanMetro,
} from "@/lib/plan-clock";
import { setMasterMuted, start as pulseStart, stop as pulseStop } from "@/lib/pulse";
import { broadcastSync, getSyncState, onSyncPayload, subscribeSyncState } from "./room";
import type { SyncPayload } from "./types";

let initialized = false;
let routerNavigate: ((to: string) => void) | null = null;

export function registerSyncNavigator(navigate: (to: string) => void) {
  routerNavigate = navigate;
}

export function initSyncBridge() {
  if (initialized) return;
  initialized = true;

  // Register broadcast hook so controller broadcasts its actions automatically
  setPlanBroadcastHook({
    onStart: (item, endsAt) => {
      const clock = getPlanClock();
      syncPlanStart(
        item.id,
        item.mins,
        clock.store.bpm,
        `${clock.store.beats}/4`,
        clock.store.sub,
        item.mins * 60,
        endsAt,
      );
    },
    onPause: (remainMs) => syncPlanPause(remainMs),
    onResume: (endsAt) => syncPlanResume(endsAt),
    onBpm: (bpm) => syncMetroSet(bpm),
    onMeter: (beats, sub) => {
      const clock = getPlanClock();
      syncMetroSet(clock.store.bpm, `${beats}/4`, sub);
    },
  });

  // Sync audio mute state with pulse core
  subscribeSyncState(() => {
    const state = getSyncState();
    if (state.connected) {
      setMasterMuted(!state.audioActive);
    } else {
      setMasterMuted(false);
    }
  });

  // Handle incoming remote sync messages
  onSyncPayload((payload: SyncPayload) => {
    const state = getSyncState();
    // Only "display" devices automatically follow controller commands
    if (state.role !== "display") return;

    switch (payload.type) {
      case "PLAN_START": {
        beginBlockRemote(
          payload.blockId as BlockId,
          payload.mins,
          payload.bpm,
          payload.meter,
          payload.sub,
          payload.endsAt,
        );
        const to = blockTool(payload.blockId as BlockId);
        if (to && routerNavigate) {
          routerNavigate(to);
        }
        break;
      }

      case "PLAN_PAUSE": {
        pauseBlockRemote(payload.remainMs);
        break;
      }

      case "PLAN_RESUME": {
        resumeBlockRemote(payload.endsAt);
        break;
      }

      case "PLAN_FINISH": {
        // Just pause sound when block finishes
        stopPlanMetro();
        break;
      }

      case "PLAN_NAVIGATE": {
        if (routerNavigate) {
          routerNavigate(payload.to);
        }
        break;
      }

      case "METRO_SET": {
        setPlanBpm(payload.bpm);
        break;
      }

      case "METRO_START": {
        if (state.audioActive) {
          pulseStart({
            owner: "metronom",
            bpm: payload.bpm,
            beats: 4,
            sub: payload.sub ?? 1,
          });
        }
        break;
      }

      case "METRO_STOP": {
        pulseStop("metronom");
        break;
      }
    }
  });
}

// Helpers called by controller components
export function syncPlanStart(
  blockId: string,
  mins: number,
  bpm: number,
  meter: string,
  sub: number,
  durationSec: number,
  endsAt: number,
) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "PLAN_START",
    blockId,
    mins,
    bpm,
    meter,
    sub,
    durationSec,
    endsAt,
  });
}

export function syncPlanPause(remainMs: number) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "PLAN_PAUSE",
    remainMs,
  });
}

export function syncPlanResume(endsAt: number) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "PLAN_RESUME",
    endsAt,
  });
}

export function syncPlanNavigate(to: string) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "PLAN_NAVIGATE",
    to,
  });
}

export function syncMetroSet(bpm: number, meter?: string, sub?: number) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "METRO_SET",
    bpm,
    meter,
    sub,
  });
}

export function syncMetroStart(bpm: number, meter?: string, sub?: number) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "METRO_START",
    bpm,
    meter,
    sub,
  });
}

export function syncMetroStop() {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "METRO_STOP",
  });
}
