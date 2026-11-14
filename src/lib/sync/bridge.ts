import { blockTool, playsMetronome, type BlockId } from "@/lib/oveplan";
import {
  armBlockRemote,
  beginBlockRemote,
  getPlanClock,
  pauseBlockRemote,
  resumeBlockRemote,
  setPlanBpm,
  setPlanBroadcastHook,
  setPlanMetroRemote,
  startPlanMetroRemote,
  stopPlanMetroRemote,
  stopPlanRemote,
  syncRemainRemote,
} from "@/lib/plan-clock";
import {
  getProfile,
  setProfile,
  setProfileBroadcastHook,
  type InstrumentProfile,
} from "@/lib/profile";
import { setFollowerMode, setMasterMuted } from "@/lib/pulse";
import { broadcastSync, getSyncState, onSyncPayload, subscribeSyncState } from "./room";
import type { DuetViewPart, SyncPayload } from "./types";

export type SightAction =
  | "generate"
  | "togglePlay"
  | "toggleMetro"
  | "startPlay"
  | "stopPlay"
  | "startMetro"
  | "stopMetro"
  | "again";

type MalletSightApi = NonNullable<Window["MalletSight"]> & {
  getSeed?: () => number | null;
  getSyncSettings?: () => Record<string, unknown> | null;
  applySeed?: (payload: { seed: number; settings?: Record<string, unknown>; tempo?: number }) => boolean;
  getDuetViewPart?: () => DuetViewPart;
  setDuetViewPart?: (part: DuetViewPart) => boolean;
};

declare global {
  interface Window {
    MusikkSync?: {
      isController: () => boolean;
      isAudioActive: () => boolean;
      sightAction: (action: SightAction) => void;
      sightSeed: (seed: number, settings: Record<string, unknown>, tempo?: number) => void;
      sightScore: (score: unknown, tempo?: number) => void;
      sightDuetView: (duetViewPart: DuetViewPart) => void;
      isDuetViewPaired: () => boolean;
      setDuetViewPaired: (paired: boolean) => void;
      setTempo: (bpm: number) => void;
    };
  }
}

let initialized = false;
let routerNavigate: ((to: string) => void) | null = null;
let heartbeatTimer: number | null = null;
let pairedDuetView = false;
const duetViewPairedListeners = new Set<() => void>();

export function isDuetViewPaired() {
  return pairedDuetView;
}

export function subscribeDuetViewPaired(listener: () => void) {
  duetViewPairedListeners.add(listener);
  return () => {
    duetViewPairedListeners.delete(listener);
  };
}

export function setDuetViewPaired(paired: boolean) {
  if (pairedDuetView === paired) return;
  pairedDuetView = paired;
  for (const listener of duetViewPairedListeners) listener();
  if (paired && typeof window !== "undefined") {
    const ms = window.MalletSight as MalletSightApi | undefined;
    const part = ms?.getDuetViewPart?.();
    if (part) {
      syncDuetViewPart(part);
    }
  }
}

export function registerSyncNavigator(navigate: (to: string) => void) {
  routerNavigate = navigate;
}

const SIGHT_BTN_MAP: Record<SightAction, string> = {
  generate: "#malletsight-root #btnGenerate",
  togglePlay: "#malletsight-root #btnPlay",
  toggleMetro: "#malletsight-root #btnMetro",
  startPlay: "#malletsight-root #btnPlay",
  stopPlay: "#malletsight-root #btnPlay",
  startMetro: "#malletsight-root #btnMetro",
  stopMetro: "#malletsight-root #btnMetro",
  again: "#malletsight-root #btnAgain",
};

export function runSightAction(action: SightAction, attempt = 0) {
  if (typeof window === "undefined") return;
  const ms = window.MalletSight;
  const btn = typeof document !== "undefined" ? (document.querySelector(SIGHT_BTN_MAP[action]) as HTMLElement | null) : null;
  const ready = ms?.isReady ? ms.isReady() : Boolean(btn);

  if (!ready) {
    if (attempt < 30) {
      window.setTimeout(() => runSightAction(action, attempt + 1), 100);
    }
    return;
  }

  if (action === "togglePlay" || action === "startPlay" || action === "stopPlay" || action === "again") {
    stopPlanMetroRemote();
  }

  const fn = ms?.[action];
  if (typeof fn === "function") {
    const ok = fn();
    if (ok !== false) return;
  }

  if (btn) {
    btn.click();
    return;
  }

  if (attempt < 30) {
    window.setTimeout(() => runSightAction(action, attempt + 1), 100);
  }
}

