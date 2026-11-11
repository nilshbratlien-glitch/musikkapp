import { blockTool, playsMetronome, type BlockId } from "@/lib/oveplan";
import {
  armBlockRemote,
  beginBlockRemote,
  getPlanClock,
  pauseBlockRemote,
  resumeBlockRemote,
  setPlanBroadcastHook,
  setPlanMetroRemote,
  startPlanMetroRemote,
  stopPlanMetroRemote,
  stopPlanRemote,
} from "@/lib/plan-clock";
import { setMasterMuted } from "@/lib/pulse";
import { broadcastSync, getSyncState, onSyncPayload, subscribeSyncState } from "./room";
import type { SyncPayload } from "./types";

let initialized = false;
let routerNavigate: ((to: string) => void) | null = null;

export function registerSyncNavigator(navigate: (to: string) => void) {
  routerNavigate = navigate;
}

function runSightAction(action: "generate" | "togglePlay", attempt = 0) {
  if (typeof window === "undefined") return;
  const ms = window.MalletSight as
    | {
        generate?: () => void;
        togglePlay?: () => void;
      }
    | undefined;
  if (ms && typeof ms[action] === "function") {
    ms[action]!();
    return;
  }
  if (attempt < 6) {
    window.setTimeout(() => runSightAction(action, attempt + 1), 120);
  }
}

function applyRemoteSightTempo(bpm: number) {
  if (typeof window === "undefined") return;
  const ms = window.MalletSight as { setTempo?: (bpm: number) => void } | undefined;
  ms?.setTempo?.(bpm);
}

export function broadcastControllerSnapshot() {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  const clock = getPlanClock();
  if (clock.activeId) {
    const item = clock.store.items.find((i) => i.id === clock.activeId);
    const mins = item?.mins ?? 10;
    if (!clock.blockPaused && clock.timer != null) {
      syncPlanStart(
        clock.activeId,
        mins,
        clock.store.bpm,
        clock.store.beats,
        clock.store.sub,
        mins * 60,
        clock.blockEndsAt,
      );
      if (clock.metroRunning !== playsMetronome(clock.activeId)) {
        if (clock.metroRunning) {
          syncMetroStart(clock.store.bpm, clock.store.beats, clock.store.sub);
        } else {
          syncMetroStop();
        }
      }
    } else {
      const remainMs = clock.blockPaused ? Math.max(0, clock.blockRemainMs) : Math.max(0, clock.blockLeft * 1000);
      syncPlanArm(
        clock.activeId,
        mins,
        clock.store.bpm,
        clock.store.beats,
        clock.store.sub,
        remainMs,
        false,
      );
      if (clock.metroRunning) {
        syncMetroStart(clock.store.bpm, clock.store.beats, clock.store.sub);
      }
    }
  } else if (clock.metroRunning) {
    syncMetroStart(clock.store.bpm, clock.store.beats, clock.store.sub);
  }
}

export function initSyncBridge() {
  if (initialized) return;
  initialized = true;

  // Register broadcast hook so controller broadcasts all block lifecycle actions automatically
  setPlanBroadcastHook({
    shouldNavigateLocally: () => {
      const state = getSyncState();
      return !(state.connected && state.role === "controller");
    },
    isFollower: () => {
      const state = getSyncState();
      return state.connected && state.role === "display";
    },
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
    onArm: (item, chime) => {
      const clock = getPlanClock();
      syncPlanArm(
        item.id,
        item.mins,
        clock.store.bpm,
        clock.store.beats,
        clock.store.sub,
        undefined,
        chime,
      );
    },
    onPause: (remainMs) => syncPlanPause(remainMs),
    onResume: (endsAt) => syncPlanResume(endsAt),
    onStop: (chime) => syncPlanStop(chime),
    onBpm: (bpm) => syncMetroSet(bpm),
    onMeter: (beats, sub) => {
      const clock = getPlanClock();
      syncMetroSet(clock.store.bpm, beats, sub);
    },
    onMetroStart: (bpm, beats, sub) => syncMetroStart(bpm, beats, sub),
    onMetroStop: () => syncMetroStop(),
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

    if (payload.type === "SYNC_REQUEST") {
      if (state.connected && state.role === "controller") {
        broadcastControllerSnapshot();
      }
      return;
    }

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
        const to = blockTool(payload.blockId as BlockId) ?? "/oveplan";
        if (routerNavigate) {
          routerNavigate(to);
        }
        if (payload.blockId === "srf") {
          applyRemoteSightTempo(payload.bpm);
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
          payload.remainMs,
          payload.chime,
        );
        const to = blockTool(payload.blockId as BlockId) ?? "/oveplan";
        if (routerNavigate) {
          routerNavigate(to);
        }
        if (payload.blockId === "srf") {
          applyRemoteSightTempo(payload.bpm);
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
        stopPlanRemote(payload.chime);
        if (routerNavigate) {
          routerNavigate("/oveplan");
        }
        break;
      }

      case "PLAN_NAVIGATE": {
        if (routerNavigate) {
          routerNavigate(payload.to);
        }
        break;
      }

      case "METRO_SET": {
        setPlanMetroRemote(payload.bpm, payload.beats, payload.sub);
        applyRemoteSightTempo(payload.bpm);
        break;
      }

      case "METRO_START": {
        startPlanMetroRemote(payload.bpm, payload.beats ?? 4, payload.sub ?? 1);
        break;
      }

      case "METRO_STOP": {
        stopPlanMetroRemote();
        break;
      }

      case "SIGHT_ACTION": {
        if (routerNavigate) {
          routerNavigate("/");
        }
        runSightAction(payload.action);
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
  remainMs?: number,
  chime?: boolean,
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
    remainMs,
    chime,
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

export function syncPlanStop(chime?: boolean) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({
    type: "PLAN_STOP",
    chime,
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

export function syncSightAction(action: "generate" | "togglePlay") {
  const state = getSyncState();
  if (state.connected && state.role === "controller") {
    broadcastSync({
      type: "SIGHT_ACTION",
      action,
    });
  } else {
    runSightAction(action);
  }
}
