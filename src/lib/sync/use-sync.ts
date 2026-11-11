import { useSyncExternalStore } from "react";
import {
  broadcastSync,
  getSyncState,
  joinRoom,
  leaveRoom,
  setAudioActive,
  setDeviceName,
  setRole,
  subscribeSyncState,
} from "./room.ts";
import type { SyncPayload } from "./types.ts";

export function useSync() {
  const state = useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState);

  return {
    ...state,
    joinRoom,
    leaveRoom,
    broadcastSync: (payload: SyncPayload) => broadcastSync(payload),
    setRole,
    setAudioActive,
    setDeviceName,
  };
}