function applyRemoteSightTempo(bpm: number, attempt = 0) {
  if (typeof window === "undefined") return;
  const ms = window.MalletSight;
  if (ms && typeof ms.setTempo === "function") {
    const ok = ms.setTempo(bpm);
    if (ok !== false) return;
  }
  if (attempt < 20) {
    window.setTimeout(() => applyRemoteSightTempo(bpm, attempt + 1), 100);
  }
}

function applyRemoteSightScore(score: unknown, tempo?: number, attempt = 0) {
  if (typeof window === "undefined" || !score) return;
  const ms = window.MalletSight as MalletSightApi | undefined;
  const ready = ms?.isReady ? ms.isReady() : false;
  if (ready && ms && typeof ms.applyScore === "function") {
    const ok = ms.applyScore(score, tempo);
    if (ok !== false) return;
  }
  if (attempt < 30) {
    window.setTimeout(() => applyRemoteSightScore(score, tempo, attempt + 1), 100);
  }
}

function applyRemoteSightSeed(
  seed: number,
  settings?: Record<string, unknown>,
  tempo?: number,
  attempt = 0,
) {
  if (typeof window === "undefined" || !Number.isFinite(seed)) return;
  const ms = window.MalletSight as MalletSightApi | undefined;
  const ready = ms?.isReady ? ms.isReady() : false;
  if (ready && ms && typeof ms.applySeed === "function") {
    const ok = ms.applySeed({ seed, settings, tempo });
    if (ok !== false) return;
  }
  if (attempt < 30) {
    window.setTimeout(() => applyRemoteSightSeed(seed, settings, tempo, attempt + 1), 100);
  }
}

function applyRemoteDuetViewPart(duetViewPart: DuetViewPart, attempt = 0) {
  if (typeof window === "undefined") return;
  const ms = window.MalletSight as MalletSightApi | undefined;
  const ready = ms?.isReady ? ms.isReady() : false;
  if (ready && ms && typeof ms.setDuetViewPart === "function") {
    const ok = ms.setDuetViewPart(duetViewPart);
    if (ok !== false) return;
  }
  if (attempt < 30) {
    window.setTimeout(() => applyRemoteDuetViewPart(duetViewPart, attempt + 1), 100);
  }
}

function stopRemoteSightPlayback() {
  if (typeof window === "undefined") return;
  window.MalletSight?.stopAll?.();
}

export function emitPlanHeartbeat() {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return false;
  const clock = getPlanClock();
  if (!clock.activeId || clock.blockPaused || clock.timer == null) return false;
  broadcastSync({
    type: "PLAN_HEARTBEAT",
    blockId: clock.activeId,
    remainMs: Math.max(0, clock.blockEndsAt - Date.now()),
  });
  return true;
}

export function syncDuetViewPart(duetViewPart: DuetViewPart) {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({ type: "SIGHT_DUET_VIEW", duetViewPart });
}

