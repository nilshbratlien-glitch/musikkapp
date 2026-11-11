import { blockTool, type BlockId } from "@/lib/oveplan";
import {
  armBlockRemote,
  beginBlockRemote,
  getPlanClock,
  pauseBlockRemote,
  resumeBlockRemote,
  setPlanBpm,
  setPlanBroadcastHook,
  setPlanMeter,
  stopPlanRemote,
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

  // Register broadcast hook so controller broadcasts all block lifecycle actions automatically
  setPlanBroadcastHook({
    onStart: (item, endsAt) => {
      const clock = getPlanClock();
      syncPlanStart(
        item.id,
        item.mins,
        clock.store.bpm,
        clock.store.beats,
        clock.store.sub,
        item.mins * 60,
        endsAt,
      );
    },
    onArm: (item) => {
      const clock = getPlanClock();
      syncPlanArm(
        item.id,
        item.mins,
        clock.store.bpm,
        clock.store.beats,
        clock.store.sub,
      );
    },
    onPause: (remainMs) => syncPlanPause(remainMs),
    onResume: (endsAt) => syncPlanResume(endsAt),
    onStop: () => syncPlanStop(),
    onBpm: (bpm) => syncMetroSet(bpm),
    onMeter: (beats, sub) => {
      const clock = getPlanClock();
      syncMetroSet(clock.store.bpm, beats, sub);
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
          payload.beats,
          payload.sub,
          payload.endsAt,
        );
        const to = blockTool(payload.blockId as BlockId);
        if (to && routerNavigate) {
          routerNavigate(to);
        }
        break;
      }

      case "PLAN_ARM": {
        armBlockRemote(
          payload.blockId as BlockId,
          payload.mins,
          payload.bpm,
          payload.beats,
          payload.sub,
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

      case "PLAN_STOP": {
        stopPlanRemote();
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
        if (payload.beats != null && payload.sub != null) {
          setPlanMeter(payload.beats, payload.sub);
        }
        break;
      }

      case "METRO_START": {
        if (state.audioActive) {
          pulseStart({
            owner: "metronom",
            bpm: payload.bpm,
            beats: payload.beats ?? 4,
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
  beats: number,
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
    beats,
    sub,
    durationSec,
    endsAt,
  });
}

export function syncPlanArm(
  blockId: string,
  mins: number,
  bpm: number,
  beats: number,
  sub: number,
) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "PLAN_ARM",
    blockId,
    mins,
    bpm,
    beats,
    sub,
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

export function syncPlanStop() {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "PLAN_STOP",
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

export function syncMetroSet(bpm: number, beats?: number, sub?: number) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "METRO_SET",
    bpm,
    beats,
    sub,
  });
}

export function syncMetroStart(bpm: number, beats?: number, sub?: number) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "METRO_START",
    bpm,
    beats,
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