export function broadcastControllerSnapshot() {
  const state = getSyncState();
  if (!state.connected || state.role !== "controller") return;
  broadcastSync({ type: "PROFILE_SET", profile: getProfile() });
  if (typeof window !== "undefined") {
    const ms = window.MalletSight as MalletSightApi | undefined;
    const seed = ms?.getSeed?.();
    const syncSettings = ms?.getSyncSettings?.();
    if (typeof seed === "number" && syncSettings) {
      broadcastSync({
        type: "SIGHT_SET",
        seed,
        settings: syncSettings,
        tempo: ms?.getTempo?.(),
      });
    } else if (ms?.getScore) {
      const score = ms.getScore();
      if (score) {
        broadcastSync({
          type: "SIGHT_SET",
          score,
          tempo: ms.getTempo?.(),
        });
      }
    }
    if (pairedDuetView && ms?.getDuetViewPart) {
      const part = ms.getDuetViewPart();
      if (part) {
        broadcastSync({ type: "SIGHT_DUET_VIEW", duetViewPart: part });
      }
    }
  }
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

  setProfileBroadcastHook((profile: InstrumentProfile) => {
    const s = getSyncState();
    if (s.connected && s.role === "controller") {
      broadcastSync({ type: "PROFILE_SET", profile });
    }
  });

  if (typeof window !== "undefined") {
    if (heartbeatTimer == null) {
      heartbeatTimer = window.setInterval(() => {
        emitPlanHeartbeat();
      }, 12_000);
    }
    window.MusikkSync = {
      isController: () => {
        const s = getSyncState();
        return s.connected && s.role === "controller";
      },
      isAudioActive: () => {
        const s = getSyncState();
        return !s.connected || s.audioActive;
      },
      sightAction: (action: SightAction) => {
        const s = getSyncState();
        if (s.connected && s.role === "controller") {
          broadcastSync({ type: "SIGHT_ACTION", action });
        }
      },
      sightSeed: (seed: number, settings: Record<string, unknown>, tempo?: number) => {
        const s = getSyncState();
        if (s.connected && s.role === "controller" && Number.isFinite(seed)) {
          broadcastSync({ type: "SIGHT_SET", seed, settings, tempo });
        }
      },
      sightScore: (score: unknown, tempo?: number) => {
        const s = getSyncState();
        if (s.connected && s.role === "controller" && score) {
          broadcastSync({ type: "SIGHT_SET", score, tempo });
        }
      },
      sightDuetView: (duetViewPart: DuetViewPart) => {
        syncDuetViewPart(duetViewPart);
      },
      isDuetViewPaired: () => pairedDuetView,
      setDuetViewPaired: (paired: boolean) => {
        setDuetViewPaired(paired);
      },
      setTempo: (bpm: number) => {
        setPlanBpm(bpm, true);
      },
    };
  }

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

  // Sync audio mute and follower state with pulse core
  const syncPulseFlags = () => {
    const state = getSyncState();
    setFollowerMode(state.connected && state.role === "display");
    if (state.connected) {
      setMasterMuted(!state.audioActive);
    } else {
      setMasterMuted(false);
    }
  };
  subscribeSyncState(syncPulseFlags);
  syncPulseFlags();

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
      case "PROFILE_SET": {
        setProfile(payload.profile, { broadcast: false });
        break;
      }

      case "PLAN_START": {
        if (payload.blockId !== "srf") {
          stopRemoteSightPlayback();
        }
        beginBlockRemote(
          payload.blockId as BlockId,
          payload.mins,
          payload.bpm,
          payload.beats,
          payload.sub,
          payload.endsAt,
          payload.remainMs,
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
        if (payload.blockId !== "srf") {
          stopRemoteSightPlayback();
        }
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
        stopRemoteSightPlayback();
        pauseBlockRemote(payload.remainMs);
        break;
      }

      case "PLAN_RESUME": {
        resumeBlockRemote(payload.endsAt, payload.remainMs);
        break;
      }

      case "PLAN_STOP": {
        stopRemoteSightPlayback();
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

      case "PLAN_HEARTBEAT": {
        syncRemainRemote(payload.blockId, payload.remainMs);
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

      case "SIGHT_SET": {
        if (typeof payload.seed === "number") {
          if (routerNavigate) {
            routerNavigate("/");
          }
          applyRemoteSightSeed(payload.seed, payload.settings, payload.tempo);
        } else if (payload.score) {
          if (routerNavigate) {
            routerNavigate("/");
          }
          applyRemoteSightScore(payload.score, payload.tempo);
        } else if (typeof payload.tempo === "number") {
          applyRemoteSightTempo(payload.tempo);
        }
        break;
      }

      case "SIGHT_DUET_VIEW": {
        applyRemoteDuetViewPart(payload.duetViewPart);
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
    remainMs: Math.max(0, endsAt - Date.now()),
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
    remainMs: Math.max(0, endsAt - Date.now()),
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

export function syncSightAction(action: SightAction) {
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
